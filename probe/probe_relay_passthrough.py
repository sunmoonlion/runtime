"""Passthrough probe: app-server -> sandbox_bridge(47002) -> [relay(47100) -> agent_bridge] -> exec-server(47001).
Runs the same two turns whichever way 47002 is wired; the bridge prints RTT per JSON-RPC method on SIGTERM.
  R1 read-only: `echo hi`            R2 workspace-write: apply_patch + cat
Run: env CODEX_HOME=~/.codex-probe EXEC_URL=ws://127.0.0.1:47002 python3 -u probe_relay_passthrough.py
"""
import asyncio, json, os, time
from probe_common import AppServer, USER_WS, ENV_ID
EXEC_URL=os.environ.get("EXEC_URL","ws://127.0.0.1:47002"); TS=int(time.time())

async def main():
    s=AppServer(); await s.start()
    await s.call("initialize",{"clientInfo":{"name":"probe-relay","title":"probe-relay","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    print("environment/add:",(await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})).get("result"))
    t0=time.perf_counter(); st=await s.call("environment/status",{"environmentId":ENV_ID}); print("environment/status:",st.get("result",st),f"({(time.perf_counter()-t0)*1000:.0f} ms)")
    for name,sandbox,prompt in (
        ("R1 read-only echo","read-only","Run exactly `echo hi` and report the output verbatim."),
        ("R2 workspace-write apply_patch+cat","workspace-write",f"Use apply_patch to create PROBE_RELAY_{TS}.txt containing exactly `via-relay`, then run exactly `cat PROBE_RELAY_{TS}.txt`. Report verbatim.")):
        print("=====",name); t0=time.perf_counter()
        r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":sandbox})
        tid=r["result"]["thread"]["id"]; cmds,final,notes=await s.turn(tid,prompt)
        for c in cmds: print("  cmd:",json.dumps(c.get("command"))[:120],"| exit",c.get("exitCode"),"|",(c.get("aggregatedOutput") or "").replace("\n"," | ")[:100])
        for n in notes:
            if n[0]!="turn/completed": print("  note:",str(n)[:200])
        print("  final:",(final or "").replace("\n"," ")[:160]); print(f"  turn wall time: {time.perf_counter()-t0:.1f} s")
    f=os.path.join(USER_WS,f"PROBE_RELAY_{TS}.txt"); print("  VERDICT file written through the path:",os.path.exists(f))
    try: os.remove(f)
    except FileNotFoundError: pass
    s.proc.terminate()
asyncio.run(main())
