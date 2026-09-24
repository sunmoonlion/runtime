#!/usr/bin/env bash
# 两机公网延迟探针——远程（沙箱 + 会合点角色）这一侧。所有者同意临时开放 47100 后由远程助手跑。
# 起会合点（0.0.0.0:47100，无认证，跑完即停）与 sandbox_bridge（47002 → 会合点），等本地代理注册后跑 probe_relay_passthrough.py，
# 打印 bridge 的 RTT 表；对照 probe/bridge-relay.log（回环）即公网开销。
# 用法：USER_ID=luna ORCH_HOME=$HOME/.codex-probe bash scripts/probe-two-machine-latency-remote.sh
cd "$(dirname "$0")/.." || exit 2
source scripts/env-header.sh
USER_ID="${USER_ID:-luna}"; ORCH_HOME="${ORCH_HOME:-$HOME/.codex-probe}"; PY=.venv/bin/python
[ -x "$PY" ] || { echo "缺 .venv"; exit 3; }
for port in 47100 47002; do ss -ltn | grep -q ":${port} " && { echo "端口 ${port} 被占用"; exit 4; }; done
setsid $PY probe/relay_dumb.py 47100 0.0.0.0 > probe/relay-two-machine.log 2>&1 < /dev/null &
setsid $PY probe/sandbox_bridge.py 47002 "ws://127.0.0.1:47100/sandbox?user=${USER_ID}" > probe/bridge-two-machine.log 2>&1 < /dev/null &
for i in $(seq 1 20); do ss -ltn | grep -q ':47100 ' && ss -ltn | grep -q ':47002 ' && break; sleep 0.5; done
echo "--- 等本地代理注册（最多 ${WAIT:-600}s）"
for i in $(seq 1 "${WAIT:-600}"); do grep -q "agent control up user=${USER_ID}" probe/relay-two-machine.log && break; sleep 1; done
grep -q "agent control up user=${USER_ID}" probe/relay-two-machine.log || { echo "本地代理没有注册上来"; cat probe/relay-two-machine.log; exit 5; }
echo "--- 本地代理已注册，跑透传探针"
env CODEX_HOME="$ORCH_HOME" PROBE_SIDE=app-server EXEC_URL=ws://127.0.0.1:47002 timeout 400 python3 -u probe/probe_relay_passthrough.py 2>&1
echo "--- 收尾并打印 RTT 表"
for port in 47002 47100; do for p in $(ss -ltnp | grep ":${port} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$p"; done; done
sleep 1; cat probe/bridge-two-machine.log; echo "--- 回环对照（probe/bridge-relay.log）"; grep -A12 "RTT per request" probe/bridge-relay.log
