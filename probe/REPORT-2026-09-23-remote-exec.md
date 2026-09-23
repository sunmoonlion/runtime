# 探针报告：Codex「循环在云、执行在本机」（架构 C）能否成立

> 日期 2026-09-23 ｜ 执行者 Fable（Claude Code）｜ 机器：远程开发机 VM-0-13-ubuntu（Ubuntu 24.04，3.6 GB 内存）
> 钉版：`codex-cli 0.155.1`（npm，原生二进制 `codex-linux-x64`）；源码对照 `~/repo/codex`（更新于 0.155 之后，本文只引用与 0.155.1 行为一致的部分）
> 结论按三值写；没跑的写「没跑」。脚本与日志在本目录：`probe_c_remote_exec.py`、`probe_c_phases.py`、`es.log`、`phases.out`。

## 结论

**架构 C 成立（`pass`）**：Codex 的模型循环（app-server）与工具执行（exec-server）可以分在两台机器上，官方协议原生支持，不需要改 Codex。
下面四条都是这台机上实跑出来的事实，不是读文档推断。

| # | 要验的 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | app-server 能把一个远程 exec-server 当执行环境，命令在 exec-server 那边跑 | `pass` | 命令输出 `PROBE_SIDE=exec-server`（该变量只注入给 exec-server 进程；app-server 进程里是 `app-server`）；对照臂不带环境时输出 `PROBE_SIDE=app-server` |
| 2 | 文件改动落在远端工作区 | `pass` | `apply_patch` 新建 `PROBE_WRITE.txt`，文件出现在 exec-server 所在目录，`item/completed` 的 `fileChange` 记录了路径与 diff |
| 3 | 工具级审批经协议回到 app-server 的客户端，且带环境标识 | `pass` | `item/commandExecution/requestApproval` 携带 `environmentId: "user-pc"`、`command`、`cwd`、`reason`；客户端回 `accept` 后命令由 exec-server 不带沙箱执行，目标文件出现 |
| 4 | 执行端断线的表现 | `pass`（行为可接受） | 中途 `kill -9` exec-server：两个绑定该环境的 thread 各收到 `thread/environment/disconnected`；进行中的命令项以断线结束；turn 正常 `turn/completed`，模型如实报「执行连接断开」；`environment/status` 返回 `disconnected` 并注明尝试会话恢复 25 秒超时。**没有退回本地执行** |

另有两条顺带核实的事实：

- 沙箱在**执行端**施加：exec-server 用 `codex-linux-sandbox --permission-profile …` 包住命令（只读策略下 `sandbox.type=LinuxSeccomp`；批准后越出沙箱的那条 `sandbox.type=None`）。
- 执行端有审计日志：每个 `process/start` 带 `conversation.id`、`tool.call_id`、`sandbox.type`、退出码（`RUST_LOG=info`）。

一轮只读命令的 turn 全程 16.7 秒（含模型往返）。

## 机制（0.155.1 实测 + 源码对照）

```text
云端                                       用户机器
app-server ──ws://host:port（JSON-RPC）──▶ codex exec-server --listen ws://IP:PORT
  │ 模型循环、审批分发、thread/turn 状态        │ 进程与文件系统 RPC、沙箱、审计日志
  ▼                                            ▼
模型厂商（用户的 key）                       用户的工作区
```

- 环境注册两条路，都验过一条：
  - 协议：`environment/add {environmentId, execServerUrl, connectTimeoutMs?}`（本次用的）；
  - 配置：`$CODEX_HOME/environments.toml`，`[[environments]] id / url | program / args / env / cwd`，`default`、`include_local`（源码 `exec-server/src/environment_toml.rs`，没跑）。
- 选环境：`thread/start` 与 `turn/start` 的 `environments: [{environmentId, cwd, runtimeWorkspaceRoots?}]`；turn 级可覆盖 thread 级。
- 查询：`environment/info`（连上并返回 shell 与 cwd）、`environment/status`（`ready | pending | disconnected | unknown`）；通知 `thread/environment/connected | disconnected`。
- 官方还有 `--remote <URL> --environment-id` 的注册 + Noise 中继模式（通过 OpenAI 的环境注册表会合，穿 NAT），本次**没跑**，也不打算用——我们自己做中继。

## 对架构的直接含义

1. **本地那一层就是 `codex exec-server`**，我们的 runtime 包一层：起它、管它、连我们的中继、显示审批。不用再把整个 Codex 打进本机，不用给 Codex 做 Windows 沙箱（exec-server 自己带沙箱，见下面的未验）。
2. **云端每用户一个 app-server**，用用户的 API key（BYOK）。同一实例天然成立：用户自驾和顾问驾驶用的是同一个 app-server、同一个 thread。
3. **审批协议已经是我们要的形状**：审批请求到 app-server 的客户端（我们的后端），带环境标识，由我们决定转给用户界面还是按策略自动处置。这正是"工具级审批在本机、Task 级审批经后端"两层能落的地方。
4. **断线语义可用**：有 disconnected 通知、有 25 秒恢复窗口、不静默退回本地。租约与 fencing 的一大半需求由此消解，剩下的是我们自己的中继怎么做重连。

## 没验的（⚠，下一步的探针清单）

| 项 | 为什么重要 | 怎么验 |
| --- | --- | --- |
| **NAT 穿透与中继** | 用户机器没有公网地址，app-server 连不到它。要么用 Codex 的注册表 + Noise 中继（依赖 OpenAI 服务），要么我们自建：exec-server 出站连我们的中继，中继给 app-server 一个 `ws://` 入口，字节透传 | 写一个 200 行的 ws 转发器，两台机（远程机 + 本地 luna）实跑 |
| **ws 监听的认证** | `exec-server --listen` 没有认证参数（帮助里没有；app-server 的 `--ws-auth` 是给它自己的入口用的）。裸 ws 等于任何能连上端口的人都能在用户机器上执行命令 | 中继两端加认证；exec-server 只监听 loopback，由 runtime 出站连中继 |
| **API key 而非 ChatGPT 登录** | 本次 app-server 用的是 `~/.codex-probe` 里的 ChatGPT 登录态。云端形态要求 API key（订阅登录搬上云端条款上是灰区） | 用 `OPENAI_API_KEY` 或国产厂商 key 配 `model_provider` 跑同一探针 |
| **Windows 上的 exec-server** | 目标用户在 Windows。`windows_sandbox_service` 特性标为 under development；exec-server 在 Windows 上有没有沙箱、装不装得上 | 本地 luna 在 Windows 跑 `codex exec-server --listen`，重复本探针 |
| **国产模型直连** | 用户拿不到 OpenAI key 时的生死项 | Kimi API key 配 provider，跑同一探针；看工具调用与 apply_patch 是否正常 |
| **断线后的恢复** | 25 秒内重连能不能接回原会话与原进程（源码有 `client_recovery.rs`、`resume`） | 中途断网 10 秒再恢复，看命令是否续上 |
| **一个 exec-server 服务多个 app-server 会话** | 用户自驾和顾问驾驶如果是两个 app-server 进程 | `--concurrent-requests` 与多客户端连接实测 |
| **MCP 与 skills 在远端环境里的解析** | 我们的方法工具要挂在哪一端 | README 说 stdio MCP 在选定环境里启动、HTTP MCP 用该环境的客户端；实跑一个 |
| **`environments.toml` 的 `program` 模式** | 云端沙箱里用 stdio 起一个"到中继的桥"可能比 `url` 更省事 | 写一个 stdio 桥试 |

## 复现

```bash
# 用户机器一侧（本次与云端同机模拟，用不同目录与环境变量区分）
cd probe/user-ws && setsid env CODEX_HOME=$HOME/.codex-probe PROBE_SIDE=exec-server RUST_LOG=info \
  codex exec-server --listen ws://127.0.0.1:47001 > ../es.log 2>&1 < /dev/null &

# 云端一侧：驱动 app-server（stdio JSON-RPC），A 对照 / B 写与审批 / C 断线
cd probe && CODEX_HOME=$HOME/.codex-probe python3 -u probe_c_remote_exec.py     # 主探针
cd probe && CODEX_HOME=$HOME/.codex-probe python3 -u probe_c_phases.py A B C     # 三阶段
```

踩过的坑，免得重踩：`sandbox` 取值是 `read-only | workspace-write | danger-full-access`（README 示例里的驼峰在 0.155.1 会被拒）；`approvalPolicy` 是 `never | on-request | on-failure | unless-trusted`；
找 exec-server 进程**按监听端口找**（`ss -ltnp`），不要 `pgrep -f`——它会匹配到你自己的 shell 并把它一起杀掉；
node 包装进程的 pid 不是原生二进制的 pid，杀包装进程不释放端口。
