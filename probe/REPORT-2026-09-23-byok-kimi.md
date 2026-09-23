# 探针报告：BYOK 与国产模型直连（Kimi）

日期 2026-09-23 · codex-cli 0.155.1 · 编排端 app-server `CODEX_HOME=~/.codex-probe-kimi`（从所有者的 `~/.codex-kimi` 复制：`model_provider="kimi"`，`model="kimi-k3"`，`base_url="https://api.moonshot.cn/v1"`，`wire_api="responses"`，`requires_openai_auth=true`，key 在 `auth.json` 的 `OPENAI_API_KEY` 字段，`auth_mode="apikey"`）· 执行端 exec-server `CODEX_HOME=~/.codex-probe-exec`。脚本 `probe_byok_kimi.py`（harness 在 `probe_common.py`），输出 `byok-kimi.out`。

## 问题

用户自己的国产厂商 key（不是 OpenAI 订阅）经 Codex 的 `model_providers` 直连，能不能跑通远端环境、命令工具、`apply_patch`、审批回调。这是"不垫付 token"（BYOK）与"国产模型经 Codex"两条未验证事项。

## 结果：三项全过

| 案例 | 条件 | 结果 |
| --- | --- | --- |
| K1 | 本地环境，`echo PROBE_SIDE` | 模型调了命令工具，输出 `PROBE_SIDE=app-server`；一轮 9.5k token |
| K2 | 远端环境，`workspace-write`，`apply_patch` 建文件 + 命令读它 | 文件落在 user-ws（`fileChange` 事件，`kind=add`）；命令输出 `PROBE_SIDE=exec-server`，即在执行端跑 |
| K3 | 远端环境，`on-request`，写 cwd 之外 | `item/commandExecution/requestApproval` 到达，带 `environmentId="user-pc"` 与 reason；客户端 `accept` 后执行成功 |

每个 turn 都有 `thread/tokenUsage` 事件（input/output/cached/reasoning 分项），可直接进预算账，标"厂商回报"。K3 已见到 `cachedInputTokens=8960`，Moonshot 的缓存计费生效。

## 对设计的影响

- **BYOK 成立**：key 放在沙箱的 `CODEX_HOME/auth.json`（`auth_mode="apikey"`）或环境变量，Codex 不需要 OpenAI 账号。沙箱池（`0003-sandbox`）注入 key 的办法：生成 `auth.json` 或设 `OPENAI_API_KEY`，两者都不落镜像。
- **国产模型直连成立**（Kimi K3 为首个样本）：工具调用、`apply_patch`、审批回调与 OpenAI 模型无差别；`wire_api="responses"` 可用，不必退到 chat completions。
- **未验**：OpenAI 的 API key 路径（所有者只有订阅，没有 key）；开发与展示期用所有者自己的订阅登录态（`~/.codex-probe/auth.json`）跑沙箱，上线时 OpenAI 用户须自带 key，否则不支持。其他国产厂商（DeepSeek、Qwen、GLM）未试，各家的 responses 兼容度可能不同。

## 复现

```bash
setsid env CODEX_HOME=$HOME/.codex-probe-exec PROBE_SIDE=exec-server codex exec-server --listen ws://127.0.0.1:47001 > es-kimi.log 2>&1 < /dev/null &
env CODEX_HOME=$HOME/.codex-probe-kimi PROBE_SIDE=app-server python3 -u probe_byok_kimi.py > byok-kimi.out
kill $(ss -ltnp | grep ':47001 ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
```

key 只在 `~/.codex-probe-kimi/auth.json`（600），不进脚本、输出与提交；`byok-kimi.out` 已核对不含 key。
