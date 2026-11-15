package main

import (
_ "embed"
"fmt"
"os"
"strings"
)

//go:embed FullHelp.hl
var embeddedHelpText string

func printShortHelp() {
fmt.Println("NiimBc — драйвер принтера этикеток и штрихкодов NIIMBOT N1 (Bluetooth LE)")
fmt.Println()
fmt.Println("Синтаксис: niimbc [флаги] <команда> [аргументы]")
fmt.Println("Команды:   barcode | text | image | preview | gui | info | rfid | testpage | calibrate | scan")
fmt.Println()
fmt.Println("Технический список флагов:")
flagSet.SetOutput(os.Stdout)
flagSet.PrintDefaults()
fmt.Println()
fmt.Println("Для подробной справки с примерами запустите: niimbc --help")
}

func printFullHelp() {
fmt.Println(strings.TrimRight(embeddedHelpText, "\r\n"))
}

func printHelpText() {
printFullHelp()
}
