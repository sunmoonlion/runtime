# 0024 第四节补跑：Windows 全量单测

**执行完成，测试结论 fail：337 通过、19 失败、1 跳过，共 357 项。** 34 个测试文件全部加载，30 个通过、4 个失败；vitest 退出 1。只补跑第四节，不重新跑项目探针、不改任何测试或产品代码。

## 版本、隔离与执行顺序

- runtime 当前 HEAD：`778d8571517784638abd6a1f025f0d83ae757745`，分支 qwen。相较卡指定的 `f09ec89ed5ba550d2d6c96337e5df790fd0d40d8` 只增加上一轮回执，代理代码相同；执行前工作区干净。
- 隔离测试目录：`C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\tests\agent`。
- 官方 Windows Node 24.19.0，pnpm 10.24.0，vitest 3.2.7，代理 0.4.1，Codex 0.155.1。
- PowerShell 直接启动 Windows node.exe，非 WSL 代跑。PATH 仅在本轮进程里优先选择隔离 Node。
- 已有 elevated 测试家 `C:\Users\zymun\.codex-probe-exec` 不含 auth.json；原生符号链接夹具 `windows-agent-2-native-links-20261008` 的三个读取对照均是 outside-control。没有重新做管理员 setup 或新建需提升权限的夹具。

执行顺序：先等待隔离源码复制完成并逐文件核验，再冻结安装依赖，退出 0 后才启动 vitest。完整输入补齐后，agent 全部 110 个 Git 跟踪文件与 `probe/frames.jsonl` 都逐文件核对相同；原先构建的 dist 也保留。执行后的第二次核对仍相同，未改锁文件、断言或跳过条件。

冻结安装：

```powershell
Set-Location 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\tests\agent'
& 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\node\node.exe' 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-1d-20261008\corepack\v1\pnpm\10.24.0\bin\pnpm.cjs' install --frozen-lockfile --registry=https://registry.npmmirror.com
```

全量单测（全部 34 个 `test/**/*.test.ts`，不按文件筛选）：

```powershell
$env:Path = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\node;' + $env:Path
$env:SUNMOON_TEST_ELEVATED_HOME = 'C:\Users\zymun\.codex-probe-exec'
$env:SUNMOON_TEST_SYMLINK_FIXTURE = 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-2-native-links-20261008'
$env:NO_COLOR = '1'
Set-Location 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\tests\agent'
& 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\node\node.exe' node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --reporter=default --reporter=json --outputFile.json=C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\section4-vitest.complete.json
```

worker 上限只控制并发，不增删用例、不改超时与断言。依赖安装中 esbuild build-script 被 pnpm 原策略忽略的警告保留；实际 vitest 已正常启动与运行，没有修改批准列表或全局 npm 配置。

## 两轮记录

首轮隔离副本漏了仓库中已有的 `agent/distribution/sites/dev-kind-ca.pem` 与 `probe/frames.jsonl`，导致 `siteTrust.test.ts`、`windowsFilter.test.ts` 加载失败；这是执行者复制夹具不完整，不能算产品功能失败。首轮已运行用例是 308 通过、19 失败、1 跳过（328 项），另有两个测试文件未加载。

为满足本次要求的全量覆盖，补齐全部原有 agent 跟踪文件和协议帧夹具，确认复制结束后再次冻结安装（退出 0），随后完整运行同一条 vitest 命令。没有修改任何测试来使失败变通过，也没有筛掉失败用例；两轮的原始输出和 JSON 均保存。补齐后站点信任 5 项、协议帧 24 项全部通过，最终仍保留 19 项失败。

| 轮次 | 通过 | 失败用例 | 跳过 | 已加载用例 | 文件加载失败 | exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 首轮（漏夹具） | 308 | 19 | 1 | 328 | 2 | 1 |
| 补齐后的完整轮 | 337 | 19 | 1 | 357 | 0 | 1 |

完整轮原文统计：

```text


 Test Files  4 failed | 30 passed (34)
      Tests  19 failed | 337 passed | 1 skipped (357)
   Start at  16:09:26
   Duration  84.05s (transform 585ms, setup 0ms, collect 1.84s, tests 157.14s, environment 4ms, prepare 2.93s)

```

失败与跳过所在文件：

| 文件 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| localApi.test.ts | 6 | 4 | 0 |
| localProjects.test.ts | 4 | 9 | 0 |
| localProjectsApi.test.ts | 2 | 1 | 0 |
| localSettings.test.ts | 24 | 0 | 1 |
| service.test.ts | 5 | 5 | 0 |

## localProjects.test.ts：9 项失败逐条列出

该文件总共 13 项：4 通过、9 失败、0 跳过。

源码里的通用 `projects()` 明确固定 `platform: "linux"`，并用 `#!/bin/sh` 假 git 夹具；Windows 上 `os.tmpdir()` / path.join 生成盘符路径。实际这 9 项均在 `LocalProjects.target()` 的前置检查报 outside_whitelist，尚未执行假 git。按现有源码和堆栈，这是 Linux 夹具在 Windows 上的不适配；不是这些场景在真实 Windows 分支中的成功或失败证明。本轮不修改测试、不把这些失败改记为跳过。

| 失败用例原名 | 实际错误 |
| --- | --- |
| new project folder creates nested folders under a workspace root, then reports an existing one as not created | `Error: outside_whitelist` |
| new project folder refuses outside the roots, the library, a file in the way, a linked ancestor and a read-only ceiling | `AssertionError: expected 'outside_whitelist' to be 'not_a_directory' // Object.is equality` |
| clone runs git with fixed argv, no prompts, only https/ssh transports and no submodules | `Error: outside_whitelist` |
| clone hands a typed token to git through its env only, and remembers it only when asked | `Error: outside_whitelist` |
| clone asks for a token when git cannot log in, and removes the folder it made | `AssertionError: expected 'outside_whitelist' to be 'auth_required' // Object.is equality` |
| clone keeps an empty folder the user picked, but empties what a failed clone left in it | `AssertionError: expected 'outside_whitelist' to be 'clone_failed' // Object.is equality` |
| clone refuses a non-empty target and a token for an ssh address; ssh login failure says so | `AssertionError: expected 'outside_whitelist' to be 'target_not_empty' // Object.is equality` |
| clone stops git on timeout or cancel and removes the folder | `AssertionError: expected 'outside_whitelist' to be 'clone_timeout' // Object.is equality` |
| clone says git is missing | `AssertionError: expected 'outside_whitelist' to be 'git_missing' // Object.is equality` |

通过的 4 项是：Windows helper createDirectory 与大小写用例、clone URL 校验、失败分类、真实 Git 的一次性凭据助手。真实 Git 用例仅使用测试合成用户名/令牌，不使用所有者的实际凭据。

## 另外 10 项失败

`localProjectsApi.test.ts` 的 projects 和 `service.test.ts` 的 handler 都固定 platform=linux，因此盘符路径会被前置路径检查拒绝；`localApi.test.ts` 的 LocalFiles 夹具没有提供 Windows 所需的 files helper，读取被拒绝。另两项创建原生符号链接的用例在普通 Windows 用户下报 EPERM。下面保留实际结果，不以夹具原因把测试改判通过。

### localProjectsApi.test.ts：1 项

| 失败用例原名 | 实际错误 |
| --- | --- |
| loopback new-project routes make a folder by POST with a JSON body holding only the path | `AssertionError: expected { status: 403, body: { …(2) } } to deeply equal { status: 200, body: { …(2) } }` |

### localApi.test.ts：4 项

| 失败用例原名 | 实际错误 |
| --- | --- |
| local file HTTP API reads original bytes with exposed metadata headers and reconstructs 5 MiB in five reads | `AssertionError: expected 403 to be 200 // Object.is equality` |
| local file HTTP API rejects outside/parent escape/protected names, symlinks and hardlinks without revealing paths | `Error: EPERM: operation not permitted, symlink 'C:\Users\zymun\AppData\Local\Temp\sunmoon-local-api-QtAEXR\outside' -> 'C:\Users\zymun\AppData\Local\Temp\sunmoon-local-api-QtAEXR\root\link'` |
| local file HTTP API returns 413 for a file above 64 MiB and 404 for absent files | `AssertionError: expected 403 to be 413 // Object.is equality` |
| local file HTTP API returns one-layer directory entries with path and truncation and metadata | `AssertionError: expected undefined to be 'C:\Users\zymun\AppData\Local\Temp\sun…' // Object.is equality` |

### service.test.ts：5 项

| 失败用例原名 | 实际错误 |
| --- | --- |
| service-v1 read boundary returns only the contracted hello and metadata fields | `AssertionError: expected undefined to deeply equal { type: 'file', size: 5, …(1) }` |
| service-v1 read boundary blocks symlinks and hardlinks but lists links without traversing | `Error: EPERM: operation not permitted, symlink 'C:\Users\zymun\AppData\Local\Temp\sunmoon-service-VEqdNu\outside' -> 'C:\Users\zymun\AppData\Local\Temp\sunmoon-service-VEqdNu\root\link'` |
| service-v1 read boundary bounds and reconstructs a 5 MiB file in ten responses under the frame limit | `TypeError: Cannot read properties of undefined (reading 'eof')` |
| service-v1 read boundary rejects files above 64 MiB before reading and reports not-found | `AssertionError: expected { code: -32010, …(1) } to deeply equal { code: -32011, message: 'too_large' }` |
| service-v1 read boundary truncates directories at 2000 entries | `TypeError: Cannot read properties of undefined (reading 'entries')` |

## 跳过项与真实 Windows 通过范围

唯一跳过项：`localSettings.test.ts > loopback settings transaction > rejects symlink directories and protected configuration roots`；测试原有 `it.skipIf(process.platform === "win32")` 生效，本轮未新增跳过。

Windows 原生安全测试 15 项、follow-up 9 项、HTTP 测试 45 项（含三项原生 HTTP）、生命周期 1 项、后台/托盘生命周期 4 项、CLI 能力测试 8 项均通过。生命周期与托盘使用测试自己的合成账号、独立 home 和回环 relay，不操作现装代理或所有者账号。用户看到的自动取消确认窗来自原有单测，不曾自动批准权限。

末尾只读清理检查：本隔离目录相关 node/codex 进程余留 0，本隔离目录相关登录任务余留 0；已有 elevated 测试家仍无 auth.json。隔离测试源码和依赖保留供复核。

## 证据与交回

- [完整轮 stdout/stderr](windows-agent-0.4.1-projects-section4.20261014-161317/vitest-complete.log)
- [完整轮 JSON](windows-agent-0.4.1-projects-section4.20261014-161317/vitest-complete.json)
- [首轮 stdout/stderr（含加载失败）](windows-agent-0.4.1-projects-section4.20261014-161317/vitest-first.log)
- [首轮 JSON](windows-agent-0.4.1-projects-section4.20261014-161317/vitest-first.json)
- [首轮冻结依赖安装](windows-agent-0.4.1-projects-section4.20261014-161317/install-first.log)
- [完整输入后的冻结依赖安装](windows-agent-0.4.1-projects-section4.20261014-161317/install-complete.log)
- 上一轮项目探针回执：[windows-agent-0.4.1-projects.20261014-155506.md](windows-agent-0.4.1-projects.20261014-155506.md)。本次只补第四节，私有仓库仍未验。

第四节已执行并如实交回；Windows 全量测试尚未全部通过。回执与原始证据本地提交，不 push、不发布，不改其他仓库。

exit=1
