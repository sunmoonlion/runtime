# Windows 代理 0.2.8：桌面链交审回执

任务：k8s `switch-test/astra-028.md`。2026-10-11 开始，最后核对跨至 2026-10-12 00:00（UTC+8）。只在 luna 本地提交，未推送、未发布、未修改集群。

**交审状态：七项代码及下列自动/真机检查完成；控制台闪出这一项未观察，不能宣布任务全部验收通过。** 所有者原装 0.2.7 保留，测试版没有替换正式安装。

## 1. 按项提交与实现

| 项 | runtime 提交 | 实现及证据 |
| --- | --- | --- |
| 1 显示窗口 | `0a3fea6` | P/Invoke 在顶部编译一次；Shown 显式 SW_SHOW、Activate，可见才写就绪；失败 Close。0.2.7 回执补原 22:34:20 枚举，与后来进程已退的快照区分 |
| 2 UI 看门狗 | `dc556db` | onboard、托盘内部窗体、设置窗体共享每秒检查；整体 finally 清本 PID 的记录。正常关闭设置不退出托盘。Windows 实际 Dispose 通过 |
| 3 子进程兜底 | `79c9c96` | 首次就绪宽限 15 秒；就绪消失立即终止本子进程；死亡记录宽限 10 秒；寿命上限 30 分钟。实际结束 PowerShell、移除标记均在 2 秒内收尾 |
| 4 卸载收尾 | `4e4e04f` | 当前用户 SID、完整 cli.js/desktop.ps1 路径识别；终止前复核创建时间/路径/命令；未知占用者保留并报告；不按进程名杀。真实孤儿由外部可信包收掉 |
| 5 删除重试 | `8c21aea` | EPERM/EBUSY 首次失败后最多 10 次 × 500ms；其它错误直接报；最终错误含精确文件路径 |
| 6 半卸修复 | `18eaba4` | 删除前落标记，失败保留；标记或损坏清单返回 repair；外部可信包收进程，不运行损坏代码；残目录旁移保留，干净安装，配置不变。完整安装模板真实走通 |
| 7 错误提示 | `f723539` | 保留原始失败并提示「可能有旧窗口的进程还开着，先在托盘退出、关掉所有 SunMoon 窗口再试」 |

k8s 权威安装模板的两次本地提交：`d451d67c`、`878c7cb2`。runtime 副本与 k8s `gitops/components/app-platform/investment-app/investment-backend/agent-releases/install.ps1.tmpl` 逐字节相同、无 BOM。桌面脚本保留其已有 BOM，供 PowerShell 5.1 的 `-File` 读中文。

## 2. 检查结果与测试调整

| 检查 | 实际结果 |
| --- | --- |
| TypeScript 构建与类型 | `npm run build`、`npm run typecheck` 退出 0 |
| Linux 全量 Vitest | 19 个文件通过、4 个 Windows 专用文件跳过；224 通过、32 Windows 专用跳过 |
| Windows 全量 Vitest | `Test Files 23 passed (23)`；`Tests 256 passed (256)`；23:49:41 开始，52.19 秒 |
| 发行测试 | Linux 45 通过、2 Windows 专用跳过；Windows 47/47，无跳过 |
| 脚本解析 | desktop.ps1 ParseFile 通过；安装模板按 UTF-8 解码后 ParseInput 通过 |

Windows 的完整日志在 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-028\windows-vitest-2.txt`，`windows-vitest-result.json` 为 `{"code":0,"pid":…}`。本轮保留了真实沙箱边界测试，没有改沙箱、协议过滤、配对协议或令牌处理。

全量验收发现旧测试与现有实现/普通用户 Windows 不符，仅改测试：

- `cli.test.ts` 仍断言缺少探测记录时拒绝启动；0.2.6 已改为自动探测保存。改验后台启动、探测落盘、状态及停止，finally 停测试代理。
- `siteTrust.test.ts` 的 realpath 字符串大小写比较在 Windows 不合适。Windows 比较忽略大小写，Linux 保持原规则。
- `trayStop.test.ts` 的文件符号链接需要 Windows 特权；普通用户改用目录联接验同样的拒绝与目标未变。已有预制原生符号链接测试仍在全量套件中通过。
- `bundle.test.mjs` 两处同类链接夹具在 Windows 改用联接，Linux 保留文件链接；模板一致性检查允许测试环境指定真实 k8s 模板绝对路径，未指定仍沿用相邻仓路径，仍比较全部字节。

新增 `distribution/test/watchdog.test.mjs` 在临时副本中注入 Dispose，不修改产品或已装脚本；失败保留夹具，成功清自己夹具。

最终 Windows 发行复跑原文：

```
{"action":"onboard","exitCode":0,"elapsedAfterDisposeMs":42,"readyCleared":true}
{"action":"tray","exitCode":0,"elapsedAfterDisposeMs":748,"readyCleared":true}
tests 47; pass 47; fail 0; cancelled 0; skipped 0
```

## 3. 固定源码候选及真实开窗

候选从已提交、干净的 runtime `f723539e5d6794839e7a4a0fd1bc9869b4fb1107` 组装。后续改动只有测试/回执，未改变产品载荷；发布仍应由 Cursor 按远程审定的最终源码重新固定。

```
app: 0.2.8
Codex: 0.155.1
Node: 24.19.0
files: 98
bytes: 501029681
manifest SHA256: 504a15edcc413bd32a370e2728d4c526c371a3ba95b7d7dd0c22a10dd55d3fe0
ZIP bytes: 175314327
ZIP SHA256: fc7cb9cde52dfea680340bd5a5104656384bf27b665a1339954973726de6b1e0
```

包和 ZIP：`C:\Users\zymun\sunmoon-probe-runs\windows-agent-028\candidate-f723539`、同级 `candidate-f723539.zip`。完整清单回验及隔离安装通过，没有自编译 exe。

真实托盘链：隔离托盘使用安装包自己的 VBS → Node onboard-window → PowerShell。第一次所有者答「没出现」，该次未取得窗口/就绪，**不抹去这次失败**。随后同链重新打开通过；所有者取消窗口，再从测试托盘「重新连接账号」重开，回答「能打开」。该次 PowerShell PID 50996、父 Node 50416；原枚举 visible=true，窗口曾被最小化。未用直接 PowerShell 开窗冒充托盘开窗。

为取得无遮挡截图，随后通过同一个 VBS/Node 隐藏链重新开窗取证，**这是同链 CLI 启动，不是另一条托盘菜单点击证据**。诊断 ShowWindow(SW_RESTORE) 之前的枚举原文：

```json
{"pid":45792,"main_title":"SunMoon - 设置","main_handle":"0xE0B42","responding":true}
{"pid":45792,"handle":"0xE0B42","title":"SunMoon - 设置","visible":true,"iconic":false,"rect":{"left":290,"right":990,"bottom":616,"top":136}}
```

原文 `tray-window-visible.json` 为 PowerShell 写的 UTF-16 文件。截图 `tray-onboard-visible.png` 为 700×480 设置窗，无连接码/账号；SHA256 `3cce392eedab86244fb275f86797e587120c5c89e9e73ce3bfa53dca9fd1e9a1`。之前 CopyFromScreen 拍到 VS Code 的画面不作为窗体证据。

所有者点击「连接我的账号」后答「都出现了」：8 位码、变化的倒计时、浏览器核对页、窗口持续显示通过。助手没有输入确认码或批准配对。黑色控制台观察最后回答 **「没注意，无法确认」**，记为待验，不能写无闪出。

## 4. 异常退出、半卸与完整模板修复

实际 Dispose：onboard 退出 44ms、托盘退出 727ms，退出码 0、就绪清除。最终复跑的独立结果附在本节末尾。

```
kill-window: psPid=50996 nodePid=50416 elapsedMs=56
psAlive=false nodeAlive=false markerExists=false
remove-ready: psPid=45792 nodePid=46692 elapsedMs=433
psAlive=false nodeAlive=false markerExists=false
```

原文：`kill-window.json`、`remove-ready.json`。

标记型半卸：在隔离 `repair-2` 安装中启动孤儿窗口，删除 README/helper 并写 `.uninstall-incomplete`；返回 `action:repair`。外部可信卸载器 `--stop-only --apply` 精确收 PID 41512/44268。旁移目录后重新安装 98 文件；`configUnchanged:true`。原文 `half-repair.json`。回退目录 `repair-2\Local\Programs\sunmoon-agent.broken-probe-1791733236219` 保留。

**完整 PowerShell 模板自动修复**：另一个隔离安装 `full-repair` 不写标记，只删两个清单内文件，验证「清单在但校验不过」分支。通过本机 loopback 服务提供已核 ZIP；UTF-8 模板按 InvokeExpression 的安装语义执行。实际输出：

```
{"action":"stop-only","preserveConfig":true,"stoppedPids":[48688,46404]}
上次升级没做完，已清理残留
exitCode=0; configUnchanged=true
archive=sunmoon-agent.broken-20261011T155409595Z-ef190bdf
files=98; taskCleanupCode=0
```

原文 `full-repair-installer.txt`、`full-repair.json`。模板创建临时登录任务 `SunMoonAgent-f04bbd1724b6226c9b06d4e9` 后打开设置；验后停止本安装的 PID 46216/6560、用其已验证 CLI 删除该任务、关闭 loopback 服务。该残目录保留，不递归删除。真实用户配置从未提供给该夹具。

## 5. 首次失败与原因（保留，不写成通过）

| 失败原文/现象 | 原因及后续 |
| --- | --- |
| 沙箱内 `listen EPERM 127.0.0.1`、`spawn … EPERM`；25 failed / 199 passed / 32 skipped，34 errors | 工具隔离不允许这些测试动作；获准外部运行同套后全量通过 |
| `ERR_PNPM_BAD_PM_VERSION` | 系统 pnpm 12.0.0 与项目 10.24.0 不一致；使用已有 npm/tsc/vitest，不改锁或版本 |
| `bundle.test.mjs:270 AssertionError false !== true` | 第 4 项将停止改为循环后旧结构断言失效；更新顺序断言，实际语义保留 |
| 首次 Windows `4 failed | 223 passed (227)`，6 个文件失败 | 临时副本缺 sites/contracts/probe，缺原生链接夹具参数；另有上述三个旧测试问题。完整补齐后 256/256。原文 `windows-vitest.txt` |
| Windows 发行首次 `pass 44; fail 3`；`EPERM … symlink` 两处，`ENOENT … sunmoon-probe-runs\k8s\…\install.ps1.tmpl` | 补上述链接夹具及真实模板路径参数后完整 47/47；没有跳过失败用例或降低系统策略 |
| 托盘 Dispose 20 秒超时（两次） | 诊断注入误匹配 onboard 而不是托盘代码位置，实际没执行 Dispose；保留夹具 tick 记录均 disposed=false。修正为唯一锚点后两窗均通过，未为通过改产品 |
| 首次半卸夹具 `orphan fixture not ready` | 手写合成配置无效。失败 `repair` 目录保留；用有效隔离配置重建 `repair-2` 后通过 |
| 安装模板 ParseFile 编码错误 | 无 BOM 的模板不是给 PowerShell 5.1 -File 读的；按 UTF-8 解码 ParseInput 和实际安装语义通过，不加 BOM |
| 模板演练 CMD 提示 UNC 当前目录不支持，默认 Windows 目录 | 测试启动 cwd 为 WSL UNC；安装成功退出 0，后续清理用本地 cwd |
| 最后只读 `.ps1` 从 UNC 执行被 `UnauthorizedAccess` 拒绝 | 未改执行策略；改为等价内联只读命令成功，不作为产品故障 |

失败看门狗夹具在 `sunmoon-watchdog-5nzjPJ`，只留静态脚本/trace；测试进程已退出。诊断配置、pair-status、连接码、真实 config.json 内容没有写入本报告。

## 6. 测试现场收尾与正式版保护

外部可信卸载器实际清理三个健康测试安装，原文 `cleanup.json`：

```json
[
  {"name":"full-repair","exitCode":0,"targetAbsent":true,"configUnchanged":true},
  {"name":"repair-2","exitCode":0,"targetAbsent":true,"configUnchanged":true},
  {"name":"isolated","exitCode":0,"targetAbsent":true,"configUnchanged":true}
]
```

最后只读核对 2026-10-12 00:00:36 UTC+8：

```
testProcesses=[]
temporaryTaskPresent=false
originalTray=[{ProcessId:14740,ParentProcessId:12704}]
installedDesktopSha256=d14b7f9aa09c4011182082fa2afbc9c68fc507dc3369c9238a034f1871fca2a6
```

该摘要与原装 d90cef3/0.2.7 desktop.ps1 一致。只保留正式托盘；测试托盘停止后 Windows 可能留缓存图标，没有第二个运行托盘进程。候选包、静态证据、失败夹具、残目录保留给审读，不把它们当常驻安装；不清原装设置窗口或原代理。

## 7. 重跑与剩余

Linux（runtime/agent，已有依赖）：

```bash
npm run build
npm run typecheck
node_modules/.bin/vitest run
node --test distribution/test/*.test.mjs
```

Windows：使用候选的 Node，从 `windows-agent-028\test-source` 执行 `node_modules\vitest\vitest.mjs run`；环境 `SUNMOON_TEST_ELEVATED_HOME=C:\Users\zymun\.codex-probe-exec`、`SUNMOON_TEST_SYMLINK_FIXTURE=C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-native-links-20261008`。发行回归：同 Node `--test distribution/test/bundle.test.mjs distribution/test/processes.test.mjs distribution/test/watchdog.test.mjs`；`SUNMOON_PROBE_ROOT` 可设为本次取证根目录。临时副本运行发行测试时另设 `SUNMOON_TEST_INSTALL_TEMPLATE=\\wsl.localhost\Ubuntu\home\zymun\worktrees\luna\k8s\gitops\components\app-platform\investment-app\investment-backend\agent-releases\install.ps1.tmpl`，使用真实权威模板比较，不复制虚假的相邻仓。

看门狗测试仅创建自己唯一临时目录。其他诊断脚本为一次性夹具；已经卸载或已有残目录时不要原封不动重跑修复脚本。要重跑，使用新的明确测试目录，不覆盖保留的失败/回退证据。

**待验**：所有者观察真实托盘开窗时有无控制台闪出。未发布 0.2.8、未做线上 E；需远程审读接受并由 Cursor 发布后按其发布卡验收。真实配对批准、干净机及重启不是本次隔离修复的通过结论。
