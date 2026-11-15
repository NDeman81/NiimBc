package main

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/code128"
	"github.com/boombuler/barcode/qr"
	"github.com/boombuler/barcode/twooffive"
	"golang.org/x/image/font"
	"golang.org/x/image/math/fixed"
)

// BarcodeOptions описывает параметры генерации этикетки со штрихкодом или QR-кодом.
type BarcodeOptions struct {
	Data           string
	Format         string // auto | code128 | qr | qrl | qrr
	LengthMM       float64
	TopText        string
	BottomText     string
	FontName       string
	IsMainTextBold bool
	FontSize       string // -1 (авто), 0 (скрыть), N (pt), Np (%)
	OffsetPx       int
	SideMarginPx   int
	MarginPx       int
	GapPx          int
	TextGapPx      int
}

var (
	reOnlyDigits = regexp.MustCompile(`^[0-9]+$`)
	reAsciiPrint = regexp.MustCompile(`^[\x20-\x7E]+$`)
)

// RenderBarcodeLabel строит готовое изображение этикетки со штрихкодом (ITF / Code 128) или QR-кодом.
func RenderBarcodeLabel(opts BarcodeOptions, cfg AppConfig) (*image.Gray, error) {
	raw := strings.TrimSpace(opts.Data)
	if raw == "" {
		return nil, fmt.Errorf("не заданы данные для штрихкода")
	}

	fmtMode := strings.ToLower(strings.TrimSpace(opts.Format))
	if fmtMode == "" {
		fmtMode = cfg.BcFormat
	}
	if fmtMode == "" {
		fmtMode = "auto"
	}

	switch fmtMode {
	case "auto", "code128":
		if !reAsciiPrint.MatchString(raw) {
			return nil, fmt.Errorf("линейный штрихкод поддерживает только латиницу, цифры и спецсимволы ASCII")
		}
		return renderLinearBarcodeLabel(raw, fmtMode, opts)
	case "qr", "qrl", "qrr":
		side := cfg.DefaultQrSide
		if fmtMode == "qrl" {
			side = "left"
		} else if fmtMode == "qrr" {
			side = "right"
		}
		return renderQrLabel(raw, side, opts)
	default:
		return nil, fmt.Errorf("неизвестный формат штрихкода %q (доступны: auto, code128, qr, qrl, qrr)", fmtMode)
	}
}

// encodeLinear кодирует строку в ITF (при auto и чётных цифрах) или Code 128.
func encodeLinear(raw, fmtMode string) (barcode.Barcode, error) {
	useItf := fmtMode == "auto" && reOnlyDigits.MatchString(raw) && len(raw)%2 == 0
	if useItf {
		return twooffive.Encode(raw, true)
	}
	return code128.Encode(raw)
}
// renderLinearBarcodeLabel рисует горизонтальный штрихкод с верхним, основным и нижним текстом.
func renderLinearBarcodeLabel(raw, fmtMode string, opts BarcodeOptions) (*image.Gray, error) {
	bc, err := encodeLinear(raw, fmtMode)
	if err != nil {
		return nil, fmt.Errorf("ошибка кодирования штрихкода: %w", err)
	}

	lengthMM := opts.LengthMM
	if lengthMM <= 0 {
		lengthMM = 50
	}
	canvas := NewLabelImage(lengthMM)
	W := canvas.Bounds().Dx()
	H := canvas.Bounds().Dy()

	topMargin := maxInt(0, opts.MarginPx)
	bottomMargin := maxInt(0, opts.MarginPx)
	sideMargin := maxInt(0, opts.SideMarginPx)
	gap := maxInt(0, opts.GapPx)

	netH := H - topMargin - bottomMargin
	if netH < 10 {
		netH = 10
	}

	hasTop := strings.TrimSpace(opts.TopText) != ""
	hasBottom := strings.TrimSpace(opts.BottomText) != ""

	maxAllowedGap := int(math.Floor(float64(netH) * 0.05))
	textGap := minInt(maxInt(0, opts.TextGapPx), maxAllowedGap)

	topTextH := 0
	if hasTop {
		topTextH = int(math.Round(float64(netH) * 0.15))
	}
	topGap := 0
	if hasTop {
		topGap = textGap
	}

	bottomTextH := 0
	if hasBottom {
		bottomTextH = int(math.Round(float64(netH) * 0.15))
	}
	bottomGap := 0
	if hasBottom {
		bottomGap = textGap
	}
	bottomTextY := H - bottomMargin - bottomTextH

	centerY := topMargin + topTextH + topGap
	centerH := bottomTextY - bottomGap - centerY
	if centerH < 6 {
		centerH = 6
	}

	fontSize := strings.ToLower(strings.TrimSpace(opts.FontSize))
	if fontSize == "" {
		fontSize = "-1"
	}

	renderBarcode := fontSize != "only_text"
	renderMain := fontSize != "0"
	isPercent := strings.HasSuffix(fontSize, "p")
	fontVal := -1
	if isPercent {
		v, err := strconv.Atoi(strings.TrimSuffix(fontSize, "p"))
		if err != nil {
			return nil, fmt.Errorf("неверный процент шрифта %q", opts.FontSize)
		}
		if v > 95 {
			renderBarcode = false
		} else if v < 5 {
			renderMain = false
		}
		fontVal = v
	} else if fontSize != "only_text" {
		v, err := strconv.Atoi(fontSize)
		if err != nil {
			return nil, fmt.Errorf("неверный размер шрифта %q", opts.FontSize)
		}
		fontVal = v
	}

	var barcodeY, barcodeH, mainY, mainH int
	switch {
	case !renderBarcode:
		mainY = centerY
		mainH = centerH
	case !renderMain:
		barcodeY = centerY
		barcodeH = centerH
	case fontVal == -1 && !isPercent:
		avail := maxInt(2, centerH-gap)
		barcodeH = avail / 2
		mainH = avail - barcodeH
		barcodeY = centerY
		mainY = barcodeY + barcodeH + gap
	case isPercent:
		mainH = int(math.Round(float64(centerH) * (float64(fontVal) / 100.0)))
		if mainH > centerH-gap-2 {
			mainH = maxInt(1, centerH-gap-2)
		}
		mainY = centerY + centerH - mainH
		barcodeY = centerY
		barcodeH = maxInt(1, mainY-gap-barcodeY)
	default:
		mainH = minInt(fontVal, maxInt(1, centerH-gap))
		mainY = centerY + centerH - mainH
		barcodeY = centerY
		barcodeH = maxInt(1, mainY-gap-barcodeY)
	}

	offX := opts.OffsetPx
	if hasTop && topTextH > 0 {
		_ = drawFittedLine(canvas, opts.TopText, opts.FontName, false, offX+sideMargin, topMargin, W-2*sideMargin, topTextH)
	}

	if renderBarcode && barcodeH > 0 {
		bcSide := maxInt(sideMargin, 10)
		targetW := maxInt(10, W-2*bcSide)
		drawSharpBarcode(canvas, bc, offX+bcSide, barcodeY, targetW, barcodeH)
	}

	if renderMain && mainH > 0 {
		_ = drawFittedLine(canvas, raw, opts.FontName, opts.IsMainTextBold, offX+sideMargin, mainY, W-2*sideMargin, mainH)
	}

	if hasBottom && bottomTextH > 0 {
		_ = drawFittedLine(canvas, opts.BottomText, opts.FontName, false, offX+sideMargin, bottomTextY, W-2*sideMargin, bottomTextH)
	}

	return canvas, nil
}
// renderQrLabel рисует QR-код слева или справа, а текстовые блоки — с противоположной стороны.
func renderQrLabel(raw, side string, opts BarcodeOptions) (*image.Gray, error) {
	qrCode, err := qr.Encode(raw, qr.M, qr.Auto)
	if err != nil {
		return nil, fmt.Errorf("ошибка кодирования QR: %w", err)
	}

	lengthMM := opts.LengthMM
	if lengthMM <= 0 {
		lengthMM = 50
	}
	canvas := NewLabelImage(lengthMM)
	W := canvas.Bounds().Dx()
	H := canvas.Bounds().Dy()

	margin := maxInt(0, opts.MarginPx)
	sideMargin := maxInt(0, opts.SideMarginPx)
	gap := maxInt(4, opts.GapPx)

	qrSize := maxInt(16, H-2*margin)
	if qrSize > W-2*sideMargin-10 {
		qrSize = maxInt(16, W-2*sideMargin-10)
	}

	offX := opts.OffsetPx
	var qrX, textX, textW int
	if side == "right" {
		qrX = offX + W - sideMargin - qrSize
		textX = offX + sideMargin
		textW = maxInt(10, qrX-gap-textX)
	} else {
		qrX = offX + sideMargin
		textX = qrX + qrSize + gap
		textW = maxInt(10, offX+W-sideMargin-textX)
	}

	drawSharpBarcode(canvas, qrCode, qrX, margin, qrSize, qrSize)

	type textLine struct {
		text   string
		bold   bool
		weight float64
	}
	var lines []textLine
	if strings.TrimSpace(opts.TopText) != "" {
		lines = append(lines, textLine{text: opts.TopText, bold: false, weight: 0.25})
	}
	if strings.TrimSpace(opts.FontSize) != "0" {
		lines = append(lines, textLine{text: raw, bold: opts.IsMainTextBold, weight: 0.50})
	}
	if strings.TrimSpace(opts.BottomText) != "" {
		lines = append(lines, textLine{text: opts.BottomText, bold: false, weight: 0.25})
	}
	if len(lines) == 0 {
		return canvas, nil
	}

	totalWeight := 0.0
	for _, l := range lines {
		totalWeight += l.weight
	}
	textGap := maxInt(2, opts.TextGapPx)
	availH := maxInt(10, (H-2*margin)-textGap*(len(lines)-1))

	curY := margin
	for i, l := range lines {
		h := int(math.Round(float64(availH) * (l.weight / totalWeight)))
		if i == len(lines)-1 {
			h = maxInt(4, H-margin-curY)
		}
		_ = drawFittedLine(canvas, l.text, opts.FontName, l.bold, textX, curY, textW, h)
		curY += h + textGap
	}

	return canvas, nil
}

// drawSharpBarcode вписывает штрихкод/QR без сглаживания (строго чёрные и белые модули) по центру области.
func drawSharpBarcode(dst *image.Gray, bc barcode.Barcode, x, y, boxW, boxH int) {
	b := bc.Bounds()
	srcW, srcH := b.Dx(), b.Dy()
	if srcW <= 0 || srcH <= 0 || boxW <= 0 || boxH <= 0 {
		return
	}

	scaleX := boxW / srcW
	if scaleX < 1 {
		scaleX = 1
	}
	drawW := srcW * scaleX
	if drawW > boxW {
		drawW = boxW
	}
	drawH := boxH
	if bc.Metadata().Dimensions == 2 {
		s := minInt(boxW/srcW, boxH/srcH)
		if s < 1 {
			s = 1
		}
		drawW = srcW * s
		drawH = srcH * s
	}

	offX := x + (boxW-drawW)/2
	offY := y + (boxH-drawH)/2

	for py := 0; py < drawH; py++ {
		sy := b.Min.Y + (py*srcH)/drawH
		for px := 0; px < drawW; px++ {
			sx := b.Min.X + (px*srcW)/drawW
			r, g, bl, _ := bc.At(sx, sy).RGBA()
			if (r+g+bl)/3 < 0x8000 {
				if image.Pt(offX+px, offY+py).In(dst.Bounds()) {
					dst.SetGray(offX+px, offY+py, color.Gray{Y: 0})
				}
			}
		}
	}
}

// drawFittedLine подбирает максимальный кегль, при котором строка целиком влезает в boxW × boxH, и центрирует её.
func drawFittedLine(dst *image.Gray, text, fontName string, bold bool, x, y, boxW, boxH int) error {
	text = strings.TrimSpace(text)
	if text == "" || boxW < 4 || boxH < 4 {
		return nil
	}
	fontPath, err := pickFont(fontName, bold)
	if err != nil {
		return err
	}

	bestSize := 4.0
	for size := float64(boxH) * 1.15; size >= 4.0; size -= 0.5 {
		face, err := loadFace(fontPath, size)
		if err != nil {
			continue
		}
		w := font.MeasureString(face, text).Ceil()
		m := face.Metrics()
		h := (m.Ascent + m.Descent).Ceil()
		face.Close()
		if w <= boxW && h <= boxH {
			bestSize = size
			break
		}
	}

	face, err := loadFace(fontPath, bestSize)
	if err != nil {
		return err
	}
	defer face.Close()

	w := font.MeasureString(face, text).Ceil()
	m := face.Metrics()
	h := (m.Ascent + m.Descent).Ceil()

	px := x + (boxW-w)/2
	py := y + (boxH-h)/2 + m.Ascent.Ceil()

	d := &font.Drawer{
		Dst:  dst,
		Src:  image.NewUniform(color.Black),
		Face: face,
		Dot:  fixed.P(px, py),
	}
	d.DrawString(text)
	return nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
