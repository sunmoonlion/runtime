# Windows 代理卡 C1 回执

日期：2026-10-10（Asia/Shanghai）
依据：k8s `e9573559`，`luna-feedback.md`「2026-10-10 · 卡 C1 审读」；此前实现依据同文件「卡 C（代理）交 Cursor」和 SDD 0012 第二节第 1、2、4 节里属于 C1 的部分。C2 未做。

## 审读修改

- `UNABLE_TO_GET_ISSUER_CERT`、`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`、`CERT_HAS_EXPIRED`、`CERT_NOT_YET_VALID`、`ERR_TLS_CERT_ALTNAME_INVALID` 都归证书那句。实现按 `UNABLE_TO_GET_ISSUER_CERT*`、`CERT_*` 和这一个主机名错误码匹配。五个码各有一条测试，句子里没有「检查网络」。
- 启动自检对 `NODE_EXTRA_CA_CERTS` 和安装目录里的 `ca.pem` 都先 `fs.realpathSync.native`。文件打不开就算不匹配。win32 上再把两边转成小写后比较。测试：同一文件换一种大小写路径应通过；另一个文件应拒绝。本机文件系统区分大小写，打不开纯大小写变体，所以这条用指向同一文件的 `CA.pem` 链接充当不同写法；win32 上会直接用大小写不同的原路径。
- 三个 `.cmd` 去掉 `call :launch`，环境变量和 `node.exe` 命令写在主体里。

## 结果

源码版本 **0.2.2**。没有组包，没有发布，没有改集群，没有覆盖本机已安装的 0.2.1。

- 组包必须给出 `--site`。开发站点用 `agent/distribution/sites/dev-kind.json` 和 `dev-kind-ca.pem`（SunMoonAI Root CA，无私钥）。`ca_sha256` 是组包时对证书 DER 的 SHA-256：`79562e076be4c90442edba46de5a4ae2b6009d1c35dab0a895cb8797f6bce1ef`。配置文件里不能自带这个字段。`site/site.json` 和 `site/ca.pem` 进入清单；核验包时再对 DER 比对。
- 已安装布局（`node\node.exe` 且存在 `site\site.json`）的托盘、设置、后台、`sunmoon-agent.cmd`、自启 `run-hidden.vbs`、`install.cmd` / `uninstall.cmd`，以及卸载时拉起已装 CLI，都使用 `node.exe --use-system-ca`。`bundled-ca` 时 `NODE_EXTRA_CA_CERTS` 指向安装目录 `site\ca.pem`。这些入口会清掉 `NODE_OPTIONS`，不读取用户会话里的该变量。源码目录和单元测试没有站点文件，启动检查不介入。计划任务的参数串仍是 `//B //Nologo` 加上脚本、node、cli、state，没有改成另一种配置。
- 日志、`status.lastError`、托盘菜单和设置窗口备注使用同一句「错误码: 人话」。映射表每条都有测试。未知拒绝原因不回显原文。配对过期/拒绝只做成纯函数和测试，没有 `pair` 命令。
- 托盘图标悬停文字最长 63。悬停仍显示短状态；完整句子在托盘菜单「状态」项和「查看状态」对话框。

## 已跑

| 检查 | 结果 |
| --- | --- |
| 先 `pnpm build`，再 `pnpm test`（agent） | build 通过。测试 200 通过，32 跳过。跳过的是既有 Windows 实机用例。不先 build 时 `cli.test.ts` 会因没有 `dist/cli.js` 失败 |
| `tsc -p agent/tsconfig.json --noEmit` | 通过 |
| `node --test agent/distribution/test/bundle.test.mjs` | 28 通过 |
| PowerShell 解析 `desktop.ps1` | 上一轮 `parse-ok`。本轮未改该文件，未重跑 |
| `cscript run-hidden.vbs` 不带参数 | 上一轮退出码 2。本轮未改该文件，未重跑 |

## 未做

- 没有用官方 `node.exe` 组 Windows 包，因此没有新的 ZIP、清单摘要或安装目录。
- 没有在所有者的 Windows 上去掉会话 `NODE_OPTIONS`、重启，或确认代理靠随包 CA 自己连上。
- 没有安装、卸载或改已在运行的 0.2.1。没有发布，没有推送，没有改集群。
- C2 的配对、四步设置、开始菜单快捷方式、自启默认开启和 `install.ps1.tmpl` 都没写。

## 审过之后才需要所有者在 Windows 上做的事

1. 用审过的 0.2.2 源码在 Windows 上组新包。不要拿已经装上的 0.2.1 包代替。
2. 安装前先停掉当前代理。这次还没有 C2 的升级脚本：按现有卸载保留配置，再安装新包。不要往安装目录里直接覆盖。
3. 去掉用户会话里的 `NODE_OPTIONS`。如果 `NODE_EXTRA_CA_CERTS` 只是为了这张开发 CA 设的，也去掉，让会话变量不再成为连接条件。
4. 重启。
5. 确认代理自己连上（开发证书经随包 `site\ca.pem`）。托盘和状态里的失败应是人话加原始错误码，且不出现令牌。
