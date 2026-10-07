# Windows 代理第 1 段：Node 助手与严格协议边界

日期：2026-10-07。工作仓 `runtime`，分支 `luna`。
基线 `36ec68be9a47386b3a39f387a3a12cd5fe9785d7`；依据 k8s
`1f921d83e3f7d12d44d32ecd6835ce978855aa7d` 的 `luna-feedback.md` 最后一节，
及所有者本轮“本机 Node、普通 fs 写入、禁止自编译 exe”的明确决定。
只本地提交，由所有者同步；未改其他仓、未升级 Codex、未改会合点协议。

**结论：本段开发与自检完成，停在第 1 段交远程审读。**安装、托盘、MCP 合并与
更高权限本机交互尚未实施，不能把本段通过写成整个 Windows 产品验收完成。

## 1. 实现与约束

| 对象 | 实现 |
| --- | --- |
| 执行器 | 固定官方 Codex 0.155.1；Windows 原生 exec-server，随机回环端口，无外层嵌套 |
| 命令 | `process/start` 的每项 managed/restricted 文件权限、cwd、workspaceRoots、网络与环境覆盖都检查；禁止关闭内层沙箱 |
| 方法边界 | 明确列出允许方法；未知方法、额外字段、二进制帧、未列通知、伪响应拒绝并计数；进程 ID/文件句柄按流隔离 |
| 文件助手 | `codex.exe -c <本机 profile> -c windows.sandbox=… sandbox --permission-profile sunmoon_files -C <root> -- node.exe native/helper.mjs <本机配置>`；没有 shell 插值，配置不是远端传入 |
| 写入 | 普通 Node `fs.writeFileSync`、mkdir/rm 等；白名单外写入由 Codex OS 沙箱阻止，包括检查后的目录替换 |
| 读取 | 仅白名单 + 自有 codex-home；额外拒绝 auth.json/.sandbox-secrets。Windows 当前目录句柄固定目录及祖先，随后检查真实路径；读取前核对打开 fd 与目录项的文件身份、单链接，流式读取持有原 fd |
| 目录固定 | 本机 Node 的只读 guard 持有当前目录，不接受远端 RPC；命令启动前固定根、cwd 和显式权限目录，结束释放 |
| 模式选择 | init 实际 process/start 探测已有 elevated 环境，成功才优先用；否则实际探测 unelevated，全部失败则拒绝。start 再核可用性，状态记录实际模式 |
| 生命周期 | 断线重连保留执行器；退出用精确 PID 的 `taskkill /T`，不按进程名杀其他 Codex；有界请求队列/句柄/活跃命令 |
| 凭据 | 执行器独立家不含 auth.json；环境按清单构造；本轮真实令牌只读取现有私有配置，没有进入结果、源码或日志 |

| 项目规则 | 对照 |
| --- | --- |
| C-C7/C-C8/C-A4 | 使用固定 0.155.1 的公开协议及 CLI；不修改/依赖 Codex 内部实现，不换版本 |
| C-A7/C-A11 | 权限不足拒绝，不退为无沙箱；攻击用例包含有效的目录内成功对照 |
| C-T5/任务范围 | 只提交 runtime；阶段交付后等待审读，不进入第 2 段 |

`windowsRuntime.ts` 负责本机环境、实际沙箱探针和助手生命周期；
`windowsPolicy.ts` 是严格协议规则；`windowsBridge.ts` 负责每流隔离与文件拦截；
`windowsBootstrap.ts` 负责模式探测。现有 CLI/execServer/relayClient 接入上述实现。
Linux 保留原 filter/bwrap 行为。

## 2. 实测结果

证据目录：[windows-agent-1-node-20261007](windows-agent-1-node-20261007/)。

| 项目 | 结果与证据 |
| --- | --- |
| 原生 Windows build/typecheck/test | **98 passed，8 个文件**；`windows-tests.txt`，Node 24.19.0、pnpm 10.24.0 JS 入口、Windows 11 10.0.26200 |
| Linux build/typecheck/test | **82 passed，16 skipped**；跳过的为明确 Windows 专用用例，`linux-tests.txt` |
| Windows 输入一致性 | 26 个源码、测试与依赖/构建清单在测试时全部匹配；归档后仅更正 execServer/pathuri 两处注释，记录最终摘要，`windows-source-match.json` |
| Linux 原有真实模型链路 | **pass**；L3 目录内写成，L1 danger-full-access 被桥实际拒绝，`linux-minimal-pair.txt` |
| 普通用户 fresh home | unelevated 实际启动成功，无 setup、无 auth.json |
| 已有 elevated home | 实际受限命令和 Node 文件助手成功；未复制 setup 私密材料，未执行新 setup |
| 文件攻击 | junction、原生文件/目录 symlink、hardlink、大小写边界、8.3/设备路径别名、写入/读取检查后替换均拒绝；允许文件操作的内容核对成功 |
| OS 独立边界 | 两种模式均先启动沙箱，再替换目标目录为外部 junction；不使用助手的路径检查，普通 Node 写入直接外部路径和联接外部路径均 EPERM/EACCES，目录内写成 |
| CLI 与桥生命周期 | 实际 init/roots/ceiling/start/status；回环会合点离线 20 秒后同 PID/执行器 URL/generation 重连；4003 后退出码 3，执行器端口及真实子、孙进程消失 |
| 网页在线 | 所有者已确认 `luna-windows-stage1-20261007` 显示在线；确认后恢复原 Linux 代理 |
| 最终 Node 版本现网复核 | 13:45:49Z connected，13:45:51Z 原代理接回后 Windows 退出码 3；13:45:55Z Linux 恢复在线、执行器 alive。见 `live-final-node.jsonl` |

两次现网检查均沿用“允许临时替换并恢复”的批准，未轮换令牌；最终 Node 检查短暂替换数秒。
原 Linux 代理在原 `fable/runtime/agent` 工作目录启动，源码和私有配置未改。
此前网页人工确认发生在更换助手之前；最终 Node 版本另做了真实会合点连接，未索要第二次浏览器确认。

测试使用独立回环会合点模拟掉线/4003，**没有**拔掉整机网络、在生产网页轮换令牌、
重启 Windows 或测试托盘。AT-WA-04/05 只能称上述机制通过，真实网页轮换/开机验收留后段。
原生 symlink 夹具使用先前批准的一次创建权限，攻击测试本身普通用户运行；
没有把 junction 当作 symlink，也没有修改 Developer Mode。

## 3. 本机应用控制与中途问题

本机只读查询原值（13:41:03Z），见 `application-control.json`：

- `SmartAppControlState = On`
- `AMRunningMode = Passive Mode`
- `CodeIntegrityPolicyEnforcementStatus = 2`
- `UsermodeCodeIntegrityPolicyEnforcementStatus = 2`

此前试验自编译 C# helper 的签名状态为 `NotSigned`，Windows 启动返回
**“应用程序控制策略已阻止此文件”**，Node 层表现为 `spawn UNKNOWN`。
当时按本次路径筛选的 Defender 威胁检测未见匹配记录，不能写成已证实的病毒隔离。
以上状态和现象不能精确区分是哪一条具体应用控制规则阻止了该二进制。
本次没有关闭应用控制、修改保护策略或添加白名单。

所有者随后指定 Node。产品已经删除 C#/Python helper，只有 `native/helper.mjs`；
不新增依赖、不编译自己的 exe。后续打包必须保留官方 Node 运行时 + JS + 官方 Codex
方式，不能改用自编译 helper/SEA/pkg 又引入自有 exe。安装包本身及干净机适配仍须第 3 段验证。

Node 首轮 elevated 测试在 `fs.realpathSync.native` 返回 EPERM，未把拒绝算作攻击通过；
改用标准 `fs.realpathSync`，保留目录固定和文件身份检查后，两种模式正向与负向都通过。
另补了不用助手检查、直接普通 Node 写入的 OS 用例，验证成功不依赖桥的词法判断。

## 4. 当前明确限制

1. 没有 Windows 外层沙箱；不声称与 Linux 的 bwrap 保护等价。unelevated 的隔离限制沿用上游。
2. FS 请求读白名单不等于任意命令的系统禁读。命令运行环境仍保留 root-read。
3. UNC、设备前缀、8.3、ADS、链接别名拒绝。FS 显式 sandbox 尚未支持组合，非 null 直接拒绝，不能丢弃更窄权限后执行。
4. process 显式权限路径须是可固定的现有目录；文件目标目前失败关闭。Windows `http/request` 尚未开放，网络开关不能绕过方法清单。
5. `--no-outer-sandbox` 在 Windows 忽略，无法关掉内层/文件助手保护。
6. elevated 检查的是该独立 home 是否有可用 setup，不复制用户其他 Codex 家的私密材料。
7. 按正常停止/拒绝流程清理进程树已测；整机掉电、代理被强杀后的恢复和开机常驻归第 3 段。
8. Windows 10、未安装 Node 的干净机器、安装器、托盘、MCP 合并、提权交互与日志轮转未做。

## 5. Linux 联调脚本修正

原脚本清理用全局 `pgrep codex app-server`，可能误杀其他助手。本次改为只终止本轮
`setsid` 建立的进程组，同时固定 app-server 也用包内 0.155.1。

L1 被桥拒绝时尚未创建进程，原进程结果判定为 `None`。判据现在要求
“L1 None + 实际桥日志中 process/start 的 danger-full-access 上限拒绝”同时存在才通过；
或者原有明确 False。成功写出时为 True，仍失败。不以文件不存在或笼统错误代替证据。

## 6. 清理、复现与交付

复现环境、测试夹具及入口见 [agent/README.md](../../agent/README.md)。
结果只追加，原 20:25 的受阻报告保留为历史，不改写成通过。
本轮专属 Windows stage（含依赖副本、所有试验 helper、临时在线令牌副本和符号链接夹具）
在检查无相关进程后清除，详见 `cleanup-windows.jsonl`。保留原 `.sunmoon-agent`、`.codex`、
`.codex-probe-exec` 和原 Linux 代理。未装服务或计划任务。

本地提交交远程审读；不 push。回退本次提交会回到 36ec68b 的 Windows 启动门禁；
不恢复早期无保护 Windows 启动实现。第 2/3 段须按任务停点等远程审读和所有者决定。
