#!/usr/bin/env bash
# 两机公网延迟探针——本地（用户机器角色）这一侧。
# 起 codex exec-server（只绑 127.0.0.1）与 agent_bridge（出站连远程会合点），保持 DURATION 秒供远程跑 probe_relay_passthrough.py，
# 然后收尾并打印 exec-server 日志尾部。RTT 表在远程侧的 bridge 日志里；这份输出只证明本地侧连上、命令在本地执行。
# 用法：RELAY=ws://43.153.135.74:47100 USER_ID=local DURATION=600 bash scripts/probe-two-machine-latency.sh
cd "$(dirname "$0")/.." || exit 2
source scripts/env-header.sh
RELAY="${RELAY:?需要 RELAY=ws://<远程IP>:47100}"; USER_ID="${USER_ID:-local}"; DURATION="${DURATION:-600}"
EXEC_HOME="${EXEC_HOME:-$HOME/.codex-probe-exec}"; PORT=47001
echo "会合点 ${RELAY}  用户 ${USER_ID}  保持 ${DURATION}s  执行端 CODEX_HOME=${EXEC_HOME}"

echo "--- 依赖"
[ -x .venv/bin/python ] || { uv venv -q .venv && uv pip install -q --python .venv/bin/python websockets; } || { echo "venv 建不起来"; exit 3; }
.venv/bin/python -c 'import websockets;print("websockets",websockets.__version__)' || exit 3
codex --version || { echo "codex 不在 PATH"; exit 3; }
mkdir -p "$EXEC_HOME" probe/user-ws
[ -f "$EXEC_HOME/config.toml" ] || printf 'sandbox_mode = "read-only"\napproval_policy = "never"\n' > "$EXEC_HOME/config.toml"

echo "--- 起 exec-server"
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then echo "端口 ${PORT} 已被占用，先停掉再跑"; exit 4; fi
setsid env CODEX_HOME="$EXEC_HOME" PROBE_SIDE=exec-server codex exec-server --listen "ws://127.0.0.1:${PORT}" > probe/es-two-machine.log 2>&1 < /dev/null &
for i in $(seq 1 40); do ss -ltn 2>/dev/null | grep -q ":${PORT} " && break; sleep 0.5; done
ss -ltnp 2>/dev/null | grep ":${PORT} " || { echo "exec-server 没起来："; cat probe/es-two-machine.log; exit 5; }

echo "--- 起 agent_bridge（出站到会合点），保持 ${DURATION}s；远程在这段时间里跑 probe_relay_passthrough.py"
timeout "$DURATION" .venv/bin/python probe/agent_bridge.py "$RELAY" "$USER_ID" "ws://127.0.0.1:${PORT}" 2>&1 | tee probe/agent-bridge-two-machine.log
rc=${PIPESTATUS[0]}; echo "agent_bridge 退出码 ${rc}（124 = 到时正常结束）"

echo "--- 收尾"
for p in $(ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$p" && echo "停 exec-server pid $p"; done
echo "--- exec-server 日志尾部（看有没有来自远程的 process 启动记录）"
tail -20 probe/es-two-machine.log
grep -c "conn=" probe/agent-bridge-two-machine.log | sed 's/^/桥接过的连接数 /'
echo "结论：本地侧 $( [ "$rc" = 124 ] && grep -q 'bridged' probe/agent-bridge-two-machine.log && echo pass || echo undecidable )（RTT 表看远程侧）"
