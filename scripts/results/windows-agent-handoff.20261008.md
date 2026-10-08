# 给 Fable 与下一位本地开发者的交接

所有者要求：今晚清理现场，明天由其他人继续。本交接只整理状态、清理本轮临时物料，
不再开发功能或执行新的联网验收。**请 Fable 在下一位开始前提醒以下事项。**

## 先读这六点

1. **第 1b 段已获 Fable 接受；第 2、3 段仍有待验项。** 安装闭环通过不等于全部交付。
   下面的待验表必须保留，不要沿用过程记录中较早的通过数或状态。
2. 源码以 `~/worktrees/luna/runtime` 的 Git 为准。Windows 测试副本只是执行环境；
   先核对提交、更新副本再跑，不能在副本改完就当作提交完成。
3. 只使用 `sunmoon-agent-9f2b5c6` 候选包。旧候选包已删除；证据保留在 Git。
   发行源码是 `9f2b5c6`，其后的报告/清理提交没有重新组包，不要混淆两个版本。
4. 测试机器目前应处于离线状态：四轮 Windows 临时代理已退出并清除配置副本。
   原 Linux 代理在本轮开始前就已停止，未为了交接而启动。**离线不等于新增故障。**
   恢复真实连接前核对令牌和当前连接，避免同一个令牌把别人的代理顶下线。
5. 不放宽 HTTP、路径或沙箱限制来让验收通过；不关闭应用控制，不编译自有 exe。
   Windows 产品使用本机 Node + JS + 官方 Codex，无 Python 依赖。
6. 本地提交后停止编辑，再让所有者运行 `WS=luna bash ~/switch-test/human-remote.sh`。
   同步成功后 Fable **只在 luna 审读**；整体验收后再由所有者安排合入 fable。

## 提交和报告入口

| 提交 | 已完成的内容 |
| --- | --- |
| `5f8d208` | 保存当时全部改动、真机/测试结果、失败原文和 Windows 重跑方法 |
| `a95910f` | HTTP 完整 URL 精确匹配、禁网拒绝、禁止跳转及越界测试 |
| `9f2b5c6` | 修复卸载时 Node 路径身份不匹配；整包重新演练通过 |
| `3d5b48e` | 第三段最终候选和结果报告 |
| 本交接提交 | 现场清理回执、补存临时测试输出、本交接与 CHECKPOINT；没有修改产品代码 |

- [第三段最终报告](windows-agent-3.20261008-2340.md)：完整安装流程、失败原因与恢复、测试数量。
- [第二段真实审批与延期项](windows-agent-2.20261008-2315.md)：真人确认、数据库事务、审计回执、文件写入的时间顺序。
- [CHECKPOINT](../../CHECKPOINT.md)：当前停点；其后较早小节是历史记录。
- [安装和日常操作](../../agent/distribution/README.md)：安装、启停、托盘、自启、卸载。

## 已验与待验分开

### 已实际验证

- Windows 原生测试 **204/204**，无跳过；Linux **172 通过、32 Windows 专用跳过**。
- 发行测试 Windows/Linux 各 **27/27**；HTTP/桥/权限专项 Windows **62/62**。
- 真包隔离安装 → 启动 → 关闭托盘后后台保活 → 停止 → 卸载。
  默认保留配置且摘要不变；重装后显式删除隔离配置也通过，项目文件保留。
- 本机 CLI 真人批准 → 工作台持久化事务 → relay recorded 回执 → Windows 实际写入。
- 登录任务注册、手动触发与移除；GUI 取消拒绝；20 秒连接闪断、吊销与进程清理。

### 待验：下一位不能直接写成通过

| 项目 | 现有覆盖与下一步 |
| --- | --- |
| 真实联网 MCP 完整调用 | 所有者明确后置；回环测试不代表真实链路。重新约定隔离代理网络上限，再经真人导入确认、实际 callTool、核对 marker 与审计回执，结束停代理 |
| 真实重启/登录自启 | 仅手动触发过计划任务；需要另行安排整机重启，不能擅自关闭 WSL/电脑 |
| 干净 Windows 10/11 | 当前是开发机。移除 Node PATH 不等于从未安装过 Node 的机器 |
| GUI 真人正向批准全链路 | 已验 CLI 正向、GUI 取消；还需 GUI 真人批准 → 持久审计 → 实际执行 |
| 可选 UAC elevated setup | 只验脚本解析，未执行新的提权安装入口；既有 elevated 测试家通过不等于此入口通过 |
| 两次旧 environmentConfig 投影拒绝 | 旧日志只记录粗粒度 cwd，仍需捕获真实拒绝路径；不能推断已解决或放宽目录读取 |
| 当前源码的 Linux 模型最小对 | 本轮末次源码未重跑；第二段已有结果，必须标明对应版本 |

建议先由 Fable 审读现有提交与本表，再安排真实 MCP/GUI 正向验收；重启和干净机验收另约条件。
这是交接建议，不替下一位自动发起新维护或新的授权。

## 安全和协议边界

- Windows 采用每个请求的 Codex 内层沙箱 + 桥内协议/真实路径过滤；不重试已证明不可用的双层嵌套方案。
- 文件助手通过固定 Codex 沙箱启动 `node.exe helper.mjs`，用正常文件 API；不要改成 Python 或自编译 exe。
- `mcp import` 只有本机真人确认后才保存无凭据 HTTP 项。启动时从本机 `mcp.json`
  读取 enabled 项，运行期间采用固定快照；云端字段不能扩展列表。
- `http/request` 同时要求本机网络上限开启、完整 URL 原文完全一致、显式
  `redirectPolicy=stop`。省略/follow/null、前缀/子路径、查询/编码/端口等变体均不扩大许可。
  禁止 Host 和代理身份头覆盖；真实 302 回环验证中跳转目标命中数为 0。
- **真实 MCP 客户端如果要求 follow，必须拒绝并报告兼容性问题，不能临时放行。**
  HTTP 由 Windows exec-server 发起；localhost 指 Windows，不是集群里的沙箱。
- 本机批准仍需持久化审计 recorded 回执才执行；不增设 localhost 自动批准接口。
  不回显令牌、用户确认码或密钥。远端命令使用私有桌面，控制目录不能成为可写项目根。
- 本机只读记录：普通用户、FullLanguage、CurrentUser RemoteSigned、Smart App Control On、
  VerifiedAndReputablePolicyState=1、官方 Node 签名有效。没有关闭应用控制或设置 Bypass。

## 现场保留什么，为什么保留

以下 Windows 路径中 `P = C:\Users\zymun\sunmoon-probe-runs`。

| 路径 | 用途与注意事项 |
| --- | --- |
| `P\windows-agent-3-20261008\sunmoon-agent-9f2b5c6` | 唯一最终候选目录，89 文件；清理前后全目录摘要校验通过 |
| `P\windows-agent-3-20261008\windows-stage3-package.mjs` | 隔离安装演练副本；源码在 `runtime/probe/`，重跑前核对来源 |
| `P\windows-agent-2-20261008\agent` | 普通 Windows 用户测试副本及冻结依赖；保留供明天复跑，不能当源仓 |
| `P\windows-agent-2-20261008` 下其余 probe/scripts 与旧测试日志 | 第二段复跑辅助与历史诊断；四个 live 临时目录已删除，不含保留中的活代理 |
| `P\windows-agent-2-native-links-20261008` | 原生符号链接/联接测试夹具；不要递归跟随链接清理 |
| `P\windows-agent-1d-20261008` | 上一段测试环境，包括固定 pnpm/Corepack 等复跑依赖；未作为本轮临时输出删除 |
| `P\windows-agent-1b-20261007` | 网页验收项目及第一段环境，保留供后续真实会话复用 |
| `C:\Users\zymun\.codex-probe-exec` | 既有 elevated 测试家；不要复制 sandbox secrets 或更改系统安全设置 |
| Git 中 `scripts/results/`、`probe/` | 证据、失败记录、可重跑探针，全部保留 |

包清单 SHA256：
`95d9219ee12ffeb9b5a992523f9f8a0a8348bfce3c1b2d5c2be79d52f6511946`。
固定源码：`9f2b5c60b738b51d9cb757fd574ccd479cc40874`。
物料 500,955,617 字节（不含清单）。它是候选，未安装到真实用户的默认目录。

## 本轮清理结果

精确清理清单：[cleanup.json](windows-agent-cleanup-20261008/cleanup.json)。

- 删除旧 `a95910f` Windows 候选、整个过时 `windows-agent-3a-20261008` 组包副本、
  `/tmp` 中三个重复包和可再生成的协议 schema。
- 删除四个已退出的 `live-approval-*` / `live-mcp-*` **精确目录**。
  删除前逐份确认 trace 末条 exit=0、凭据配置副本不存在、脱敏证据已入库。
- 临时测试输出和下载摘要先按字节归档到
  [retained-outputs/](windows-agent-cleanup-20261008/retained-outputs/)，再移除 `/tmp` 副本；许可证重复件与仓内原件逐字节核对。
- 共移除 **28 个精确目标、822 个文件，逻辑大小 2,508,779,475 字节（约 2.34 GiB）**；
  新归档输出 57,711 字节。此数不是 Windows C 盘实测增量，未压缩 WSL 虚拟盘。
- 清理前未发现本轮测试进程/`SunMoonAgent-*` 任务；清理后再次核对，测试进程、任务、
  本轮 `sunmoon-*-test`/原生测试家均无残留。见 `windows-state-before.json` 与 `windows-state-after.json`。
- 最终包再次验真；网页项目三个验收文件摘要不变，见 `preserved-project-files.json`。
- 未改真实用户配置、Windows 系统安全策略、现有集群、镜像、卷或磁盘挂载任务。
  早期报告中的临时路径是历史证据位置；本节已删除的路径不可再作为操作入口。

## 继续真实网页验收时

- 站点：`https://investment.sunmoonai.com:30443`。
- 测试机器：`luna-windows-stage1b-20261007`，当前离线是测试结束后的预期状态。
- 项目 ID：`053b9b70-260f-42b9-a2e7-ba911e4424c1`。
- 工作会话：`6e0bc2cf-7c86-4784-9156-5b4d3c7a6e5e`；聊天会话：
  `52511429-3a68-4bb3-a102-55db1e6b4c3f`。开始前从现网确认这些记录仍有效。
- 项目目录：`P\windows-agent-1b-20261007\workspace\myproject`。
  保留 `browser-check.txt`、`reconnect-work-20261008.txt`、`stage2-permission-check.txt`。
- 临时令牌配置已删除，需要时从既有私有输入读取，勿在仓库、报告或聊天粘贴。
  不复用旧一次性批准码，不把本机批准模拟成自动回复。
- 业务后端/relay 最近由 Cursor 固定发布；读其 k8s 回执 `ee9adbb8`，不要用新 runtime
  提交号推断线上镜像已更新。本次清理没有发布或重启它们。

## Windows 重跑入口

先将 Git 当前源码的 `src/`、`test/`、`native/`、`distribution/`、`vitest.config.ts`
同步到上述 Windows 测试副本；依赖若改动，按 `pnpm-lock.yaml` 重新冻结安装。
不要直接对真实用户默认配置运行隔离测试。

```powershell
Set-Location 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-20261008\agent'
$Node = 'C:\Program Files\nodejs\node.exe'
$env:SUNMOON_TEST_ELEVATED_HOME = 'C:\Users\zymun\.codex-probe-exec'
$env:SUNMOON_TEST_SYMLINK_FIXTURE = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-native-links-20261008'
& $Node node_modules/typescript/bin/tsc -p tsconfig.json
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
& $Node node_modules/vitest/vitest.mjs run
if ($LASTEXITCODE -ne 0) { throw 'native tests failed' }
& $Node --test distribution/test/bundle.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'distribution tests failed' }
```

包级闭环使用最终报告“Windows 重跑”的命令；它创建隔离配置、测试任务和安装目录，
成功自动清理，失败留现场。不要将“失败留现场”改成无条件强删。

## 同步和协作

- 所有者回传：`WS=luna bash ~/switch-test/human-remote.sh`。
- Fable 读本交接、CHECKPOINT 与第 2/3 段报告；意见写 `luna-feedback.md`。
- 所有者拉回：`WS=luna bash ~/switch-test/human-local.sh`。期间本地不要编辑或运行会写仓的检查。
- 只在 `luna` 提交；不要擅自 push、reset、改父仓 gitlink 或合入 fable。
- 若需构建镜像/发布，可按既有协作约定给同机 Cursor 写 inbox，固定源码和范围、要求回执。
  不把普通单元测试通过当成已发布，也不把用户网页转述当作未执行的真机结果。

exit=0
