# 下载与接入实现记录（2026-10-09）

依据 k8s `d1cc2d65` 最后一节：所有者批准最小路线、代理令牌 **30 天**；托管位置由远程定，
后端配置为空即暂不可下载。仅本地提交；发布前另报具体对象。旧方案 24 小时不执行。

## 顺序

| 阶段 | 状态 |
| --- | --- |
| 0 包体审计、ZIP 实测 | 完成，见下 |
| 1 后端配置、30 天、并发/重放、no-store 与身份 | 26 项定向测试通过，pyright 0 错误，ruff 通过，分层 4/4 |
| 2 CLI 隐藏输入令牌 | Windows 16/16、Linux 15/1 Windows 专用跳过；真实 Linux PTY 非敏感夹具验证通过 |
| 3 网页接入迁到「我的机器」 | 已本地提交 039fa96；205 通过 / 2 既有跳过，类型、lint、i18n、生产构建通过 |
| 4 固定源码组新包，核对最终 ZIP | 6de6002 / 0.2.1；90 文件、ZIP 回验及 Windows 隔离安装通过，未发布 |

适用约束：C-I3/I5/I6 身份与 CSRF，C-I9 按本次所有者定案 30 天；C-A11 本机权限不变；
C-C3/C-C4 后端提供契约、网页配套；C-T5 分仓提交、C-R8 固定兼容版本。

## 包体审计

完整机器可读清单：[package-before.json](windows-agent-onboarding-20261009/package-before.json)。
路径前缀 `V` 为 `app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/`。

| 排名 | 包内路径 | 字节 |
| --- | --- | ---: |
| 1 | V/bin/codex.exe | 307108144 |
| 2 | node/node.exe | 92825416 |
| 3 | V/bin/codex-code-mode-host.exe | 72473904 |
| 4 | V/codex-resources/codex-windows-sandbox-setup.exe | 15498544 |
| 5 | V/codex-resources/codex-command-runner.exe | 8217904 |
| 6 | V/codex-path/rg.exe | 4218880 |
| 7 | licenses/node-LICENSE | 157606 |
| 8 | app/node_modules/ws/lib/websocket.js | 37367 |
| 9 | app/node_modules/smol-toml/dist/index.cjs | 26378 |
| 10 | app/node_modules/ws/lib/receiver.js | 17439 |

89 文件共 **500974988 字节（477.77 MiB）**。只有一个 Codex 主程序，六个 exe 均不同；
无 PDB/map 调试符号、无其它 OS/CPU 平台包。code-mode-host 是官方随包的另一程序，
没有“不需要它”的证据，不能当重复主程序删；沙箱辅助程序及许可证保留。JS 的零星辅助文件
不构成大体积来源，本轮不改官方签名二进制或冒险删依赖。

对已有固定包 `21f864b` 实际 ZIP Deflate-9：**174242372 字节（166.17 MiB）**；
SHA256 `576799e69496663b472f80143ae6bfee474508f53417945a8397e5481bd66d36`。
ZIP CRC 及解压后全部 89 文件摘要与原文件逐一相等。此为基线测量，**不是新功能发布包**；
大幅缩小的是传输压缩，安装占用仍 477.77 MiB。最终包组装后另报实测。

## 后端检查与失败记录

`tests/test_agent_onboarding.py test_workbench_tokens.py test_workbench_provisioning.py test_auth_routes_security.py`：
**26 passed**。覆盖并发首次请求仅一份签发、旧 revision 重放拒绝、锁跨提交/错误释放、
代理 30 天/沙箱 90 天、状态只给元数据、未配置下载、非法配置、鉴权、两个动作的 Origin/CSRF。
运行于临时容器 `sunmoon-onboarding-tests-20261009` 的 `onboarding_tests`；业务卷未挂载。

初次失败：测试 Settings 使用小写字段而本配置要求环境别名，导致 download 为 null，已修夹具；
临时 PostgreSQL 初始 HBA 不接受 Docker 网关、SQL_ASCII 编码令驱动报 bytes 类型错误，
已仅在临时实例修 HBA 并重建空 UTF-8 测试库后通过。首次 pytest 工作目录错误，无测试运行。
失败输出及最终结果在 [证据目录](windows-agent-onboarding-20261009/)，不把这些失败算产品通过。

后端契约/配置说明在 investment-backend `app/contracts/agent-onboarding.md`。
后续 CLI 和网页已配套完成，见下文；仍未发布。旧网页没有 revision，后端与新网页必须成对上线。

## CLI 阶段

后端本地 `8279c2c`，投资父仓 `f049fe6` 已跟随；子仓同步留下 detached HEAD，
已确认旧 luna 是祖先后快进并切回 luna，未丢弃或合并别人工位。

`init --token-prompt` 只从本机 TTY 隐藏输入，拒管道，支持退格、Ctrl+C 和两分钟超时；
错误不含输入，终止恢复原始终端模式，不保存配置。旧 --token 保留兼容；两种参数不能同时使用。
编译通过，Windows 原生 16/16、Linux 15 通过/1 Windows 专用跳过；实际 Linux PTY 用固定
无凭据字符串验证匹配、无回显、raw 模式恢复。没有为真实用户输入令牌或替人批准权限。

初次 Linux CLI 子进程受工具沙箱 EPERM 阻拦，主机权限重跑通过；首次原生 vitest 从 WSL
UNC 工作目录起时报告 Invalid regular expression，改从已有 Windows 本地测试目录运行通过。
未修改测试器依赖或系统策略。Windows 测试含真实 unelevated 沙箱准入，但不是新包完整验收。

## 网页与最终后端回归

网页 `039fa96`，后端最终 `ed77f73`（主功能 `8279c2c`），投资父仓 `1b05650`。

- 接入流程与机器接口都迁到 `features/machines/`；设置保留模型 key、会话默认与跳转。
  取数共用既有 `lib/workbench/http`，没有跨 feature 引用或另一份签发逻辑。
- 下载只读后端配置；缺省显示暂不可下载；失败可重查，不凭空填地址。
  安装说明先校验 ZIP，再校验清单，再预览/安装；默认普通用户、不启动、不自动提权。
- 初始化命令无令牌；短时内存内单独显示/复制，默认遮罩，五分钟、pagehide、离开页面或主动清除时删除。
  查询缓存、mutation 缓存与浏览器持久存储不保留令牌；剪贴板由用户主动复制后自行保管。
- 首次领取和显式轮换不自动重试。轮换确认绑定打开弹窗时的 revision；轮询变化不会替换这个值。
  409 先刷新状态再由用户决定；一次只支持本人一个在线代理；页面明确说明轮换会断旧代理并可能滚动沙箱。
- 30 天只改 agent JWT 签发默认参数，其它 JWT 90 天维持。既有令牌不自动改；旧不透明开发令牌
  没有期限，页面显示未知。发布接入前必须确认 `WORKBENCH_TOKEN_SIGNING_KEY` 已配置；未配签名的
  旧开发回退路径不构成“30 天令牌”验收。
- 最终复核删除了传给供给器的两项多余身份元数据，测试断言它们只在网页响应/状态中出现。

网页 **205 passed / 2 skipped**（既有 consumer-vector 条目），typecheck、eslint、i18n、Next 生产构建通过。
后端 **881 passed / 5 skipped**，两个测试库变量均指向本轮专用 PostgreSQL 18.6 UTF-8 测试库；
不使用现网数据库。跳过项是既有外部 broker/vector 条件，并非本轮逻辑跳过；pyright 0 错误、ruff 通过。

初次前端断言按钮名不匹配；全测发现 machines 跨 feature 引用，均已修复。工具沙箱不许监听回环，
导致预览服务和 Next 构建失败；在主机权限下原命令通过。后端首次全测 798 通过 / 4 跳过 / 84 错误，
原因是选用的 Harbor DB 镜像没有 uuid-ossp；换项目锁定的 PostgreSQL 后全套通过。
Harbor 拉该测试镜像返回 401，未改认证或服务，改用本机已有同摘要 OCI 归档导入。
失败输出摘录和最终输出均保留在证据目录。

## 新发行候选（未发布）

| 项目 | 值 |
| --- | --- |
| Agent | 0.2.1 |
| 固定源码 | 6de600279ffc1996e19409b1bd6c4ee1eb1eccbe |
| Codex / Node | 0.155.1 / 24.19.0，沿用已核验官方文件 |
| 完整目录 | `C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261009\sunmoon-agent-6de6002` |
| ZIP | 同一上级目录下 `sunmoon-agent-0.2.1-6de6002-windows-x64.zip` |
| 解压占用 | 90 文件，500978970 字节，477.77 MiB |
| 实际下载 | **174243923 字节，166.17 MiB** |
| ZIP SHA256 | `2d5421627198b9cf2eccf15d88b726c80d46f4180e2db30606120f5bd52aea5a` |
| 清单 SHA256 | `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2` |

ZIP 无外层嵌套目录，解压根即 install.cmd 与清单，符合网页命令。ZIP CRC 与全部 90 文件摘要回读一致；
没有重复 Codex、调试文件或其它平台依赖；没有删官方执行器、沙箱助手与许可文件。
`package-after.json` 保存最终前十项大小。原 21f864b 可信完整包保留供人工升级回退参考，
它仍不包含隐藏输入；不能冒用新版本、不能与新网页命令混用。

代理全测：**Windows 217/217；Linux 185 通过 / 32 Windows 专用跳过**；Linux 与 Windows 发行测试各 27/27。
新包原生实际校验：官方 Node/Codex/JS 版本、模块加载、隐藏 Node 的 PATH、隔离安装、真实 .cmd 版本调用、
配置字节不变，隔离安装清除；没有启动代理、真实用户安装或连接现网。
这不是重做 21f864b 的整套联网启停闭环，也不是干净 Windows 测试。

曾误用全局 pnpm 12 导致其隐式重装依赖；停止后用固定 10.24.0、冻结锁和 ignore-scripts 恢复，
锁摘要未变；现已在 agent/package.json 固定 packageManager。离线恢复缺缓存、后续在线恢复成功，
详见 dependency-restore.txt。安装包不依赖用户的 pnpm，不受该开发机修复影响。

## 重跑入口

后端在 `investment-backend/app`：为专用 `_tests` 库设置 `AGENT_TEST_DATABASE_URL` 与
`DELIVERY_TEST_DATABASE_URL`，执行 `.venv/bin/python -m pytest -q`；库须 UTF-8、提供 uuid-ossp。
网页在 `investment-web-frontend/app`：pnpm 10.24.0 执行 `typecheck`、`lint`、`check:i18n`、`test`、`build`。

Windows 在已保留的 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-20261008\agent`：

```powershell
$env:SUNMOON_TEST_ELEVATED_HOME = 'C:\Users\zymun\.codex-probe-exec'
$env:SUNMOON_TEST_SYMLINK_FIXTURE = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-native-links-20261008'
& 'C:\Program Files\nodejs\node.exe' node_modules/typescript/bin/tsc -p tsconfig.json
& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run
```

只能在该本地测试副本目录跑；先按固定源同步 src/test（测试副本不是代码真源）。
新包校验入口 `agent/distribution/test/windows-candidate.mjs` 需要包内 Node 和上表的包路径/清单摘要，
脚本只做隔离安装并清理，不调用 init/start。组包命令见 distribution/README.md，源码必须先提交。

## 交给 Fable：发布前停点

**本轮只本地提交，没有 push、镜像发布、部署、真实令牌轮换或新的线上代理连接。**

1. 先审后端 `8279c2c` + `ed77f73`、网页 `039fa96`、runtime `43182c6` + `6de6002`；
   下载配置契约见后端 `app/contracts/agent-onboarding.md`。旧后端不认识 revision，新后端拒绝旧网页不带 revision 的轮换，必须配套。
2. 远程确定真实 HTTPS 托管位置并上传**上表这一份** ZIP；后端唯一配置包含真实 URL、0.2.1、
   两个摘要、Codex 0.155.1、size_bytes=174243923。未配置时页面应保持“暂不可下载”，不得填假链接。
   托管配置建议稳定 Content-Disposition 文件名 windows-x64.zip、Content-Length、Range/断点续传；
   这些托管行为**本地未验**，正式下载、网络中断后续传也仍待验。
3. 发布前核实 JWT 签名配置、旧代理实际期限、relay 兼容 0.155.1，以及新旧网页缓存/成对发布顺序。
   本轮不迁移旧令牌；重新领取会撤销旧令牌，不能靠回退代码恢复它。
4. 开发站点上线后补完整“下载→哈希→安装→模型 key/沙箱首次令牌→隐藏输入→托盘选目录→
   启动→网页在线”真人链；本轮测试不能代替该链。
5. 原待验不变：GUI 真人允许→审计→执行；已安装实例网页在线；实际重启登录；可选 UAC；干净 Windows。
   两次旧 environmentConfig/read 原始拒绝参数、真实 MCP 被拒请求完整 URL 仍缺证据，不能猜测关闭。
6. Luna 合入 Fable 前，不能从 fable 发布投资后端/relay，避免把当前已验的本机确认链退回旧版本。

Windows 的 `node --test` 最初不能把 UNC 测试路径当成本地文件（Could not find）；
将同一测试与发行代码逐字节复制到临时 C 盘目录后 27/27，通过后副本已核对删除。
工具沙箱中 Node 发行测试先返回 test failed，主机权限原代码 27/27；未定位更细根因，不把首跑标通过。

## 现场清理与保留

两只本轮专用 PostgreSQL 测试容器已按固定 ID 停止并自动删除；新导入、无容器引用的测试镜像也已删除。
最初自动删除检查过早，容器尚处于异步删除时触发断言；随后只读确认后等待删除完成，再处理第二只。
没有使用 prune、没有触碰业务数据库/卷/节点。最终对象记录见 `cleanup.json`。
Windows 临时发行测试副本已逐文件核对后删除，隔离安装目录为 0；旧基线 ZIP 临时副本已核验摘要后删除。
保留新 0.2.1 目录与 ZIP、原可信完整包、Windows 依赖副本和原生攻击夹具，以便复测和人工升级。
真实 `~/.sunmoon-agent/config.json` 摘要仍为
`c80e10838cac82599861d996b94a5d095f67457e6192e99bb9d798c28bb4fe16`；未重启原 Linux 代理。
测试结果已入仓；本轮未注册实际用户自启任务、未打开新托盘、未轮换用户令牌。
