Option Explicit
If WScript.Arguments.Count <> 4 Then WScript.Quit 2
Dim Shell, FSO, Node, Cli, State, Action, Command, Root, SiteFile, Text, Stream, Launch
Set Shell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
Node = WScript.Arguments(0)
Cli = WScript.Arguments(1)
State = WScript.Arguments(2)
Action = WScript.Arguments(3)
If InStr(Node, Chr(34)) Or InStr(Cli, Chr(34)) Or InStr(State, Chr(34)) Then WScript.Quit 2
If Action = "tray" Then
  Command = "tray"
Else
  WScript.Quit 2
End If
Shell.Environment("PROCESS")("SUNMOON_AGENT_HOME") = State
Launch = ""
If LCase(FSO.GetBaseName(Node)) = "node" And LCase(FSO.GetFileName(FSO.GetParentFolderName(Node))) = "node" Then
  Root = FSO.GetParentFolderName(FSO.GetParentFolderName(Node))
  SiteFile = Root & "\site\site.json"
  If FSO.FileExists(SiteFile) Then
    On Error Resume Next
    Shell.Environment("PROCESS").Remove "NODE_OPTIONS"
    Shell.Environment("PROCESS").Remove "NODE_EXTRA_CA_CERTS"
    On Error GoTo 0
    Set Stream = FSO.OpenTextFile(SiteFile, 1)
    Text = Stream.ReadAll
    Stream.Close
    If InStr(Text, """mode"": ""bundled-ca""") > 0 And FSO.FileExists(Root & "\site\ca.pem") Then
      Shell.Environment("PROCESS")("NODE_EXTRA_CA_CERTS") = Root & "\site\ca.pem"
    End If
    Launch = "--use-system-ca "
  End If
End If
' Do not wait. menu exits after the ready file appears; this process keeps the window.
Shell.Run Chr(34) & Node & Chr(34) & " " & Launch & Chr(34) & Cli & Chr(34) & " " & Command, 0, False
