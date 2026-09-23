"""Reconnect probe: app-server -> sandbox_bridge(47002) -> exec-server(47001). Killing/restarting the bridge simulates a
network blip on the public segment; killing exec-server simulates the user's machine restarting the agent.
  N1  blip 3 s   : turn runs `sleep 12`; bridge killed at t=3 s, restarted at t=6 s  (within the 25 s window)
  N2  blip 35 s  : bridge killed at t=3 s, restarted at t=38 s                         (beyond the window); then a NEW turn
  N3  executor restart: exec-server killed at t=3 s, a new one started at t=8 s; then a NEW turn
Each case reports: environment events, whether the command output arrived, environment/status after, and whether a fresh turn works.
Run: env CODEX_HOME=~/.codex-probe python3 -u probe_reconnect.py > reconnect.out   (bridge + exec-server started by the script)
"""
import asyncio, json, os, re, subprocess, time
from probe_common import AppServer, USER_WS, ENV_ID, HOME
PY=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..",".venv","bin","python")
EXEC_URL="ws://127.0.0.1:47002"

def pids_on(port):
    out=subprocess.run(["ss","-ltnp"],capture_output=True,text=True).stdout
    return sorted({int(m) for l in out.splitlines() if f":{port} " in l for m in re.findall(r"pid=(\d+)",l)})
def kill_port(port):
    ps=pids_on(port)
    for p in ps: os.kill(p,15)
    return ps
def start_bridge():
    return subprocess.Popen([PY,"sandbox_bridge.py","47002","ws://127.0.0.1:47001"],stdout=open("bridge-reconnect.log","a"),stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
def start_exec():
    env=dict(os.environ,CODEX_HOME=os.path.expanduser("~/.codex-probe-exec"),PROBE_SIDE="exec-server")
    return subprocess.Popen(["codex","exec-server","--listen","ws://127.0.0.1:47001"],env=env,stdout=open("es-reconnect.log","a"),stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
async def wait_port(port,up=True,t=15):
    for _ in range(int(t*4)):
        if bool(pids_on(port))==up: return True
        await asyncio.sleep(0.25)
    return False

async def turn_bg(s,tid,text,timeout=120):
    return asyncio.create_task(s.turn(tid,text,timeout=timeout))

async def case(s,name,disrupt):
    print(f"===== {name}")
    r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":"read-only"})
    tid=r["result"]["thread"]["id"]; t0=time.time(); start=len(s.events)
    task=await turn_bg(s,tid,"Run exactly `sleep 12 && echo slept-ok` and report the output verbatim. Do not retry if it fails; just report the error.")
    await asyncio.sleep(3); await disrupt()
    cmds,final,notes=await task
    print(f"  turn took {time.time()-t0:.1f} s")
    for e in s.events[start:]:
        m=e.get("method","")
        if m.startswith("thread/environment") or m=="error": print(f"  event {m}:",json.dumps(e.get("params"))[:200])
    for c in cmds: print("  cmd:",json.dumps(c.get("command"))[:80],"| exit",c.get("exitCode"),"| status",c.get("status"),"|",(c.get("aggregatedOutput") or "").replace("\n"," | ")[:80])
    print("  final:",(final or "").replace("\n"," ")[:220])
    out=" ".join(c.get("aggregatedOutput") or "" for c in cmds)
    print("  VERDICT command output survived:", "slept-ok" in out)
    st=await s.call("environment/status",{"environmentId":ENV_ID}); print("  environment/status:",json.dumps(st.get("result",st))[:220])
    print("  -- fresh turn on the same thread:")
    cmds,final,notes=await s.turn(tid,"Run exactly `echo fresh-ok` and report verbatim.",timeout=120)
    out=" ".join(c.get("aggregatedOutput") or "" for c in cmds); print("  VERDICT fresh turn works:", "fresh-ok" in out, "|", (final or "").replace("\n"," ")[:120])

async def main():
    ex=start_exec(); assert await wait_port(47001), "exec-server did not start"
    br=start_bridge(); assert await wait_port(47002), "bridge did not start"
    s=AppServer(); await s.start()
    await s.call("initialize",{"clientInfo":{"name":"probe-reconnect","title":"probe-reconnect","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    print("environment/add:",(await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})).get("result"))

    async def blip(seconds):
        print(f"  [disrupt] killing bridge {kill_port(47002)}; restarting after {seconds} s"); await wait_port(47002,up=False)
        await asyncio.sleep(seconds); start_bridge(); print("  [disrupt] bridge restarted:",await wait_port(47002))
    async def exec_restart(seconds):
        print(f"  [disrupt] killing exec-server {kill_port(47001)}; new one after {seconds} s"); await wait_port(47001,up=False)
        await asyncio.sleep(seconds); start_exec(); print("  [disrupt] exec-server restarted:",await wait_port(47001))

    await case(s,"N1 network blip 3 s (within 25 s window)",lambda: blip(3))
    await case(s,"N2 network blip 35 s (beyond window), then fresh turn",lambda: blip(35))
    await case(s,"N3 exec-server restart after 5 s, then fresh turn",lambda: exec_restart(5))
    s.proc.terminate(); kill_port(47002); kill_port(47001); print("cleanup done")
asyncio.run(main())
