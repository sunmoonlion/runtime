# 032 乙案段 1：回环文件只读与本机访问票，交审

日期：2026-10-12。runtime `fable`，按重写的 `inbox/astra/astra-032.md` 与 SDD 0022 第三节实施。
基线：`9d96980054c23d9e1c2f6f1b7514b6437b43fdac`（已过审的服务流段 1）。
本段代码：`35d7964b329376a2d30f1b17c1c0ace3a283e7e8`。版本仍为 0.4.0，Codex 0.155.1，无新依赖。

## 实现范围

原 presence 监听扩到 `localApi.ts`，47811 → 47812；`presence.ts` 保留原导出，复用同一个监听器和同秒 20 次限速。
`/presence` 仍是四字段、不要票；`/local/v1/*` 的业务请求必须通过精确 Origin 和本机票验证。
预检免票，允许 GET, POST, PUT、Authorization, Content-Type，带 Private-Network，始终不发 credentials。

`ticket.ts` 使用 Node crypto 验 ES256/P-256，按 kid 从固定站点 `{webOrigin}/api/workbench/token-keys` 的公钥集合取钥；缓存十分钟，合并并发拉取，限制 JWKS 大小，取不到返回 503 keys_unavailable。校验 aud=local-agent、sub=config.userId、exp、iss、iat 与最长十分钟票期；取钥后再核到期，拒绝坏签名、未知 kid 和非 ES256。JWT 内的 jku 等不参与选址。不转发访问票给取钥接口。

`GET /local/v1/info`、`fs/dir`、`fs/meta`、`fs/file` 已实现。文件路径每次过白名单和受保护目录检查；Windows 用现有只读沙箱文件助手，Linux 文件实现仅用于测试。原始字节一次默认/最多 1 MiB，文件 >64 MiB 返回 413；目录最多 2000 项。文件响应为 application/octet-stream，带 X-File-Size/Mtime/Eof，并用 Access-Control-Expose-Headers 让浏览器能读三个头。错误为固定 JSON，不带路径、内容或票。

已过审的 `service.ts`、`relayClient.ts`、`relayProtocol.ts`，以及 `filter.ts`、`windowsPolicy.ts`、`windowsBridge.ts`、`pair.ts` 与基线逐字节相同。文件助手只增加私有 local/readFile 投影；原 service/readFile 上限仍为 512 KiB。

**段 1 作者自检与所有者允许的自签票通路通过，交远程审读；现网发票和真实网页文件树仍待发布后验收。段 2 settings/read|write、libraryDir、设置确认和重启尚未实施。** 没有 push、发布、改现装代理或同步脚本。

## Linux 检查

在 agent 目录用锁定 pnpm 执行。首次从外层目录执行 pnpm --dir 遇到 Corepack 选中 12.0.0，与项目固定 10.24.0 不符；该次退出 1，没有修改 packageManager 或绕过版本检查，随后在 agent 目录正常执行。

```text
pnpm typecheck
exit=0
pnpm build
exit=0
pnpm test
Test Files  26 passed | 4 skipped (30)
Tests       274 passed | 33 skipped (307)
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

新增 ticket/localApi 用例覆盖本地产生的 P-256 钥对与真实假 JWKS HTTP 服务器；无票、错 sub/aud、过期、坏签名、未知 kid、错 alg、取不到公钥；缓存与并发取钥、取钥期间过期；错/缺 Origin 无 CORS；预检全部头；presence 不取钥；路径逃逸、符号链接、硬链接、64 MiB 限额、1 MiB 分段原文重组、EOF、目录截断、共享第 21 次请求 429；日志只含固定类别/错误码。

33 项平台跳过与发行测试 2 项跳过不冒充 Windows 通过。完整 Linux 输出暂存 `/tmp/sunmoon-040-local-linux-final.log` 和 `/tmp/sunmoon-040-local-distribution-final.log`；这里保存原文总结。

## Windows 原生与隔离 Edge

按所有者最新提醒，后端新发票端点未发布，本次采用**自签票 + 本地 JWKS**验证通路，没有取得或使用现网站点的 local-ticket。生产 CLI 没有添加 JWKS 改址或自签票开关；只在测试脚本的注入接口中将固定站点的取钥请求送往本机假 JWKS。

Windows 原生官方 Node、Codex 0.155.1 unelevated 与现有 WindowsFiles 沙箱助手；所有读取均为自己的合成夹具。目录/文件路径、内容、票、私钥不打印或进 Git。测试源码和依赖放在所有者约定的 sunmoon-probe-runs 隔离目录，未安装或改登录任务。

第一轮按固定端口试运行，因 47811 和 47812 均已被非本探针进程占用，监听返回 null，assert(api) 失败、退出 1。只读检查见 47811 的拥有者是 Cursor.exe、47812 是 node.exe，均非本探针；没有终止它们。接着用已有的端口测试接口选随机回环端口重跑；正式 CLI 的固定端口与占用时报告不可用的行为不变，回退/双占用继续由 presence 单测覆盖。

脚本已入仓：`agent/test/local-api-windows-probe.mjs`、`agent/test/local-browser-probe.mjs`。
重跑：先 pnpm build，准备隔离 app 的 dist/native/package.json 与已核验的 Windows 运行依赖，再用官方 node.exe 执行 `local-api-windows-probe.mjs <隔离 app> --browser`。浏览器脚本用全新的 Edge 配置，打开站点的公开 JWKS 页面以取得真实站点 Origin，不读所有者的 Cookie。测试 profile 的 local-network-access 权限仅为本次授予，未禁用 CORS、TLS 或浏览器安全；退出关闭自己的浏览器并清理该 profile。不是冒充生产票或真人文件树。

最终退出 0，原文输出：

```text
{"stage":"local-1","platform":"win32","agent":"0.4.0","codex":"0.155.1","sandbox":"unelevated","port":49710,"jwks":"local-self-signed","presence_without_ticket":true,"missing_ticket_401":true,"missing_origin_403":true,"wrong_origin_no_cors":true,"invalid_tickets_401":true,"preflight":true,"chinese_read":true,"metadata":true,"directory":true,"raw_segments":5,"reassembled":true,"file_headers":true,"directory_limit":true,"junction_denied":true,"hardlink_denied":true,"aliases_denied":true,"too_large_413":true,"oversized_length_400":true,"not_found_404":true,"jwks_requests":1,"ticket_sent_to_jwks":false,"production_ticket":false,"edge_cross_origin_read":true,"edge_metadata_headers":true,"isolated_profile":true,"test_profile_local_network_permission":"granted-for-test"}
```

含义：中文文件原文、元数据和目录正常；5 MiB 分五个 1 MiB 原始字节响应重组相同；受保护的用户 .codex/代理 home、白名单外、目录联接、硬链接和设备/短名/ADS 别名拒绝；大文件 413、长度超限 400、缺失文件 404；2001 个中文目录项截断到 2000 且编码正确。缺票 401、缺 Origin 403、错 Origin 不带 CORS，错票均 401。假 JWKS 请求一次、未收到 Authorization。Edge 在真实站点 Origin 下带自签票跨源取本机文件成功，能读三个响应头，未向云端发送内容。

隔离候选 dist 64 文件、native 5 文件与本次构建源码逐个相同。Windows 汇总暂存 `/tmp/sunmoon-040-local-edge.log`，前两次记录保留在 `/tmp/sunmoon-040-local-windows.log` 与 `/tmp/sunmoon-040-local-windows-random-port.log`。测试退出已关闭自己的监听、钥服务器、执行器和助手，清理合成文件、沙箱临时目录与临时浏览器配置；隔离源码保留供复核。

## 约束与未验项

| 规则 | 本次结论 |
| --- | --- |
| C-I5、C-I7 | 本机每次复核 Origin、ES256 票的用户与 audience，不接受票中的外部取钥地址 |
| C-A11 | 路径每次检查，文件只读沙箱，不提供任意进程/用户文件写入 |
| C-C8 | Codex 0.155.1 钉版不变，已过审服务流与原沙箱代码保留 |

已查：Linux 单测、Windows 原生沙箱助手、真实隔离 Edge 跨源读取、自签票/本地 JWKS 通路。
没查：生产站点 local-ticket 签发→本机验证、现网真实文件树、干净新电脑安装、Chrome、elevated、段 2 设置确认与重启。现网未发布不是通过的证据，也没有读登录凭据绕过发票。

下一步所有者同步本地提交，由远程审读本段；发布后补生产票与网页文件树。段 1 的停点确认后再做段 2 设置。旧服务流回执保留不改。

exit=0
