#!/usr/bin/env bash
# 第二段最小对，沙箱以容器形态：会合点 v1（本机 python）+ 本地代理（真 exec-server，外沙箱）+ 沙箱镜像容器（app-server ws + 桥）+ 工作台角色（ws + 能力令牌）。
# 看什么：1) 容器里的桥经会合点配对到代理；2) 工作台经 ws 令牌连上容器里的 app-server；3) workspace-write 的 turn 在本机白名单目录写成；4) danger 被本地上限拒。
# 前提：docker 能用且已 build sunmoon/sandbox:dev（k8s/sunmoonai/sandbox-platform）；Kimi key 在 ~/.codex-probe-kimi/auth.json（BYOK 用它，不打印）。
# 用法：bash scripts/integration-sandbox-image.sh
cd "$(dirname "$0")/.." || exit 2
source scripts/env-header.sh
set -o pipefail
K8S="${K8S_REPO:-$(cd .. && pwd)/k8s}"; PY="${PY:-$PWD/.venv/bin/python}"; IMAGE="${IMAGE:-sunmoon/sandbox:dev}"
RELAY_PORT=47100; APP_PORT=47800; USER_ID=local; AGENT_TOKEN=agent-secret; SANDBOX_TOKEN=sandbox-secret
ROOT="$PWD/probe/user-ws"; mkdir -p "$ROOT"; AGENT_HOME="$(mktemp -d /tmp/sunmoon-agent-it.XXXXXX)"; TOKDIR="$(mktemp -d /tmp/sunmoon-tok.XXXXXX)"
pids=(); cleanup() { docker rm -f sandbox-it >/dev/null 2>&1; for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$AGENT_HOME" "$TOKDIR"; }
trap cleanup EXIT
fail=0; verdict() { printf '  VERDICT %-52s %s\n' "$1" "$2"; [ "$2" = pass ] || fail=1; }

echo "--- 依赖"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "没有镜像 $IMAGE：cd $K8S/sunmoonai/sandbox-platform && docker build -t $IMAGE -f image/Dockerfile ."; exit 3; }
[ -x "$PY" ] && [ -f agent/dist/cli.js ] || { echo "缺 .venv 或 agent/dist"; exit 3; }
KEYFILE="${KEYFILE:-$HOME/.codex-probe-kimi/auth.json}"; [ -f "$KEYFILE" ] || { echo "缺 $KEYFILE"; exit 3; }
for port in $RELAY_PORT $APP_PORT; do ss -ltn | grep -q ":$port " && { echo "端口 $port 被占用"; exit 4; }; done
CODEX_VERSION=$(node -e "console.log(require('./agent/node_modules/@openai/codex/package.json').version)")
IMG_CODEX=$(docker run --rm --entrypoint codex "$IMAGE" --version | awk '{print $2}')
echo "codex 代理随包 $CODEX_VERSION / 镜像 $IMG_CODEX"
[ "$CODEX_VERSION" = "$IMG_CODEX" ] && verdict "两端 Codex 版本一致" pass || verdict "两端 Codex 版本一致" fail
head -c 32 /dev/urandom | base64 | tr -d '=+/\n' > "$TOKDIR/token"; chmod 644 "$TOKDIR/token"; APP_TOKEN=$(cat "$TOKDIR/token")

echo "--- 1. 会合点（绑 0.0.0.0 让容器能连；令牌表只有 local）"
RELAY_HOST=0.0.0.0 RELAY_PORT=$RELAY_PORT RELAY_TOKENS_JSON="{\"$USER_ID\":{\"agent\":\"$AGENT_TOKEN\",\"sandbox\":\"$SANDBOX_TOKEN\"}}" \
  setsid "$PY" "$K8S/sunmoonai/relay-platform/relay/relay.py" > probe/it2-relay.log 2>&1 < /dev/null & pids+=($!)
for i in $(seq 1 20); do ss -ltn | grep -q ":$RELAY_PORT " && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$RELAY_PORT/healthz" >/dev/null || { echo "会合点没起来"; cat probe/it2-relay.log; exit 5; }

echo "--- 2. 本地代理"
export SUNMOON_AGENT_HOME="$AGENT_HOME"
node agent/dist/cli.js init --relay "ws://127.0.0.1:$RELAY_PORT" --user $USER_ID --token $AGENT_TOKEN --root "$ROOT" >/dev/null
setsid node agent/dist/cli.js start > probe/it2-agent.log 2>&1 < /dev/null & pids+=($!)
for i in $(seq 1 40); do grep -q '"relay connected"' probe/it2-agent.log 2>/dev/null && break; sleep 0.5; done
grep -q '"relay connected"' probe/it2-agent.log && verdict "代理连上会合点" pass || { verdict "代理连上会合点" fail; cat probe/it2-agent.log; exit 6; }

echo "--- 3. 沙箱容器（Kimi BYOK；key 经环境变量进容器后由入口脚本落 auth.json 并 unset）"
MODEL_KEY=$(python3 -c "import json;print(json.load(open('$KEYFILE'))['OPENAI_API_KEY'])")
docker run -d --name sandbox-it --add-host=host.docker.internal:host-gateway -p 127.0.0.1:$APP_PORT:47800 \
  -e RELAY_URL="ws://host.docker.internal:$RELAY_PORT" -e RELAY_USER=$USER_ID -e RELAY_TOKEN=$SANDBOX_TOKEN \
  -e OPENAI_API_KEY="$MODEL_KEY" -e MODEL_PROVIDER=kimi -e MODEL=kimi-k3 -e PROVIDER_BASE_URL=https://api.moonshot.cn/v1 \
  -e APP_SERVER_TOKEN_FILE=/secrets/token -v "$TOKDIR/token:/secrets/token:ro" "$IMAGE" >/dev/null
unset MODEL_KEY
for i in $(seq 1 40); do ss -ltn | grep -q ":$APP_PORT " && docker logs sandbox-it 2>&1 | grep -q "entrypoint" && break; sleep 0.5; done
sleep 2; docker logs sandbox-it 2>&1 | grep -v "sk-" | tail -5

echo "--- 4. 工作台角色经 ws + 令牌跑 turn"
env APP_SERVER_URL="ws://127.0.0.1:$APP_PORT" APP_SERVER_TOKEN="$APP_TOKEN" ROOT="$ROOT" timeout 400 "$PY" -u probe/probe_sandbox_image.py > probe/it2-turns.out 2>&1
echo "probe exit=$?"; grep -E "initialize|environment/status|=====|cmd:|final:|VERDICT|ERROR|Traceback" probe/it2-turns.out | cut -c1-220
grep -q "VERDICT S1 .*: True" probe/it2-turns.out && verdict "workspace-write turn 在本机白名单目录写成" pass || verdict "workspace-write turn 在本机白名单目录写成" fail
grep -q "VERDICT S2 .*: True" probe/it2-turns.out && verdict "danger-full-access 被本地上限拒" pass || verdict "danger-full-access 被本地上限拒" fail
grep -q "paired user=" probe/it2-relay.log && verdict "会合点配对了容器里的桥" pass || verdict "会合点配对了容器里的桥" fail
docker logs sandbox-it 2>&1 | grep -q "paired conn=" && verdict "容器里的桥报告配对" pass || verdict "容器里的桥报告配对" fail
echo "--- 日志尾部"; echo "[relay]"; tail -4 probe/it2-relay.log; echo "[agent]"; tail -4 probe/it2-agent.log | cut -c1-200; echo "[sandbox]"; docker logs sandbox-it 2>&1 | grep -v "sk-" | tail -6
echo "结论：$( [ $fail = 0 ] && echo pass || echo fail )"; exit $fail
