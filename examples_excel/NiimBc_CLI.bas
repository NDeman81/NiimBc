Attribute VB_Name = "NiimBc_CLI"
Option Explicit

Private Const NIIMBC_EXE As String = "C:\dev\NiimbotBcGo\niimbc.exe"

Private Function RunNiimBc(ByVal args As String, ByRef exitCode As Long) As String
    Dim sh As Object, ex As Object
    Set sh = CreateObject("WScript.Shell")
    Set ex = sh.Exec("cmd.exe /c chcp 65001 >nul && """ & NIIMBC_EXE & """ " & args)
    Do While ex.Status = 0: DoEvents: Loop
    exitCode = ex.ExitCode
    RunNiimBc = ex.StdOut.ReadAll & ex.StdErr.ReadAll
End Function

Public Sub PrintBarcode_CLI()
    Dim c As String, t As String, b As String, outTxt As String, rc As Long
    c = Trim(CStr(Cells(ActiveCell.Row, 1).Value))
    t = Replace(Trim(CStr(Cells(ActiveCell.Row, 2).Value)), """", "'")
    b = Replace(Trim(CStr(Cells(ActiveCell.Row, 3).Value)), """", "'")
    If c = "" Then Exit Sub
    outTxt = RunNiimBc("--log-level error --on-demand --length 50 --bc-format auto --top-text """ & t & """ --bottom-text """ & b & """ --font-size ""35p"" --bold barcode """ & c & """", rc)
    If rc <> 0 Then MsgBox outTxt, vbCritical Else MsgBox "Напечатано: " & c, vbInformation
End Sub

Public Sub PrintTemplate_CLI()
    Dim lineStr As String, outTxt As String, rc As Long
    lineStr = Trim(CStr(Cells(ActiveCell.Row, 1).Value)) & ";" & Trim(CStr(Cells(ActiveCell.Row, 2).Value)) & ";" & Trim(CStr(Cells(ActiveCell.Row, 3).Value))
    outTxt = RunNiimBc("--log-level error --on-demand --template ""Инвентарный штрихкод"" template """ & lineStr & """", rc)
    If rc <> 0 Then MsgBox outTxt, vbCritical Else MsgBox "Этикетка по шаблону напечатана!", vbInformation
End Sub

Public Sub ReadStatusAndRfid_CLI()
    Dim rc As Long
    MsgBox RunNiimBc("--on-demand info", rc) & vbCrLf & RunNiimBc("--on-demand rfid", rc), vbInformation
End Sub
