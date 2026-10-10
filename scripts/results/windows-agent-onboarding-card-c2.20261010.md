# Windows 代理卡 C2 回执

日期：2026-10-10（Asia/Shanghai）
依据：k8s `390aabf2`，`luna-feedback.md`「2026-10-10 · 卡 C1 验收通过」；内容照「卡 C（代理）交 Cursor」的 C2 段和卡 B 契约表。两个缺陷照「0.2.2 组包与本机替换审读」。版本仍是 0.2.2。

## 做了什么

- `sunmoon-agent pair` 按契约提交五项：`machine_name`、`os`、`agent_version`、`codex_version`、`device_secret_sha256`。连接码、300 秒和 3 秒间隔写入标准输出。批准后把 `relayUrl`、`userId`、`token` 写入本机配置。标准输出和错误句里没有设备秘密，也没有代理令牌。429 继续等；过期、拒绝、取消、已投递各有退出码。`init --token-prompt` 仍在。
- 设置窗口是 `desktop.ps1 -Action onboard`，不改原来的 `-Action setup`。四步：连接我的账号（大号连接码、倒计时、打开核对页、取消、重新获取）、目录勾选（可以一个都不选，并显示「不选的话工作和专家碰不到你的文件」）、开机自动运行（默认勾选）、完成（后台启动，最多等 30 秒，显示「已在线」或人话和「重试」）。托盘菜单增加「重新连接账号」。
- `sunmoon-agent menu`：已有令牌打开托盘，否则打开设置窗口。开始菜单快捷方式「SunMoon 代理」指向 `sunmoon-agent.cmd menu`。新装和升级会打开登录自启；同版本重跑不改自启开关。
- `install.ps1.tmpl` 六个占位符各出现一次，没有别的 `{{大写}}`。下载到 `%TEMP%\sunmoon-agent-<随机>\pkg.zip`，最多 4 次请求（1 次加 3 次续传），核对长度和 ZIP SHA256，再核对清单 SHA256。不打印带凭据的地址，没有 `-ExecutionPolicy Bypass`。
- 升级先问 `upgrade.mjs`。没有安装则安装；同版本只打开窗口；已装版本更旧则保留配置卸载后再安装；已装版本更新则拒绝。卸载后安装目录还在，就停止，不调用安装。没有覆盖开关。0.2.1（没有 `installer/launch.mjs`、没有 `installer/upgrade.mjs`、没有 `site/`）和 0.2.2 都按各自清单核验。
- 新包的 `REQUIRED` 仍用于组包和首次安装。已安装目录和 `removeVerifiedBundle` 用 `{ requireLayout: false }`，只核对该目录自己的清单。
- 残留 `tray-stop.json`：记录的托盘进程已不在时，删掉停止文件和 `tray.json`，视为已停。进程还在则保持等待，不删文件。符号链接不删。

## 已跑

| 检查 | 结果 |
| --- | --- |
| 先 `pnpm build`，再 `pnpm test`（agent） | build 通过。测试 206 通过，32 跳过。跳过的是既有 Windows 实机用例 |
| `tsc -p agent/tsconfig.json --noEmit` | 通过 |
| `node --test agent/distribution/test/bundle.test.mjs` | 31 通过。含 0.2.1 形态清单、同版本/升级/拒绝，以及模板占位符和「没有覆盖」 |
| PowerShell 解析 `desktop.ps1`、`install.ps1.tmpl` | 均通过。模板以 UTF-8 BOM 保存，否则 Windows PowerShell 5.1 会把中文按系统代码页拆开 |

## 本轮没有做

没有组包，没有发布，没有改集群，没有卸载或覆盖 `C:\Users\zymun\AppData\Local\Programs\sunmoon-agent` 里正在运行的 0.2.2，没有发起真实配对，没有改令牌。

## 所有者在 Windows 上的步骤（审过并组 0.2.3 包之后）

本轮不要做。配对会换掉当前令牌，这台电脑会断开。

1. 同版本再跑安装脚本：只打开托盘或设置，安装目录不被覆盖。
2. 从本机现装的 0.2.2 升级：配置保留，自启开着，开始菜单有「SunMoon 代理」。0.2.1 形态用临时目录模拟，不必真装回 0.2.1。目录还在就停，不覆盖。
3. 在设置窗口点「连接我的账号」，在浏览器里输入连接码，走完四步，看到「已在线」。

## 审读修改（k8s `dd62bbb0`）

- 版本改为 **0.2.3**：`cli.ts` 的 `VERSION`、`agent/package.json`、`windows-x64.json` 的 `agentVersion`。所有者那台是 0.2.2，同版本只会开窗。
- 外部包的 `uninstall.mjs` 在 `invoke(['tray','stop'])` 之前调用 `clearStaleTray`。规则与常驻进程相同：记录的 pid 已不在、普通文件、非链接，就删掉 `tray-stop.json` 和 `tray.json`。进程还在则留下，交给旧 CLI。符号链接不删。测试用 0.2.1 形态目录加上已退进程的残留文件，清掉之后卸载走完，旁边的 `config.json` 还在。
- `desktop.ps1` 用 `BeginErrorReadLine` 异步读 `pair` 的 stderr。进程退出且没有 `result` 时，窗口显示 stderr 最后一行，没有则显示「连接没有完成，请重新获取。」「重新获取连接码」保持可点。PowerShell 解析通过；窗口本身没有在本机手测。
- `verify_url` 必须以 `site.json` 的 `web_origin` 开头，且下一字符是结尾、`/`、`?` 或 `#`，才写入可打开的地址并打开浏览器。`approved` 的 `relay_url` 必须等于 `site.json` 的 `relay_url`，否则不保存令牌。收到 429 后，下一次轮询多等一个间隔（3 秒变 6 秒）。这三条都有测试。

## 审读后已跑

| 检查 | 结果 |
| --- | --- |
| 先 `pnpm build`，再 `pnpm test`（agent） | build 通过。测试 208 通过，32 跳过。跳过的是既有 Windows 实机用例 |
| `tsc -p agent/tsconfig.json --noEmit` | 通过 |
| `node --test agent/distribution/test/bundle.test.mjs` | 32 通过。含 0.2.1 形态加已退进程的 `tray-stop.json` |
| PowerShell 解析 `desktop.ps1` | 通过。窗口没有在本机手测 |

没有组 0.2.3 包，没有发布，没有改集群，没有动正在运行的 0.2.2。

## 0.2.3 组包与本机验收（k8s `69fd572e`）

源码 `7449160d3b11ca9d8cab4583f740d0bd4df7553e`。组包参数 `--site agent/distribution/sites/dev-kind.json --ca-pem agent/distribution/sites/dev-kind-ca.pem`。官方 `node.exe` 与 Windows 依赖目录沿用卡 C1，没有重新下载。

| 项目 | 值 |
| --- | --- |
| 目录 | `C:\Users\zymun\sunmoon-probe-runs\windows-agent-c2-20261010\sunmoon-agent-7449160` |
| ZIP | 同一目录下 `sunmoon-agent-0.2.3-7449160-windows-x64.zip` |
| 清单内文件 | 96 个，合计 501005949 字节；加上清单本身是 97 个 |
| ZIP 大小 | 175305339 字节 |
| ZIP SHA256 | `77eda63720dab2e833541440ff16aaeba46cd6c13fb20e812e75b18a61102ea8` |
| 清单 SHA256 | `8c742cfc718ac9e9d5b160bbf26ca6352a09e8fb3a0dd5e627a15d8d90de136b` |
| `site/site.json` 的 `ca_sha256` | `76f9012886262cf6974039de8baf16ecd5e79e780237349fdcb95a2ac1aa1b3c` |
| `web_origin` | `https://investment.sunmoonai.com:30443` |
| `relay_url` | `wss://relay.sunmoonai.com:30443` |

ZIP 为 deflate、正斜杠、无外层目录。`windows-candidate.mjs` 用包内 Node 通过：0.2.3，97 个文件，没有启动代理，隔离目录已删。安装脚本由模板手工替换六个占位符，写在 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-c2-20261010\install.ps1`，不在仓库里。包地址是本机 `127.0.0.1:8765` 的临时 HTTP，没有凭据。服务已停。

### 从现装 0.2.2 升级

升级前已装清单 `8e11fbbe294aaf29f4ffe6e8e8225b007920935e863dd76810e5f429063b3510`，版本 0.2.2，`status` 为 connected。安装脚本原文：

```text
{"action":"uninstall","target":"C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent","preserveConfig":true,"stopsOnlyThisAgent":true,"result":"removed"}
{"action":"installed","destination":"C:\\Users\\zymun\\AppData\\Local\\Programs\\sunmoon-agent","files":97,"bytes":501005949,"startsAgent":false,"registersLogonTask":false,"changesUserConfig":false,"needsAdministrator":false}
{"runLevel":"Limited","name":"SunMoonAgent-5b4377b497ee820ab8d076cf","installed":true,"enabled":true}
{"action":"tray"}
已准备 SunMoon 代理 0.2.3（Codex 0.155.1）。请在弹出的窗口里继续。
```

退出码 0。`config.json` 修改时间仍是 2026-10-09T16:06:40，令牌还在，没有打印令牌。开始菜单「SunMoon 代理」指向 `sunmoon-agent.cmd`，参数 `menu`。自启任务仍是 `SunMoonAgent-5b4377b497ee820ab8d076cf`，Limited，enabled=True。安装脚本不启动后台，随后执行 `start --background`，原文 `{"started":true}`。之后 `status`：

```text
{"version":"0.2.3","pid":26184,"relay":"connected","lastError":""}
```

### 同版本再跑

第二次安装脚本只打印：

```text
{"action":"tray"}
已准备 SunMoon 代理 0.2.3（Codex 0.155.1）。请在弹出的窗口里继续。
```

退出码 0。没有卸载，没有 `installed`。`node.exe` 修改时间仍是 2026-10-10T15:58:02，清单摘要仍是 `8c742cfc…136b`，配置修改时间未变。`status` 仍是 0.2.3、pid 26184、connected。

### 0.2.1 形态，临时目录

复制 `sunmoon-agent-6de6002` 到临时 `LOCALAPPDATA`，没有 `installer\launch.mjs`，没有 `site\`，清单版本 0.2.1，摘要 `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2`。临时状态目录放了 `config.json` 和进程号 424242 的 `tray-stop.json` / `tray.json`。用新包的 `uninstall.mjs`，`SUNMOON_AGENT_HOME` 和 `LOCALAPPDATA` 都指向临时目录。原文：

```text
{"action":"uninstall","target":"C:\\Users\\zymun\\sunmoon-probe-runs\\windows-agent-c2-20261010\\sim-021-local\\Programs\\sunmoon-agent","preserveConfig":true,"stopsOnlyThisAgent":true,"result":"removed"}
```

退出码 0。安装目录已消失，临时 `config.json` 还在，两个托盘残留文件已清掉。本机正在用的 0.2.2 当时还在，没有被这次模拟碰到。

### 真实配对没有做成

托盘「重新连接账号」会启动同一个 `pair`。直接跑安装目录里的 `node.exe --use-system-ca app\dist\cli.js pair`（没有别的参数）立刻退出码 1，标准输出为空。stderr 原文是一条 fatal，抛出点在 `app\dist\cli.js:104`。源码对应：

```text
if (cmd === "pair") {
  if (argv.length) throw new Error("pair 不接受参数");
```

`argv` 里含有子命令名 `pair`，所以不带参数也会被拒绝。没有拿到连接码，没有打开核对页，没有换令牌。配置修改时间未变。结束后 `status` 仍是 0.2.3、pid 26184、connected。

## 已做 / 未做

已做：组 0.2.3 包并核对 `ca_sha256`；隔离安装检查；不进仓库的 `install.ps1`；从 0.2.2 升级并连上；同版本重跑只开窗；0.2.1 临时目录卸载。未做：真实配对、浏览器核对页、四步窗口里输入连接码。未发布，未改集群。卡 D 未开始。
