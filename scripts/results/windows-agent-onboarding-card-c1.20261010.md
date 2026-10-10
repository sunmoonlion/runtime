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

## 0.2.2 包（未发布）

组包用已核过的官方 `node.exe`（SHA256 `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`）和 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-20261008\agent`。锁文件与源码一致。站点参数为 `--site agent/distribution/sites/dev-kind.json --ca-pem agent/distribution/sites/dev-kind-ca.pem`。

| 项目 | 值 |
| --- | --- |
| 源码 | `dcb3a10e9a2fca883915084683aa678c01facafd` |
| 目录 | `C:\Users\zymun\sunmoon-probe-runs\windows-agent-c1-20261010\sunmoon-agent-dcb3a10` |
| ZIP | 同一目录下 `sunmoon-agent-0.2.2-dcb3a10-windows-x64.zip` |
| 清单内文件 | 94 个，合计 500978887 字节；加上清单本身是 95 个 |
| ZIP 大小 | 175297560 字节 |
| ZIP SHA256 | `43dc2e2cf0816b6d8413d14d6237c4f961898302dff44225b5d251a13bb8bd5b` |
| 清单 SHA256 | `53d27a66112dc79be809b696fb0c98f3a013757db3eeda8b1abbe43496f2f64c` |
| `site/site.json` 的 `ca_sha256` | `79562e076be4c90442edba46de5a4ae2b6009d1c35dab0a895cb8797f6bce1ef` |

ZIP 无外层目录，路径用正斜杠。回读 94 个清单文件的 SHA256 与清单一致，`site/site.json` 里的 `ca_sha256` 与证书 DER 一致。隔离安装检查 `windows-candidate.mjs` 用包内 Node 通过：版本 0.2.2，95 个文件，没有启动代理，隔离目录已删。

## 本机替换 0.2.1

按这个顺序做的：

1. 停掉当时在跑的 0.2.1 后台，保留配置卸载，再安装 0.2.2。
2. 用户级、计算机级和 `HKCU\Environment` 里都没有 `NODE_OPTIONS`，也没有 `NODE_EXTRA_CA_CERTS`。没有需要删除的值。
3. 用安装目录的 `sunmoon-agent.cmd start --background` 启动。该进程的命令行带 `--use-system-ca`。`status.json` 为版本 0.2.2、`relay.status=connected`、`lastError` 空。日志 `2026-10-10T05:38:27Z` 有 `relay connected`。配置文件仍在。

两处过程记录：

- 0.2.2 的卸载器核验 0.2.1 安装目录时报 `Incomplete or oversized bundle`，因为新清单要求 `installer/launch.mjs`，0.2.1 没有这个文件。随后改用保留的 0.2.1 外部目录 `sunmoon-agent-6de6002` 卸载，预览为保留配置，结果 `removed`。安装目录已消失，`C:\Users\zymun\.sunmoon-agent\config.json` 还在。
- 第一次卸载停在 `Cannot complete tray`。托盘进程 4756 当时已经不在，`tray-stop.json` 留着，第二次会被拒。确认该进程不存在后，删掉这两个托盘控制文件，卸载才完成。没有强杀 node 进程。

没有登录计划任务、启动文件夹快捷方式或 Run 项。因此没有重启：重启后这个代理不会自己起来，而它当时已经连上。没有发布到网页，没有改集群，没有做 C2。
