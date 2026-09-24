#!/usr/bin/env bash
# 第二段「代理与沙箱最小对」的一机联调：会合点 v1 + 本地代理（真 exec-server，外沙箱）+ 沙箱侧桥 + 真 app-server。
# 看什么：1) 代理连上会合点、沙箱经会合点配对；2) 一个 turn 在执行端跑、apply_patch 落白名单目录；
#         3) danger-full-access 被本地上限拒绝（协议过滤给出干净错误）。
# 前提：runtime/agent 已 pnpm install && pnpm build；~/.codex-probe 有登录态；k8s 仓与本仓并列（../k8s）。
# 用法：bash scripts/integration-minimal-pair.sh   （结果按 switch-test 约定落 scripts/results/）
cd "$(dirname "$0")/.." || exit 2
source scripts/env-header.sh
set -o pipefail
K8S="${K8S_REPO:-$(cd .. && pwd)/k8s}"; PY="${PY:-$PWD/.venv/bin/python}"; ORCH_HOME="${ORCH_HOME:-$HOME/.codex-probe}"
RELAY_PORT="${RELAY_PORT:-47100}"; BRIDGE_PORT="${BRIDGE_PORT:-47002}"; USER_ID=local; AGENT_TOKEN=agent-secret; SANDBOX_TOKEN=sandbox-secret
AGENT_HOME="$(mktemp -d /tmp/sunmoon-agent-it.XXXXXX)"; ROOT="$PWD/probe/user-ws"; mkdir -p "$ROOT"
pids=(); cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; pgrep -f "[c]odex app-server" | xargs -r kill 2>/dev/null; rm -rf "$AGENT_HOME"; }
trap cleanup EXIT
fail=0; verdict() { printf '  VERDICT %-52s %s\n' "$1" "$2"; [ "$2" = pass ] || fail=1; }

echo "--- 依赖"
[ -x "$PY" ] || { echo "缺 .venv（uv venv .venv && uv pip install --python .venv/bin/python websockets）"; exit 3; }
[ -f agent/dist/cli.js ] || { echo "缺 agent/dist（cd agent && pnpm install && pnpm build）"; exit 3; }
[ -f "$K8S/sunmoonai/relay-platform/relay/relay.py" ] || { echo "找不到会合点代码：$K8S"; exit 3; }
[ -f "$ORCH_HOME/auth.json" ] || { echo "编排端 $ORCH_HOME 没有登录态"; exit 3; }
for port in $RELAY_PORT $BRIDGE_PORT; do ss -ltn | grep -q ":$port " && { echo "端口 $port 被占用"; exit 4; }; done
CODEX_VERSION=$(node -e "console.log(require('./agent/node_modules/@openai/codex/package.json').version)")
echo "codex(随包) $CODEX_VERSION  ORCH_HOME=$ORCH_HOME  ROOT=$ROOT"

echo "--- 1. 会合点"
RELAY_HOST=127.0.0.1 RELAY_PORT=$RELAY_PORT RELAY_TOKENS_JSON="{\"$USER_ID\":{\"agent\":\"$AGENT_TOKEN\",\"sandbox\":\"$SANDBOX_TOKEN\"}}" \
  setsid "$PY" "$K8S/sunmoonai/relay-platform/relay/relay.py" > probe/it-relay.log 2>&1 < /dev/null & pids+=($!)
for i in $(seq 1 20); do ss -ltn | grep -q ":$RELAY_PORT " && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$RELAY_PORT/healthz" || { echo "会合点没起来"; cat probe/it-relay.log; exit 5; }

echo "--- 2. 本地代理（外沙箱 + 过滤），白名单只有 $ROOT"
export SUNMOON_AGENT_HOME="$AGENT_HOME"
node agent/dist/cli.js init --relay "ws://127.0.0.1:$RELAY_PORT" --user $USER_ID --token $AGENT_TOKEN --root "$ROOT" >/dev/null
SUNMOON_AGENT_LOG=info setsid node agent/dist/cli.js start > probe/it-agent.log 2>&1 < /dev/null & pids+=($!)
for i in $(seq 1 40); do grep -q '"relay connected"' probe/it-agent.log 2>/dev/null && break; sleep 0.5; done
grep -q '"relay connected"' probe/it-agent.log && verdict "代理连上会合点" pass || { verdict "代理连上会合点" fail; cat probe/it-agent.log; exit 6; }
grep -q '"sandboxed":true' probe/it-agent.log && verdict "exec-server 在外沙箱里启动" pass || verdict "exec-server 在外沙箱里启动" fail

echo "--- 3. 沙箱侧桥"
RELAY_URL="ws://127.0.0.1:$RELAY_PORT" RELAY_USER=$USER_ID RELAY_TOKEN=$SANDBOX_TOKEN CODEX_VERSION=$CODEX_VERSION BRIDGE_PORT=$BRIDGE_PORT \
  setsid "$PY" "$K8S/sunmoonai/sandbox-platform/bridge/sandbox_bridge.py" > probe/it-bridge.log 2>&1 < /dev/null & pids+=($!)
for i in $(seq 1 20); do ss -ltn | grep -q ":$BRIDGE_PORT " && break; sleep 0.5; done

echo "--- 4. app-server 经整条链跑 turn（L1 danger 应被拒；L3 workspace-write 应写成）"
env CODEX_HOME="$ORCH_HOME" PROBE_SIDE=app-server EXEC_URL="ws://127.0.0.1:$BRIDGE_PORT" CASES=L1,L3 timeout 400 python3 -u probe/probe_local_ceiling.py > probe/it-turns.out 2>&1
echo "probe exit=$?"; grep -E "=====|cmd:|final:|VERDICT|ERROR" probe/it-turns.out | cut -c1-220
grep -q "VERDICT L3 .*: True" probe/it-turns.out && verdict "workspace-write 的 turn 在执行端写成（L3）" pass || verdict "workspace-write 的 turn 在执行端写成（L3）" fail
grep -q "VERDICT L1 .*: False" probe/it-turns.out && verdict "danger-full-access 未能写出白名单（L1）" pass || verdict "danger-full-access 未能写出白名单（L1）" fail
grep -q "local ceiling" probe/it-turns.out && verdict "拒绝来自协议过滤（错误文本含 local ceiling）" pass || verdict "拒绝来自协议过滤（错误文本含 local ceiling）" fail
grep -q 'paired user=' probe/it-relay.log && verdict "会合点记录了配对" pass || verdict "会合点记录了配对" fail

echo "--- 5. 代理状态"
cat "$AGENT_HOME/status.json" 2>/dev/null | head -40
echo "--- 日志尾部"; for f in it-relay it-agent it-bridge; do echo "[$f]"; tail -5 probe/$f.log | cut -c1-200; done
echo "结论：$( [ $fail = 0 ] && echo pass || echo fail )"; exit $fail
