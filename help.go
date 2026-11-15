package main

import (
"fmt"
"os"
)

func printHelpText() {
fmt.Println("NiimBc — драйвер принтера этикеток и штрихкодов NIIMBOT N1 (Bluetooth LE)")
fmt.Println("Синтаксис: niimbc [флаги] <команда> [аргументы]")
fmt.Println("Доступные команды: barcode, text, image, preview, gui, info, rfid, testpage, calibrate, scan")
fmt.Println("Подробный список флагов и примеров смотрите в коде проекта или help.go")
flagSet.SetOutput(os.Stdout)
flagSet.PrintDefaults()
}