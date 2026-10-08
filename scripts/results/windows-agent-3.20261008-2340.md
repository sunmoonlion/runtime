# 第三阶段候选交付与本机安装闭环（2026-10-08）

本次按所有者最终顺序完成：先提交现状 → 收窄 HTTP 并提交 → 实测安装闭环 →
23:50 前最后提交、停手。只本地提交，不 push；先前同步碰上编辑已解决，所有者确认同步成功。

## 提交与范围

| 提交 | 内容 |
| --- | --- |
| `5f8d208` | 当时全部源码/测试/文档、真实审批证据、失败输出与 Windows 重跑方法 |
| `a95910f` | HTTP 仅允许本机确认的精确 MCP URL；不跳转；网络关闭拒绝；越界测试 |
| `9f2b5c6` | 修复卸载器使用错误 Node 路径导致自启任务身份不匹配；保留失败原文 |
| 本报告提交 | 最终真机/回归结果、交付位置、待验项；不改变上述发行源码 |

只修改 runtime；没有发布新业务镜像，没有重启集群、WSL 或真实服务。
Windows 产品仍是 Node + JS + 官方 Codex 0.155.1，不用 Python、不编译自有 exe。
后台/托盘接在同一个现有 CLI，批准复用第二段 SessionPermissions 与持久化审计回执。

## 交付包

本机目录：

```text
C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261008\sunmoon-agent-9f2b5c6
```

- 89 个文件（含清单）；物料合计 500,955,617 字节（不含清单），约 477.75 MiB。
- 固定源码 `9f2b5c60b738b51d9cb757fd574ccd479cc40874`。
- `bundle-manifest.json` SHA256：
  `95d9219ee12ffeb9b5a992523f9f8a0a8348bfce3c1b2d5c2be79d52f6511946`。
- 版本：Node 24.19.0、Codex 0.155.1、代理 0.2.0；所有生产依赖及 helper/许可证纳入摘要。
- 这是供 Fable/所有者审读的候选，不是已完成所有环境验收的正式发布。
- 旧 `sunmoon-agent-a95910f` 是第一次发现卸载失败的中间包，**不要用于安装交付**。
  最终只用上述 `9f2b5c6` 路径及摘要。

组包初次在工作区沙箱被只读 Git 子进程权限挡住：`Assembly stopped: git failed: EPERM`；
经授权在宿主同一命令重跑，完成固定源码与全目录摘要检查。没有改动源码绕过校验。

## 已实际验证

使用本机同一个**普通 Windows 用户**，通过独立 USERPROFILE/LOCALAPPDATA/SUNMOON_AGENT_HOME
隔离目录，合成令牌与回环目标。没有复用真实账号或连接真实 MCP。这不是新 Windows 用户/干净机器。

| 顺序 | 真实包结果 |
| --- | --- |
| 安装预览 | 只读，不创建目标 |
| 安装 | 外部可信摘要校验，复制到隔离 `%LOCALAPPDATA%\Programs\sunmoon-agent` |
| 无 Node PATH | PATH 仅保留 Windows System32，使用包内 Node；版本及 CLI 正常 |
| 初始化、启动 | 真 Codex 沙箱探测，后台进程启动、status.running=true |
| 关闭托盘 | 界面退出，后台仍 running=true |
| 停止 | running=false，执行进程正常清理 |
| 卸载 | 删除匹配任务和清单内程序；配置摘要保持不变 |
| 重装 | 同一配置摘要保留，重新启动成功 |
| 显式删除隔离配置 | 卸载自动停止已运行代理，移除专用默认配置家，项目目录仍在 |
| 清理检查 | 本次任务不存在，成功/失败的测试安装夹具均清理完毕 |

机器安全状态只读结果：administrator=false、SmartAppControlState=On、
VerifiedAndReputablePolicyState=1、FullLanguage、CurrentUser RemoteSigned、Node 签名 Valid。
读到 8 个活动目录 CI 策略文件；没有据文件个数推断每项具体策略。
没有设置 ExecutionPolicy Bypass、没有关闭应用控制、没有执行可选 UAC。

原生源码测试另验证：单实例、过期停止请求拒绝、运行时 init 拒绝、设置中文名称保存、
控制目录不能成为可写根、GUI 取消拒绝；Limited 登录任务实际注册→手动触发→删除。

## 首次失败与修复

首次整包走到卸载时失败：

```text
Uninstall stopped: Cannot complete autostart; installation and config kept
```

外部卸载器以外部 Node 调用已装 CLI，导致计划任务中的**已装 Node 路径**无法匹配。
保护检查正确停止，没有误删。`9f2b5c6` 改为短命子命令使用已装 Node，等待其退出后
再删除文件；卸载器本身仍从外部包运行。未降低任务归属检查。
修复包按旧包摘要精确移除失败夹具后，从头跑以上流程通过。
原文、恢复回执和最终 JSON 见本报告同名证据目录。

## HTTP 限制与回归

确认列表只来自本机 `mcp import` 人工批准后保存的 `mcp.json`，启动时读一次；disabled
不纳入，远端不能传入确认列表。URL 原文完全一致，不能以域名前缀、子路径、大小写、
编码、查询、协议/端口替换获得额外访问。必须显式 `redirectPolicy=stop`；禁止 Host/代理
身份头改写，禁网时拒绝。真实固定版执行器的 302 返回 302，目标请求数为 0。

| 检查 | 最终结果 |
| --- | --- |
| Windows 原生全测 | **204/204**，0 跳过 |
| Linux 全测 | **172 通过、32 Windows 专用跳过** |
| 发行检查（Node test runner） | Windows/Linux 各 **27/27** |
| HTTP/桥/权限专项 | Windows **62/62**，其中 HTTP 45 项 |
| 新完整包安装闭环 | pass，见 `package-lifecycle-pass.json` |

Windows 最新全测输出：`scripts/results/windows-agent-3-20261008/windows-final-204-pass.log`。
Linux 最后运行输出摘要：`Test Files 12 passed | 4 skipped; Tests 172 passed | 32 skipped (204)`。
初次失败结果没有删除，CHECKPOINT 的 23:20 节保留具体原文和处置。

## 明确待验

1. **真实联网 MCP 完整调用**：按所有者决定后置；不得用回环夹具代替。
2. **真实关机重启后的登录自启**：只手动触发过任务，未重启电脑。
3. **从未安装 Node 的干净 Windows 10/11**：清空 PATH 的开发机不是干净机。
4. GUI 真实人工正向批准→持久审计→实际执行；本轮仅 GUI 取消和既有 CLI 真人批准。
5. 可选 UAC elevated setup：代码及 PowerShell 解析已检查，未实际提权安装。
6. 两次旧 environmentConfig 投影拒绝的原始 cwd 仍未齐，不放宽读取范围。
7. Linux 现有模型最小对本轮未重跑；第二段已有通过记录，不冒充当前源码新验收。

## Windows 重跑

源码全测方法在 CHECKPOINT 23:20 节。真实包闭环（只能用于隔离测试）由
`probe/windows-stage3-package.mjs` 创建独立临时配置和安装目录，成功才清理，失败留现场：

```powershell
$Delivery = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261008\sunmoon-agent-9f2b5c6'
$Probe = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261008\windows-stage3-package.mjs'
& "$Delivery\node\node.exe" $Probe $Delivery '95d9219ee12ffeb9b5a992523f9f8a0a8348bfce3c1b2d5c2be79d52f6511946'
if ($LASTEXITCODE -ne 0) { throw '隔离安装闭环失败，保留现场，不强删' }
```

正常安装/日常启停/卸载看 `agent/distribution/README.md` 和包内 README.txt。
本轮未正式安装到真实用户默认目录；后续正式使用须走所有者验收。

## 给 Fable 的审读重点

- `a95910f` 的确认来源、精确 URL 与无跳转约束，和实际 Codex HTTP 帧一致。
- 系统 WinForms 托盘/确认窗口没有自编译 exe、没有开放审批 RPC；远端命令强制私有桌面。
- `9f2b5c6` 保留任务身份保护，卸载先停再按清单删，默认保留配置。
- 本报告只把代码和已跑的本机验证列通过；上面 7 项仍是待办。
- 所有者将本地提交同步回去后，请继续仅在 luna 审读，不自动合入 fable。
