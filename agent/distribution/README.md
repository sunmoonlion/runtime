# Windows 安装与日常操作

单目录包包含官方 Node 24.19.0、Codex 0.155.1、JS 和系统 PowerShell/WinForms 界面。
不编译自有 exe，不要求用户安装 Node/Python，不增加 Electron/原生依赖，不关闭应用控制。
版本入口为 `windows-x64.json`。执行能力仍在 `agent/src/`，托盘只调用同一个 CLI。

## 安装和首次连接

由可信交付记录取得清单 SHA256，在运行包内程序之前核对摘要及来源。包内清单只能
检查完整性，不能作为发布者签名。若 Smart App Control、WDAC 或 PowerShell 策略阻止，
记录具体程序与策略后停止；不要修改执行策略或关闭应用控制来通过。

```powershell
Get-FileHash .\bundle-manifest.json -Algorithm SHA256
.\install.cmd --manifest-sha256 '<可信记录中的 SHA256>'
.\install.cmd --manifest-sha256 '<同一 SHA256>' --apply
```

固定每用户目录 `%LOCALAPPDATA%\Programs\sunmoon-agent`。默认只安装，不启动、
不自启、不提权、不设置全局 PATH。已存在目标或安装中断标记均停止，不能覆盖未知文件。
之后从**安装目录**执行工作台发给你自己的 `init` 命令；令牌不转发给其他人。
首次仍使用网页拿命令的方式，浏览器登录是第二期。已有配置时先停止后台再 `init`。

新接入推荐 `sunmoon-agent.cmd init --relay <网页地址> --user <本人编号> --token-prompt`。
在真正的本机终端粘贴网页给本人的令牌后回车，输入不回显、不进命令参数或 Shell 历史；
不能管道输入，Ctrl+C/终端关闭/两分钟超时均取消且不保存配置。目录通过 `--root` 或本机托盘选。
旧 `--token` 参数保留兼容，但网页不再生成含明文令牌的命令。

`init` 会真实探测沙箱能力。普通用户默认 unelevated，无管理员也能使用。
可选管理员沙箱入口在完成 init 且代理停止后使用：

```powershell
.\sunmoon-agent.cmd sandbox-setup --elevated
```

这是**唯一可选 UAC**：只调用官方 `codex sandbox setup --elevated --current-user`，
固定到代理自己的 codex-home。拒绝用另一管理员账号替代当前用户。成功后再次实际探测，
确认 elevated 可用才保存模式；取消、失败不自动降权。超时先检查现场，不重复发起 UAC。
本轮未执行这个可选入口；普通 unelevated 路径不受它影响。

## 日常控制

均在安装目录使用；未指定 `SUNMOON_AGENT_HOME` 时使用 `%USERPROFILE%\.sunmoon-agent`。

| 操作 | 命令/入口 | 行为 |
| --- | --- | --- |
| 启动 | `sunmoon-agent.cmd start --background` | 单实例、隐藏后台；重复启动不会多开 |
| 看状态 | `sunmoon-agent.cmd status` | running、relay 状态及原因；成功查询退出 0，是否运行看 running |
| 托盘 | `sunmoon-agent.cmd tray` | 查看连接原因、启停、白名单、权限、自启 |
| 关闭界面 | 托盘“退出托盘”或 `tray stop` | 后台继续；不等于停止代理 |
| 停止 | `sunmoon-agent.cmd stop` | 匹配 PID 与本轮随机身份，正常清理执行进程，不杀未知进程 |
| 自启开关 | `autostart enable / disable / status` | 当前用户登录任务，Limited、非管理员；默认关闭 |
| 配置 | 托盘“白名单与上限设置” | 逐项勾选目录、只读/工作区写入、网络开关；保存后 stop/start 生效 |
| 前台诊断 | `sunmoon-agent.cmd start` | 终端交互和日志；前台/后台共用单实例锁 |

托盘与后台分离，登录任务用系统 wscript 隐藏启动二者，不弹控制台。
任务名 `SunMoonAgent-<配置目录摘要>`，只有名称、说明和执行路径均匹配才修改/删除。
令牌吊销/被替换的退出不会触发任务自动重试；重新取得令牌是人工动作。
自启任务的手动触发可以验证启动链，**不能代替整机重启验收**。

托盘菜单直接显示在线、正在连接、离线或停止；双击图标或“查看状态与原因”查看
最近连接错误和状态时间。超过 15 秒未更新的状态不会继续显示在线。

目录列表中，添加新目录只加入待选项，勾选后保存才进入白名单。取消勾选保留位置，
下次可以重新选择；“移除选中行”删除待选项。可以全部取消，关闭所有项目目录访问。
配置中的 `roots` 是唯一实际授权列表；`rootChoices` 只是本机界面记住的候选目录，
不会作为执行器权限或上传配置。旧配置没有 `rootChoices` 时，以原 `roots` 初始化列表。
保存后必须停止并重新启动代理，运行中的连接不会悄悄改变权限。

## 本机授权与边界

后台收到允许申请的权限提升时，以系统 WinForms 展示程序、目录、权限范围和请求摘要。
人工输入本次短码并点击允许；窗口关闭、60 秒超时、断线均拒绝。答案只走私有子进程
stdin/stdout，不开 localhost 批准接口、不存批准文件。远端命令强制 Codex 私有桌面，
控制目录与安装代码禁止作为可写项目根。确认后仍须经过工作台持久化审计回执。
`danger-full-access` 和新增白名单根不能在这个弹窗中获批；临时权限断线失效。

HTTP 只转发启动时本机确认过的完整 MCP URL，逐字匹配且禁止跳转；网络开关关闭则拒绝。
没有确认列表时不能访问任何 HTTP 地址。域名按正常 DNS 解析，本轮不实现 IP 固定。

同一 Windows 用户的任意恶意本地进程不是普通用户安装器的隔离边界。
后台不会提供无交互的自动同意方式。GUI 正向真实授权留所有者后续验收；CLI 真实授权已有结果。

## 日志与故障

`%LOCALAPPDATA%\sunmoon-agent\logs\agent.log`：每份 2 MiB，共 5 份。
不记录令牌、确认码、用户输入、命令正文和执行器原始输出。托盘状态显示 `lastError`/`lastNotice`。
配置保持私有，执行器家不含登录态。退出或禁用自启不会删除配置和项目文件。
脚本被策略拒绝时 GUI/任务会失败，仍保留前台诊断入口，不能自动 bypass 策略。

## 卸载和手动升级

使用保留的**外部交付目录**运行，不能让正在使用的 installed node.exe 删除自己。

```powershell
.\uninstall.cmd --manifest-sha256 '<交付摘要>'
.\uninstall.cmd --manifest-sha256 '<同一摘要>' --apply
# 明确不要配置与令牌时，额外加 --remove-config；默认不删除。
```

先全目录验真，再删除本实例的自启任务、关闭托盘、正常停代理。全部成功后才按清单
逐文件移除安装目录；未知文件、修改或链接导致停止，不使用递归强删。部分文件被占用时
保留现场并报告失败，不宣称卸载完成。默认配置和日志保留。

`--remove-config` 只允许删除默认专用 `.sunmoon-agent`，另删五个自有日志文件；
自定义配置目录、未知顶层文件、链接均拒绝。用户 `.codex` 和项目目录不删除。
外部包与已装版本不同时，增加 `--installed-manifest-sha256 '<已装版本可信摘要>'`。

第一期手动升级：核对新包 → 卸载旧程序（保留配置）→ 安装新包 → 启动/检查 →
按需重新启用自启。失败保留配置并用旧可信包重装。自动下载、验签更新与自动回滚属第二期。

## 维护者组包与回归

依赖必须由 `agent/pnpm-lock.yaml` 冻结安装在 Windows agent 目录。
不下载、不执行 npm 生命周期、不复制用户配置。提交源码后从 runtime 根目录：

```sh
node agent/distribution/build.mjs \
  --node-exe '/path/to/verified/node.exe' \
  --dependencies '/path/to/windows-agent' \
  --output '/path/to/new/delivery'
pnpm --dir agent build
pnpm --dir agent test
node --test agent/distribution/test/bundle.test.mjs
```

组包仅复制白名单生产文件、完整 Codex Windows 资源、固定依赖、许可证与入口。
Node 版本/摘要来自已固定的官方物料；生成全文件 SHA256、固定源码提交和锁文件摘要。
Node/Codex LICENSE/NOTICE 存 `licenses/`，其余许可证随依赖。输出不能预先存在。

当前固定包 `21f864b` 及原始结果见 [第三阶段结果](../../scripts/results/windows-agent-3.20261009.md)。
此前 `9f2b5c6` 候选已核对清理；不要使用旧报告里的目录作为当前安装入口。

## 第三阶段任务表

| 项目 | 实现状态 | 验收边界 |
| --- | --- | --- |
| 发行目录、校验、首次安装 | 已实现 | 原生真实包验证记录见最新 windows-agent-3 报告 |
| 单实例后台、启停、状态、托盘 | 已实现 | 普通用户原生启停及关托盘后保活已验证 |
| 设置窗口、确认窗口 | 已实现 | 实际 WinForms 三轮保存/重开、全不选、目录读写拒绝通过；GUI 人工正向确认待补 |
| 登录任务 | 已实现 | 当前用户 Limited 注册/触发/清理已验证；真实重启待补 |
| 可选 UAC setup | 已实现 | 静态解析通过，实际 UAC 未执行 |
| 卸载、保留或删除配置 | 已实现 | 21f864b 新完整包安装到卸载、重装闭环通过；实际安装实例真实 relay 在线后亦已清理 |
| 干净 Windows 10/11 | 待所有者 | 不能用开发机清空 PATH 宣布通过 |
| 真实 MCP | 已实际调用通过 | 见 `scripts/results/windows-agent-2-mcp.20261009.md`；固定回显服务，不代表认证型 MCP 均通过 |
| 旧两次投影追踪 | 待定位 | 最新调用投影成功，不能据此解释旧拒绝 |
