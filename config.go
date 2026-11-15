package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppConfig хранит настройки генерации штрихкодов и печати по умолчанию.
type AppConfig struct {
	BcFormat       string `json:"bcFormat"`       // auto | code128 | qr | qrl | qrr
	DefaultQrSide  string `json:"defaultQrSide"`  // left | right (используется при bcFormat == "qr")
	FontName       string `json:"fontName"`       // имя системного шрифта
	IsMainTextBold bool   `json:"isMainTextBold"` // полужирный шрифт для основной подписи
	FontSize       string `json:"fontSize"`       // -1 (авто), 0 (скрыть), N (pt), Np (%)
	OffsetPx       int    `json:"offsetPx"`       // горизонтальный сдвиг в точках
	SideMarginPx   int    `json:"sideMarginPx"`   // боковые поля в точках
	MarginPx       int    `json:"marginPx"`       // верхнее и нижнее поля в точках
	GapPx          int    `json:"gapPx"`          // зазор между штрихкодом/QR и текстом
	TextGapPx      int    `json:"textGapPx"`      // зазор до верхнего и нижнего текста
	SaveDir        string `json:"saveDir"`        // папка для сохранения PNG-макетов
}

// DefaultConfig возвращает стандартные настройки.
func DefaultConfig() AppConfig {
	return AppConfig{
		BcFormat:       "auto",
		DefaultQrSide:  "left",
		FontName:       "",
		IsMainTextBold: false,
		FontSize:       "-1",
		OffsetPx:       0,
		SideMarginPx:   10,
		MarginPx:       4,
		GapPx:          4,
		TextGapPx:      4,
		SaveDir:        "",
	}
}

// configPath возвращает путь к config.json (рядом с exe, если он там есть, иначе в UserConfigDir).
func configPath() string {
	if exe, err := os.Executable(); err == nil {
		local := filepath.Join(filepath.Dir(exe), "config.json")
		if _, err := os.Stat(local); err == nil {
			return local
		}
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "niimbot", "config.json")
}

// LoadConfig читает настройки из config.json или возвращает значения по умолчанию.
func LoadConfig() AppConfig {
	cfg := DefaultConfig()
	data, err := os.ReadFile(configPath())
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	if cfg.BcFormat == "" {
		cfg.BcFormat = "auto"
	}
	if cfg.DefaultQrSide != "right" {
		cfg.DefaultQrSide = "left"
	}
	if cfg.FontSize == "" {
		cfg.FontSize = "-1"
	}
	return cfg
}

// SaveConfig записывает настройки в config.json.
func SaveConfig(cfg AppConfig) error {
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
