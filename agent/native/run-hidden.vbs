Option Explicit
If WScript.Arguments.Count <> 3 Then WScript.Quit 2
Dim Shell, FSO, Node, Cli, State, Code, Root, SiteFile, Text, Stream, Launch
Set Shell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
Node = WScript.Arguments(0)
Cli = WScript.Arguments(1)
State = WScript.Arguments(2)
If InStr(Node, Chr(34)) Or InStr(Cli, Chr(34)) Then WScript.Quit 2
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
' The tray is separate; exiting its UI cannot terminate the daemon.
Shell.Run Chr(34) & Node & Chr(34) & " " & Launch & Chr(34) & Cli & Chr(34) & " tray", 0, False
Code = Shell.Run(Chr(34) & Node & Chr(34) & " " & Launch & Chr(34) & Cli & Chr(34) & " start --background-worker", 0, True)
' A revoked/replaced token requires the user to act, never a scheduled retry.
If Code = 3 Then Code = 0
WScript.Quit Code
