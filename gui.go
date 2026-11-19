// Графический интерфейс: встроенный веб-сервер в самом бинарнике.
//
// Тот же подход, что в OCRTAG: ресурсы вшиты через embed, сервер на net/http,
// никаких GUI-фреймворков и внешних зависимостей. Логика печати не
// дублируется — интерфейс вызывает те же функции, что и командная строка.
package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	_ "image/gif"
	_ "image/jpeg"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web/*
var webAssets embed.FS

// Принтер держит ОДНО BLE-соединение, поэтому все обращения к нему
// выстраиваем в очередь.
var bleMu sync.Mutex

// guiVerbose включает вывод протокола в интерфейсе (флаг -v).
var guiVerbose = true

// --------------------------------------------------------------------------
// Задания печати
// --------------------------------------------------------------------------

type job struct {
	mu      sync.Mutex
	Total   int       `json:"total"`
	Done    int       `json:"done"`
	State   string    `json:"state"` // running | done | error
	Err     string    `json:"error,omitempty"`
	Started time.Time `json:"-"`
}

var (
	jobsMu sync.Mutex
	jobs   = map[string]*job{}
	jobSeq int
)

func newJob(total int) (string, *job) {
	jobsMu.Lock()
	defer jobsMu.Unlock()
	jobSeq++
	id := fmt.Sprintf("job-%d", jobSeq)
	j := &job{Total: total, State: "running", Started: time.Now()}
	jobs[id] = j
	return id, j
}

func (j *job) set(done int) {
	j.mu.Lock()
	j.Done = done
	j.mu.Unlock()
}

func (j *job) finish(err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err != nil {
		j.State, j.Err = "error", err.Error()
		return
	}
	j.State, j.Done = "done", j.Total
}

func (j *job) snapshot() job {
	j.mu.Lock()
	defer j.mu.Unlock()
	return job{Total: j.Total, Done: j.Done, State: j.State, Err: j.Err}
}

// --------------------------------------------------------------------------
// Шаблоны настроек
// --------------------------------------------------------------------------

// Template — комбинированный профиль задачи: может включать дизайн (elements),
// настройки одиночной/серийной печати и системные параметры (system).
type Template struct {
Name        string `json:"name"`
HasDesigner bool   `json:"hasDesigner,omitempty"`
HasSingle   bool   `json:"hasSingle,omitempty"`
HasSystem   bool   `json:"hasSystem,omitempty"`

// Базовые параметры этикетки
Length    float64 `json:"length"`
Font      float64 `json:"font,omitempty"`
Density   int     `json:"density,omitempty"`
Label     string  `json:"label,omitempty"`
Copies    int     `json:"copies,omitempty"`
Flip      bool    `json:"flip,omitempty"`
Threshold int     `json:"threshold,omitempty"`

// Секция 1: Настройки одиночной и серийной печати
BcFormat     string `json:"bcFormat,omitempty"`
GapPx        *int   `json:"gapPx,omitempty"`
TextGapPx    *int   `json:"textGapPx,omitempty"`
FontName     string `json:"fontName,omitempty"`
FontSize     string `json:"fontSize,omitempty"`
Bold         bool   `json:"bold,omitempty"`
MarginPx     *int   `json:"marginPx,omitempty"`
SideMarginPx *int   `json:"sideMarginPx,omitempty"`
OffsetPx     *int   `json:"offsetPx,omitempty"`
BcData       string `json:"bcData,omitempty"`
TopText      string `json:"topText,omitempty"`
BottomText   string `json:"bottomText,omitempty"`
SingleText   string `json:"singleText,omitempty"`
CsvHeader    bool   `json:"csvHeader,omitempty"`
Template     string `json:"template,omitempty"`
Colorder     string `json:"colorder,omitempty"`
	CounterStart *int   `json:"counterStart,omitempty"`
	CounterStep  *int   `json:"counterStep,omitempty"`

// Секция 2: Визуальный макет из Конструктора
Elements []Element `json:"elements,omitempty"`

// Секция 3: Системные параметры (приоритет выше config.json)
System *AppConfig `json:"system,omitempty"`
}

func normalizeTemplateFlags(t *Template) {
if !t.HasDesigner && !t.HasSingle && !t.HasSystem {
if len(t.Elements) > 0 {
t.HasDesigner = true
}
if strings.TrimSpace(t.Template) != "" || strings.TrimSpace(t.BcData) != "" ||
strings.TrimSpace(t.SingleText) != "" || strings.TrimSpace(t.FontName) != "" || !t.HasDesigner {
t.HasSingle = true
}
if t.System != nil {
t.HasSystem = true
}
}
}

func templatesPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "niimbot", "templates.json")
}

func loadTemplates() []Template {
data, err := os.ReadFile(templatesPath())
if err != nil {
return nil
}
var list []Template
if json.Unmarshal(data, &list) != nil {
return nil
}
for i := range list {
normalizeTemplateFlags(&list[i])
}
return list
}

func saveTemplates(list []Template) error {
	path := templatesPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// --------------------------------------------------------------------------
// Ответы
// --------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// withPrinter подключается к принтеру, подержав очередь, и отдаёт его обработчику.
func withPrinter(address string, fn func(*Printer) error) error {
bleMu.Lock()
defer bleMu.Unlock()

cfg := LoadConfig()
if strings.TrimSpace(address) == "" {
address = strings.TrimSpace(cfg.Address)
}
foundByName := false
if address == "" {
found, err := ScanPrinter("N1-", 12*time.Second, guiVerbose)
if err != nil {
return err
}
address = found
foundByName = true
}
p, release, err := acquirePrinter(address, guiVerbose, foundByName)
if err != nil {
return err
}
defer release()
if err := fn(p); err != nil {
disconnectSharedPrinter()
return err
}
return nil
}

// --------------------------------------------------------------------------
// API
// --------------------------------------------------------------------------

// apiStatus — состояние принтера и расходников.
func apiStatus(address string) (map[string]any, error) {
	var out = map[string]any{}
	err := withPrinter(address, func(p *Printer) error {
		info, err := p.Handshake()
		if err != nil {
			return err
		}
		out["printer"] = info
		for key, ribbon := range map[string]bool{"paper": false, "ribbon": true} {
			rf, err := p.ReadRfid(ribbon)
			if err != nil {
				continue
			}
			out["rfid_"+key] = map[string]any{
				"tag":       rf.TagPresent,
				"serial":    rf.Serial,
				"barcode":   rf.Barcode,
				"labelType": rf.LabelTypeName(),
				"typeID":    rf.LabelType,
				"total":     rf.AllPaper,
				"used":      rf.UsedPaper,
				"left":      rf.Leftover(),
			}
		}
		return nil
	})
	return out, err
}

// printRequest — тело запросов на печать.
type printRequest struct {
Mode         string    `json:"mode"`         // barcode | single | image | series
Items        []string  `json:"items"`        // строки данных: одна запись на этикетку
Template     string    `json:"template"`     // шаблон этикетки с {1}, {2}… (необязательно)
Elements     []Element `json:"elements"`     // шаблон из конструктора (важнее Template)
Length       float64   `json:"length"`
Font         float64   `json:"font"`
Density      int       `json:"density"`
Label        string    `json:"label"`
Copies       int       `json:"copies"`
Flip         bool      `json:"flip"`
Threshold    int       `json:"threshold"`    // порог чёрно-белого, 0..255; 0 — по умолчанию
Address      string    `json:"address"`
BcFormat     string    `json:"bcFormat"`     // auto | code128 | qr | qrl | qrr
TopText      string    `json:"topText"`      // верхний текст штрихкода
BottomText   string    `json:"bottomText"`   // нижний текст штрихкода
FontName     string    `json:"fontName"`     // шрифт текста/подписи
FontSize     string    `json:"fontSize"`     // размер текста: -1, 0, N, Np
Bold         bool      `json:"bold"`         // жирный текст/подпись
MarginPx     *int      `json:"marginPx"`     // поля верх/низ, px (указатель, чтобы 0 не терялся)
SideMarginPx *int      `json:"sideMarginPx"` // боковые поля, px
GapPx        *int      `json:"gapPx"`        // зазор код-текст, px
TextGapPx    *int      `json:"textGapPx"`
	OffsetPx     *int      `json:"offsetPx"`     // сдвиг по X, px    // зазор доп. текста, px
ImageData    string    `json:"imageData"`
	Stretch      bool      `json:"stretch"`      // растянуть картинку без сохранения пропорций
CounterStart *int      `json:"counterStart,omitempty"`
CounterStep  *int      `json:"counterStep,omitempty"`
PreviewIndex int       `json:"previewIndex,omitempty"`
PreviewTotal int       `json:"previewTotal,omitempty"`
}

// splitFields разбирает строку данных на столбцы: ; , или табуляция.
func splitFields(s string) []string {
	s = strings.TrimRight(s, "\r")
	sep := ";"
	switch {
	case strings.Contains(s, "\t"):
		sep = "\t"
	case strings.Contains(s, ";"):
		sep = ";"
	case strings.Contains(s, ","):
		sep = ","
	}
	return splitQuoted(s, sep)
}

// splitQuoted делит строку по разделителю, не трогая разделители внутри
// кавычек, и снимает сами кавычки: "Насос; старый";12А-5 → 2 столбца.
func splitQuoted(s, sep string) []string {
	var out []string
	var cur strings.Builder
	inQuotes := false
	runes := []rune(s)
	sepRunes := []rune(sep)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		switch {
		case inQuotes && c == '"':
			// удвоенная кавычка внутри поля — это одна кавычка
			if i+1 < len(runes) && runes[i+1] == '"' {
				cur.WriteRune('"')
				i++
			} else {
				inQuotes = false
			}
		case !inQuotes && c == '"':
			inQuotes = true
		case !inQuotes && len(sepRunes) == 1 && c == sepRunes[0]:
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
		default:
			cur.WriteRune(c)
		}
	}
	out = append(out, strings.TrimSpace(cur.String()))
	return out
}

// rePlaceholder находит неподставленные {1}, {2}… в строке этикетки.
var rePlaceholder = regexp.MustCompile(`\{\d+\}`)

// expandTemplate подставляет столбцы строки данных в шаблон этикетки.
//
// Каждая строка шаблона становится строкой этикетки — включая пустые:
// так раскладка одинакова у всех этикеток серии, даже если какое-то поле
// пустое. Пустые строки в конце шаблона отбрасываются.
//
// Если шаблон ссылается на столбец, которого в данных нет, возвращается
// ошибка: иначе на этикетке напечаталось бы литеральное «{3}» — брак,
// который на бумаге уже не исправить.
func expandTemplate(tpl string, row []string) ([]string, error) { return expandTemplateCtx(tpl, row, 1, 1) }
func expandTemplateCtx(tpl string, row []string, counter, total int) ([]string, error) {
	if substituted, err := substituteFieldsCtx(tpl, row, time.Now(), counter, total); err == nil { tpl = substituted } else { return nil, err }
	lines := strings.Split(tpl, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}

	out := make([]string, 0, len(lines))
	for _, line := range lines {
		for i, v := range row {
			line = strings.ReplaceAll(line, fmt.Sprintf("{%d}", i+1), v)
		}
		if bad := rePlaceholder.FindString(line); bad != "" {
			return nil, fmt.Errorf(
				"шаблон использует %s, а в данных только %d столбц(а/ов). "+
					"Проверьте, что в CSV столько же столбцов, сколько в шаблоне", bad, len(row))
		}
		out = append(out, strings.TrimRight(line, " \t"))
	}
	return out, nil
}

// splitLabel превращает текст этикетки в строки: «A|B» → две строки.
func splitLabel(s string) []string {
	s = strings.TrimRight(s, "\r")
	parts := strings.Split(s, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	// если разделителей нет — это одна строка
	if len(parts) == 1 && parts[0] == "" {
		return nil
	}
	return parts
}

// renderPages готовит страницы битмапа по списку этикеток.
func renderPages(req printRequest) ([][]Row, error) {
	length := req.Length
	if length <= 0 {
		length = 30
	}
	var pages [][]Row
	for rowIdx, item := range req.Items {
		cs, cst := resolveCounterParams(req); img, err := renderOneCtx(req, item, length, cs+rowIdx*cst, len(req.Items))
		if err != nil {
			return nil, err
		}
		if img == nil {
			continue
		}
		pages = append(pages, ImageToRowsAt(img, req.Flip, req.threshold()))
	}
	return pages, nil
}

// threshold возвращает порог для запроса: свой или общий по умолчанию.
func (r printRequest) threshold() uint8 {
	if r.Threshold >= 1 && r.Threshold <= 255 {
		return uint8(r.Threshold)
	}
	return binarizeThreshold
}

// renderOne готовит одну этикетку: по шаблону конструктора, если он задан,
// иначе прежним способом — текстом с шаблоном или строкой через |.
func renderOne(req printRequest, item string, length float64) (*image.Gray, error) {
cfg := LoadConfig()
marginPx := cfg.MarginPx
if req.MarginPx != nil {
marginPx = *req.MarginPx
}
sideMarginPx := cfg.SideMarginPx
if req.SideMarginPx != nil {
sideMarginPx = *req.SideMarginPx
}
gapPx := cfg.GapPx
if req.GapPx != nil {
gapPx = *req.GapPx
}
textGapPx := cfg.TextGapPx
if req.TextGapPx != nil {
textGapPx = *req.TextGapPx
}
	offsetPx := cfg.OffsetPx
	if req.OffsetPx != nil {
		offsetPx = *req.OffsetPx
	}

if req.Mode == "barcode" {
return RenderBarcodeLabel(BarcodeOptions{
Data:           item,
Format:         req.BcFormat,
LengthMM:       length,
TopText:        req.TopText,
BottomText:     req.BottomText,
FontName:       req.FontName,
IsMainTextBold: req.Bold,
FontSize:       req.FontSize,
OffsetPx:       offsetPx,
SideMarginPx:   sideMarginPx,
MarginPx:       marginPx,
GapPx:          gapPx,
TextGapPx:      textGapPx,
}, cfg)
}
if req.Mode == "image" {
raw := strings.TrimSpace(req.ImageData)
if idx := strings.Index(raw, ","); idx >= 0 {
raw = raw[idx+1:]
}
if raw == "" {
return nil, fmt.Errorf("выберите файл картинки")
}
bin, err := base64.StdEncoding.DecodeString(raw)
if err != nil {
return nil, fmt.Errorf("ошибка чтения картинки: %w", err)
}
src, _, err := image.Decode(bytes.NewReader(bin))
if err != nil {
return nil, fmt.Errorf("неподдерживаемый формат картинки: %w", err)
}
res := FitToLabelEx(src, length, marginPx, sideMarginPx, req.Stretch)
		if offsetPx != 0 { shiftImageX(res, offsetPx) }
		return res, nil
}
if len(req.Elements) > 0 {
img, err := RenderTemplate(LabelTemplate{LengthMM: length, Elements: req.Elements},
splitFields(item))
if err != nil {
return nil, fmt.Errorf("этикетка %q: %w", item, err)
}
if offsetPx != 0 {
shiftImageX(img, offsetPx)
}
return img, nil
}

var lines []string
if strings.TrimSpace(req.Template) != "" {
var err error
lines, err = expandTemplate(req.Template, splitFields(item))
if err != nil {
return nil, fmt.Errorf("строка данных %q: %w", item, err)
}
} else {
lines = splitLabel(item)
}
if len(lines) == 0 {
return nil, nil
}
fontName := req.FontName
if fontName == "" {
fontName = cfg.FontName
}
fontSize := req.FontSize
if fontSize == "" {
fontSize = cfg.FontSize
}
return RenderTextWithOptions(lines, length, TextRenderOptions{
FontName:     fontName,
Bold:         req.Bold,
FontSize:     fontSize,
FontPt:       req.Font,
MarginPx:     marginPx,
SideMarginPx: sideMarginPx,
		OffsetPx:     offsetPx,
})
}
// apiPrint запускает серию в фоне и возвращает идентификатор задания.
func apiPrint(w http.ResponseWriter, req printRequest) {
	pages, err := renderPages(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(pages) == 0 {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("пустой список этикеток"))
		return
	}

	// Тип этикетки проверяем сразу, до похода к принтеру.
	if req.Label != "" {
		if err := checkLabelName(req.Label); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
	}

	density := req.Density
	if density < 1 || density > 3 {
		density = 2
	}
	copies := req.Copies
	if copies < 1 {
		copies = 1
	}

	id, j := newJob(len(pages) * copies)
	go func() {
		err := withPrinter(req.Address, func(p *Printer) error {
			labelName, err := resolveLabel(p, req.Label)
			if err != nil {
				return err
			}
			lt := labelTypes[labelName]
			return p.PrintPages(pages, byte(density), lt, copies,
				func(done, total int) {
					j.set(done)
					fmt.Printf("  отправлено %d из %d этикеток\n", done, total)
				})
		})
		if err != nil {
			fmt.Printf("серия не напечатана: %v\n", err)
		} else {
			fmt.Printf("серия напечатана: %d этикеток\n", j.Total)
		}
		j.finish(err)
	}()

	writeJSON(w, map[string]any{"job": id, "total": j.Total})
}

// apiPreview отдаёт PNG-макет этикетки.
func apiPreview(w http.ResponseWriter, req printRequest) {
	length := req.Length
	if length <= 0 {
		length = 30
	}
	item := "пусто"
	if len(req.Items) > 0 {
		item = req.Items[0]
	}
	cs, cst := resolveCounterParams(req); pt := req.PreviewTotal; if pt < 1 { pt = len(req.Items) }; img, err := renderOneCtx(req, item, length, cs+req.PreviewIndex*cst, pt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if img == nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("нечего рисовать"))
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	// Отдаём то же, что уйдёт в принтер: чёрно-белое, а не серое.
	png.Encode(w, BinarizeAt(img, req.threshold()))
}

// --------------------------------------------------------------------------
// Сервер
// --------------------------------------------------------------------------

var (
sharedMu      sync.Mutex
sharedPrinter *Printer
sharedMAC     string
)

func acquirePrinter(mac string, verbose bool, foundByName bool) (*Printer, func(), error) {
cfg := LoadConfig()
if !cfg.KeepAlive {
p, err := ConnectMAC(mac, verbose, foundByName)
if err != nil {
return nil, nil, err
}
p.printMode = cfg.PrintMode
return p, func() { _ = p.Close() }, nil
}

sharedMu.Lock()
if sharedPrinter != nil && strings.EqualFold(sharedMAC, mac) {
if _, err := sharedPrinter.Handshake(); err == nil {
sharedPrinter.printMode = cfg.PrintMode
return sharedPrinter, func() { sharedMu.Unlock() }, nil
}
_ = sharedPrinter.Close()
sharedPrinter = nil
}

p, err := ConnectMAC(mac, verbose, foundByName)
if err != nil {
sharedMu.Unlock()
return nil, nil, err
}
p.printMode = cfg.PrintMode
p.StartKeepAlive()
sharedPrinter = p
sharedMAC = mac
return sharedPrinter, func() { sharedMu.Unlock() }, nil
}

// startGUI поднимает веб-интерфейс и открывает браузер.
func startGUI(address string, port int, openBrowserFlag, appMode, verbose bool) error {
	guiVerbose = verbose
	mux := http.NewServeMux()

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		data, err := apiStatus(address)
		if err != nil {
			writeErr(w, http.StatusServiceUnavailable, err)
			return
		}
		writeJSON(w, data)
	})

	mux.HandleFunc("/api/job", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		jobsMu.Lock()
		j, ok := jobs[id]
		jobsMu.Unlock()
		if !ok {
			writeErr(w, http.StatusNotFound, fmt.Errorf("задание не найдено"))
			return
		}
		writeJSON(w, j.snapshot())
	})

	readRequest := func(w http.ResponseWriter, r *http.Request) (printRequest, bool) {
		var req printRequest
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("нужен POST"))
			return req, false
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return req, false
		}
		if address == "" {
			req.Address = ""
		} else {
			req.Address = address // адрес из командной строки важнее
		}
		return req, true
	}

	mux.HandleFunc("/api/save-preview", func(w http.ResponseWriter, r *http.Request) {
		if req, ok := readRequest(w, r); ok {
			apiSavePreview(w, req)
		}
	})
	mux.HandleFunc("/api/preview", func(w http.ResponseWriter, r *http.Request) {
		if req, ok := readRequest(w, r); ok {
			apiPreview(w, req)
		}
	})
	mux.HandleFunc("/api/print", func(w http.ResponseWriter, r *http.Request) {
if req, ok := readRequest(w, r); ok {
apiPrint(w, req)
}
})
mux.HandleFunc("/api/print-template", apiPrintTemplateHandler)


	// Список системных шрифтов для конструктора.
// Конфигурация программы по умолчанию (config.json)
mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
switch r.Method {
case http.MethodGet:
writeJSON(w, LoadConfig())
case http.MethodPost:
var cfg AppConfig
if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
writeErr(w, http.StatusBadRequest, err)
return
}
if err := SaveConfig(cfg); err != nil {
writeErr(w, http.StatusInternalServerError, err)
return
}
activeCfg = LoadConfig()
writeJSON(w, activeCfg)
default:
w.WriteHeader(http.StatusMethodNotAllowed)
}
})

mux.HandleFunc("/api/fonts", func(w http.ResponseWriter, r *http.Request) {
		families := fontFamiliesForPicker()
		if families == nil {
			writeErr(w, http.StatusInternalServerError,
				fmt.Errorf("не удалось прочитать список шрифтов"))
			return
		}
		writeJSON(w, map[string]any{
			"families": families,
			"default":  "DejaVu Sans", // встроенный выбор драйвера
		})
	})

	mux.HandleFunc("/api/templates", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, loadTemplates())
		case http.MethodPost:
			var t Template
			if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if strings.TrimSpace(t.Name) == "" {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("нужно имя шаблона"))
				return
			}
			list := loadTemplates()
			replaced := false
			for i := range list {
				if list[i].Name == t.Name {
					list[i], replaced = t, true
					break
				}
			}
			if !replaced {
				list = append(list, t)
			}
			if err := saveTemplates(list); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, list)
		case http.MethodDelete:
			name := r.URL.Query().Get("name")
			list := loadTemplates()
			out := list[:0]
			for _, t := range list {
				if t.Name != name {
					out = append(out, t)
				}
			}
			if err := saveTemplates(out); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, out)
		default:
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("метод не поддерживается"))
		}
	})

	// Статика из embed
	mux.HandleFunc("/api/connect", apiConnectHandler)
mux.HandleFunc("/api/disconnect", apiDisconnectHandler)
mux.HandleFunc("/api/mode", apiModeHandler)
mux.HandleFunc("/api/calibrate", apiCalibrateHandler)
mux.HandleFunc("/api/testpage", apiTestPageHandler)
mux.HandleFunc("/api/shutdown", apiShutdownHandler)

sub, err := fs.Sub(webAssets, "web")
	if err != nil {
		return err
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	url := "http://" + addr
	fmt.Printf("Интерфейс: %s\n", url)
	if nativeWindowAvailable() {
		fmt.Println("Сборка с собственным окном")
	}

	// Сервер уходит в отдельную горутину: собственное окно (сборка с тегом
	// webview) требует главного потока, да и ждать его закрытия надо здесь.
	serverErr := make(chan error, 1)
	go func() {
		if err := http.ListenAndServe(addr, mux); err != nil {
			serverErr <- err
		}
	}()
	if err := waitForServer(addr, 5*time.Second); err != nil {
		return err
	}

	if !openBrowserFlag {
		fmt.Println("Остановить — Ctrl+C")
		return <-serverErr
	}
	return runGUIWindow(url, appMode)
}

// waitForServer ждёт, пока сервер начнёт принимать соединения.
func waitForServer(addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("сервер не поднялся на %s за %s", addr, timeout)
}

// openBrowser открывает браузер (как в OCRTAG).
func openBrowser(url string) {
	cmd, args := browserCommand(url)
	if cmd == "" {
		return
	}
	_ = exec.Command(cmd, args...).Start()
}

// browserCommand — команда открытия адреса в браузере по умолчанию.
func browserCommand(url string) (string, []string) {
	switch runtime.GOOS {
	case "darwin":
		return "open", []string{url}
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default:
		return "xdg-open", []string{url}
	}
}

// appBrowsers — браузеры на движке Chromium: только они умеют режим
// приложения — отдельное окно без вкладок, адресной строки и меню.
var appBrowsers = map[string][]string{
	"linux": {
		"google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
		"microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi",
	},
	"darwin": {
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
	},
	"windows": {
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
	},
}

// appWindowCommand подбирает браузер и аргументы для окна в режиме приложения.
//
// Второе значение — пусто, если подходящего браузера не нашлось: тогда
// вызывающий открывает обычный браузер.
func appWindowCommand(url string) (string, []string) {
	osName := runtime.GOOS
	if osName != "darwin" && osName != "windows" {
		osName = "linux"
	}
	for _, name := range appBrowsers[osName] {
		path := name
		if osName != "windows" {
			if found, err := exec.LookPath(name); err == nil {
				path = found
			} else if _, err := os.Stat(name); err != nil {
				continue // нет ни в PATH, ни по этому пути
			}
		} else if _, err := os.Stat(name); err != nil {
			continue
		}
		// --app даёт окно без интерфейса браузера; размер задаём сами,
		// иначе окно откроется маленьким.
		return path, []string{"--app=" + url, "--window-size=1280,900"}
	}
	return "", nil
}

// openAppWindow открывает интерфейс отдельным окном без вкладок и адресной
// строки. Возвращает false, если браузера на Chromium не нашлось.
func openAppWindow(url string) bool {
	cmd, args := appWindowCommand(url)
	if cmd == "" {
		return false
	}
	if err := exec.Command(cmd, args...).Start(); err != nil {
		return false
	}
	return true
}

func disconnectSharedPrinter() {
sharedMu.Lock()
defer sharedMu.Unlock()
if sharedPrinter != nil {
_ = sharedPrinter.Close()
sharedPrinter = nil
sharedMAC = ""
}
}

func apiConnectHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
cfg := LoadConfig()
err := withPrinter(cfg.Address, func(p *Printer) error {
_, err := p.Handshake()
return err
})
if err != nil {
writeErr(w, http.StatusBadGateway, err)
return
}
writeJSON(w, map[string]any{"ok": true, "keepAlive": cfg.KeepAlive})
}

func apiDisconnectHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
disconnectSharedPrinter()
writeJSON(w, map[string]any{"ok": true})
}

func apiModeHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
var body struct {
KeepAlive bool `json:"keepAlive"`
}
if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
writeErr(w, http.StatusBadRequest, err)
return
}
cfg := LoadConfig()
cfg.KeepAlive = body.KeepAlive
if err := SaveConfig(cfg); err != nil {
writeErr(w, http.StatusInternalServerError, err)
return
}
if !cfg.KeepAlive {
disconnectSharedPrinter()
}
writeJSON(w, map[string]any{"ok": true, "keepAlive": cfg.KeepAlive})
}

func apiCalibrateHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
feed := r.URL.Query().Get("feed") == "1"
cfg := LoadConfig()
err := withPrinter(cfg.Address, func(p *Printer) error {
labelName, err := resolveLabel(p, cfg.Label)
if err != nil {
return err
}
return p.Calibrate(feed, cfg.Length, labelTypes[labelName])
})
if err != nil {
writeErr(w, http.StatusBadGateway, err)
return
}
writeJSON(w, map[string]any{"ok": true})
}

func apiTestPageHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
cfg := LoadConfig()
err := withPrinter(cfg.Address, func(p *Printer) error {
return p.PrintTestPage()
})
if err != nil {
writeErr(w, http.StatusBadGateway, err)
return
}
writeJSON(w, map[string]any{"ok": true})
}

func apiShutdownHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
return
}
writeJSON(w, map[string]any{"ok": true})
go func() {
time.Sleep(150 * time.Millisecond)
disconnectSharedPrinter()
os.Exit(0)
}()
}

// apiPrintTemplateHandler запускает печать серии по имени сохранённого шаблона из templates.json.
func apiPrintTemplateHandler(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("нужен POST"))
return
}
var body struct {
TemplateName string   `json:"templateName"`
Name         string   `json:"name"`
Items        []string `json:"items"`
Copies       int      `json:"copies"`
Length       float64  `json:"length"`
Density      int      `json:"density"`
Address      string   `json:"address"`
}
if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
writeErr(w, http.StatusBadRequest, err)
return
}
tName := strings.TrimSpace(body.TemplateName)
if tName == "" {
tName = strings.TrimSpace(body.Name)
}
if tName == "" {
writeErr(w, http.StatusBadRequest, fmt.Errorf("укажите имя шаблона (templateName)"))
return
}

var found *Template
for _, t := range loadTemplates() {
if strings.EqualFold(strings.TrimSpace(t.Name), tName) {
cp := t
found = &cp
break
}
}
if found == nil {
writeErr(w, http.StatusNotFound, fmt.Errorf("шаблон %q не найден", tName))
return
}

effDensity := found.Density
effLabel := found.Label
effCopies := found.Copies
effFlip := found.Flip
effThresh := found.Threshold
effOffset := found.OffsetPx
if found.HasSystem && found.System != nil {
if found.System.Density >= 1 && found.System.Density <= 3 {
effDensity = found.System.Density
}
if found.System.Label != "" {
effLabel = found.System.Label
}
if found.System.Copies > 0 {
effCopies = found.System.Copies
}
effFlip = found.System.Flip
if found.System.Threshold >= 1 && found.System.Threshold <= 255 {
effThresh = found.System.Threshold
}
if effOffset == nil {
v := found.System.OffsetPx
effOffset = &v
}
}

req := printRequest{
Mode:         "series",
Items:        body.Items,
Template:     found.Template,
Elements:     found.Elements,
Length:       found.Length,
Font:         found.Font,
Density:      effDensity,
Label:        effLabel,
Copies:       effCopies,
Flip:         effFlip,
Threshold:    effThresh,
OffsetPx:     effOffset,
		CounterStart: found.CounterStart,
		CounterStep:  found.CounterStep,
FontName:     found.FontName,
FontSize:     found.FontSize,
Bold:         found.Bold,
MarginPx:     found.MarginPx,
SideMarginPx: found.SideMarginPx,
Address:      body.Address,
}
if body.Copies > 0 {
req.Copies = body.Copies
}
if body.Length > 0 {
req.Length = body.Length
}
if body.Density >= 1 && body.Density <= 3 {
req.Density = body.Density
}

apiPrint(w, req)
}

// apiSavePreview сохраняет одну или несколько этикеток напрямую в папку saveDir на диске.
func apiSavePreview(w http.ResponseWriter, req printRequest) {
length := req.Length
if length <= 0 {
length = 30
}
if len(req.Items) == 0 {
writeErr(w, http.StatusBadRequest, fmt.Errorf("нет данных для сохранения"))
return
}

cfg := LoadConfig()
dir := strings.TrimSpace(cfg.SaveDir)
if dir == "" {
dir = executableDir()
}
if dir == "" {
if wd, err := os.Getwd(); err == nil {
dir = wd
}
}
if dir == "" {
dir = "."
}
if err := os.MkdirAll(dir, 0o755); err != nil {
writeErr(w, http.StatusInternalServerError, err)
return
}

baseName := strings.TrimSpace(cfg.SaveFile)
if baseName == "" {
baseName = "niimbot_label_preview.png"
}
if filepath.Ext(baseName) == "" {
baseName += ".png"
}
ext := filepath.Ext(baseName)
stem := strings.TrimSuffix(baseName, ext)

var saved []string
usedNames := map[string]int{}

for i, item := range req.Items {
cs, cst := resolveCounterParams(req); img, err := renderOneCtx(req, item, length, cs+i*cst, len(req.Items))
if err != nil {
writeErr(w, http.StatusBadRequest, err)
return
}
if img == nil {
continue
}

fname := ""
if cfg.AutoFileName {
if clean := sanitizeFileName(item); clean != "" {
fname = clean + ".png"
}
}
if fname == "" {
if len(req.Items) > 1 {
fname = fmt.Sprintf("%s_%d%s", stem, i+1, ext)
} else {
fname = baseName
}
}

// Защита от перезаписи при одинаковых именах внутри одного пакета
key := strings.ToLower(fname)
usedNames[key]++
if usedNames[key] > 1 {
fExt := filepath.Ext(fname)
fStem := strings.TrimSuffix(fname, fExt)
fname = fmt.Sprintf("%s_%d%s", fStem, usedNames[key], fExt)
}

fullPath := filepath.Join(dir, fname)
f, err := os.Create(fullPath)
if err != nil {
writeErr(w, http.StatusInternalServerError, err)
return
}
encErr := png.Encode(f, BinarizeAt(img, req.threshold()))
_ = f.Close()
if encErr != nil {
writeErr(w, http.StatusInternalServerError, encErr)
return
}
saved = append(saved, fullPath)
}

writeJSON(w, map[string]any{
"ok":    true,
"dir":   dir,
"count": len(saved),
"files": saved,
})
}

func resolveCounterParams(req printRequest) (int, int) {
s, st := 1, 1
if req.CounterStart != nil { s = *req.CounterStart }
if req.CounterStep != nil { st = *req.CounterStep }
return s, st
}
func renderOneCtx(req printRequest, item string, length float64, counter, total int) (*image.Gray, error) {
if len(req.Elements) > 0 {
img, err := RenderTemplateCtx(LabelTemplate{LengthMM: length, Elements: req.Elements}, splitFields(item), counter, total)
if err == nil && req.OffsetPx != nil && *req.OffsetPx != 0 { shiftImageX(img, *req.OffsetPx) }
return img, err
}
if req.Mode == "series" && strings.TrimSpace(req.Template) != "" {
rows, err := expandTemplateCtx(req.Template, splitFields(item), counter, total)
if err != nil || len(rows) == 0 { return nil, err }
opts := buildTextOptionsFromConfig()
if req.FontName != "" { opts.FontName = req.FontName }
if req.FontSize != "" { opts.FontSize = req.FontSize }
opts.Bold = req.Bold
if req.MarginPx != nil { opts.MarginPx = *req.MarginPx }
if req.SideMarginPx != nil { opts.SideMarginPx = *req.SideMarginPx }
if req.OffsetPx != nil { opts.OffsetPx = *req.OffsetPx }
return RenderTextWithOptions(rows, length, opts)
}
return renderOne(req, item, length)
}
