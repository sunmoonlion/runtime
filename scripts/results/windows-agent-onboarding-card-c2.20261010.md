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

## 所有者在 Windows 上的步骤（审过并组包之后）

本轮不要做。配对会换掉当前令牌，这台电脑会断开。

1. 同版本再跑安装脚本：只打开托盘或设置，安装目录不被覆盖。
2. 用一份按 0.2.1 清单核验得过的目录（没有 `installer\launch.mjs`、没有 `site\`）升级：配置保留，旧目录卸掉之后才装入新版本。0.2.2 形态同样先卸再装；目录还在就停。
3. 开始菜单有「SunMoon 代理」。新装或升级后，登录自启是开着的。
4. 在设置窗口点「连接我的账号」，在浏览器里输入连接码，走完四步，看到「已在线」。
