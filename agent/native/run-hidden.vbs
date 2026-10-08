Option Explicit
If WScript.Arguments.Count <> 3 Then WScript.Quit 2
Dim Shell, Node, Cli, State, Code
Set Shell = CreateObject("WScript.Shell")
Node = WScript.Arguments(0)
Cli = WScript.Arguments(1)
State = WScript.Arguments(2)
If InStr(Node, Chr(34)) Or InStr(Cli, Chr(34)) Then WScript.Quit 2
Shell.Environment("PROCESS")("SUNMOON_AGENT_HOME") = State
' The tray is separate; exiting its UI cannot terminate the daemon.
Shell.Run Chr(34) & Node & Chr(34) & " " & Chr(34) & Cli & Chr(34) & " tray", 0, False
Code = Shell.Run(Chr(34) & Node & Chr(34) & " " & Chr(34) & Cli & Chr(34) & " start --background-worker", 0, True)
' A revoked/replaced token requires the user to act, never a scheduled retry.
If Code = 3 Then Code = 0
WScript.Quit Code
