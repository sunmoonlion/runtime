"""Dumb rendezvous relay for the passthrough probe.
Three outbound client kinds (all connect TO the relay; nothing connects to them):
  /agent?user=U            agent control channel (long-lived). Relay sends {"open": conn_id} when a sandbox wants a stream.
  /agent-data?user=U&conn=ID   agent data stream for one sandbox connection.
  /sandbox?user=U          sandbox stream; each is paired with a fresh agent data stream.
Pipes messages both ways (text/binary preserved). Logs per-JSON-RPC-request RTT observed at the relay
(request seen sandbox->agent, response with same id seen agent->sandbox) to measure how many round trips a tool call costs.
Run: .venv/bin/python relay_dumb.py [port]   (default 47100)
"""
import asyncio, json, sys, time, uuid
from urllib.parse import urlparse, parse_qs
import websockets
PORT=int(sys.argv[1]) if len(sys.argv)>1 else 47100
agents={}          # user -> control ws
waiting={}         # conn_id -> Future[agent data ws]
stats=[]           # (method, rtt_ms)

async def pipe(src,dst,tag,pending):
    try:
        async for msg in src:
            if isinstance(msg,str):
                try:
                    o=json.loads(msg)
                    if tag=="s->a" and "id" in o and "method" in o: pending[o["id"]]=(o["method"],time.perf_counter())
                    elif tag=="a->s" and "id" in o and "method" not in o and o["id"] in pending:
                        m,t=pending.pop(o["id"]); stats.append((m,(time.perf_counter()-t)*1000))
                except Exception: pass
            await dst.send(msg)
    except websockets.ConnectionClosed: pass
    finally:
        try: await dst.close()
        except Exception: pass

async def handler(ws):
    u=urlparse(ws.request.path); q=parse_qs(u.query); user=q.get("user",["?"])[0]
    if u.path=="/agent":
        agents[user]=ws; print(f"[relay] agent control up user={user}",flush=True)
        try: await ws.wait_closed()
        finally: agents.pop(user,None); print(f"[relay] agent control down user={user}",flush=True)
    elif u.path=="/agent-data":
        cid=q.get("conn",[""])[0]; fut=waiting.get(cid)
        if not fut: await ws.close(); return
        fut.set_result(ws); await ws.wait_closed()
    elif u.path=="/sandbox":
        ctrl=agents.get(user)
        if not ctrl: print(f"[relay] no agent for user={user}",flush=True); await ws.close(code=1011,reason="agent offline"); return
        cid=uuid.uuid4().hex[:8]; fut=asyncio.get_event_loop().create_future(); waiting[cid]=fut
        await ctrl.send(json.dumps({"open":cid}))
        try: agent_ws=await asyncio.wait_for(fut,10)
        except asyncio.TimeoutError: waiting.pop(cid,None); await ws.close(code=1011,reason="agent did not open"); return
        waiting.pop(cid,None); print(f"[relay] paired conn={cid}",flush=True); pending={}
        await asyncio.gather(pipe(ws,agent_ws,"s->a",pending),pipe(agent_ws,ws,"a->s",pending))
        print(f"[relay] closed conn={cid}",flush=True)
    else: await ws.close(code=1008)

async def main():
    async with websockets.serve(handler,"127.0.0.1",PORT,max_size=None,ping_interval=20):
        print(f"[relay] listening ws://127.0.0.1:{PORT}",flush=True)
        try: await asyncio.Future()
        finally: pass
try: asyncio.run(main())
except KeyboardInterrupt: pass
finally:
    by={}
    for m,r in stats: by.setdefault(m,[]).append(r)
    print("[relay] RTT per request method (count, median ms, max ms):",flush=True)
    for m,rs in sorted(by.items()): rs.sort(); print(f"  {m:30s} n={len(rs):4d} med={rs[len(rs)//2]:8.2f} max={rs[-1]:8.2f}",flush=True)
