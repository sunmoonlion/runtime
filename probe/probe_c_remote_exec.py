"""Probe C: app-server (cloud role) drives a Codex turn whose commands execute on a remote exec-server (user-machine role).
Decisive signal: PROBE_SIDE env var differs between the two processes; the command output tells which side ran it."""
import asyncio, json, os, sys, time
USER_WS = os.path.expanduser("~/worktrees/fable/runtime/probe/user-ws")
CLOUD_WS = os.path.expanduser("~/worktrees/fable/runtime/probe/cloud-ws")
EXEC_URL = "ws://127.0.0.1:47001"
ENV_ID = "user-pc"
MARKER = open(os.path.join(USER_WS, "MARKER.txt")).read().strip()

class AppServer:
    def __init__(self):
        self.proc=None; self.pending={}; self.next_id=1; self.events=[]; self.server_requests=[]
    async def start(self):
        env=dict(os.environ, PROBE_SIDE="app-server")
        self.proc=await asyncio.create_subprocess_exec("codex","app-server",stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,cwd=CLOUD_WS,env=env)
        asyncio.create_task(self._reader()); asyncio.create_task(self._stderr())
    async def _stderr(self):
        while True:
            line=await self.proc.stderr.readline()
            if not line: return
            self.events.append(("stderr", line.decode(errors="replace").rstrip()))
    async def _reader(self):
        while True:
            line=await self.proc.stdout.readline()
            if not line: return
            try: msg=json.loads(line)
            except Exception: self.events.append(("raw", line.decode(errors="replace"))); continue
            if "id" in msg and "method" in msg:   # server -> client request
                self.server_requests.append(msg); asyncio.create_task(self._handle_server_request(msg))
            elif "id" in msg:
                fut=self.pending.pop(msg["id"],None)
                if fut: fut.set_result(msg)
            else:
                self.events.append(("notify", msg))
                if msg.get("method")=="turn/completed" and hasattr(self,"turn_done"): self.turn_done.set()
    async def _handle_server_request(self, msg):
        m=msg["method"]; p=msg.get("params",{})
        self.events.append(("server_request", {"method":m,"environmentId":p.get("environmentId"),"command":p.get("command"),"cwd":p.get("cwd"),"reason":p.get("reason")}))
        if "requestApproval" in m: resp={"decision":"accept"}
        else: resp={}
        await self._send({"jsonrpc":"2.0","id":msg["id"],"result":resp})
    async def _send(self, obj):
        self.proc.stdin.write((json.dumps(obj)+"\n").encode()); await self.proc.stdin.drain()
    async def call(self, method, params, timeout=60):
        i=self.next_id; self.next_id+=1
        fut=asyncio.get_event_loop().create_future(); self.pending[i]=fut
        await self._send({"jsonrpc":"2.0","id":i,"method":method,"params":params})
        return await asyncio.wait_for(fut, timeout)
    async def notify(self, method, params):
        await self._send({"jsonrpc":"2.0","method":method,"params":params})

async def main():
    s=AppServer(); await s.start()
    t0=time.time()
    r=await s.call("initialize",{"clientInfo":{"name":"probe-c","title":"probe-c","version":"0.0.1"},"capabilities":{"experimentalApi":True}})
    print("initialize:", json.dumps(r.get("result",r))[:200]); await s.notify("initialized",{})
    r=await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL}); print("environment/add:", r.get("result",r))
    r=await s.call("environment/info",{"environmentId":ENV_ID}); print("environment/info:", json.dumps(r.get("result",r))[:300])
    r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":"read-only"})
    if "error" in r: print("thread/start ERROR:", r["error"]); return
    thread=r["result"]["thread"]; tid=thread["id"]; print("thread/start: id", tid, "| environment fields:", {k:v for k,v in thread.items() if "nviron" in k or k in("cwd","runtimeWorkspaceRoots")})
    s.turn_done=asyncio.Event()
    prompt=("In the current working directory run exactly this shell command and report its full output verbatim: "
            "`echo PROBE_SIDE=$PROBE_SIDE && cat MARKER.txt && pwd && echo PARENT=$(tr '\\0' ' ' < /proc/$PPID/cmdline)`. Do not modify any file.")
    r=await s.call("turn/start",{"threadId":tid,"input":[{"type":"text","text":prompt}]}); print("turn/start:", json.dumps(r.get("result",r))[:200])
    try: await asyncio.wait_for(s.turn_done.wait(), 240)
    except asyncio.TimeoutError: print("!! turn did not complete in 240s")
    print(f"\n===== elapsed {time.time()-t0:.1f}s; server requests: {len(s.server_requests)}")
    cmds=[]; final=None
    for kind,e in s.events:
        if kind=="server_request": print("SERVER REQUEST:", e)
        if kind!="notify": continue
        m=e.get("method"); p=e.get("params",{})
        if m in("item/completed","item/started"):
            it=p.get("item",{})
            if it.get("type")=="commandExecution" and m=="item/completed":
                cmds.append(it); print("COMMAND ITEM:", json.dumps({k:it.get(k) for k in("command","cwd","environmentId","status","exitCode")},ensure_ascii=False)); print("   output:", (it.get("aggregatedOutput") or "")[:400].replace("\n"," | "))
            if it.get("type")=="agentMessage" and m=="item/completed": final=it.get("text")
        if m in("thread/environment/connected","thread/environment/disconnected","error","turn/completed"): print("NOTIFY:", m, json.dumps(p)[:300])
    print("\nFINAL ASSISTANT MESSAGE:", (final or "")[:600])
    out=" ".join((c.get("aggregatedOutput") or "") for c in cmds)
    print("\n===== VERDICT")
    print("PROBE_SIDE seen in command output:", "exec-server" if "PROBE_SIDE=exec-server" in out else ("app-server" if "PROBE_SIDE=app-server" in out else "NOT FOUND"))
    print("MARKER seen in command output:", MARKER in out)
    import re; m=re.search(r"PARENT=([^\n|]*)", out); print("PARENT cmdline of the shell that ran the command:", m.group(1)[:120] if m else "NOT FOUND")
    print("environmentId on command items:", sorted({str(c.get("environmentId")) for c in cmds}))
    for kind,e in s.events:
        if kind=="stderr" and ("error" in e.lower() or "environment" in e.lower()): print("STDERR:", e[:300])
    s.proc.stdin.close(); await asyncio.sleep(0.5); s.proc.kill()
asyncio.run(main())
