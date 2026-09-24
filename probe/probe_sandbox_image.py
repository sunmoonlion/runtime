"""工作台角色：经 WebSocket + 能力令牌连沙箱镜像里的 app-server，走整条链跑两个 turn。
env: APP_SERVER_URL（默认 ws://127.0.0.1:47800）APP_SERVER_TOKEN ROOT（用户机器上的白名单目录，本机联调时就是本机路径）ENV_ID（默认 user-pc）"""
import asyncio, json, os, time
from probe_common import AppServerWs
URL=os.environ.get("APP_SERVER_URL","ws://127.0.0.1:47800"); TOKEN=os.environ["APP_SERVER_TOKEN"]; ROOT=os.environ["ROOT"]; ENV_ID=os.environ.get("ENV_ID","user-pc"); TS=int(time.time())

async def case(s,name,sandbox,prompt):
    print("=====",name); r=await s.call("thread/start",{"cwd":ROOT,"environments":[{"environmentId":ENV_ID,"cwd":ROOT}],"approvalPolicy":"never","sandbox":sandbox})
    if "error" in r: print("  thread/start ERROR:",r["error"]); return [],None
    cmds,final,notes=await s.turn(r["result"]["thread"]["id"],prompt,timeout=300)
    for c in cmds: print("  cmd:",json.dumps(c.get("command"))[:120],"| exit",c.get("exitCode"),"|",(c.get("aggregatedOutput") or "").replace("\n"," | ")[:160])
    for n in notes:
        if n[0]!="turn/completed": print("  note:",str(n)[:220])
    print("  final:",(final or "").replace("\n"," ")[:260]); return cmds,final

async def main():
    s=AppServerWs(URL,TOKEN); await s.start()
    r=await s.call("initialize",{"clientInfo":{"name":"probe-sandbox-image","title":"probe","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    print("initialize:",json.dumps(r.get("result",r))[:160])
    st=await s.call("environment/status",{"environmentId":ENV_ID}); print("environment/status:",st.get("result",st))
    f=os.path.join(ROOT,f"PROBE_SANDBOX_{TS}.txt")
    cmds,final=await case(s,"S1 workspace-write: write inside root","workspace-write",f"Run exactly `echo via-sandbox-image > PROBE_SANDBOX_{TS}.txt && cat PROBE_SANDBOX_{TS}.txt` and report verbatim.")
    print("  VERDICT S1 file written on the user machine:", os.path.exists(f) and open(f).read().strip()=="via-sandbox-image")
    out=f"{os.path.expanduser('~')}/probe-sandbox-outside-{TS}.txt"
    cmds,final=await case(s,"S2 danger-full-access: must be denied by the local ceiling","danger-full-access",f"Run exactly `touch {out} && echo touched`. Do not retry; report the error verbatim.")
    print("  VERDICT S2 denied by local ceiling:", (not os.path.exists(out)) and ("local ceiling" in (final or "")))
    for p in (f,out):
        try: os.remove(p)
        except FileNotFoundError: pass
    await s.close()
asyncio.run(main())
