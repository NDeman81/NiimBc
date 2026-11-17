package main

import (
_ "embed"
"fmt"
"os"
"strings"
)

//go:embed FullHelp.hl
var embeddedHelpText string

//go:embed Examples.hl
var embeddedExamplesText string

func printShortHelp() {
fmt.Println("NiimBc — драйвер принтера этикеток и штрихкодов NIIMBOT N1 (Bluetooth LE)")
fmt.Println()
fmt.Println("Синтаксис: niimbc [флаги] <команда> [аргументы]")
fmt.Println("Команды:   barcode | text | image | preview | gui | info | rfid | testpage | calibrate | scan | examples")
fmt.Println()
fmt.Println("Технический список флагов:")
flagSet.SetOutput(os.Stdout)
flagSet.PrintDefaults()
fmt.Println()
fmt.Println("Для подробной справки запустите: niimbc --help")
fmt.Println("Для просмотра примеров запустите: niimbc examples")
}

func printFullHelp() {
fmt.Println(strings.TrimRight(embeddedHelpText, "\r\n"))
}

func printExamples() {
fmt.Println(strings.TrimRight(embeddedExamplesText, "\r\n"))
}

func printHelpText() {
printFullHelp()
}
