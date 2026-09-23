"""BYOK + 国产模型探针：app-server 用 Kimi（model_provider=kimi, wire_api=responses, key 在 CODEX_HOME/auth.json），
exec-server 在“用户机器”。问：国产 key 经 Codex 直连能不能跑通远端环境、工具调用、apply_patch、审批。
  K1 control  本地环境，echo PROBE_SIDE                      → 模型能对话、能调命令工具
  K2 remote   远端环境 workspace-write：apply_patch 建文件 + 跑命令 → 文件在 user-ws、命令在 exec-server 侧执行
  K3 approval 远端环境 on-request：写 cwd 之外              → 审批请求带 environmentId，accept 后执行
  每个 turn 记录 token 用量事件（厂商回报）。
Run: env CODEX_HOME=~/.codex-probe-kimi python3 -u probe_byok_kimi.py > byok-kimi.out  （exec-server 先在 47001 监听）
"""
import asyncio, json, os, time
from probe_common import AppServer, USER_WS, CLOUD_WS, EXEC_URL, ENV_ID, HOME
TS=int(time.time())

def usage(s, start):
    for e in s.events[start:]:
        if "tokenUsage" in e.get("method","") or "usage" in json.dumps(e.get("params",{}))[:200].lower():
            return json.dumps(e.get("params"))[:400]
    return None

async def case(s,name,thread_params,prompt,timeout=300):
    print(f"===== {name}"); start=len(s.events)
    r=await s.call("thread/start",thread_params)
    if "error" in r: print("  thread/start ERROR:",r["error"]); return [],None
    tid=r["result"]["thread"]["id"]
    cmds,final,notes=await s.turn(tid,prompt,timeout=timeout)
    for c in cmds: print("  cmd:",json.dumps(c.get("command"))[:150],"| exit",c.get("exitCode"),"|",(c.get("aggregatedOutput") or "").replace("\n"," | ")[:160])
    for n in notes: print("  note:",str(n)[:300])
    print("  final:",(final or "").replace("\n"," ")[:300])
    print("  usage:",usage(s,start))
    errs=[e for e in s.events[start:] if e.get("method")=="error"]
    for e in errs: print("  ERROR EVENT:",json.dumps(e.get("params"))[:300])
    return cmds,final

async def main():
    s=AppServer(); await s.start()
    r=await s.call("initialize",{"clientInfo":{"name":"probe-byok","title":"probe-byok","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    print("initialize:",json.dumps(r.get("result",r))[:200])
    print("environment/add:",(await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})).get("result"))

    cmds,final=await case(s,"K1 control: local env, Kimi",{"cwd":CLOUD_WS,"approvalPolicy":"never","sandbox":"read-only"},
        "Run exactly `echo PROBE_SIDE=$PROBE_SIDE && pwd` and report the output verbatim.")
    out=" ".join(c.get("aggregatedOutput") or "" for c in cmds)
    print("  VERDICT K1 model+tool call works:", "PROBE_SIDE=app-server" in out)

    target=os.path.join(USER_WS,f"PROBE_KIMI_{TS}.txt")
    cmds,final=await case(s,"K2 remote env, workspace-write, apply_patch + command",
        {"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":"workspace-write"},
        f"Step 1: use apply_patch to create a new file PROBE_KIMI_{TS}.txt in the current directory containing exactly the line `written-by-kimi`. Step 2: run exactly `echo PROBE_SIDE=$PROBE_SIDE && cat PROBE_KIMI_{TS}.txt`. Report both results verbatim.")
    out=" ".join(c.get("aggregatedOutput") or "" for c in cmds)
    print("  VERDICT K2a file written in user-ws via apply_patch:", os.path.exists(target) and open(target).read().strip()=="written-by-kimi")
    print("  VERDICT K2b command ran on exec-server side:", "PROBE_SIDE=exec-server" in out)

    outside=f"{HOME}/probe-kimi-outside-{TS}.txt"; nreq=len(s.reqs)
    cmds,final=await case(s,"K3 remote env, on-request, write outside cwd",
        {"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"on-request","sandbox":"workspace-write"},
        f"Run exactly `touch {outside} && echo touched`. If it needs approval, request approval. Report the result verbatim.")
    approvals=[q for q in s.reqs[nreq:] if "requestApproval" in q["method"]]
    print("  approval requests:",len(approvals),[q.get("params",{}).get("environmentId") for q in approvals])
    print("  VERDICT K3 approval carried environmentId and file created after accept:", bool(approvals) and os.path.exists(outside))
    for f in (target,outside):
        try: os.remove(f)
        except FileNotFoundError: pass
    s.proc.terminate()
asyncio.run(main())
