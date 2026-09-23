# 探针报告：断线恢复

日期 2026-09-23 · codex-cli 0.155.1 · 链路 app-server → `sandbox_bridge.py`（47002）→ `codex exec-server`（47001）。杀桥模拟公网段断线；杀 exec-server 模拟用户机器上的代理重启。脚本 `probe_reconnect.py`，输出 `reconnect.out`，日志 `bridge-reconnect.log`、`es-reconnect.log`。

## 源码里的两个窗口

| 常量 | 值 | 在哪一侧 | 含义 |
| --- | --- | --- | --- |
| `SESSION_RECOVERY_TIMEOUT` | 25 s | 编排端（app-server 的 exec-server 客户端） | 断线后按 100 ms 间隔重连并 `resume_session_id`，超 25 s 放弃 |
| `DETACHED_SESSION_TTL` | 30 s | 执行端（exec-server） | 连接掉了之后会话在内存里保留 30 s，进程与输出缓冲不动；超时清掉 |

会话 id 只在 exec-server 进程内存里：进程重启即 `unknown session id`。

## 结果

| 案例 | 干扰 | 事件 | 命令输出 | 之后的新 turn |
| --- | --- | --- | --- | --- |
| N1 | 桥断 3 s | `disconnected` → `connected` | **到了**：`sleep 12 && echo slept-ok` 在执行端一直跑着，重连后输出补回，turn 正常结束（21 s） | 正常 |
| N2 | 桥断 35 s | `disconnected`；25 s 后 `recovery timed out` | 丢：turn 以 `exec_command failed … recovery timed out after 25s` 结束；`environment/status = disconnected` | **正常**：桥回来后 app-server 自动重新连上（registry recovery，退避 0.5 到 5 s），新 turn 直接跑 |
| N3 | exec-server 杀掉，5 s 后起新进程 | `disconnected`；`unknown session id` | 丢：turn 以 `unknown session id …` 结束；status `disconnected` | **正常**：新进程被自动接上 |

三个案例里 turn 都**诚实结束**：没有静默退回本地执行（沙箱侧 `include_local` 语义再次验证），错误文本带原因。

## 对设计的影响

- 状态机 `Attempt.SUSPENDED` 的语义按此定：`thread/environment/disconnected` → `SUSPENDED`；25 s 内 `connected` → `RUNNING`，进程与输出无损；超窗或代理重启 → 该 Attempt `ABANDONED`（turn 会带错误结束），Task 进 `WAITING(ENVIRONMENT)`。
- **恢复不需要工作台做任何事**：环境回来后 app-server 自己重连，工作台只要看到 `environment/status = ready`（或下一个 turn 成功）就可以开新 Attempt。工作台要做的是判断"这一步做到哪了"：用固定版本的 Artifact 与 Codex 的 patch 记录，不靠猜。
- 桥与会合点的实现要求：断线后**同一 URL 重连能到同一个 exec-server 进程**（会话 id 才有效）；会合点无状态没关系，但代理侧桥必须把新连接接回同一个 exec-server，不能顺手重启它。
- 25 s 与 30 s 是 Codex 常量，不可配；公网抖动通常远短于 25 s，所以第一期不做自己的续传（`D17` 里 Codex rendezvous 的续传优势因此减弱）。
- 本地代理重启 = 会话全丢，这是用户可感知的：代理升级、机器休眠都会触发，网页要把 `WAITING(ENVIRONMENT)` 说成人话。

## 复现

```bash
env CODEX_HOME=$HOME/.codex-probe PROBE_SIDE=app-server python3 -u probe_reconnect.py > reconnect.out   # 脚本自己起 exec-server 与桥并清理
```
