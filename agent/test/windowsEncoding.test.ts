import { describe, expect, it } from "vitest";
import { windowsUtf8Argv, windowsUtf8Environment } from "../src/windowsEncoding.js";

const psPrefix =
  "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n" +
  "try { $OutputEncoding=New-Object System.Text.UTF8Encoding($false) } catch {}\n";

describe("Windows UTF-8 command preparation", () => {
  it.each([
    [["powershell.exe", "-Command", "Get-ChildItem"], ["powershell.exe", "-Command", psPrefix + "Get-ChildItem"]],
    [["pwsh", "-c", "Get-ChildItem"], ["pwsh", "-c", psPrefix + "Get-ChildItem"]],
    [["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-Command", "Get-ChildItem"], ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-Command", psPrefix + "Get-ChildItem"]],
    [["pwsh.exe", "-Command", psPrefix + "Get-ChildItem"], ["pwsh.exe", "-Command", psPrefix + "Get-ChildItem"]],
    [["powershell", "-Command"], ["powershell", "-Command"]],
    // A script that sets only the console encoding itself still gets the pipe encoding.
    [["powershell", "-Command", "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; 'x' | python -"],
     ["powershell", "-Command", psPrefix + "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; 'x' | python -"]],
  ] as const)("handles PowerShell invocation %j", (input, expected) => {
    expect(windowsUtf8Argv(input)).toEqual(expected);
  });

  it.each([
    [["cmd.exe", "/c", "dir"], ["cmd.exe", "/c", "chcp 65001>nul & dir"]],
    [["C:\\Windows\\System32\\cmd.exe", "/d", "/c", "dir"], ["C:\\Windows\\System32\\cmd.exe", "/d", "/c", "chcp 65001>nul & dir"]],
    [["cmd.exe", "/c", "/d", "dir"], ["cmd.exe", "/c", "/d", "chcp 65001>nul & dir"]],
    [["cmd", "dir"], ["cmd", "dir"]],
  ] as const)("handles cmd invocation %j", (input, expected) => {
    expect(windowsUtf8Argv(input)).toEqual(expected);
  });

  it("leaves non-shell executables unchanged and does not mutate argv", () => {
    const input = ["python.exe", "script.py"];
    expect(windowsUtf8Argv(input)).toEqual(input);
    expect(input).toEqual(["python.exe", "script.py"]);
  });

  it("adds Python UTF-8 defaults without replacing existing values, case-insensitively", () => {
    expect(windowsUtf8Environment({ PATH: "C:\\bin" })).toEqual({ PATH: "C:\\bin", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });
    expect(windowsUtf8Environment({ pythonutf8: "0", PythonIOEncoding: "cp936" })).toEqual({ pythonutf8: "0", PythonIOEncoding: "cp936" });
  });
});
