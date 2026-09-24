# 探针报告：Windows 上的 exec-server（D11）

日期 2026-09-24 · 在所有者的 Windows 机（ZYMUN，Windows 11 26200，PowerShell 5.1，Node 24.19，Python 3.13.15，codex-cli 0.155.1，杀毒 Windows Defender + 火绒）由本地助手跑，原生 Windows，不经 WSL。脚本 `scripts/probe-windows-exec-server.ps1`（本地助手按所有者授权修过，见下），结果 `scripts/results/probe-windows-exec-server.20260924-*.txt`，逐次的补丁与摘要同目录。

## 结论：pass。Windows 上 exec-server 起得来，沙箱挡得住。

| 次 | 结果 | 原因 |
| --- | --- | --- |
| 10:33 | undecidable | 机器上没装 Codex、Node、可用 Python；本地助手没装东西，正确 |
| 11:24 | fail（脚本错） | `Start-Process "codex"` 起 npm 的 `.cmd` 垫片报「不是有效的 Win32 应用程序」；与 exec-server 无关 |
| 11:38 | **pass** | 修脚本后：exec-server 监听 `ws://127.0.0.1:47011`；`environment/add`、`environment/info` 成功（shell 是 `powershell.exe`）；L2 写 `%USERPROFILE%` 被拒（`PermissionDenied`，文件未建）；L3 写 cwd 成功 |

## Windows 特有的四件事，都要进设计

1. **一次性管理员初始化。**Windows 上的沙箱不是装完就有：要在管理员 PowerShell 里对每个 `CODEX_HOME` 跑一次 `codex sandbox setup --elevated --current-user`，它建沙箱账号、权限、防火墙规则，并在配置里写 `windows.sandbox = "elevated"`。没做这一步时，`approvalPolicy=never` 下的写操作可能在编排端就被策略拒了，**不能拿来证明执行端的文件边界**。本地代理的 Windows 安装器要含这一步（需要 UAC 提权一次）。
2. **启动方式。**npm 装的 `codex` 是 `.cmd`/`.ps1` 垫片，不能当原生进程起；要么解析包里的 `bin.codex` 用 `node.exe` 起，要么直接用包内 `vendor/<平台>/codex/codex.exe`。代理随包带原生 exe 就没这个问题。
3. **端口不能写死。**47001 在那台机上被 Cursor 的端口转发占了；探针改成 `EXEC_PORT` 可配。代理应选空闲回环端口。
4. **杀毒没拦。**Defender 与火绒同时在，exec-server 起动、监听、执行都没被拦；样本一台，不能外推到全部杀毒。

另外：PowerShell 5.1 下 `.ps1` 要带 BOM 的 UTF-8，否则中文乱码；进程清理要 `taskkill /T`（node 起的是原生子进程）。

## 对设计的影响

- `D11` 关闭：Windows 版本地代理可做。第一期仍 Linux 与 macOS 先行，Windows 进第二期，安装器多一步提权初始化。
- 本地上限的 OS 外沙箱在 Windows 上的实现仍未定：Codex 用的是受限令牌（elevated 模式还有独立沙箱账号），我们能否把 exec-server 进程本身包进同一套机制，要在做 Windows 版时再探（记未验证事项）。
- 本地助手对 `probe/probe_local_ceiling.py` 的改动（`EXEC_URL`、`CODEX_COMMAND_JSON` 环境变量，`close()` 清理，`__main__` 守卫）向后兼容，Linux 上 L2 回归通过。

## 复现

见 `scripts/README-windows-probe.md`（本地助手写的，含管理员初始化与普通用户运行两段命令）。
