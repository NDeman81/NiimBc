Attribute VB_Name = "NiimBc_HTTP"
Option Explicit

Private Const NIIMBC_EXE As String = "C:\dev\NiimbotBcGo\niimbc.exe"
Private Const API_BASE As String = "http://localhost:8765"

Private Sub EnsureServer()
    Dim http As Object: Set http = CreateObject("MSXML2.XMLHTTP")
    On Error Resume Next
    http.Open "GET", API_BASE & "/api/config", False: http.Send
    If Err.Number = 0 And http.Status = 200 Then Exit Sub
    On Error GoTo 0
    CreateObject("WScript.Shell").Run """" & NIIMBC_EXE & """ gui --no-browser", 0, False
    Dim t As Double: t = Timer: Do While Timer - t < 2.5: DoEvents: Loop
End Sub

Private Function JsonEsc(ByVal s As String) As String
    JsonEsc = Replace(Replace(Replace(s, "\", "\\"), """", "\"""), vbCrLf, "\n")
End Function

Private Function CallApi(ByVal method As String, ByVal path As String, ByVal body As String) As String
    EnsureServer
    Dim http As Object: Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open method, API_BASE & path, False
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    If body <> "" Then http.Send body Else http.Send
    If http.Status >= 400 Then Err.Raise vbObjectError + 1, , http.responseText
    CallApi = http.responseText
End Function

Public Sub PrintSelectionByTemplate_HTTP()
    Dim rng As Range, r As Range, items As String, lineStr As String
    Set rng = Intersect(Selection.EntireRow, ActiveSheet.UsedRange)
    If rng Is Nothing Then Exit Sub
    For Each r In rng.Rows
        If Trim(CStr(Cells(r.Row, 1).Value)) <> "" Then
            lineStr = Trim(CStr(Cells(r.Row, 1).Value)) & ";" & Trim(CStr(Cells(r.Row, 2).Value)) & ";" & Trim(CStr(Cells(r.Row, 3).Value))
            If items <> "" Then items = items & ","
            items = items & """" & JsonEsc(lineStr) & """"
        End If
    Next r
    If items = "" Then Exit Sub
    MsgBox CallApi("POST", "/api/print-template", "{""templateName"":""Инвентарный штрихкод"",""items"":[" & items & "]}"), vbInformation
End Sub

Public Sub ReadStatusAndRfid_HTTP()
    MsgBox CallApi("GET", "/api/status", ""), vbInformation
End Sub
