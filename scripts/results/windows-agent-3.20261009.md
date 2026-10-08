# Windows 代理第三段：新候选、实际安装与收尾

## 给 Fable 的结论

**Luna 继续开发；Fable 仍在 luna 审读，未整体合并前不从 fable 发布投资后端/relay。**
所有者授权本轮自动开发与验证，真人步骤后置；随后改为较大阶段提交。
本轮只修改 runtime，没有新依赖、没有发布镜像、没有改现网服务或重启 Windows。

托盘目录勾选、可读状态已实现，实际 WinForms 保存及后台权限边界通过。
新完整包安装、启停、卸载、重装通过；**已安装的程序**用普通用户真实连上 relay。
不把 API 在线写成网页人工验收，不把可控回调批准写成真人 GUI 批准。

## 变更与证据

| 部分 | 实现/验证 |
| --- | --- |
| `agent/native/desktop.ps1` | 连接状态与原因；CheckedListBox 逐项目录勾选；添加默认不选，全部可取消 |
| `config.ts` / `resident.ts` / `cli.ts` | `rootChoices` 只保存本地候选，实际授权只用 `roots`；拒绝重复或非法选择，保护控制目录；兼容旧配置与 CLI |
| 原生边界检查 | 未勾选目录读写均拒，全部取消后可启动；设置改动须 stop/start 生效 |
| 审批时序检查 | 未本机确认不报告；未收到持久化回执不转发；断开后的迟到回执不执行；真实沙箱仍约束写入 |
| `windows-stage3-settings.mjs` | 原样运行产品 AST 函数、真实 WinForms 按钮与实际 CLI 保存，三轮选择/重开通过；包内版本也通过 |
| `windows-stage3-installed-live.mjs` | 隔离真实安装，复用连接身份后实际探测；后台路径核对、真实 relay 在线、停止卸载、原配置核对；无真实口令输出 |

源码提交：`b5ba251` 托盘功能，`21f864b` 回归/操作说明。
本报告及后续探针只记录验证，不改变交付包里的产品源码。
详细失败与修正：[界面检查记录](windows-agent-3-ui.20261009.md)。

## 完整交付包

```text
C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261009\sunmoon-agent-21f864b

sourceRevision: 21f864b5d8e44c70ad485b5cc0f3e52de15a84ff
bundle-manifest.json SHA256:
e04d0cd3b2b865a638ca1d2425423e5d7dcf5b2d16211a19439b044fc6cf705d
```

89 文件（含清单）；不含清单 500,959,705 字节，含清单 500,974,988 字节，约 477.8 MiB。
官方 Node 24.19.0、Codex 0.155.1、代理 0.2.0，冻结依赖与许可证齐全。
依赖全复用已校验材料；没有下载、不编译自有 exe、产品无 Python 依赖。
包未签名，摘要用于完整性检查，不能当发布者签名。未关闭应用控制或使用策略 Bypass。

只有这个新候选保留。旧 `9f2b5c6` 目录已在逐文件核对、确认无进程/任务引用后清理；
其旧报告是历史证据，不能继续使用其中的本机路径。

## 实际验证结果

| 验证 | 结果和限制 |
| --- | --- |
| TypeScript 编译 | 通过 |
| Windows 原生全套 | **206/206**，无跳过 |
| Linux 全套 | **174 通过、32 Windows 专用跳过** |
| 发行单测 | Windows/Linux 各 **27/27** |
| Linux 真实模型最小对 | 退出 0、六项 pass；L3 执行端写入成功，L1 在协议层拒；模型列表刷新 timeout 保留在原始日志 |
| 真包闭环 | 安装预览无修改→安装→后台启动→关托盘仍运行→停止→卸载保留配置→重装→显式删除隔离配置，项目仍在，测试任务已移除 |
| 新包目录界面 | 包内 Node + app，三轮勾选/取消/重开；真实 CLI 保存通过 |
| 已装程序连接现网 | `luna-windows-installed-20261009`，真实 relay 列表可见；进程路径为隔离 `Local\Programs\sunmoon-agent\node\node.exe` |
| 权限与应用控制 | Administrator=false，unelevated，业务网络开关 false；本机应用控制只读值 `VerifiedAndReputablePolicyState=1` |
| 凭据保护 | 包全文件摘要和实际令牌扫描；实际安装实例的 status/轮转日志另做扫描；私有配置只临时复制，卸载后删除 |
| 真实 MCP | 此前本夜 `73bb78c` 已记录真实调用成功，见 MCP 报告；本包产品 HTTP 路径未改，不冒充本包重新做了 MCP 导入 |

真包测试通过修改进程的 USERPROFILE/LOCALAPPDATA 隔离安装目标，使用同一个真实普通用户。
这验证真正的安装器和已装程序，但**不是新 Windows 账号或干净 Windows**。
首次 token 仍沿用任务书的网页 init 方式；本轮真实联网测试复用私有配置，仅复制连接身份，
不把该准备动作描述为新用户从下载到首次 init 的产品验收。

组包第一次被工具沙箱 `git failed: EPERM` 拦截，宿主重跑成功；证据分别保留于
`package-build.log` / `package-build-host.log`，没有修改组包门禁。

## 未完成项：后续不要直接改成通过

| 项目 | 已有证据 | 还需的动作 |
| --- | --- | --- |
| GUI 真人“允许”全链 | CLI 真人正向、GUI 取消、自动审批时序与真实受限写入 | 由本人在后台代理弹窗批准，核对持久审计回执后实际写入；不能自动输入验证码代验 |
| 安装后网页“我的机器” | 已装实例真实在线，relay 在线列表可见 | 本人打开网页确认该已装实例；本轮没有浏览器登录会话 |
| 真实重启后登录自启 | Limited 当前用户任务注册、手动触发、移除通过 | 约定重启整机后确认自启、在线、托盘关闭后后台保活 |
| 可选 UAC sandbox setup | 实现、解析、已有 elevated 环境攻击用例通过 | 本人实际同用户 UAC 确认后跑 setup 与真实探测；已有 elevated 夹具不能代替新入口 |
| 干净 Windows 10/11 | 去掉 Node PATH 的开发机安装通过 | 未装 Node 的干净环境从零安装、连接、卸载 |
| 两次旧配置投影拒绝 | 旧日志没有原始参数；本夜两次新投影成功 | 有原始帧或重现后再定；不剥混合路径、不扩大配置读取 |

安装包下载位置和首次令牌产品入口牵涉网页/后端，按所有者要求由代理完成后另定，
本轮没有伪造公开下载地址或实现浏览器登录。

## 现场与清理

- 临时安装、令牌副本、GUI 失败夹具已清；真实配置 SHA256 不变。
- 测试进程与 `SunMoonAgent-*` 任务无残留；Linux 隔离端口 47100/47002 已释放。
- 网页项目的三个原文件全摘要保持；原已停止的 Linux 代理未启动。
- 清理重复 WSL 包、旧 Windows 候选和已归档临时日志约 **0.93 GiB 逻辑文件量**；
  不是 C 盘实际增加量，未压缩 WSL。逐项清单 `cleanup-files.json`。
- 保留新交付包、普通用户原生测试依赖、符号链接夹具、原网页项目、既有 elevated 测试家，
  以便补真人步骤。保留 Git 中的失败输出和可重跑探针。
- 测试机器显示离线是收尾后的预期；没有永久安装、自启或替换原代理。

全部原始输出：[windows-agent-3-ui-20261009/](windows-agent-3-ui-20261009/)。
当前状态以 `CHECKPOINT.md` 顶部和本报告为准；更早停点报告保持历史，不覆盖新进度。

## 后续重跑方法

日常用户命令见 [发行与日常操作](../../agent/distribution/README.md)。
只做合成身份的隔离安装闭环，可在普通 PowerShell 执行：

```powershell
$Package = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261009\sunmoon-agent-21f864b'
$Hash = 'e04d0cd3b2b865a638ca1d2425423e5d7dcf5b2d16211a19439b044fc6cf705d'
$Runtime = '\\wsl.localhost\Ubuntu\home\zymun\worktrees\luna\runtime'
& "$Package\node\node.exe" "$Runtime\probe\windows-stage3-package.mjs" $Package $Hash
& "$Package\node\node.exe" "$Runtime\probe\windows-stage3-settings.mjs" "$Package\app"
```

真实联网探针会复用身份，重跑前先确认 relay 无其它代理在线，并取得测试窗口授权；
本轮一次性授权不能当作以后任意接管真实机器的许可。源码写明120秒上限与清理步骤。

**请 Fable 接手提醒：** 先审本次 runtime 新提交与 MCP 报告，特别核 `rootChoices` 从未进入
实际权限或 hello、目录全不选仍拒绝工作区访问、GUI 答案只来自本机私有子管道。
不要因第二阶段/第三阶段自动结果通过，就漏掉上面的真人项或发布旧 fable 镜像。
本轮只本地提交，仍由所有者同步；在其同步期间不要继续写同一工作树。
