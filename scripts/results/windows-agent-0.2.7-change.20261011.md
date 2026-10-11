# 0.2.7 改动回执：设置窗口改文件轮询，根除 pair 输出回调导致的整窗消失

时间：2026-10-11（UTC+8）。工位 luna，分支 luna。依据 k8s luna `59ae4914` 的 `luna-feedback.md`「0.2.6 审读」节给 Qwen 的第一张活。
取证见同目录 `windows-agent-0.2.7-forensics.20261011.md`（取证 a 事件日志 + 取证 b 前台/最小复现/对照实验，根因确证 = `add_OutputDataReceived` 脚本块在无 runspace 线程执行、引擎 exit 2 有序终止）。

## 改法（4 个文件）

### 1. `agent/src/pair.ts`：每步进展原子写 `pair-status.json`（不含秘密）
- `PairRunOptions` 加 `statusFile?: string`。
- 新增 `writeStatusFile`（临时名 `.<pid>.<seq>.tmp` 写完 `renameSync`，`mode 0o600`，照 `mcp.ts`）、`emitStatus`（`WeakMap` 计 seq，单次 runPair 内单调递增）、`emitPairFailure`（导出，准备阶段失败也写人话）。
- `code` 事件：`deadline` 计算提前，`say` 后 `emitStatus({event:"code", user_code, expires_at:<ISO 绝对时刻>, verify_url})`（窗口用绝对时刻自算倒计时）。
- `accept`（approved）：`emitStatus({event:"result", status:"approved", account})`——`account` 是用户可读标识，token 只进 config.json。
- `done`（expired/denied/cancelled/failed）：`emitStatus({event:"result", status, message})`——message 是我们自己写的人话。
- stdout 契约不变（`say` 原样），现有测试不破。

### 2. `agent/src/cli.ts`：pair 命令传 statusFile + 兜底写失败
- import 补 `emitPairFailure, PAIR_EXIT`。
- pair 命令：`statusFile = CONFIG_DIR/pair-status.json`，启动前 `fs.rmSync(statusFile,{force:true})` 删旧文件；`runPair({... statusFile ...})`。
- 准备阶段（`siteDocument`/`locateCodex`）或主流程抛错：`catch` 里 `log("error","pair fatal",...)` + `emitPairFailure(statusFile, message)` + `return PAIR_EXIT.failed`（旧版直接 exit 1 不写文件，窗口只会干等）。

### 3. `agent/native/desktop.ps1`：`Show-Onboard` 去回调改文件轮询 + Timer/Click 包 try/catch
- 删 `$script:Lines/$script:ErrLines` 队列，加 `$script:StatusFile`、`$script:LastSeq`、`Read-PairStatus`（照 `readTrayControl` 校验：存在、非符号链接、`Length<=4096`、去 BOM、解析失败当没有）。
- `$Timer.Add_Tick`：整体包 `try/catch`；每秒 `Read-PairStatus`，`seq > LastSeq` 才处理（去重，避免重复开浏览器）；`code` 用 `expires_at` 算 `Remaining`、`verify_url` 过 `Test-SiteUrl` 后 `Start-Process`；`approved` 启用 `Next1`；其他 result 显示 message + 启用 `Refresh`；保留 `HasExited` 兜底。`catch { $Connected.Text = '窗口内部错误：' + ... }`，**窗口不退**。
- `$Connect.Add_Click`：整体包 `try/catch`；点击前删旧 `pair-status.json`、`LastSeq=0`、清空界面；起 pair 后**不挂输出事件脚本块**，改 `[void]$script:Pair.StandardOutput.ReadToEndAsync()` + `StandardError.ReadToEndAsync()` 读掉丢弃（防管道满阻塞、不涉脚本块回调）。`catch { $Connected.Text = '无法开始连接：' + ... }`，**窗口不退**。
- `Stop-Pair`（stdin 写 `cancel`）保留不变。

### 4. `agent/distribution/uninstall.mjs`：inspectConfig 允许清单补两项（待办 70）
- `allowed` 加 `'pair-status.json','onboard-ready.json'`，否则卸载时这两个文件会触发「Unexpected user data; refusing deletion」。

## 测试（原文）

```
# vitest（test/**/*.test.ts）
 Test Files  19 passed | 4 skipped (23)
      Tests  218 passed | 32 skipped (250)

# pair.test.ts 单跑（含新增「writes each pair step to the status file without secrets」）
 ✓ test/pair.test.ts (7 tests) 13ms

# bundle.test.mjs（node --test，含新增 banned 回调断言）
ℹ tests 32
ℹ pass 32
ℹ fail 0

# typecheck（tsc -p tsconfig.json --noEmit）：无输出（干净）
# desktop.ps1 PowerShell Parser：syntax-ok；BOM 保留 efbbbf
```

新增断言：
- `pair.test.ts`：approved 流程下，第一次 poll 前快照 = code 事件（`seq===1`、`user_code==="ABCD-2345"`、`expires_at` 可 `Date.parse`），终态文件 = approved（`seq===2` 证明 code 与 result 两步都落文件、`account==="owner"`），状态文件原文不含 `TOKEN`/`SECRET`/`agent_token`/`device_secret`。
- `bundle.test.mjs`：`desktop.ps1` 不含 `add_OutputDataReceived`/`add_ErrorDataReceived`/`BeginOutputReadLine`/`BeginErrorReadLine`（并从正向 label 列表移除已废弃的 `BeginErrorReadLine`）。

> 注：`node --test distribution/test/`（跑整个目录）会把 `windows-candidate.mjs` 误当测试——它是 Windows 专用候选验证脚本（`assert.equal(process.platform,'win32')` + 需 argv），在 WSL 必失败，与本改动无关。正确跑法是单跑 `bundle.test.mjs`。

## 版本 0.2.7（三处，原文）

```
src/cli.ts:28:const VERSION = "0.2.7";
package.json:3:  "version": "0.2.7",
distribution/windows-x64.json:5:  "agentVersion": "0.2.7",
```
源码/配置无 `0.2.6` 残留。`npm run build` 成功，`dist/cli.js` 内 `VERSION = "0.2.7"`。

## 发布环节交接（需所有者侧基础设施，停下交审）

步骤 4 余下的组包→verify→upload→agent-releases→只发投资→application-check，按 0.2.6 记录（`k8s/sunmoonai/scripts/results/agent-release-026.20261011.md`）依赖：
- **组包** `distribution/build.mjs --node-exe <official node.exe> --dependencies <Windows agent 目录> --site <profile.json> --output <新目录> [--ca-pem]`：0.2.6 在 **Windows 侧**组（输出 `C:\Users\zymun\sunmoon-probe-runs\...`），且 build.mjs 强制 `git status --porcelain` tracked 干净（**组包前须先本地提交**）。
- **windows-candidate.mjs**：用**包内 Node** 验证，须在 Windows 跑。
- **agent-release-verify / agent-release-upload**：`infrastructure/Makefile` target，底层 **ansible**（`host/inventory.yaml`）+ 云对象存储凭证；upload 是不可逆生产动作。
- **agent-releases**：`config.yaml` 五项（version/object_key/zip_sha256/manifest_sha256/size_bytes/source_revision）+ `install.ps1.tmpl` + **`agent-releases.sops.yaml`（sops 加密）** + 四处 `config-sha256`；只 stage 投资。
- **application-check**：`make application-check APP=investment`（k8s 集群）。
- 远程同步由所有者负责（规矩：不 push/fetch/pull/rebase/merge fable）。

以上 Windows 物料、ansible、云凭证、k8s 集群、sops 密钥、同步均在本助手（WSL 本地）能力之外，**停下交审**，请所有者确认发布推进方式。
