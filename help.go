package main

import (
_ "embed"
"fmt"
"os"
"strings"
)

//go:embed help.txt
var embeddedHelpText string

func printHelpText() {
fmt.Println(strings.TrimRight(embeddedHelpText, "\r\n"))
fmt.Println()
fmt.Println("Полный справочник флагов командной строки:")
flagSet.SetOutput(os.Stdout)
flagSet.PrintDefaults()
}
