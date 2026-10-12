const POWERSHELL_PREFIX = "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n";
const POWERSHELL_MARKER = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8";
const CMD_PREFIX = "chcp 65001>nul & ";

function executableName(value: string): string {
  return value.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
}

/** Add UTF-8 output setup only after the Windows request has passed local policy. */
export function windowsUtf8Argv(argv: readonly string[]): string[] {
  if (argv.length === 0) return [...argv];
  const executable = executableName(argv[0]);
  if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(executable)) {
    const commandIndex = argv.findIndex((arg, index) => index > 0 && ["-command", "-c"].includes(arg.toLowerCase()));
    if (commandIndex < 0 || commandIndex + 1 >= argv.length) return [...argv];
    const scriptIndex = commandIndex + 1;
    const script = argv[scriptIndex];
    if (!script || script.includes(POWERSHELL_MARKER)) return [...argv];
    const result = [...argv];
    result[scriptIndex] = POWERSHELL_PREFIX + script;
    return result;
  }
  if (executable === "cmd" || executable === "cmd.exe") {
    const commandIndex = argv.findIndex((arg, index) => index > 0 && arg.toLowerCase() === "/c");
    if (commandIndex < 0 || commandIndex + 1 >= argv.length) return [...argv];
    const commandIndexNext = argv[commandIndex + 1].toLowerCase() === "/d" ? commandIndex + 2 : commandIndex + 1;
    if (commandIndexNext >= argv.length) return [...argv];
    const command = argv[commandIndexNext];
    if (!command || command.startsWith(CMD_PREFIX)) return [...argv];
    const result = [...argv];
    result[commandIndexNext] = CMD_PREFIX + command;
    return result;
  }
  return [...argv];
}

/** Preserve caller values, while supplying UTF-8 defaults for Python processes. */
export function windowsUtf8Environment(env: Readonly<Record<string, string>>): Record<string, string> {
  const result = { ...env };
  const keys = new Set(Object.keys(result).map(key => key.toLowerCase()));
  if (!keys.has("pythonutf8")) result.PYTHONUTF8 = "1";
  if (!keys.has("pythonioencoding")) result.PYTHONIOENCODING = "utf-8";
  return result;
}
