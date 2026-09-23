"""Agent-side outbound bridge: keeps a control WS to the relay; for each {"open": id} dials relay /agent-data and local exec-server, pipes.
Run: .venv/bin/python agent_bridge.py ws://127.0.0.1:47100 user1 ws://127.0.0.1:47001
"""
import asyncio, json, sys
import websockets
RELAY,USER,LOCAL=sys.argv[1],sys.argv[2],sys.argv[3]

async def pipe(src,dst):
    try:
        async for msg in src: await dst.send(msg)
    except websockets.ConnectionClosed: pass
    finally:
        try: await dst.close()
        except Exception: pass

async def serve_conn(cid):
    async with websockets.connect(f"{RELAY}/agent-data?user={USER}&conn={cid}",max_size=None) as up, websockets.connect(LOCAL,max_size=None) as local:
        print(f"[agent] conn={cid} bridged to {LOCAL}",flush=True)
        await asyncio.gather(pipe(up,local),pipe(local,up))
    print(f"[agent] conn={cid} closed",flush=True)

async def main():
    while True:
        try:
            async with websockets.connect(f"{RELAY}/agent?user={USER}") as ctrl:
                print("[agent] control up",flush=True)
                async for msg in ctrl:
                    o=json.loads(msg)
                    if "open" in o: asyncio.create_task(serve_conn(o["open"]))
        except Exception as e: print("[agent] control error:",e,flush=True)
        await asyncio.sleep(1)
asyncio.run(main())
