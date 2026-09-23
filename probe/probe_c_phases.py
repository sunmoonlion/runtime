"""Probe C phases: A control (local env) · B write+approval via remote env · C disconnect mid-turn."""
import asyncio, json, os, re, subprocess, sys, time
PHASES=set(sys.argv[1:]) or {"A","B","C"}
USER_WS=os.path.expanduser("~/worktrees/fable/runtime/probe/user-ws"); CLOUD_WS=os.path.expanduser("~/worktrees/fable/runtime/probe/cloud-ws")
EXEC_URL="ws://127.0.0.1:47001"; ENV_ID="user-pc"; HOME=os.path.expanduser("~")

class AppServer:
    def __init__(self): self.proc=None; self.pending={}; self.nid=1; self.events=[]; self.reqs=[]
    async def start(self):
        self.proc=await asyncio.create_subprocess_exec("codex","app-server",stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,cwd=CLOUD_WS,env=dict(os.environ,PROBE_SIDE="app-server"))
        asyncio.create_task(self._reader())
    async def _reader(self):
        while True:
            line=await self.proc.stdout.readline()
            if not line: return
            try: msg=json.loads(line)
            except Exception: continue
            if "id" in msg and "method" in msg: self.reqs.append(msg); asyncio.create_task(self._srv(msg))
            elif "id" in msg:
                f=self.pending.pop(msg["id"],None); f and f.set_result(msg)
            else:
                self.events.append(msg)
                if msg.get("method")=="turn/completed": self.done.set()
    async def _srv(self,msg):
        p=msg.get("params",{}); print("  SERVER REQUEST:",msg["method"],json.dumps({k:p.get(k) for k in("environmentId","command","cwd","reason","kind")},ensure_ascii=False)[:300])
        await self._send({"jsonrpc":"2.0","id":msg["id"],"result":{"decision":"accept"} if "requestApproval" in msg["method"] else {}})
    async def _send(self,o): self.proc.stdin.write((json.dumps(o)+"\n").encode()); await self.proc.stdin.drain()
    async def call(self,m,p,timeout=60):
        i=self.nid; self.nid+=1; f=asyncio.get_event_loop().create_future(); self.pending[i]=f
        await self._send({"jsonrpc":"2.0","id":i,"method":m,"params":p}); return await asyncio.wait_for(f,timeout)
    async def notify(self,m,p): await self._send({"jsonrpc":"2.0","method":m,"params":p})
    async def turn(self,tid,text,timeout=240):
        self.done=asyncio.Event(); start=len(self.events)
        r=await self.call("turn/start",{"threadId":tid,"input":[{"type":"text","text":text}]})
        if "error" in r: print("  turn/start ERROR:",r["error"]); return [],None,[]
        try: await asyncio.wait_for(self.done.wait(),timeout)
        except asyncio.TimeoutError: print("  !! turn timeout")
        evs=self.events[start:]; cmds=[]; final=None; notes=[]
        for e in evs:
            m=e.get("method"); p=e.get("params",{})
            if m=="item/completed":
                it=p.get("item",{})
                if it.get("type")=="commandExecution": cmds.append(it)
                if it.get("type")=="agentMessage": final=it.get("text")
                if it.get("type")=="fileChange": notes.append(("fileChange",{k:it.get(k) for k in("status","changes")}))
            if m in("thread/environment/connected","thread/environment/disconnected","error","turn/completed"): notes.append((m,json.dumps(p)[:260]))
        return cmds,final,notes

def exec_server_pids():
    """pids of processes LISTENING on the exec-server port (never match by command line: it also matches our own shell)."""
    out=subprocess.run(["ss","-ltnp"],capture_output=True,text=True).stdout
    return sorted({int(m) for line in out.splitlines() if ":47001 " in line for m in re.findall(r"pid=(\d+)",line)})

async def main():
    s=AppServer(); await s.start()
    await s.call("initialize",{"clientInfo":{"name":"probe-c","title":"probe-c","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})
    if "A" in PHASES:
     print("===== A. control: default local environment, cwd=cloud-ws")
     r=await s.call("thread/start",{"cwd":CLOUD_WS,"approvalPolicy":"never","sandbox":"read-only"}); tid=r["result"]["thread"]["id"]
     cmds,final,notes=await s.turn(tid,"Run exactly `echo PROBE_SIDE=$PROBE_SIDE && pwd` and report the output verbatim.")
     out=" ".join(c.get("aggregatedOutput") or "" for c in cmds); print("  output:",out.replace("\n"," | ")[:200]); print("  VERDICT A: side =", "app-server" if "PROBE_SIDE=app-server" in out else ("exec-server" if "PROBE_SIDE=exec-server" in out else "?"))

    if "B" in PHASES:
     st=await s.call("environment/status",{"environmentId":ENV_ID}); print("  environment/status before B:",st.get("result",st))
     print("===== B. remote env, workspace-write + on-request: create file via apply_patch, then touch outside sandbox")
     outside=f"{HOME}/probe-outside-{int(time.time())}.txt"; target=os.path.join(USER_WS,"PROBE_WRITE.txt")
     r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"on-request","sandbox":"workspace-write"}); tid=r["result"]["thread"]["id"]
     cmds,final,notes=await s.turn(tid,f"Step 1: create a new file named PROBE_WRITE.txt in the current directory containing exactly the line `written-by-codex` (use apply_patch). Step 2: run exactly `touch {outside} && echo touched`. If the second step needs approval, request it. Report both results.")
     for n in notes: print("  note:",n)
     print("  server requests during B:",len([q for q in s.reqs if "requestApproval" in q["method"]]))
     print("  VERDICT B1 file in user-ws:", os.path.exists(target) and open(target).read().strip()=="written-by-codex")
     print("  VERDICT B2 outside file created after approval:", os.path.exists(outside))
     for f in (target,outside):
        try: os.remove(f)
        except FileNotFoundError: pass

    if "C" in PHASES:
     print("===== C. disconnect: kill exec-server mid-turn")
     r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":"read-only"}); tid=r["result"]["thread"]["id"]
     s.done=asyncio.Event(); start=len(s.events)
     await s.call("turn/start",{"threadId":tid,"input":[{"type":"text","text":"Run exactly `sleep 45 && echo slept` and report the output."}]})
     await asyncio.sleep(12); pids=exec_server_pids(); print("  killing exec-server pids:",pids)
     for p in pids: subprocess.run(["kill","-9",str(p)])
     try: await asyncio.wait_for(s.done.wait(),90)
     except asyncio.TimeoutError: print("  !! turn did not complete within 90s after kill")
     for e in s.events[start:]:
        m=e.get("method"); p=e.get("params",{})
        if m in("thread/environment/connected","thread/environment/disconnected","error","turn/completed") or (m=="item/completed" and p.get("item",{}).get("type")=="commandExecution"):
            print("  note:",m,json.dumps(p,ensure_ascii=False)[:300])
     r=await s.call("environment/status",{"environmentId":ENV_ID}); print("  environment/status after kill:",r.get("result",r))
    try: s.proc.stdin.close(); await asyncio.sleep(0.3); s.proc.kill()
    except Exception: pass
asyncio.run(main())
