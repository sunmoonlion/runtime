# Windows unelevated 探针：阶段 0

日期：2026-10-07。任务：k8s 的 `switch-test/luna-task-windows-agent.md`（`c77e2536`）。
代码基线：runtime `luna`，`bdcddddb2ff10e4f678c5f7c83a6cf2cf8878afe`。
本次仅修改 runtime 探针及文档，没有修改代理产品代码、其他仓或会合点协议。

## 两问的结论

| 任务问题 | 结论 | 实际证据与边界 |
| --- | --- | --- |
| 1. 普通账号、不跑 setup，执行端配置 unelevated：模型驱动 L2 被拒、L3 成功？ | **undecidable** | exec-server 启动、`environment/add`、`environment/info` 成功；模型认证刷新返回 HTTP 403 `unsupported_country_region_territory`，没有取得已完成的写命令。停止本次进程树。没有把“文件未生成”算作通过。 |
| 2. 能否把整个 exec-server 包进外层受限沙箱？ | **pass（本机文件写边界）** | 原生 `codex.exe sandbox --permission-profile … -- codex.exe exec-server …` 启动成功。`sandbox:null` 文件请求在允许目录写成功，用户目录内 cwd 外、用户目录外均返回 OS access denied；不包外层时相同三类请求全部写成功。 |

第二项说明外层封装可行，不能据此声称第一项的 `process/start` 内层沙箱、嵌套执行及完整代理已经验收。
本次不作“Windows 只能靠协议过滤”的结论，也不进入阶段 1；按任务停点交所有者同步及远程审读。

## 环境与方法

- Windows 11 build 26200，PowerShell 5.1.26100.9444，Node 24.19.0，Python 3.13.15，Codex **0.155.1**，Windows Defender。
- Windows 执行进程的 `administrator=False`；从 WSL 发起 Windows 原生 PowerShell，测试源码复制到 NTFS 路径，不以 WSL/Linux 沙箱结果代替 Windows。
- 每次新建独立执行端家，无 `auth.json`，配置 `[windows] sandbox = "unelevated"`，没有执行 setup。编排测试家已有独立登录态，未复制或改写。
- 本机历史上做过 elevated setup；本次没有使用管理员令牌，但**没有证明从未安装过沙箱的干净 Windows 主机**。Windows 10 和干净 Windows 11 仍待验证。
- 没有增加包依赖。Node 内置 WebSocket 做纯本机对照，避免模型认证阻塞掩盖 OS 层事实。

外层配置还设 `sandbox_mode = "read-only"`、`approval_policy = "never"`，named profile 授权 cwd 和本次执行端家写入、根只读，联网允许用于本机 WebSocket。
外部测试目录是当前普通用户创建的 `C:\sunmoon-probe-outside-3eb5781642ab4321aff6ab7e9b928284`。
每个目标先通过非沙箱普通用户的排他创建和删除对照，排除“原本不可写”的假阳性。

## 实测结果

最终两次运行使用相同源码 SHA256，完整日志在 [outer-final.txt](../scripts/results/windows-unelevated-20261007/outer-final.txt)、[control-final.txt](../scripts/results/windows-unelevated-20261007/control-final.txt)。时间均为 UTC+08。

| 时间 / 方式 | cwd 内 | 用户目录内、cwd 外 | 用户目录外 | 退出 |
| --- | --- | --- | --- | --- |
| 19:35:54 / 外层沙箱 | 成功，内容相同 | `-32600`，`拒绝访问。 (os error 5)`，文件不存在 | 同左 | 0 |
| 19:36:22 / 不包外层的对照 | 成功，内容相同 | 成功，内容相同 | 成功，内容相同 | 0 |

请求明确带 `sandbox:null`；对照结果再次说明：**仅把执行端 config 写成 read-only/unelevated，不会自动给任意无沙箱文件请求加本地上限**。
仍需外层封装和桥内协议过滤。实测允许文件写入不等于验证禁读；本轮也没测网络硬禁、路径联接绕过和恶意进程逃逸。

实际握手与文件请求响应已保存为 [outer-final.frames.jsonl](../scripts/results/windows-unelevated-20261007/outer-final.frames.jsonl) 和 [control-final.frames.jsonl](../scripts/results/windows-unelevated-20261007/control-final.frames.jsonl)，可供阶段 1 Windows 路径测试使用。
其中 sessionId 是本机执行会话标识，不是认证令牌；`dataBase64` 只编码探针标记。

原模型探针的最小失败摘要见 [model-run-summary.json](../scripts/results/windows-unelevated-20261007/model-run-summary.json)，附原始日志 SHA256；没有提交认证家的文件或完整认证日志。

## 发现并修正的探针问题

1. 原 L2 仅凭文件不存在判通过，遇到认证失败会误判。现在要求实际命令、非零退出和明确权限拒绝；未执行为 undecidable；审批请求不自动放行。
2. 旧 L2 只有用户目录内 cwd 外的目标；本次另加用户目录外普通用户可写的目标。
3. 0.155.1 Windows 实际语法是 `sandbox [COMMAND]`，运行需指定 `--permission-profile`；最初缺少 profile 导致的启动失败是调用错误，不是外层能力不支持。
4. exec-server 的握手需 `initialize {clientName}` 再发 `initialized`。文件字段是 `dataBase64`。排查过程中的 `-32602` / 握手错误全部记为未判定，没有当成权限拒绝。
5. 包外层时 arg0 缓存 / PATH alias 初始化仍有 `os error 5` 警告，原生完整路径启动和文件 RPC 不受本次观察影响。嵌套命令的影响待阶段 1 前补验，不能删掉警告冒充无问题。
6. 现有 `agent/test/filter.test.ts` 的文件写 fixture 使用 `data_base64`，而声称来源的 `probe/frames.jsonl` 当前为空。阶段 1 应以本次真实帧更新相关 fixture；本轮未改过滤产品代码。

## 改动与核验

- 扩展现有 PowerShell 入口：选择沙箱模式、原生 exe、隔离测试家、外层/本机文件探针、版本与权限检查、精确清理进程树。
- 加固原 Python 探针判据，保留原模型调用链。
- 一个 Node 本机文件 helper，无第三方依赖；保留真实帧和对应落盘检查。
- 更新复测说明、此报告及 CHECKPOINT。阶段 1 的 exe 启动适配、托盘、安装器、令牌均未实施。

最终 Windows PowerShell / Node / Python 语法检查全部通过，见 [windows-syntax.json](../scripts/results/windows-unelevated-20261007/windows-syntax.json)。
Python 判据的 10 项检查及两份真实帧的一致性检查通过，见 [local-checks.json](../scripts/results/windows-unelevated-20261007/local-checks.json)。
这不替代模型驱动验收；未运行代理全套测试或 Linux 整机联调，代理产品代码未改。
提交证据已检查常见凭据模式，未发现令牌、密钥或密码值。

本次进程树均已结束，10 个独立测试家、Windows 源码临时副本、外部测试空目录已按精确路径删除，见 [cleanup.json](../scripts/results/windows-unelevated-20261007/cleanup.json)。
原 `.codex`、`.codex-probe`、`.codex-probe-exec` 保留。认证失败的原始临时日志随测试副本清理，仓内只保留失败摘要及原字节 SHA256。

源码摘要（最终两次运行日志也列明）：

| 文件 | SHA256 |
| --- | --- |
| `scripts/probe-windows-exec-server.ps1` | `5085c6b599bd4be7ce03a0bdffa9bb82752ee506a19c1144193fbf86bfe27f6f` |
| `probe/probe_local_ceiling.py` | `873ed84a52e3be834918b57870dae6ff5cdeec07a9d6e35ccda677218fb86aec` |
| `probe/probe_windows_fs.mjs` | `2299ee2e573a722ea543ed9b13df988915355d478c5e3a42c204c39f78028fef` |

## 远程审读后的下一步

先补第一问：服务可用的合规测试环境中重跑模型 L2/L3，或经审读接受真实 `process/start` 本机协议探针替代模型发起；再验证外层下的嵌套 workspace-write 命令。
另需干净普通用户 / Windows 10 覆盖。两问的结果不代表 `AT-WA-01…08` 已通过。
这些缺口确认处理后，再按所有者指示进入阶段 1，不自行削弱安全边界。

官方模式说明：[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)、[permission profiles](https://learn.chatgpt.com/docs/permissions)。官方现行文档与钉定 CLI 的命令形式可能不同，本报告以 0.155.1 本机输出为准。
