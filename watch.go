package main

import (
"encoding/json"
"fmt"
"os"
"path/filepath"
"sort"
"strings"
"time"
)

// startWatchDirWorker запускает фоновый мониторинг папки watchDir из config.json.
func startWatchDirWorker(cliAddress string) {
go func() {
var announcedDir string
for {
time.Sleep(1500 * time.Millisecond)
cfg := LoadConfig()
dir := strings.TrimSpace(cfg.WatchDir)
if dir == "" {
announcedDir = ""
continue
}
if dir != announcedDir {
if err := os.MkdirAll(dir, 0o755); err != nil {
LogWarn("watchDir: не удалось создать папку %q: %v", dir, err)
continue
}
LogKey("Мониторинг горячей папки активен: %s", dir)
announcedDir = dir
}
processWatchDirOnce(dir, cliAddress)
}
}()
}

func processWatchDirOnce(dir, cliAddress string) {
entries, err := os.ReadDir(dir)
if err != nil {
return
}
var files []string
for _, ent := range entries {
if ent.IsDir() {
continue
}
name := ent.Name()
low := strings.ToLower(name)
if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "~$") ||
strings.HasSuffix(low, ".tmp") || strings.HasSuffix(low, ".part") ||
strings.HasSuffix(low, ".crdownload") || strings.HasSuffix(low, ".error.txt") {
continue
}
ext := filepath.Ext(low)
if ext == ".json" || ext == ".xlsx" || ext == ".csv" || ext == ".txt" {
files = append(files, filepath.Join(dir, name))
}
}
sort.Strings(files)

for _, fullPath := range files {
if !waitFileStable(fullPath) {
continue
}
LogInfoMsg("watchDir: найден файл задания %s", filepath.Base(fullPath))
if err := executeWatchFile(fullPath, cliAddress); err != nil {
LogWarn("watchDir: ошибка обработки %s: %v", filepath.Base(fullPath), err)
moveWatchFile(fullPath, filepath.Join(dir, "error"), err.Error())
} else {
moveWatchFile(fullPath, filepath.Join(dir, "done"), "")
}
}
}

func waitFileStable(path string) bool {
st1, err := os.Stat(path)
if err != nil || st1.Size() == 0 {
return false
}
time.Sleep(150 * time.Millisecond)
st2, err := os.Stat(path)
if err != nil {
return false
}
return st1.Size() == st2.Size()
}

func executeWatchFile(fullPath, cliAddress string) error {
ext := strings.ToLower(filepath.Ext(fullPath))
raw, err := os.ReadFile(fullPath)
if err != nil {
return err
}

var req printRequest
switch ext {
case ".json":
var probe struct {
TemplateName string   `json:"templateName"`
Name         string   `json:"name"`
Items        []string `json:"items"`
Copies       int      `json:"copies"`
Length       float64  `json:"length"`
Density      int      `json:"density"`
Address      string   `json:"address"`
}
_ = json.Unmarshal(raw, &probe)
tName := strings.TrimSpace(probe.TemplateName)
if tName == "" {
tName = strings.TrimSpace(probe.Name)
}
if tName != "" {
built, err := buildRequestFromTemplateName(tName, probe.Items, probe.Copies, probe.Length, probe.Density, probe.Address)
if err != nil {
return err
}
req = built
} else {
if err := json.Unmarshal(raw, &req); err != nil {
return fmt.Errorf("некорректный JSON задания: %w", err)
}
}

case ".xlsx":
res, err := ParseXlsxBytes(raw, "")
if err != nil {
return err
}
var items []string
for _, cols := range res.Rows {
items = append(items, strings.Join(cols, ";"))
}
req = printRequest{Mode: "series", Items: items}

case ".csv", ".txt":
var items []string
for _, ln := range strings.Split(string(raw), "\n") {
ln = strings.TrimSpace(strings.TrimRight(ln, "\r"))
if ln != "" {
items = append(items, ln)
}
}
req = printRequest{Mode: "series", Items: items}
}

if cliAddress != "" {
req.Address = cliAddress
}
pages, err := renderPages(req)
if err != nil {
return err
}
if len(pages) == 0 {
return fmt.Errorf("файл не содержит данных для печати")
}

cfg := LoadConfig()
density := req.Density
if density < 1 || density > 3 {
density = cfg.Density
if density < 1 || density > 3 {
density = 2
}
}
copies := req.Copies
if copies < 1 {
copies = 1
}

err = withPrinter(req.Address, func(p *Printer) error {
useLabel := req.Label
if useLabel == "" {
useLabel = cfg.Label
}
labelName, err := resolveLabel(p, useLabel)
if err != nil {
return err
}
return p.PrintPages(pages, byte(density), labelTypes[labelName], copies, nil)
})
if err == nil {
recordPrintHistory(req, len(pages)*copies)
LogKey("watchDir: напечатано %d этикеток из %s", len(pages)*copies, filepath.Base(fullPath))
}
return err
}

func buildRequestFromTemplateName(tName string, items []string, copies int, length float64, density int, address string) (printRequest, error) {
var found *Template
for _, t := range loadTemplates() {
if strings.EqualFold(strings.TrimSpace(t.Name), tName) {
cp := t
found = &cp
break
}
}
if found == nil {
return printRequest{}, fmt.Errorf("шаблон %q не найден", tName)
}
req := printRequest{
Mode:         "series",
Items:        items,
Template:     found.Template,
Elements:     found.Elements,
Length:       found.Length,
Font:         found.Font,
Density:      found.Density,
Label:        found.Label,
Copies:       found.Copies,
Flip:         found.Flip,
Threshold:    found.Threshold,
OffsetPx:     found.OffsetPx,
CounterStart: found.CounterStart,
CounterStep:  found.CounterStep,
FontName:     found.FontName,
FontSize:     found.FontSize,
Bold:         found.Bold,
MarginPx:     found.MarginPx,
SideMarginPx: found.SideMarginPx,
Address:      address,
}
if copies > 0 {
req.Copies = copies
}
if length > 0 {
req.Length = length
}
if density >= 1 && density <= 3 {
req.Density = density
}
return req, nil
}

func moveWatchFile(srcPath, targetDir, errText string) {
_ = os.MkdirAll(targetDir, 0o755)
base := filepath.Base(srcPath)
dst := filepath.Join(targetDir, base)
if _, err := os.Stat(dst); err == nil {
ext := filepath.Ext(base)
stem := strings.TrimSuffix(base, ext)
dst = filepath.Join(targetDir, fmt.Sprintf("%s_%s%s", stem, time.Now().Format("20060102_150405"), ext))
}
if err := os.Rename(srcPath, dst); err != nil {
if data, rErr := os.ReadFile(srcPath); rErr == nil {
_ = os.WriteFile(dst, data, 0o644)
_ = os.Remove(srcPath)
}
}
if errText != "" {
_ = os.WriteFile(dst+".error.txt", []byte(errText+"\r\n"), 0o644)
}
}