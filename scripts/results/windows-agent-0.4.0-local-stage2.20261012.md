# 032 乙案段 2 回执：本机设置、只读知识库与重启（2026-10-12）

runtime / fable，代码提交 `f002ab5346bb3e007c9de0339b960aeacb287a73`。上段已过审代码 `35d7964b329376a2d30f1b17c1c0ace3a283e7e8`，本轮起点 `5403c06e4960258d63b025c2608ed45d68ad838e`；批准保留的服务流基线 `9d96980054c23d9e1c2f6f1b7514b6437b43fdac`。输入为 k8s `2c7a2f9dbbb909a45611ef34c584b73de9881591` 的 inbox/astra/astra-032.md 与 SDD 0022 第三、四节，包含本轮新增的五个候选口和未知 kid 换钥两行。只本地提交，供所有者回传、远程审读。

## 做了什么

- 固定回环口依序试 47811、47812、47813、47814、47815，五个占用才放弃。presence、Origin、20/s 限速和预检沿用段 1。
- GET/PUT `/local/v1/settings` 验同一张 ES256 本机票。读投影含 machineName、roots、rootChoices、ceiling、autostart、libraryDir、version、lastSettingsChange，不含令牌。GET 读 config.json，和托盘读同一份；PUT 仅接受合同列出的五个可写字段。
- 托盘与回环 PUT 共用 preferences 校验：目录存在、绝对路径、最多 32、选中项为候选项的子集、无重复或目录别名；沙箱限 read-only/workspace-write，网络值为 boolean。错误回 400 invalid，错误正文不含输入或路径。
- 新增 roots、提高 sandbox、打开 network、新设/更换 libraryDir、打开 autostart 合成一次本机确认。后台 windowsConfirm、前台 localConfirm；新随机码、60 秒。拒绝/超时/断线回 409 local_denied，第二个写回 409 busy。确认后再次校验，检测本地同时修改的配置，避免覆盖。
- 配置用同目录临时文件原子替换，保留原账号、令牌及其它配置字段，写 lastSettingsChange。自启沿用已有当前用户登录任务；拒绝时不触碰任务，提交前失败时回滚任务变更。先返回 `{ applied: true, restart: true }`，响应 finish 后调用隔离的本机生命周期子进程，沿用 stop-request 和 startResident 正常重启，hello 重报 roots/ceiling。
- libraryDir 可空，配置 validate 检查本地绝对路径且存在。Windows 起动时检查/钉住目录；只传入回环文件助手的读取白名单，不加入 exec-server/relay 的可写 roots。info 带 libraryDir、lastSettingsChange。托盘设置增加只读知识库字段、选目录与清空按钮。
- 未知 kid 且距上次取钥尝试超过 60 秒，重取站点固定 JWKS 再判；并发共用一个取钥请求，失败尝试也计入节流，原十分钟缓存与 ES256 验签不变。无 JWKS 地址覆盖开关，无新依赖。

filter.ts、windowsPolicy.ts、windowsBridge.ts、已审 service.ts/relayClient.ts、helper.mjs、配对与既有 relay 令牌处理代码、锁文件字节不变。版本三处仍 0.4.0，Codex 0.155.1。未修改其它仓、同步脚本、现装代理或站点。

| 对照规则 | 本轮结论 |
| --- | --- |
| C-A11 本地上限；C-I9 精确用户绑定 | 放宽必须真人在本机确认；知识库单独只读；票 sub 精确绑定当前用户 |
| C-C4 双端合同 | runtime HTTP 合同测试通过；只读核对网页 03575c7ce91b72d348aefa3d177dc2491290d775 的五口、DTO、PUT 字段和回包相符。网页测试/现网 UI 未跑，见待验 |
| C-T5 / C-R7 / C-R8 | 本回执列明仓与完整代码提交；版本不另加新版本、不发布 |

## Linux 原文总结

在 agent 目录使用锁定 pnpm 10.24.0：`pnpm typecheck`、`pnpm build` 均退出 0；`pnpm test` 最终原文：

```text

 Test Files  28 passed | 4 skipped (32)
      Tests  308 passed | 33 skipped (341)
   Start at  20:10:31
   Duration  6.41s (transform 1.78s, setup 0ms, collect 4.69s, tests 9.08s, environment 6ms, prepare 2.35s)
```

新增 settings 25 项（含五种放宽、六种收窄、合成窗、拒绝字节不变、busy、60 秒超时、断线、目录失效、并发本地修改、登录任务回滚、落盘失败、非法输入、当前磁盘投影、知识库只读集合）与 HTTP 7 项；ticket 增加换钥边界、并发和失败节流。presence 测五个候选依序尝试与全占用；所有平台跳过明确保留。

`node --test distribution/test/bundle.test.mjs distribution/test/processes.test.mjs distribution/test/watchdog.test.mjs` 原文：

```text
ℹ tests 48
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 594.752187
```

完整输出在临时日志 sunmoon-stage2-linux-final2.log、sunmoon-stage2-settings-final.log、sunmoon-stage2-distribution-final.log，回执不复制含文件路径的行。

## Windows 真机：自签票 + 本地 HTTPS JWKS + 隔离源码

用官方 Windows Node 24.19.0、Codex 0.155.1 unelevated 与现有沙箱文件助手。测试配置、测试 relay、测试文件和 HTTPS 钥服务器均为隔离夹具。独立站点文件钉住本地 HTTPS JWKS；CLI 仍走实际固定 `web_origin/api/workbench/token-keys` 与正常 bundled-ca 证书校验，未禁用 TLS、未增加生产 JWKS 覆盖开关。**本轮用本地 P-256 自签票，不是现网票，也没有在网页「我的电脑」完成发布后联调。**

最后源码原生回归原文（源码 dist 68 文件、native 5 文件与隔离副本逐个相同）：

```json
{"event":"waiting_61_seconds_for_rotation_throttle"}
{"platform":"win32","version":"0.4.0","codex":"0.155.1","jwks":"local-self-signed-https","production_ticket":false,"interactive":false,"fixed_port":47813,"settings_projection":true,"library_read_only_roots":true,"library_write_denied":true,"narrow_root_restart":true,"hello_roots_after_restart":true,"clear_library_restart":true,"rotated_kid_after_60_seconds":true,"ticket_sent_to_jwks":false,"ok":true,"resident_stopped":true,"fixture_cleaned":true}
```

验证实际落到 47813；GET settings 公共投影；独立知识库原字节读取；控制数据通道 fs/writeFile 写知识库被 -32001 拒绝、文件未出现；删 roots / 清空 libraryDir 的 PUT 先收到成功回包，再观察不同 resident PID 与新 hello；清空后读取为 403；换 P-256 钥后 60 秒以内拒未知 kid，61 秒后实际重取一次成功，取钥请求不含票。

### 所有者亲手操作确认窗

所有者在本会话回答「现在可以，开始弹窗」。隔离后台代理收到添加测试目录与知识库的 PUT，弹一个合成窗，只有所有者输入窗内码并点击允许后才写入；新进程 hello roots 含新增目录而不含独立知识库。随后提高写上限再次弹窗；所有者补答「点了‘拒绝’」，HTTP 返回 409 local_denied，config.json 字节相同，PID 相同。去掉新增目录/清空知识库不弹窗，正常重启。

原文完整保留（**前面的确认/重启断言通过；该次探针的后置换钥断言失败，不把整个运行写成全过**）：

```json
{"event":"owner_allow_window_next","stage":"add-directory-and-library"}
{"event":"owner_deny_window_next","stage":"raise-sandbox"}
{"platform":"win32","version":"0.4.0","codex":"0.155.1","jwks":"local-self-signed-https","production_ticket":false,"interactive":true,"fixed_port":47813,"settings_projection":true,"library_read_only_roots":true,"library_write_denied":true,"narrow_root_restart":true,"hello_roots_after_restart":true,"clear_library_restart":true,"owner_allow":true,"tray_preferences_same_config":true,"owner_deny_config_identical":true,"remove_without_prompt":true,"ok":false,"failure_phase":"unknown-kid-rotation","error":"AssertionError","resident_stopped":true,"fixture_cleaned":true}
```

失败原因是探针在最后一次重启后未先装载钥缓存，错误期待新进程首次拿新钥要 401；已修正探针先用旧钥发 info 请求装载缓存，然后单独完整复跑上述原生回归通过。生产 ticket.ts 没有为探针改行为，真人允许/拒绝证据不由自动脚本代答。

设置窗另外实际打开，执行与原生托盘相同的 Show-Preferences 函数；测试仅加只读观察与自动关闭，不保存或批准。核对勾选项、两个候选、知识库字段当前值、只读文本框、选目录/清空/保存按钮，配置字节未变：

```json
{"clear_button":true,"library_readonly":true,"selected_root_matches":true,"library_value_matches":true,"ok":true,"save_button":true,"choices_count":2,"window_visible":true,"pick_button":true,"library_field_present":true,"config_identical":true,"production_tray_unmodified":true}
```

这是单独合成配置的窗口检查；真人批准后的配置则用同一个 preferences show 确认，不冒认所有者从正式托盘手工看过新增行。

### Windows 发行检查原文

```text
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3244.7156
```

48/48，包含真实 tray 和 confirm 窗 Dispose 后退出及就绪标记清理，没有自动批准确认窗。

## 失败记录（不隐去）

1. 首个原生探针漏把测试 relayUrl 写入合成配置，起动后的 relay 不连测试服务器，退出 1；已补配置，不改产品行为。原文：

```json
{"platform":"win32","version":"0.4.0","codex":"0.155.1","jwks":"local-self-signed-https","production_ticket":false,"interactive":false,"ok":false,"failure_phase":"start","error":"Error","resident_stopped":true,"fixture_cleaned":true}
```

2. 真人探针后置换钥断言的夹具错误，完整原文在上面；确认与重启断言已通过，换钥已修正并单独复跑通过。
3. 窗口观察脚本首两次在无控制台的 PowerShell 里直接设置 Console 编码，退出 1；沿用产品的编码 try/catch 并保留 UTF-8 BOM 后通过，只改观察脚本。首轮原文：

```json
{"ok":false,"error":"Error","reason":"gui_exit_failed"}
```

4. Windows 发行首轮隔离目录没带 source/pairPage.ts 与 k8s 安装模板，46 通过、2 夹具缺文件失败；复制原始 source 与当前 k8s 模板，使用测试已有 SUNMOON_TEST_INSTALL_TEMPLATE 参数后 48/48。未修改测试断言、同步模板或产品源码。

## 清理与待验

所有原生运行均正常 stop 自己的 resident，清理自己的监听、测试钥服务器、执行器、沙箱临时目录与合成配置。终检原文：

```json
{"stage2_fixtures":0,"gui_fixtures":0}
{"relay_status":"connected","installed_version":"0.3.1"}
```

源码与探针仍保留在所有者约定的 `~/sunmoon-probe-runs/windows-agent-040-local-stage2` 隔离目录，没有安装到现装、没有改它的账号或登录任务。探针设置的登录任务在收尾用自己的 instance 关闭（本轮未实际开启任务）。测试 TLS 私钥和自签 JWT 只在隔离夹具/内存中，不进 git、不进回执。

复跑：先 `pnpm build`，把 dist/native/package.json 与钉版 Windows 运行依赖复制到隔离 app，准备隔离 tls/key.pem、tls/cert.pem（含回环 IP SAN，临时自签，绝不改全局证书），官方 Windows node 执行隔离 `settings-windows-probe.mjs <隔离根>`；加 `--interactive` 需所有者当面按允许/拒绝，脚本不代答。窗口观察用同目录 preferences-gui-probe.mjs/ps1；额外复制官方 Node 到隔离 node 目录，按实际分发布局核对启动信任。发行测试须包含 source 文件及真实模板的只读副本。

未完成：现网发票端点及网页「我的电脑」/真实文件树发布后联调；本轮没有启动网页或跑其测试（本地 app 依赖未准备）；elevated 模式；干净机器安装升级；真实任务开/关与提交失败后的真实任务回滚（本轮使用单测注入验证这些分支，实际 Windows status 读取已过）。这些不得冒称真机通过。代码与本机确认、只读知识库、正常重启已可交远程审读；没有自行发布或推送。
