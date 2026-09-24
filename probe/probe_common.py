"""Shared probe harness: JSON-RPC client for `codex app-server` over stdio (copied from probe_c_phases.py, kept in sync by hand)."""
import asyncio, json, os, re, subprocess
_HERE=os.path.dirname(os.path.abspath(__file__))
USER_WS=os.path.join(_HERE,"user-ws"); CLOUD_WS=os.path.join(_HERE,"cloud-ws")
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



class AppServerWs(AppServer):
    """同一套 call/turn API，但 app-server 在别处以 ws://…:47800 监听（沙箱镜像），握手带 Authorization: Bearer <能力令牌>。
    需要 websockets（runtime/.venv）。"""
    def __init__(self, url, token):
        super().__init__(); self.url=url; self.token=token; self.ws=None
    async def start(self):
        import websockets
        self.ws=await websockets.connect(self.url,additional_headers={"Authorization":f"Bearer {self.token}"},max_size=None,ping_interval=20)
        asyncio.create_task(self._reader())
    async def _reader(self):
        async for line in self.ws:
            try: msg=json.loads(line)
            except Exception: continue
            if "id" in msg and "method" in msg: self.reqs.append(msg); asyncio.create_task(self._srv(msg))
            elif "id" in msg:
                f=self.pending.pop(msg["id"],None); f and f.set_result(msg)
            else:
                self.events.append(msg)
                if msg.get("method")=="turn/completed" and getattr(self,"done",None): self.done.set()
    async def _send(self,o): await self.ws.send(json.dumps(o))
    async def close(self):
        if self.ws: await self.ws.close()
