package main

import (
_ "embed"
"fmt"
"os"
"strings"
)

//go:embed FullHelp.hl
var embeddedHelpText string

func printHelpText() {
fmt.Println(strings.TrimRight(embeddedHelpText, "\r\n"))
fmt.Println()
fmt.Println("Технический список флагов:")
flagSet.SetOutput(os.Stdout)
flagSet.PrintDefaults()
}
