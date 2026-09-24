"""Tap: like sandbox_bridge (47002 -> 47001) but dumps the first full JSON of selected request methods to frames.jsonl."""
import asyncio, json, sys
import websockets
WANT={"fs/readFile":50,"fs/readDirectory":50,"fs/walk":50}
seen={}; out=open("frames.jsonl","a")
async def pipe(src,dst,tag):
    try:
        async for m in src:
            if isinstance(m,str):
                try:
                    o=json.loads(m); meth=o.get("method")
                    if tag=="up" and meth in WANT and seen.get(meth,0)<WANT[meth]:
                        seen[meth]=seen.get(meth,0)+1; out.write(json.dumps({"dir":tag,"frame":o})+"\n"); out.flush()
                    if tag=="down" and "id" in o and "method" not in o and o["id"] in RESP_WANT:
                        out.write(json.dumps({"dir":tag,"frame":o})+"\n"); out.flush(); RESP_WANT.discard(o["id"])
                    if tag=="up" and meth=="process/start" and "id" in o: RESP_WANT.add(o["id"])
                except Exception: pass
            await dst.send(m)
    except websockets.ConnectionClosed: pass
    finally:
        try: await dst.close()
        except Exception: pass
RESP_WANT=set()
async def handler(ws):
    async with websockets.connect("ws://127.0.0.1:47001",max_size=None) as up:
        await asyncio.gather(pipe(ws,up,"up"),pipe(up,ws,"down"))
async def main():
    async with websockets.serve(handler,"127.0.0.1",47002,max_size=None): await asyncio.Future()
asyncio.run(main())
