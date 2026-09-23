"""Sandbox-side bridge: listens on a loopback port (execServerUrl points here); each incoming app-server connection is dialed
out to UPSTREAM (relay `/sandbox?user=U`, or the exec-server directly for the baseline) and piped.
Measures, per JSON-RPC request the app-server sends, the RTT until the matching response comes back, and prints a
per-method table on SIGTERM/SIGINT.  Run: .venv/bin/python sandbox_bridge.py 47002 ws://127.0.0.1:47100/sandbox?user=user1
"""
import asyncio, json, signal, sys, time
import websockets
PORT,UPSTREAM=int(sys.argv[1]),sys.argv[2]
stats=[]; counts={"requests":0,"notifications_up":0,"notifications_down":0,"requests_from_executor":0}

async def pipe(src,dst,tag,pending):
    try:
        async for msg in src:
            if isinstance(msg,str):
                try:
                    o=json.loads(msg)
                    if tag=="up":
                        if "id" in o and "method" in o: pending[o["id"]]=(o["method"],time.perf_counter()); counts["requests"]+=1
                        elif "method" in o: counts["notifications_up"]+=1
                    else:
                        if "id" in o and "method" not in o and o["id"] in pending:
                            m,t=pending.pop(o["id"]); stats.append((m,(time.perf_counter()-t)*1000))
                        elif "id" in o and "method" in o: counts["requests_from_executor"]+=1
                        elif "method" in o: counts["notifications_down"]+=1
                except Exception: pass
            await dst.send(msg)
    except websockets.ConnectionClosed: pass
    finally:
        try: await dst.close()
        except Exception: pass

async def handler(ws):
    print("[sandbox] app-server connected, dialing",UPSTREAM,flush=True); pending={}
    try:
        async with websockets.connect(UPSTREAM,max_size=None) as up:
            await asyncio.gather(pipe(ws,up,"up",pending),pipe(up,ws,"down",pending))
    except Exception as e: print("[sandbox] error:",e,flush=True)
    print("[sandbox] connection closed",flush=True)

def report():
    by={}
    for m,r in stats: by.setdefault(m,[]).append(r)
    print(f"[sandbox] upstream={UPSTREAM} counts={counts}",flush=True)
    print("[sandbox] RTT per request method (n, median ms, p90 ms, max ms):",flush=True)
    for m,rs in sorted(by.items()):
        rs.sort(); print(f"  {m:32s} n={len(rs):4d} med={rs[len(rs)//2]:8.2f} p90={rs[int(len(rs)*0.9)]:8.2f} max={rs[-1]:8.2f}",flush=True)

async def main():
    loop=asyncio.get_running_loop(); stop=asyncio.Event()
    for s in (signal.SIGTERM,signal.SIGINT): loop.add_signal_handler(s,stop.set)
    async with websockets.serve(handler,"127.0.0.1",PORT,max_size=None):
        print(f"[sandbox] listening ws://127.0.0.1:{PORT}",flush=True); await stop.wait()
    report()
asyncio.run(main())
