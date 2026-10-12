# 代理 0.4.0 段 1：服务流与文件只读，交远程审读

日期：2026-10-12。工作区：runtime `fable`。任务：`switch-test/inbox/astra/astra-032.md`（SDD 0022、账 87）。
输入：产品基线 `ef6f33f1a34f47d798e5a768a8374fab6c544e66`，含 0.3.2 托盘修复；实施前另有已回传的合同阻塞回执 `8954f86`。
修订合同：k8s `e1540e0d`，原始分段改 512 KiB、帧上限保持 1 MiB，5 MiB 分十段。
代码：`3cf569aa554cc4727ebcf4ba10d7149a57fefa94`（服务流与测试），`652393f85829c9274a52280edbca2df14ea9e514`（管道 UTF-8 连续解码与中文目录大回包验收）。

## 完成范围

- 控制 hello 声明 `service-v1`；`open.kind=service` 接独立 ServiceHandler，不接 exec-server。沙箱流计数与服务流计数分开；同时最多两条服务流，第三条关闭；控制连接断开取消服务流。
- JSON-RPC 2.0 仅开放 `service/hello` 和 `fs/readDirectory|getMetadata|readFile`。固定错误消息不含路径；未知方法不能调用进程、文件写入或内部助手方法。每流四并发、50/s 令牌桶；超限回 `-32013`。超过 1 MiB 的输入或二进制输入断流。
- 每个路径经规范化与白名单边界检查，保护代理配置、codex-home、auth.json 与 .sandbox-secrets。Windows 复用现有只读沙箱文件助手与目录/文件身份检查；助手增加私有的服务投影，不暴露写方法。
- 原始读取默认及上限 524288 字节，拒绝超过 64 MiB 的文件；目录最多 2000 项，必要时进一步按输出字节预算截断。回包仍在 1 MiB 内。
- 三处版本为 0.4.0，Codex 保持 0.155.1。没有新增依赖、改锁、发布、push 或改现装代理。
- 沙箱流原函数主体与基线逐字节相同；`filter.ts`、`windowsPolicy.ts`、`windowsBridge.ts`、`pair.ts` 逐字节相同。

**段 1 作者自检通过，交远程审读。段 2 尚未实施：settings/read|write、本地知识库目录、设置放宽确认和重启均未完成。** 不把本次结果写成整个 0.4.0 已完成。

## Linux 检查

原 node_modules 缺少锁文件已有的 smol-toml，首次 tsc 报 `TS2307: Cannot find module 'smol-toml'`。离线恢复既有依赖：`CI=true pnpm install --frozen-lockfile --offline` 退出 0（60 个包全部复用缓存，未下载、未改锁）。首次非交互 install 因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 停止，随后显式 CI 恢复。没有绕过证书或依赖哈希。

命令（agent 目录）：

```text
pnpm typecheck
exit=0
pnpm build
exit=0
pnpm exec vitest run test/service.test.ts test/relayClient.test.ts
Test Files  2 passed (2)
Tests       31 passed (31)
exit=0
pnpm test
Test Files  24 passed | 4 skipped (28)
Tests       258 passed | 33 skipped (291)
exit=0
node --test distribution/test/bundle.test.mjs distribution/test/processes.test.mjs distribution/test/watchdog.test.mjs
tests 48
pass 46
fail 0
skipped 2
exit=0
git diff --check
exit=0
```

全量与发行测试在 UTF-8 解码修正后重跑通过。平台跳过不算 Windows 通过，Windows 真机证据单列如下。完整控制台输出暂存 `/tmp/sunmoon-040-linux-tests-final2.log` 与 `/tmp/sunmoon-040-distribution-final.log`，这里保留原文总结。

新增单测覆盖：白名单外与 `..` 逃逸；受保护目录和敏感文件名；符号链接与硬链接；Windows 大小写和路径别名；64 MiB 限额；十段重组及 EOF；长度/偏移校验；目录截断；第 51 次调用限速；第 5 个未完成请求限流；未知/无效 JSON-RPC、通知；超大/二进制帧；第三条服务流关闭；缺 kind 仍走沙箱；控制断开取消服务流。日志断言只出现固定方法名与错误码。

## Windows 真机与真实会合点

Full Access 下使用 Windows 原生 Node、Codex 0.155.1，临时测试源码与夹具和现装代理隔离。测试脚本已入仓：`agent/test/service-windows-probe.mjs`。会合点加载固定 k8s 源码的真实 Relay.handler，运行在本机随机端口；只用无权限的探针专用静态令牌，未访问现网账户或模型。工作台脚本真实连接 `/service`，经 `open.kind=service` 配对到代理 `/agent-data`。

临时源码位于所有者约定的 sunmoon-probe-runs 下。本机候选 dist 58 个文件、native 5 个文件逐个与最终构建源码比对相同；不是用旧安装的 helper 冒充新实现。测试未安装候选、未改登录任务或现装账号配置。探针退出时关闭自己的服务流、执行器、助手和目录固定进程，移除自己的合成夹具与临时目录。

复跑方法：先 `pnpm build`；将 dist/native/package.json 与已核验的 Windows 运行依赖放进隔离源码 app，使用官方 node.exe 执行 `agent/test/service-windows-probe.mjs <隔离 app> <本机会合点 ws 地址>`。脚本只接受本机测试地址；先在本机起固定 k8s 会合点（测试用户 probe、agent/workbench 专用测试令牌）。不要换成现网账户的令牌。测试不打印读取路径或内容。

最终命令退出 0，原文输出：

```text
{"stage":1,"platform":"win32","agent":"0.4.0","codex":"0.155.1","sandbox":"unelevated","hello":true,"chinese_read":true,"metadata":true,"directory":true,"directory_limit":true,"utf8_directory_names":true,"segments":10,"reassembled":true,"max_response_bytes":699150,"protected_codex_denied":true,"outside_denied":true,"agent_home_denied":true,"not_found":true,"oversized_length_denied":true,"case_insensitive":true,"junction_denied":true,"hardlink_denied":true,"aliases_denied":true,"too_large_denied":true,"no_token_rejected":true,"sandbox_streams":0}
```

含义：中文文件名的文件读取/元数据/目录列表正常；5 MiB 合成文件十段重组字节相同、EOF 正确；最大 JSON 回包 699150 字节。真实目录联接逃逸、硬链接、ADS、设备/短名别名、超大文件、白名单外及用户 .codex/代理 home 的读取都拒绝；不存在路径返回 not_found。2001 个中文文件名的目录返回 2000 项且 truncated=true，管道跨块没有损坏中文。服务流的沙箱连接计数为零。

无令牌的真实 WebSocket hello 在 `/service` 被 reject。另按任务使用 Windows curl 无令牌直接 GET `/service`，得到：

```text
no-token HTTP /service: 426
exit=0
```

HTTP 426 只说明该路径拒绝普通 HTTP、需要 WebSocket Upgrade；鉴权证据是前述真正的 WebSocket hello 被 reject，不能用 HTTP 426 代替它。

现装代理检查仍为 0.3.1 / connected；没有覆盖它。原始 Windows 汇总暂存 `/tmp/sunmoon-040-windows-stage1-final2.log`。临时源码保留供复核；本次启动的回环会合点收尾关闭。

## 约束与盲区

| 规则 | 本次实现与验证 |
| --- | --- |
| C-T7、C-T8 | 服务连接仍由代理出站；只读/白名单语义在代理，会合点逐帧转发 |
| C-A11 | 新请求每次检查边界，固定助手没有远端进程/写文件方法；设置提权尚未实施 |
| C-C4、C-C8 | 与固定会合点真实联调；Codex 0.155.1 不变，原沙箱路径回归通过 |
| C-R7、C-R8 | 三处版本 0.4.0；未组正式发布包，未部署现网 |

已查：Linux 单测、真实 Windows 文件读取与边界、真实本机 Relay 配对及拒绝。没查：Windows elevated 模式、干净新电脑安装、现网服务流、真实网页文件树、设置写入/确认窗/重启。不能据本次回环联调宣称这些通过。

下一步：所有者回传本地提交，远程按段 1 审读；确认后实施段 2。旧合同阻塞回执保留不改，本节与修订 SDD 优先。

exit=0
