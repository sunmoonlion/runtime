# 探针报告：会合点透传

日期 2026-09-23 · codex-cli 0.155.1 · 一台机器。链路：app-server → `sandbox_bridge.py`（沙箱侧出站桥，监听 47002）→ `relay_dumb.py`（哑会合点，47100）→ `agent_bridge.py`（代理侧出站桥）→ `codex exec-server`（47001）。三段都是我们自己的 Python（`websockets` 17.1，venv 在 `runtime/.venv`）。
基线：`sandbox_bridge` 直接接 47001，同样的仪表。脚本 `probe_relay_passthrough.py`；输出 `relay-direct.out`、`relay-relayed.out`、`bridge-direct.log`、`bridge-relay.log`、`relay.log`、`agent-bridge.log`。

## 问题

1. 两端都只出站、中间一个无状态透传，Codex 的远端环境协议能不能原样通过？
2. 一次工具调用要多少个来回？公网上的延迟是多少？
3. Codex 自带的 `--remote` 注册机制能不能直接当我们的会合点？

## 结果

**1. 透传成立。**两个 turn（`echo hi`；`apply_patch` 建文件 + `cat`）经会合点与直连结果完全相同：命令在执行端跑、文件落 user-ws、`fileChange` 事件正常。会合点按 `user` 配对，代理侧只有出站连接，沙箱侧只有出站连接。

**2. 来回数是真正的成本。**两个 turn 共 93 个 JSON-RPC 请求（app-server → 执行端），分布：

| 方法 | 次数 | 直连 RTT 中位 | 经会合点 RTT 中位 |
| --- | --- | --- | --- |
| `fs/getMetadata` | **81** | 27 ms | 8 ms |
| `fs/readFile` | 3 | 0.7 ms | 2 ms |
| `fs/writeFile` | 1 | 45 ms | 46 ms |
| `environmentConfig/read` | 3 | 2.5 ms | 3.4 ms |
| `process/start` | 2 | 4 ms | 5 ms |
| `process/terminate` | 2 | 0.6 ms | 2.9 ms |
| `initialize` | 1 | 2 ms | 33 ms |

回环上会合点本身的开销可以忽略（差异在噪声内）。要紧的是**每个 turn 约 45 个串行来回**，其中 `fs/getMetadata` 占九成（app-server 在 turn 前后探测 cwd、`AGENTS.md`、skills、`.codex` 等路径）。公网上每来回 RTT 为 r，则每 turn 额外延迟约 45r：r = 30 ms 时 1.4 s，r = 100 ms 时 4.5 s。turn 本身 7 到 9 s（模型），所以国内同城可接受，跨境边缘不可接受。这就是 9/17 否决 C 的"延迟"理由的定量版。

**3. Codex 自带的注册机制是一套完整的 rendezvous，不能直接拿来用，但值得做兼容评估。**源码（`exec-server/src/remote.rs`、`relay.rs`、`noise_relay/`、`proto/codex.exec_server.relay.v1.proto`）：exec-server 用 `--remote <base_url>` 向一个 HTTP 服务 POST 注册与连接（`register_environment`、`connect_environment`，返回 websocket URL），然后在一条物理 WebSocket 上跑**多路复用 + 序号/ACK/续传**的 relay 帧（protobuf），默认 `noise_hybrid_ik_v1` 端到端加密（`--remote-transport noise`，也有 `direct`）；app-server 侧对应 `open_noise_rendezvous_connection`，需要一个 provider 给 `connect_bundle`。它就是 OpenAI 云的会合点协议。含义：

- 它带断线续传（`RelayResume next_seq`）与多路复用，比我们的哑透传强；
- noise 模式下中间人看不见 JSON-RPC，我们的**协议过滤层失效**；`direct` 模式待验；
- 接口标 experimental、无文档、服务端我们得自己实现并跟着它变。

## 对设计的影响

- `0004-relay` 第一期按本探针的形状做：三类出站客户、按用户配对、逐消息透传、无状态。多路复用（一个代理服务多个 app-server 连接）已经在桥里：每个入站连接一条独立配对流。
- **延迟预算**写进拓扑：边缘必须与用户同区域（国内用户 → 国内边缘）；跨境边缘不成立。真实数字要在两台机器之间测（luna 本地 + 这台远程），本探针只给了来回数。
- 减少来回的两个杠杆待验：exec-server 的 `--concurrent-requests`（默认 1，`fs/getMetadata` 可能被串行化）；app-server 侧是否有缓存 metadata 的配置。
- Codex 自带 rendezvous 协议的兼容实现列为备选（`D17`）：好处是续传与多路复用现成；代价是加密下不能过滤、协议不稳定、服务端自研。

## 复现

```bash
PY=../.venv/bin/python
setsid env CODEX_HOME=$HOME/.codex-probe-exec PROBE_SIDE=exec-server codex exec-server --listen ws://127.0.0.1:47001 > es-relay.log 2>&1 < /dev/null &
setsid $PY relay_dumb.py 47100 > relay.log 2>&1 < /dev/null &
setsid $PY agent_bridge.py ws://127.0.0.1:47100 user1 ws://127.0.0.1:47001 > agent-bridge.log 2>&1 < /dev/null &
setsid $PY sandbox_bridge.py 47002 "ws://127.0.0.1:47100/sandbox?user=user1" > bridge-relay.log 2>&1 < /dev/null &   # 基线：第二参数换成 ws://127.0.0.1:47001
env CODEX_HOME=$HOME/.codex-probe PROBE_SIDE=app-server EXEC_URL=ws://127.0.0.1:47002 python3 -u probe_relay_passthrough.py
kill <sandbox_bridge pid>   # SIGTERM 触发 RTT 表；找 pid 用 ss -ltnp 按端口，或 pgrep -f '[a]gent_bridge.py'（方括号防止匹配到自己的 shell）
```
