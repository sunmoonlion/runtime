# 0.3.0 浏览器配对候选（合成回执）

依据 `astra-028.md` §一第4条、§六及 SDD 0020。只本地提交，不发布、不改集群。

## 顺序与状态

| 单元 | 实现 | 实测状态 |
| --- | --- | --- |
| 权限确认窗补齐 | `1fdefe7`，通用显式显示、失败关闭、看门狗 | Windows confirm 实际可见与 Dispose 后43ms退出；详情见独立0.2.8回执 |
| P1 Node 页面 | 五个精确路径、Host/Origin/Referer、32字节nonce、内存投影、自启与上线等待 | Windows HTTP边界与模拟流程单测已过；所有者真实站点允许后页面与后台 connected，自启 Limited |
| P2 入口/撤旧 | menu、开始菜单和托盘接 pair --page；撤 Show-Onboard/onboard-window 与进展文件 | 同步安装模板完成固定包临时目录首次安装、开始菜单入口与托盘重开；未替换真实安装 |
| P3 浏览器兜底 | 控制台/日志地址，托盘连接状态显示地址与码 | Windows故障注入 open=false：隐藏启动连接状态窗可见、地址与测试码一致；真实清空默认浏览器关联未做，不能记通过 |
| P4 文案/文档 | 中文、英文与0012引用0020；两个安装模板相同且无BOM | 网页235通过/2既有跳过，i18n706键、typecheck、lint通过；未发布 |

## 安全与维护

- 配对协议、轮询秘密、令牌保存和本机权限确认流程未改变。
- 页面状态只取event/user_code/expires_at/verify_url/status/message/account；不返任意扩展字段或异常栈。
- 配对进展不落盘。`pair-page.json` 只存受保护的PID和本机随机页地址，用于托盘兜底；Windows命名管道只作单实例锁，不接受指令。
- 浏览器页没有允许接口，POST不接受参数；刷新先取消旧一轮，再开始下一轮。启动失败重试已有配置，不重复领取令牌。
- 每个状态响应no-store/no-referrer，页面不引外链，CSP禁止嵌框；完成/取消/最长30分钟关端口。
- 验收期间原装0.2.7与真实私有配置未改；验收后所有者另要求卸载0.2.7，正式卸载器完成并保留配置与日志。真实配对由所有者亲手输码与允许，使用现有账号会让原令牌失效；所有者已选择使用现有账号。
- 旧进展文件名仅在卸载兼容允许清单保留一版，不再生产。

## 回归原文与重跑

Windows测试工作目录：`C:\Users\zymun\sunmoon-probe-runs\windows-agent-030\test-source`。
Windows入口 `tests.mjs` 将固定源码复制到该隔离目录，复用已冻结Windows依赖；不改全局策略。

```text
Windows Vitest: Test Files 25 passed (25); Tests 258 passed (258)
Windows distribution: tests 48, pass 48, fail 0, skipped 0
tray disposal: exitCode=0, elapsedAfterDisposeMs=734, readyCleared=true
confirm disposal: exitCode=0, elapsedAfterDisposeMs=55, readyCleared=true
Web: Test Files 38 passed | 1 skipped (39); Tests 235 passed | 2 skipped (237)
```

原始日志：Windows `vitest.txt`、`distribution.txt`；Linux `/tmp/windows030-linux.txt`、`/tmp/windows030-distribution-linux.txt`。
最终固定包源码复跑与真实验收另补，不把此处早期源码测试等同于固定包验收。

```sh
cd ~/worktrees/luna/runtime/agent
npm run build
npm run typecheck
./node_modules/.bin/vitest run
node --test distribution/test/bundle.test.mjs distribution/test/processes.test.mjs distribution/test/watchdog.test.mjs
```

Windows在隔离测试目录用官方Node运行 `node_modules\vitest\vitest.mjs run`，再运行同三个distribution测试；需要原生链接夹具和测试沙箱家，变量见 `tests.mjs`。

### 本轮失败记录

网页首次受限环境：preview-server.test.ts 的beforeAll超时，原因如下；随后在允许本机监听的环境重跑全部通过。

```text
Error: listen EPERM: operation not permitted 127.0.0.1
Error: Hook timed out in 10000ms.
TypeError: Cannot read properties of undefined (reading 'close')
Tests 219 passed | 18 skipped (237); 1 failed suite
```

旧bundle测试仍期望退役的「连接我的账号」按钮，首次报 `AssertionError: 连接我的账号`；改为分别断言浏览器页文案、托盘菜单、公共表单保护和撤旧路径后通过。

## 待补/不宣称通过

P3真实清空默认浏览器关联、控制台闪出是否存在、重启登录、干净机器、可选UAC与命令权限GUI人工允许均未通过。
用户对闪出答「好像有，看不清」，不能写成无闪出。不得自动批准或把未做项写成通过。


## 固定交付目录与真实首次路径

| 项 | 值 |
| --- | --- |
| 生产源码 | runtime `834e4e9f76113de9ed8a7d4b4bd162949198f2e1` |
| 版本 | Agent0.3.0 / Node24.19.0 / Codex0.155.1；依赖锁未变 |
| 目录 | `C:\Users\zymun\sunmoon-probe-runs\windows-agent-030\candidate-834e4e9` |
| 文件 | 100；总大小501034516字节 |
| manifest SHA256 | `93a9f313afc160282b203ce2ee5cf0220f142e4fda77d4a449b342062846c047` |
| ZIP | 同级`candidate-834e4e9.zip`；175317161字节 |
| ZIP SHA256 | `225f34ebf69ab03ae33bea8cf0ca1e540b9b78dab615515e4b91ca4551e18990` |
| 同步文案 | web `6fc8bb4`；投资父仓 `3f69ef1`；k8s模板/SDD `8f11c7aa` |

最终源码Windows全量再次退出0。真实安装用同一个k8s模板，只替换已校验ZIP的下载地址为本机临时HTTP服务，版本/大小/ZIP/清单摘要固定；不上传、不改下载开关。APPDATA、LOCALAPPDATA、SUNMOON_AGENT_HOME均指向`windows-agent-030\isolated`。模板下载、校验、解压、install.mjs、开始菜单与menu整条执行，退出0；首次配对前config.json不存在。

```text
{"action":"installed","files":100,"bytes":501034516,"startsAgent":false,"registersLogonTask":false,"changesUserConfig":false,"needsAdministrator":false}
{"action":"pair-page","started":false}
已准备 SunMoon 代理 0.3.0（Codex 0.155.1）。请在自动打开的浏览器页面继续；已连接的电脑可使用托盘。
```

安装器诊断从WSL UNC当前目录调用.cmd，另有环境提示：

```text
CMD.EXE was started with the above path as the current directory.
UNC paths are not supported. Defaulting to Windows directory.
```

这不是安装失败；普通Windows终端目录不会是本次WSL UNC诊断目录。未改系统策略。

配对阶段：页面event=code、browser_opened=true、hasCode=true；错nonce404、跨Origin403、错误Host403。JSON键仅event/user_code/expires_at/verify_url/browser_opened；允许后仅event/status/message/account/browser_opened，无token/secret字段。no-store/no-referrer；代码与令牌均未进入本回执。

所有者原文：首次只看到登录页→本人登录、亲手输码允许→「已在线」。实际只读记录：

```text
2026-10-11T16:53:00.413Z event=result status=connected
2026-10-11T16:53:52.636Z agentVersion=0.3.0 running=true relayStatus=connected
resident PID47624; tray PID48724; pairing Node PID46452
SunMoonAgent-c67f74352fe8159c600d7d41 installed=true enabled=true runLevel=Limited
bundleUnchanged=true; original installed script/config hashes unchanged=true
```

这是UTC，对应本地2026-10-12 00:53。托盘重开所有者答「能打开核对页，好像有，看不清」；读数为一个pair --page节点进程、零个onboard进程，未复制一轮配对。

## P3 独立兜底夹具

`browser-fallback`：注入默认浏览器open=false，本机HTTP与连接状态窗使用真实Windows代码；进展是合成测试码，不连接账号，不进行批准。连接状态窗仍用windowsHide=true起PowerShell，通用Shown将其显示。原文：

```json
{"hasSyntheticCode":true,"hasLoopbackUrl":true,"visible":true,"exitCode":0,"browserLaunchFault":"injected open=false; default browser association unchanged","consoleUrlMatches":true,"portClosed":true}
```

实际清空用户默认浏览器关联未做。本轮没有改用户注册表或系统浏览器配置；故障注入不能代替卡P3指定的该项现场验收。请Fable审读此缺口，不把P3写成全部通过。

该诊断夹具首次截取desktop.ps1时留下未闭合的try，报ParserError MissingEndCurlyBrace，继而读取证据JSON报ENOENT；只修诊断脚本截取点后通过，未改安装文件。进程盘点首次把诊断PowerShell自身文本计作onboard，排除自身PID后复核：pairPageCount=1，oldOnboardCount=0。失败原文保留在本机诊断记录，不作为产品失败结论。

## 收尾与现场

所有者明确选择「卸载临时代理，暂时没有在线机器」。关闭配对页后端口关闭、定位文件删除；正式卸载器退出0，临时程序、后台PID47624、托盘PID48724与自启任务均移除。隔离config.json保持摘要不变，私有配置与本机日志保留用于核验；不进入Git。

首轮关闭页后状态复核误把NODE_EXTRA_CA_CERTS指向外部交付目录，使用已安装CLI时违反siteTrust的证书路径检查。`cleanup.json`里的`backgroundContinuedAfterPageClosed:false`是**无效的诊断读数**，不能据此判定后台死亡，也不把它更写为true。代码路径可复核，补独立Windows真实后台集成回归；日志此前最后一次relay connected后直到正式卸载才出现shutting down。此项回归结果另补。

临时卸载原文：

```text
uninstallExitCode=0 targetRemoved=true taskRemoved=true
pairProcessGone=true residentGone=true trayGone=true
isolatedConfigRetainedUnchanged=true protectedFilesUnchanged=true
```

随后所有者另明确「0.2.7没有用，删了」。全目录核验确定原装Agent0.2.7、源码d90cef3e9114c6a336758ceb9b8e3a46b9872e27，清单SHA256=14c456a1d748d38e768cd0df613fd141a6efc84205d7e5ae25b120bef969d94e，再用可信外部候选卸载器执行，保留私有配置与日志。

```text
2026-10-11T17:01:08.064Z
originalVersion=0.2.7 uninstallExitCode=0 targetRemoved=true
configRetainedUnchanged=true trayMarkerCleared=true
```

当前没有安装的在线代理；这是用户选定的收尾状态。`C:\Users\zymun\.sunmoon-agent`保留的旧令牌已被本次真实配对替换，不能在下次安装后承诺它自动在线；发布0.3.0后需重新配对。临时0.3.0的私有配置亦保留在隔离目录，不能上传或作为公开交付物。静态候选ZIP、回退包、测试脚本和证据保留在sunmoon-probe-runs，不进Git。

## Fable / Cursor 接手

1. 先审本轮runtime生产提交834e4e9与权限确认补充1fdefe7、k8s8f11c7aa、web6fc8bb4/父仓3f69ef1。最后收尾提交只补测试/证据，固定候选生产文件不改。
2. 浏览器配对主路径真实通过；P3关联清空、闪出、重启/干净机/UAC与GUI允许缺口按上文保留。不要把同机回归当成发布验收。
3. 审过后才按发布卡组包、verify/upload、改agent-releases版本并发布投资；当前没有改锁、推送、托管或集群。
4. 所有者再从网页复制安装命令走正式0.3.0路径；原0.2.7已卸载，旧配置保留但令牌失效。重新配对仍需真人操作，不能代点允许。
5. 两个安装模板已逐字节一致，无UTF-8 BOM；native/desktop.ps1保留BOM供PowerShell5.1正确显示中文。


## 最终补充回归（关闭页面后的保活）

新增windowsResident.test.ts用例。配对批准用合成注入，不冒充第二次真人批准；真实Windows后台、官方Codex、WebSocket会合点连接、页面HTTP与POST done均实际执行。关闭页面后等待1.2秒，再核对running=true、relay connected、PID/runId不变；最后只停该夹具后台并清理夹具。

```text
closing the browser pair page leaves the real Windows resident connected: PASS (15814ms)
{"browserPageClosed":true,"residentContinuedConnected":true}
Windows: Test Files 25 passed (25); Tests 259 passed (259)
Windows distribution: tests 48, pass 48, fail 0, skipped 0
Linux: Test Files 21 passed | 4 skipped (25); Tests 226 passed | 33 skipped (259)
Linux distribution: tests 48, pass 46, fail 0, skipped 2
```

此用例验证新增页面与真实后台的生命周期分离，不能冒称重新跑过现网真实配对。现网真实配对及在线证据仍以上文原始记录为准。生产候选834e4e9不变，本次收尾仅增加测试/记录。


最终只读盘点（2026-10-12收尾）：

```json
{"remainingAgentTasks":[],"remainingOwnedProcessCount":0}
```

范围为原始及本次隔离安装路径，不按进程名清理其它程序。若通知栏暂留旧图标，是已退出进程的图标缓存，鼠标掠过后通常消失；不是仍在线的代理。
