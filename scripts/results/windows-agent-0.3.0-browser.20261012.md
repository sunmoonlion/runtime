# 0.3.0 浏览器配对候选（交审前持续补证）

依据 `astra-028.md` §一第4条、§六及 SDD 0020。只本地提交，不发布、不改集群。

## 顺序与状态

| 单元 | 实现 | 实测状态 |
| --- | --- | --- |
| 权限确认窗补齐 | `1fdefe7`，通用显式显示、失败关闭、看门狗 | Windows confirm 实际可见与 Dispose 后43ms退出；详情见独立0.2.8回执 |
| P1 Node 页面 | 五个精确路径、Host/Origin/Referer、32字节nonce、内存投影、自启与上线等待 | Windows HTTP边界与模拟TLS流程单测已过；真实站点允许与在线待本轮隔离安装 |
| P2 入口/撤旧 | menu、开始菜单和托盘接 pair --page；撤 Show-Onboard/onboard-window 与进展文件 | Windows完整回归通过；新固定包隔离首次安装待执行 |
| P3 浏览器兜底 | 控制台/日志地址，托盘连接状态显示地址与码 | 单测故障注入通过；真实清空默认浏览器关联未做，不能记通过 |
| P4 文案/文档 | 中文、英文与0012引用0020；两个安装模板相同且无BOM | 网页235通过/2既有跳过，i18n706键、typecheck、lint通过；未发布 |

## 安全与维护

- 配对协议、轮询秘密、令牌保存和本机权限确认流程未改变。
- 页面状态只取event/user_code/expires_at/verify_url/status/message/account；不返任意扩展字段或异常栈。
- 配对进展不落盘。`pair-page.json` 只存受保护的PID和本机随机页地址，用于托盘兜底；Windows命名管道只作单实例锁，不接受指令。
- 浏览器页没有允许接口，POST不接受参数；刷新先取消旧一轮，再开始下一轮。启动失败重试已有配置，不重复领取令牌。
- 每个状态响应no-store/no-referrer，页面不引外链，CSP禁止嵌框；完成/取消/最长30分钟关端口。
- 原装0.2.7与真实私有配置不修改。真实配对由所有者亲手输码与允许，使用现有账号会让原令牌失效；所有者已选择使用现有账号。
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

真实站点批准→自启→在线、固定0.3.0包首次安装、托盘入口现场观察、P3清空默认浏览器关联、控制台是否闪出、重启登录、干净机器、可选UAC与命令权限GUI人工允许。
后续补证后更新本节和CHECKPOINT。不得自动批准、自动轮换原配置或把未做项写成通过。
