// Драйвер принтера этикеток и штрихкодов NIIMBOT N1 (Bluetooth LE).
package main

import (
"flag"
"fmt"
"image"
"image/png"
"os"
"path/filepath"
"strings"
"time"
)

const defaultMAC = "24:0A:11:D9:EC:C3" // N1-GA24110447

var flagSet = flag.NewFlagSet("niimbc", flag.ExitOnError)

var (
addr      = flagSet.String("address", "", "MAC или UUID принтера (по умолчанию — поиск по имени N1-)")
verbose   = flagSet.Bool("v", true, "подробный вывод")
length    = flagSet.Float64("length", 50.0, "длина этикетки вдоль подачи, мм")
height    = flagSet.Float64("height", 14.0, "высота/ширина ленты поперёк подачи, мм")
fontPt    = flagSet.Float64("font", 0, "кегль в точках (0 = подобрать автоматически)")
flip      = flagSet.Bool("flip", false, "перевернуть содержимое на 180°")
density   = flagSet.Int("density", 2, "плотность 1..3")
label     = flagSet.String("label", "", "тип этикетки; пусто — определить по метке рулона")
copies    = flagSet.Int("copies", 1, "количество копий")
threshold = flagSet.Int("threshold", 200, "порог чёрно-белого, 0..255; больше — жирнее")
imageFile = flagSet.String("file", "", "файл картинки для макета (команда preview)")
port      = flagSet.Int("port", 8765, "порт веб-интерфейса (команда gui)")
noBrowser = flagSet.Bool("no-browser", false, "не открывать браузер (команда gui)")
appMode   = flagSet.Bool("app", false, "открыть отдельным окном без вкладок и адресной строки (команда gui)")

bcMode    = flagSet.Bool("bc", false, "режим штрихкода для команды preview")
bcFormat  = flagSet.String("bc-format", "", "формат штрихкода: auto | code128 | qr | qrl | qrr")
topText   = flagSet.String("top-text", "", "верхний текст над штрихкодом / сбоку от QR")
botText   = flagSet.String("bottom-text", "", "нижний текст под штрихкодом / сбоку от QR")
fontName  = flagSet.String("font-name", "", "имя системного шрифта для штрихкода")
fontSize  = flagSet.String("font-size", "", "размер подписи штрихкода: -1 (авто), 0 (скрыть), N, Np")
bcBold    = flagSet.Bool("bold", false, "полужирный шрифт подписи штрихкода")
bcOffset  = flagSet.Int("offset", 0, "горизонтальный сдвиг штрихкода, px")
bcMargin  = flagSet.Int("margin", -1, "верхнее и нижнее поля штрихкода, px")
bcSideM   = flagSet.Int("side-margin", -1, "боковые поля штрихкода, px")
bcGap     = flagSet.Int("gap", -1, "зазор между штрихкодом и подписью, px")
bcTextGap = flagSet.Int("text-gap", -1, "зазор до верхнего и нижнего текста, px")

saveDir   = flagSet.String("save-dir", "", "папка для сохранения PNG-превью (по умолчанию папка программы)")
	outFile   = flagSet.String("out", "", "имя или путь выходного PNG-файла превью (по умолчанию niimbot_label_preview.png)")
	autoName  = flagSet.Bool("auto-name", false, "формировать имя PNG-файла превью из данных штрихкода/текста")
	stretchImg = flagSet.Bool("stretch", false, "растянуть картинку до полей этикетки без сохранения пропорций")
watchDir  = flagSet.String("watch-dir", "", "папка мониторинга очереди этикеток")
onDemand  = flagSet.Bool("on-demand", false, "режим сервера On-Demand (подключение только на время печати)")
keepAlive = flagSet.Bool("keep-alive", false, "режим сервера Keep-Alive (постоянное удержание связи)")
saveCfg   = flagSet.Bool("save-config", false, "сохранить переданные параметры в config.json")
	cfgFile   = flagSet.String("config", "", "путь к альтернативному файлу конфигурации")
	logLevel  = flagSet.String("log-level", "", "уровень логов: error | info | debug (по умолчанию info)")
	printMode = flagSet.String("print-mode", "", "режим отправки строк: fast (быстрый пачками) | safe (построчный)")
	calFeed   = flagSet.Bool("feed", false, "протянуть пустую этикетку при калибровке (команда calibrate)")
)

var activeCfg AppConfig

var lastLabelContent string

func sanitizeFileName(raw string) string {
s := strings.TrimSpace(raw)
if s == "" {
return ""
}
var b strings.Builder
prevUnder := false
for _, r := range s {
if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
if !prevUnder {
b.WriteByte('_')
prevUnder = true
}
continue
}
if r == ' ' || r == '\t' || r == '\r' || r == '\n' {
if !prevUnder {
b.WriteByte('_')
prevUnder = true
}
continue
}
b.WriteRune(r)
prevUnder = false
}
res := strings.Trim(b.String(), "._")
if len([]rune(res)) > 80 {
res = string([]rune(res)[:80])
}
return res
}

func main() {
	flagSet.Usage = usage
if len(os.Args) < 2 {
activeCfg = LoadConfig()
	SetLogLevel(activeCfg.LogLevel)
usage()
os.Exit(2)
}

flagArgs, posArgs := splitArgs(os.Args[1:])
if err := flagSet.Parse(flagArgs); err != nil {
fatal(err)
}
if *cfgFile != "" {
SetConfigPath(*cfgFile)
}
activeCfg = LoadConfig()
	SetLogLevel(activeCfg.LogLevel)

visited := map[string]bool{}
flagSet.Visit(func(f *flag.Flag) {
visited[f.Name] = true
})

if !visited["address"] { *addr = activeCfg.Address }
if !visited["length"] { *length = activeCfg.Length }
if !visited["height"] { *height = activeCfg.Height }
if !visited["flip"] { *flip = activeCfg.Flip }
if !visited["density"] { *density = activeCfg.Density }
if !visited["label"] { *label = activeCfg.Label }
if !visited["copies"] { *copies = activeCfg.Copies }
if !visited["threshold"] { *threshold = activeCfg.Threshold }
if !visited["save-dir"] { *saveDir = activeCfg.SaveDir }
	if !visited["out"] { *outFile = activeCfg.SaveFile }
if !visited["watch-dir"] { *watchDir = activeCfg.WatchDir }

activeCfg.Address = *addr
activeCfg.Length = *length
activeCfg.Height = *height
activeCfg.Flip = *flip
activeCfg.Density = *density
activeCfg.Label = *label
activeCfg.Copies = *copies
activeCfg.Threshold = *threshold
activeCfg.SaveDir = *saveDir
	if visited["out"] && strings.TrimSpace(*outFile) != "" {
		if filepath.Dir(*outFile) != "." {
			activeCfg.SaveDir = filepath.Dir(*outFile)
			activeCfg.SaveFile = filepath.Base(*outFile)
		} else {
			activeCfg.SaveFile = *outFile
		}
	}
activeCfg.WatchDir = *watchDir

if visited["on-demand"] { activeCfg.KeepAlive = false }
if visited["keep-alive"] { activeCfg.KeepAlive = true }
	if visited["auto-name"] { activeCfg.AutoFileName = *autoName }
	if visited["stretch"] { activeCfg.ImgStretch = *stretchImg }
if visited["log-level"] && *logLevel != "" {
activeCfg.LogLevel = *logLevel
} else if visited["v"] && !*verbose {
activeCfg.LogLevel = "error"
}
SetLogLevel(activeCfg.LogLevel)
if visited["bc-format"] { activeCfg.BcFormat = *bcFormat }
if visited["font-name"] { activeCfg.FontName = *fontName }
if visited["font-size"] { activeCfg.FontSize = *fontSize }
if visited["bold"] { activeCfg.IsMainTextBold = *bcBold }
if visited["offset"] { activeCfg.OffsetPx = *bcOffset }
if visited["margin"] && *bcMargin >= 0 { activeCfg.MarginPx = *bcMargin }
if visited["side-margin"] && *bcSideM >= 0 { activeCfg.SideMarginPx = *bcSideM }
if visited["gap"] && *bcGap >= 0 { activeCfg.GapPx = *bcGap }
if visited["text-gap"] && *bcTextGap >= 0 { activeCfg.TextGapPx = *bcTextGap }

if *saveCfg {
if err := SaveConfig(activeCfg); err != nil {
fatal(fmt.Errorf("не удалось сохранить config.json: %w", err))
}
fmt.Println("Параметры сохранены в:", configPath())
if len(posArgs) == 0 {
return
}
}

if len(posArgs) == 0 {
usage()
os.Exit(2)
}
cmd := posArgs[0]
posArgs = posArgs[1:]

if *threshold < 1 || *threshold > 255 {
fatal(fmt.Errorf("порог должен быть от 1 до 255, а не %d", *threshold))
}
binarizeThreshold = uint8(*threshold)

if (cmd == "text" || cmd == "image" || cmd == "barcode") && *label != "" {
if err := checkLabelType(*label); err != nil {
fatal(err)
}
}
switch cmd {
case "scan":
mac, err := ScanPrinter("N1-", 12*time.Second, *verbose)
if err != nil { fatal(err) }
fmt.Println(mac)
return
case "gui":
if err := startGUI(*addr, *port, !*noBrowser, *appMode, *verbose); err != nil { fatal(err) }
return
case "preview":
if *imageFile != "" {
lastLabelContent = strings.TrimSuffix(filepath.Base(*imageFile), filepath.Ext(*imageFile))
			img, err := loadImageWithConfig(*imageFile, *length)
if err != nil { fatal(err) }
savePreview(img)
return
}
if *bcMode {
if len(posArgs) == 0 { fatal(fmt.Errorf("не заданы данные штрихкода")) }
lastLabelContent = strings.Join(posArgs, " ")
			img, err := buildBarcodeFromConfig(strings.Join(posArgs, " "))
if err != nil { fatal(err) }
savePreview(img)
return
}
if len(posArgs) == 0 { fatal(fmt.Errorf("не задан текст")) }
lastLabelContent = strings.Join(posArgs, "_")
			img, err := RenderTextWithOptions(posArgs, *length, buildTextOptionsFromConfig())
if err != nil { fatal(err) }
savePreview(img)
rows := ImageToRows(img, *flip)
ink := 0
for _, r := range rows {
if r != nil { ink++ }
}
fmt.Printf("строк с печатью: %d из %d\n", ink, len(rows))
return
case "info", "rfid", "testpage", "calibrate", "text", "image", "barcode":
default:
usage()
os.Exit(2)
}

mac := *addr
foundByName := false
if mac == "" {
found, err := ScanPrinter("N1-", 12*time.Second, *verbose)
if err == nil {
mac, foundByName = found, true
} else {
mac = defaultMAC
fmt.Fprintf(os.Stderr, "поиск не удался (%v), пробую %s\n", err, mac)
}
}

p, err := ConnectMAC(mac, *verbose, foundByName)
	if err == nil { p.printMode = activeCfg.PrintMode }
if err != nil { fatal(err) }
defer p.Close()

info, err := p.Handshake()
if err != nil { fatal(err) }

switch cmd {
case "info":
printInfo(info)
printRfid(p, false)
printRfid(p, true)
case "rfid":
printRfid(p, false)
printRfid(p, true)
case "calibrate":
labelName, err := resolveLabel(p, *label)
if err != nil {
fatal(err)
}
if err := p.Calibrate(*calFeed, *length, labelTypes[labelName]); err != nil {
fatal(err)
}
case "testpage":if err := p.PrintTestPage(); err != nil { fatal(err) }
fmt.Println("тестовая страница отправлена")
case "text":
if len(posArgs) == 0 { fatal(fmt.Errorf("не задан текст")) }
labelName, err := resolveLabel(p, *label)
if err != nil { fatal(err) }
lastLabelContent = strings.Join(posArgs, "_")
			img, err := RenderTextWithOptions(posArgs, *length, buildTextOptionsFromConfig())
if err != nil { fatal(err) }
savePreview(img)
if err := printRows(p, ImageToRows(img, *flip), *density, labelName, *copies); err != nil { fatal(err) }
case "barcode":
if len(posArgs) == 0 { fatal(fmt.Errorf("не заданы данные штрихкода")) }
labelName, err := resolveLabel(p, *label)
if err != nil { fatal(err) }
lastLabelContent = strings.Join(posArgs, " ")
			img, err := buildBarcodeFromConfig(strings.Join(posArgs, " "))
if err != nil { fatal(err) }
savePreview(img)
if err := printRows(p, ImageToRows(img, *flip), *density, labelName, *copies); err != nil { fatal(err) }
case "image":
if len(posArgs) < 1 { fatal(fmt.Errorf("не задан файл картинки")) }
labelName, err := resolveLabel(p, *label)
if err != nil { fatal(err) }
img, err := loadImageWithConfig(posArgs[0], *length)
if err != nil { fatal(err) }
if err := printRows(p, ImageToRows(img, *flip), *density, labelName, *copies); err != nil { fatal(err) }
}
}
func splitArgs(args []string) (flags []string, positional []string) {
for i := 0; i < len(args); i++ {
a := args[i]
if !strings.HasPrefix(a, "-") || a == "-" || a == "--" {
positional = append(positional, a)
continue
}
name := strings.TrimLeft(a, "-")
hasInline := strings.Contains(name, "=")
base := strings.SplitN(name, "=", 2)[0]
flags = append(flags, "-"+name)
if !hasInline && flagNeedsValue(base) {
if i+1 < len(args) {
i++
flags = append(flags, args[i])
}
}
}
return
}

func flagNeedsValue(name string) bool {
f := flagSet.Lookup(name)
if f == nil { return false }
if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok && bf.IsBoolFlag() {
return false
}
return true
}

func resolveLabel(p *Printer, flagValue string) (string, error) {
if flagValue != "" {
if err := checkLabelType(flagValue); err != nil { return "", err }
if detected, ok := detectLabel(p); ok {
if labelTypes[flagValue] != detected {
fmt.Fprintf(os.Stderr, "внимание: в принтере этикетки типа %s, а печатаем как %s\n", labelTypeName(detected), flagValue)
}
}
return flagValue, nil
}
if detected, ok := detectLabel(p); ok {
name := labelTypeName(detected)
if name == "" { return "", fmt.Errorf("в метке рулона неизвестный тип этикетки (%d) — задайте --label вручную", detected) }
if _, supported := labelTypesN1[detected]; !supported {
return "", fmt.Errorf("в метке рулона тип %s, который N1 не поддерживает — задайте --label вручную", name)
}
LogInfoMsg("тип этикетки определён по метке рулона: %s", name)
return name, nil
}
fmt.Fprintln(os.Stderr, "метка рулона не прочитана — печатаю как withgaps (обычные этикетки)")
return "withgaps", nil
}

func detectLabel(p *Printer) (byte, bool) {
info, err := p.ReadRfid(false)
if err != nil || !info.TagPresent || !info.LabelTypeOK { return 0, false }
return info.LabelType, true
}

func labelTypeName(id byte) string {
for name, v := range labelTypes {
if v == id { return name }
}
return ""
}

func checkLabelName(label string) error {
id, ok := labelTypes[label]
if !ok { return fmt.Errorf("неизвестный тип этикетки %q", label) }
if _, ok := labelTypesN1[id]; !ok {
return fmt.Errorf("N1 не поддерживает тип %q. Доступны: withgaps, continuous, transparent, blackmarkgap, heatshrink", label)
}
return nil
}

func checkLabelType(label string) error {
id, ok := labelTypes[label]
if !ok { return fmt.Errorf("неизвестный тип этикетки %q.\nПоддерживаются:%s", label, labelListN1()) }
if _, ok := labelTypesN1[id]; !ok { return fmt.Errorf("N1 не поддерживает тип %q.\nПоддерживаются:%s", label, labelListN1()) }
return nil
}

func printRows(p *Printer, rows []Row, density int, label string, copies int) error {
if err := checkLabelType(label); err != nil { return err }
if err := p.PrintRows(rows, byte(density), labelTypes[label], copies); err != nil { return err }
fmt.Println("готово")
return nil
}

func printRfid(p *Printer, ribbon bool) {
title := "рулон этикеток"
if ribbon { title = "лента (риббон)" }
fmt.Printf("\n=== %s ===\n", title)
info, err := p.ReadRfid(ribbon)
if err != nil { fmt.Printf("  метка не прочитана: %v\n", err); return }
if !info.TagPresent { fmt.Println("  метки нет — рулон без RFID либо не вставлен"); return }
fmt.Printf("  %-22s %s\n", "UUID:", info.UUID)
if info.Barcode != "" { fmt.Printf("  %-22s %s\n", "штрихкод:", info.Barcode) }
if info.Serial != "" { fmt.Printf("  %-22s %s\n", "серийный номер:", info.Serial) }
if info.LabelTypeOK {
name := info.LabelTypeName()
if !ribbon && name != "" {
note := "N1 не поддерживает"
if _, ok := labelTypesN1[info.LabelType]; ok { note = "N1 поддерживает" }
fmt.Printf("  %-22s %s (%d) — %s\n", "тип этикетки:", name, info.LabelType, note)
} else {
fmt.Printf("  %-22s %d\n", "тип расходника:", info.LabelType)
}
}
if info.AllPaper >= 0 && info.UsedPaper >= 0 {
fmt.Printf("  %-22s %d, израсходовано %d, осталось %d\n", "ресурс:", info.AllPaper, info.UsedPaper, info.Leftover())
}
if info.HasCapacity { fmt.Printf("  %-22s %d\n", "ёмкость:", info.Capacity) }
}

func printInfo(i Info) {
fmt.Println("\n=== принтер ===")
fmt.Printf("  %-28s %d (2 = ConnectedNew)\n", "рукопожатие:", i.ConnectResult)
fmt.Printf("  %-28s %d\n", "id модели:", i.ModelID)
if i.ModelID == modelIDN1 { fmt.Println("  ✅ это N1 — параметры драйвера совпадают") }
if i.Serial != "" { fmt.Printf("  %-28s %s\n", "серийный номер:", i.Serial) }
fmt.Printf("  %-28s %d\n", "плотность:", i.Density)
fmt.Printf("  %-28s %d\n", "тип этикетки:", i.LabelType)
fmt.Printf("  %-28s %d\n", "заряд (ступень):", i.Battery)
if i.Firmware != "" { fmt.Printf("  %-28s %s\n", "прошивка:", i.Firmware) }
}

func resolvePreviewDir() string {
dir := strings.TrimSpace(activeCfg.SaveDir)
if dir == "" { dir = executableDir() }
if dir == "" {
if wd, err := os.Getwd(); err == nil { dir = wd }
}
if dir == "" { dir = "." }
return dir
}

func resolvePreviewPath() string {
dir := resolvePreviewDir()
name := ""
if strings.TrimSpace(*outFile) != "" && *outFile != activeCfg.SaveFile {
name = strings.TrimSpace(*outFile)
} else if activeCfg.AutoFileName && lastLabelContent != "" {
if clean := sanitizeFileName(lastLabelContent); clean != "" {
name = clean + ".png"
}
}
if name == "" {
name = strings.TrimSpace(*outFile)
}
if name == "" {
name = strings.TrimSpace(activeCfg.SaveFile)
}
if name == "" {
name = "niimbot_label_preview.png"
}
if filepath.Ext(name) == "" {
name += ".png"
}
if filepath.IsAbs(name) || filepath.Dir(name) != "." {
return name
}
return filepath.Join(dir, name)
}

func savePreview(img *image.Gray) {
out := resolvePreviewPath()
_ = os.MkdirAll(filepath.Dir(out), 0o755)
f, err := os.Create(out)
if err != nil {
fatal(err)
}
defer f.Close()
if err := png.Encode(f, img); err != nil {
fatal(err)
}
b := img.Bounds()
LogKey("макет: %s (%d×%d точек = %.1f×%.1f мм)",
out, b.Dx(), b.Dy(), float64(b.Dx())/dotsPerMM, float64(b.Dy())/dotsPerMM)
}

func usage() { printHelpText() }

func fatal(err error) {
fmt.Fprintln(os.Stderr, "ошибка:", err)
os.Exit(1)
}

func buildTextOptionsFromConfig() TextRenderOptions {
return TextRenderOptions{
FontName:     activeCfg.FontName,
Bold:         activeCfg.IsMainTextBold,
FontSize:     activeCfg.FontSize,
FontPt:       *fontPt,
MarginPx:     activeCfg.MarginPx,
SideMarginPx: activeCfg.SideMarginPx,
}
}

func buildBarcodeFromConfig(data string) (*image.Gray, error) {
return RenderBarcodeLabel(BarcodeOptions{
Data: data, Format: activeCfg.BcFormat, LengthMM: activeCfg.Length,
TopText: *topText, BottomText: *botText,
FontName: activeCfg.FontName, IsMainTextBold: activeCfg.IsMainTextBold, FontSize: activeCfg.FontSize,
OffsetPx: activeCfg.OffsetPx, SideMarginPx: activeCfg.SideMarginPx,
MarginPx: activeCfg.MarginPx, GapPx: activeCfg.GapPx, TextGapPx: activeCfg.TextGapPx,
}, activeCfg)
}

func loadImageWithConfig(path string, lengthMM float64) (*image.Gray, error) {
f, err := os.Open(path)
if err != nil {
return nil, err
}
defer f.Close()
src, _, err := image.Decode(f)
if err != nil {
return nil, err
}
return FitToLabelEx(src, lengthMM, activeCfg.MarginPx, activeCfg.SideMarginPx, activeCfg.ImgStretch), nil
}
