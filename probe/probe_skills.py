"""Which skills does Codex see in a remote-environment thread? Three markers planted: project (.agents/skills under cwd on the user machine),
executor CODEX_HOME/skills (user machine), app-server CODEX_HOME/skills (sandbox)."""
import asyncio, json
from probe_common import AppServer, USER_WS, EXEC_URL, ENV_ID
async def main():
    s=AppServer(); await s.start()
    await s.call("initialize",{"clientInfo":{"name":"probe-skills","title":"p","version":"0.0.1"},"capabilities":{"experimentalApi":True}}); await s.notify("initialized",{})
    await s.call("environment/add",{"environmentId":ENV_ID,"execServerUrl":EXEC_URL})
    r=await s.call("thread/start",{"cwd":USER_WS,"environments":[{"environmentId":ENV_ID,"cwd":USER_WS}],"approvalPolicy":"never","sandbox":"read-only"})
    tid=r["result"]["thread"]["id"]
    cmds,final,notes=await s.turn(tid,"List every skill available to you right now: for each give its name and description verbatim. Do not run any commands; answer only from the skills you were given.",timeout=180)
    print("final:",(final or "")[:1200])
    for m in ("PROJECT_SKILL_MARKER","EXECUTOR_SKILL_MARKER","CLOUD_SKILL_MARKER"): print("  sees",m,":",m in (final or ""))
    print("commands run:",len(cmds))
    # also: what skills-related fs reads happened on the executor side?
    s.proc.terminate()
asyncio.run(main())
