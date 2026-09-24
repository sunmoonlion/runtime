"""Local-ceiling probe (D5): can the executor side (exec-server, the user's machine) cap what the orchestrator
(app-server, our cloud) demands?  Cases:
  L0  environment/info capabilities
  L1  orchestrator asks danger-full-access -> write OUTSIDE cwd (in $HOME). Executor config says read-only.
  L2  orchestrator asks workspace-write     -> write OUTSIDE cwd.  Expect sandbox denial.
  L3  orchestrator asks workspace-write     -> write INSIDE cwd.   Executor requirements.toml allows only read-only.
  L4  orchestrator sets cwd outside the declared runtimeWorkspaceRoots -> run pwd/ls. Does executor refuse the root?
Run:  env CODEX_HOME=~/.codex-probe python3 -u probe_local_ceiling.py > ceiling.out   (exec-server must already listen on 47001
      with CODEX_HOME=~/.codex-probe-exec).  Env: CASES=L2,L3 to select cases; WIN=1 (auto on Windows) switches to PowerShell commands.
"""
import asyncio, json, os, sys, time
_HERE=os.path.dirname(os.path.abspath(__file__))
USER_WS=os.path.join(_HERE,"user-ws"); CLOUD_WS=os.path.join(_HERE,"cloud-ws")
EXEC_URL=os.environ.get("EXEC_URL","ws://127.0.0.1:47001"); ENV_ID="user-pc"; HOME=os.path.expanduser("~")
import re, subprocess
class AppServer:
    def __init__(self): self.proc=None; self.pending={}; self.nid=1; self.events=[]; self.reqs=[]
    async def start(self):
        # Windows npm installs a .cmd/.ps1 shim, which CreateProcess cannot launch
        # directly. The PowerShell runner resolves the package's public bin entry.
        command=json.loads(os.environ.get("CODEX_COMMAND_JSON", '["codex"]'))
        if not isinstance(command,list) or not command or not all(isinstance(v,str) and v for v in command):
            raise ValueError("CODEX_COMMAND_JSON must be a nonempty array of command arguments")
        self.proc=await asyncio.create_subprocess_exec(*command,"app-server",stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=None,cwd=CLOUD_WS,env=dict(os.environ,PROBE_SIDE="app-server"))
        asyncio.create_task(self._reader())
    async def close(self):
        if self.proc is None or self.proc.returncode is not None: return
        if os.name=="nt":
            # node launches the native Codex child; stop only this owned tree.
            await asyncio.to_thread(subprocess.run,["taskkill","/PID",str(self.proc.pid),"/T","/F"],stdout=subprocess.DEVNULL,stderr=subprocess.STDOUT)
        else: self.proc.terminate()
        try: await asyncio.wait_for(self.proc.wait(),5)
        except asyncio.TimeoutError:
            self.proc.kill(); await self.proc.wait()
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

TS=int(time.time()); WIN=os.name=="nt" or os.environ.get("WIN")=="1"
OUT_ROOT=os.path.join(os.environ.get("TEMP",r"C:\\Temp"),"probe-outside-root") if WIN else "/tmp/probe-outside-root"
CASES=set(os.environ.get("CASES","L1,L2,L3,L4").split(","))
def touch_cmd(path,tag):   # Windows exec-server runs PowerShell: no `touch`
    return (f"New-Item -ItemType File -Path '{path}' -Force | Out-Null; echo {tag}" if WIN else f"touch {path} && echo {tag}")
def write_cmd(name):
    return (f"Set-Content -Path '{name}' -Value 'L3'; Get-Content '{name}'" if WIN else f"echo L3 > {name} && cat {name}")
def ls_cmd(): return "Get-Location; Get-ChildItem" if WIN else "pwd && ls -la"

async def run_case(s, name, sandbox, cwd, prompt, roots=None):
    print(f"===== {name}: sandbox={sandbox} cwd={cwd}")
    env={"environmentId":ENV_ID,"cwd":cwd}
    if roots is not None: env["runtimeWorkspaceRoots"]=roots
    r=await s.call("thread/start",{"cwd":cwd,"environments":[env],"approvalPolicy":"never","sandbox":sandbox})
    if "error" in r: print("  thread/start ERROR:",r["error"]); return [],None,[]
    tid=r["result"]["thread"]["id"]
    cmds,final,notes=await s.turn(tid,prompt)
    for c in cmds: print("  cmd:",json.dumps(c.get("command"))[:160],"| exit",c.get("exitCode"),"| status",c.get("status"),"|",(c.get("aggregatedOutput") or "").replace("\n"," | ")[:200])
    for n in notes: print("  note:",n)
    print("  final:",(final or "").replace("\n"," ")[:300])
    return cmds,final,notes

async def main():
    s=AppServer()
    try:
        await s.start()
        await s.call("initialize",{"clientInfo":{"name":"probe-ceiling","title":"probe-ceiling","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
        print("environment/add:",(await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})).get("result"))
        info=await s.call("environment/info",{"environmentId":ENV_ID}); print("L0 environment/info:",json.dumps(info.get("result",info))[:600])

        l1=os.path.join(HOME,f"probe-ceiling-L1-{TS}.txt"); l2=os.path.join(HOME,f"probe-ceiling-L2-{TS}.txt"); l3=os.path.join(USER_WS,f"PROBE_L3_{TS}.txt")
        if "L1" in CASES:
            await run_case(s,"L1 danger-full-access, write outside cwd","danger-full-access",USER_WS,
                f"Run exactly this single command and report its output verbatim, do not ask for approval: `{touch_cmd(l1,'L1-touched')}`")
            print("  VERDICT L1 (file outside cwd created although executor config says read-only):", os.path.exists(l1))
        if "L2" in CASES:
            await run_case(s,"L2 workspace-write, write outside cwd","workspace-write",USER_WS,
                f"Run exactly this single command once and report the result verbatim (if it fails, just report the error, do not retry, do not ask for approval): `{touch_cmd(l2,'L2-touched')}`")
            print("  VERDICT L2 (outside write blocked by sandbox):", not os.path.exists(l2))
        if "L3" in CASES:
            await run_case(s,"L3 workspace-write, write inside cwd (executor requirements say read-only only)","workspace-write",USER_WS,
                f"Run exactly this single command once and report the result verbatim (if it fails, just report the error, do not retry): `{write_cmd(f'PROBE_L3_{TS}.txt')}`")
            print("  VERDICT L3 (inside write succeeded despite executor requirements.toml read-only):", os.path.exists(l3))
        if "L4" in CASES:
            os.makedirs(OUT_ROOT,exist_ok=True)
            await run_case(s,"L4 read-only, cwd outside declared roots","read-only",OUT_ROOT,
                f"Run exactly `{ls_cmd()}` and report the output verbatim.",roots=[USER_WS])
        for f in (l1,l2,l3):
            try: os.remove(f)
            except FileNotFoundError: pass
    finally:
        await s.close()
if __name__ == "__main__":
    asyncio.run(main())
