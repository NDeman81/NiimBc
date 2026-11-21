package main

import (
"bytes"
"fmt"
"os"
"strings"

"github.com/xuri/excelize/v2"
)

type XlsxParseResult struct {
Sheets []string   `json:"sheets"`
Sheet  string     `json:"sheet"`
Rows   [][]string `json:"rows"`
}

// ParseXlsxBytes читает листы и строки указанного (или первого) листа из бинарного .xlsx.
func ParseXlsxBytes(data []byte, sheetName string) (*XlsxParseResult, error) {
f, err := excelize.OpenReader(bytes.NewReader(data))
if err != nil {
return nil, fmt.Errorf("ошибка чтения Excel (.xlsx): %w", err)
}
defer func() { _ = f.Close() }()

sheets := f.GetSheetList()
if len(sheets) == 0 {
return nil, fmt.Errorf("в книге Excel нет ни одного листа")
}

target := strings.TrimSpace(sheetName)
if target == "" {
target = sheets[0]
} else {
found := false
for _, s := range sheets {
if strings.EqualFold(s, target) {
target = s
found = true
break
}
}
if !found {
return nil, fmt.Errorf("лист %q не найден в книге Excel", target)
}
}

rawRows, err := f.GetRows(target)
if err != nil {
return nil, fmt.Errorf("не удалось прочитать лист %q: %w", target, err)
}

var rows [][]string
for _, r := range rawRows {
// Убираем пустые ячейки в конце строки и заменяем переносы внутри ячеек на пробел
lastNonEmpty := -1
cleaned := make([]string, len(r))
for i, cell := range r {
val := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(cell, "\r\n", " "), "\n", " "))
cleaned[i] = val
if val != "" {
lastNonEmpty = i
}
}
if lastNonEmpty < 0 {
continue // полностью пустая строка пропускается
}
rows = append(rows, cleaned[:lastNonEmpty+1])
}

return &XlsxParseResult{
Sheets: sheets,
Sheet:  target,
Rows:   rows,
}, nil
}

// LoadXlsxLines читает .xlsx с диска и возвращает строки в формате "кол1;кол2;кол3".
func LoadXlsxLines(path, sheetName string, skipHeader bool) ([]string, error) {
data, err := os.ReadFile(path)
if err != nil {
return nil, err
}
res, err := ParseXlsxBytes(data, sheetName)
if err != nil {
return nil, err
}
rows := res.Rows
if skipHeader && len(rows) > 1 {
rows = rows[1:]
}
out := make([]string, 0, len(rows))
for _, cols := range rows {
out = append(out, strings.Join(cols, ";"))
}
return out, nil
}