# Windows 发行目录与首次安装

本目录负责把代理变成不依赖用户另装 Node 的 Windows x64 单目录包。
目前是**第 3 段的 3a 候选**；托盘、常驻和自启尚未交付。用户于 2026-10-08
允许在 Cursor 验收第 2 段时，先做第 3 段独立工作。组包不改变 `agent/src/` 的运行流程。

## 任务表

| 顺序 | 完成条件 | 当前状态 |
| --- | --- | --- |
| 3a.1 | 固定 Node、Codex、依赖版本和来源；不编译自有 exe | 已实现，Node 24.19.0 与现有原生验证版本一致 |
| 3a.2 | 干净源码编译、白名单组包、全文件摘要、必要 helper 和许可证齐全 | 已实现；以结果记录中的真实构建为验收依据 |
| 3a.3 | 首次安装预览/执行；拒绝覆盖与路径别名；保留用户配置 | 已实现；先在隔离目录验证 |
| 3b | 单实例后台进程、状态、停止、托盘与本机权限确认 | 未实施，接入第 2 段验收后的运行版本 |
| 3c | 当前用户登录任务、可选 elevated setup、升级/卸载 | 未实施；默认不提权、不自启 |
| 3d | 所有者在未装过 Node 的 Windows 上安装；重启与关闭界面验收 | 待完整候选，不能用本机检查代替 |

## 为什么用单目录包

包含官方 `node.exe`、编译后的 `app/dist/`、纯 JS 依赖和完整 Windows Codex 平台包。
不使用 pkg/SEA，不把 Node 编译成自有 exe，也不增加 Electron 或原生编译依赖。
这满足所有者“Node helper、不编译自己的 exe”的要求。托盘技术接入时仍须在当前应用控制下验证，
不能用关闭 Smart App Control 或扩大本地权限换取运行成功。

`windows-x64.json` 是本发行目标的版本与物料入口。Node 选择已用于第 2 段原生测试的
24.19.0；这不是“当前最新版本”的声明。Codex 固定 0.155.1、会合点协议 1、代理 0.2.0。
Node 摘要来自[官方校验清单](https://nodejs.org/dist/v24.19.0/SHASUMS256.txt)。
`licenses/` 保留对应版本的完整 [Node LICENSE](https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE)、
[Codex LICENSE](https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/LICENSE) 和
[NOTICE](https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/NOTICE)。ws、smol-toml 的许可证随 npm 包原样保留。

## 维护者组包

先准备使用 `agent/pnpm-lock.yaml` 安装的 Windows 依赖（`pnpm install --frozen-lockfile --ignore-scripts`），
以及与上述官方摘要一致的 Node 可执行文件。构建机有开发用 Node 和已安装的 TypeScript；
最终用户不需要。组包入口不下载文件、不调用 npm 生命周期、不读取用户配置。

在 runtime 根目录，先本地提交源码，再执行：

```sh
node agent/distribution/build.mjs \
  --node-exe '/path/to/verified/node.exe' \
  --dependencies '/path/to/windows-agent-with-frozen-node_modules' \
  --output '/path/to/new/sunmoon-agent-win-x64'
```

- `--dependencies` 指 Windows **agent 目录**，含 package.json、锁文件和已安装 node_modules；不会整目录复制。
- 重新编译本仓干净源码，只复制 dist、native helper、四个固定生产包、许可证和安装入口；不带 pnpm/npm、测试、源码映射、日志、`.codex` 或代理私有家。
- 同时带平台包的 sandbox setup、command runner、code-mode host、rg 等资源，不能只抄 `codex.exe`。
- pnpm 的根链接解析成实目录后，逐文件复制成普通文件；输出不依赖开发机 node_modules 的链接。
- 输出目录必须不存在。失败的 `.sunmoon-package-*` 工作目录保留定位，按结果清单处理；入口不自动清理旧包。
- 构建收据含源码提交、锁文件摘要、文件数、总字节数和 `bundle-manifest.json` 的 SHA256。
- 每次组包要求源码固定、锁文件一致；依赖来自可信的冻结安装环境。版本名与组包后摘要本身不能证明上游供应链未被篡改。

## 候选首次安装

交付包另附可信渠道提供的校验摘要，**执行前**核对。目录内清单用于查损坏与遗漏，
不构成发布者签名；不能把“包自带的摘要等于自己”当来源认证。
这里只支持首次安装。尚未实现安全升级、停后台进程和卸载，所以已有目标目录时必须停止。

```powershell
.\sunmoon-agent.cmd --version
.\install.cmd --manifest-sha256 '<交付记录中的清单 SHA256>'
# 确认预览后再执行：
.\install.cmd --manifest-sha256 '<同一个 SHA256>' --apply
```

固定目标 `%LOCALAPPDATA%\Programs\sunmoon-agent`。默认不启动、不提权、不设 PATH、不注册任务；
已有 `%USERPROFILE%\.sunmoon-agent` 配置/令牌保持原样。首次安装用独占目录并保留未完成标记；
复制中断会拒绝重复覆盖，不能声称已安装。路径检查拒绝链接、联接、ADS、目录穿越等，
但普通用户安装器不构成对同一 Windows 账号下恶意本地进程的隔离边界。

安装后当前 CLI 仍可通过安装目录内的 `sunmoon-agent.cmd` 使用；令牌只来自用户本人的工作台。
第三段完整验收前，仍按第二段既定方式联调，不把此候选自动连接到现网。

## 检查与尚待验收

```sh
node --test agent/distribution/test/bundle.test.mjs
```

Linux/Windows 都运行同一份组包检查与隔离安装测试。原生 Windows 还须对真实包检查
Node/Codex/代理版本、依赖和 helper 定位、首次安装；用清空 Node 搜索路径的子进程验证
启动器只用包内运行时。这与“未装过 Node 的新机器验收”分别记录。

本次不会创建后台任务、触发 UAC、调整应用控制、复用真实令牌或覆盖 Cursor 的第 2 段测试目录。
后续托盘确认不能变成任何云端命令都能调用的 localhost 提权接口；在接入前必须单独审查 IPC 身份与权限边界。
