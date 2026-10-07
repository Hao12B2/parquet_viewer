' ============================================================
' Parquet Viewer - chay nhu ung dung desktop (KHONG cua so den)
'   Double-click file nay: server chay ngam + mo cua so app rieng
'   Tat server han: chay stop_server.bat
'   Xem log khi loi: mo file server.log, hoac chay run.bat
'
' LUU Y: miniconda/anaconda KHONG co pythonw.exe nen script
'   tu do tim python.exe (PATH + thu muc cai dat mac dinh)
'   va chay an bang cua so hidden.
' ============================================================
Option Explicit

Dim fso, sh, root, port, url, i, started, py
port = "8000"
url = "http://127.0.0.1:" & port & "/"
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' --- 1) Tim python (ho tro miniconda: chi co python.exe) ---
py = FindPython()
If py = "" Then
  MsgBox "Khong tim thay Python." & vbCrLf & vbCrLf & _
         "Du ban da cai miniconda, Windows van chua thay 'python' trong PATH." & vbCrLf & _
         "Cach sua nhanh:" & vbCrLf & _
         "  1. Mo Anaconda Prompt, go: where python" & vbCrLf & _
         "  2. Copy thu muc chua python.exe, them vao PATH he thong, dang nhap lai" & vbCrLf & _
         "Hoac: chay run.bat ngay trong Anaconda Prompt.", vbCritical, "Parquet Viewer"
  WScript.Quit 1
End If

sh.CurrentDirectory = root

' --- 2) Server dang chay roi thi chi mo cua so app ---
If ServerUp(url) Then
  OpenApp url
  WScript.Quit
End If

' --- 3) Cai thu vien (chay an, doi xong) ---
sh.Run """" & py & """ -m pip install -q -r requirements.txt", 0, True

' --- 4) Ghi file bat khoi dong roi chay an ---
WriteStartBat root, py
sh.Run """" & fso.BuildPath(root, "_start_server.bat") & """", 0, False

' --- 5) Doi server san sang (toi da ~30 giay) ---
started = False
For i = 1 To 30
  WScript.Sleep 1000
  If ServerUp(url) Then
    started = True
    Exit For
  End If
Next

If Not started Then
  MsgBox "Khong khoi dong duoc server." & vbCrLf & _
         "Python dang dung: " & py & vbCrLf & vbCrLf & _
         "Hay mo file server.log trong thu muc de xem loi chi tiet," & vbCrLf & _
         "hoac chay run.bat de xem log truc tiep.", vbCritical, "Parquet Viewer"
  WScript.Quit 1
End If

FirstRunNote
OpenApp url

' ==================== ham phu ====================
Function FindPython()
  Dim p
  p = FindOnPath("python.exe")
  If p <> "" Then
    FindPython = p
    Exit Function
  End If
  FindPython = GuessConda()
End Function

' Quet PATH thu cong (khong can goi where, khong chop man hinh)
Function FindOnPath(exeName)
  Dim raw, dirs, i, d, cand
  raw = sh.ExpandEnvironmentStrings("%PATH%")
  dirs = Split(raw, ";")
  For i = 0 To UBound(dirs)
    d = Trim(dirs(i))
    If Len(d) >= 2 And Left(d, 1) = """" And Right(d, 1) = """" Then
      d = Mid(d, 2, Len(d) - 2)
    End If
    If d = "" Then
      d = root
    End If
    On Error Resume Next
    d = sh.ExpandEnvironmentStrings(d)
    On Error GoTo 0
    cand = fso.BuildPath(d, exeName)
    If fso.FileExists(cand) Then
      FindOnPath = cand
      Exit Function
    End If
  Next
  FindOnPath = ""
End Function

' Thu muc cai dat mac dinh cua miniconda/anaconda
Function GuessConda()
  Dim home, cands, i
  home = sh.ExpandEnvironmentStrings("%USERPROFILE%")
  cands = Array( _
    fso.BuildPath(home, "miniconda3\python.exe"), _
    fso.BuildPath(home, "anaconda3\python.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\miniconda3\python.exe", _
    "C:\ProgramData\miniconda3\python.exe", _
    "C:\ProgramData\Anaconda3\python.exe")
  For i = 0 To UBound(cands)
    If fso.FileExists(cands(i)) Then
      GuessConda = cands(i)
      Exit Function
    End If
  Next
  GuessConda = ""
End Function

' Uu tien pythonw.exe cung thu muc (khong console); miniconda
' khong co thi dung thang python.exe (van an nho window hidden)
Function ServerRunner(pyPath)
  Dim sib
  sib = fso.BuildPath(fso.GetParentFolderName(pyPath), "pythonw.exe")
  If fso.FileExists(sib) Then
    ServerRunner = sib
  Else
    ServerRunner = pyPath
  End If
End Function

' Sinh file bat de xu ly dung path co dau cach + ghi log
Sub WriteStartBat(r, pyPath)
  Dim w, bat, logf, runner
  bat = fso.BuildPath(r, "_start_server.bat")
  logf = fso.BuildPath(r, "server.log")
  runner = ServerRunner(pyPath)
  Set w = fso.CreateTextFile(bat, True)
  w.WriteLine "@echo off"
  w.WriteLine "cd /d """ & r & """"
  w.WriteLine """" & runner & """ -m uvicorn app.main:app --host 127.0.0.1 --port " & port & " > """ & logf & """ 2>&1"
  w.Close
End Sub

Function ServerUp(u)
  On Error Resume Next
  Dim h
  Set h = CreateObject("MSXML2.XMLHTTP")
  h.open "GET", u & "api/health", False
  h.send
  ServerUp = (h.status = 200)
  If Err.Number <> 0 Then ServerUp = False
  On Error GoTo 0
End Function

Sub OpenApp(u)
  Dim br
  br = FindBrowser()
  If br = "" Then
    sh.Run u, 1, False   ' trinh duyet mac dinh
  Else
    ' --app: mo cua so rieng co nut X nhu desktop app
    sh.Run """" & br & """ --app=" & u, 1, False
  End If
End Sub

Function FindBrowser()
  Dim c
  On Error Resume Next
  c = sh.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\")
  If c <> "" And fso.FileExists(c) Then FindBrowser = c : Exit Function
  c = sh.RegRead("HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe\")
  If c <> "" And fso.FileExists(c) Then FindBrowser = c : Exit Function
  c = sh.ExpandEnvironmentStrings("%PROGRAMFILES%") & "\Google\Chrome\Application\chrome.exe"
  If fso.FileExists(c) Then FindBrowser = c : Exit Function
  c = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"
  If fso.FileExists(c) Then FindBrowser = c : Exit Function
  c = sh.ExpandEnvironmentStrings("%PROGRAMFILES(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
  If fso.FileExists(c) Then FindBrowser = c : Exit Function
  c = sh.ExpandEnvironmentStrings("%PROGRAMFILES%") & "\Microsoft\Edge\Application\msedge.exe"
  If fso.FileExists(c) Then FindBrowser = c : Exit Function
  FindBrowser = ""
  On Error GoTo 0
End Function

Sub FirstRunNote()
  Dim flag, t
  flag = fso.BuildPath(root, ".app_note_shown")
  If fso.FileExists(flag) Then Exit Sub
  Set t = fso.CreateTextFile(flag, True)
  t.Close
  MsgBox "Parquet Viewer dang chay NEN (khong cua so den)." & vbCrLf & vbCrLf & _
         "- Dong cua so app KHONG tat server." & vbCrLf & _
         "- Muon TAT HAN server: chay file stop_server.bat", vbInformation, "Parquet Viewer"
End Sub
