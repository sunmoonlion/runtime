# 0024 段 2：代理 0.4.1 Windows 真机回执

本轮结论：**项目探针通过；Windows 全量单测未执行；按卡停止，总体未完成。**

## 对象与环境

- 卡：`k8s/docs/dev-investment-agent/switch-test/inbox/qwen/2026-10-14-0024-agent-041-windows.md`。
- runtime 基线：`f09ec89ed5ba550d2d6c96337e5df790fd0d40d8`；分支 `qwen`；执行前 `git status --porcelain` 为空。
- 隔离目录：`C:\Users\zymun\sunmoon-probe-runs\windows-agent-041`；应用位于 `app`。
- 官方 Windows Node：24.19.0；SHA256 `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`，与 0.4.0 已验发行 manifest 相符。
- Windows Git：`git version 2.54.0.windows.1`；公开仓库 `https://github.com/octocat/Hello-World.git` 的 `ls-remote HEAD` 成功，无需换仓库。
- 代理版本：0.4.1；Codex：0.155.1；沙箱：unelevated。

## 准备与核验

runtime/agent 执行 `pnpm install --frozen-lockfile` 和 `pnpm build`，退出 0，构建完成。依赖全部复用缓存，下载数为 0；pnpm 自动更新元数据检查另报 npm TLS 连接失败，但不影响本次冻结安装与构建的退出码。未改网络配置、锁文件或源代码。

隔离应用复制当前构建的 dist、native、package.json。Windows 运行依赖来自已验 0.4.0 发行 `windows-agent-040-release/sunmoon-agent-f85fe31`；复制前重新核验 manifest 中全部 52 个运行依赖文件的长度与 SHA256，全部一致；Node 同样核验。dist/native 与本次构建逐文件相同，`dist/localProjects.js` 存在。

| 隔离 app 项 | 文件数 |
| --- | ---: |
| dist | 70 |
| native | 5 |
| node_modules | 52 |
| package.json | 1 |
| 合计 | 128 |

## Windows 原生项目探针：pass

由 PowerShell 使用隔离的官方 node.exe，执行基线探针的原样副本：

```powershell
& 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\node\node.exe' 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\local-project-windows-probe.mjs' 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\app'
```

退出码 0；原样 JSON：

```json
{"stage":"0024-1","platform":"win32","agent":"0.4.1","codex":"0.155.1","sandbox":"unelevated","chinese_nested_folder":true,"case_kept":true,"existing_folder_not_created":true,"root_as_project":true,"outside_and_library_denied":true,"file_in_the_way_409":true,"junction_denied":true,"read_only_denied":true,"public_clone":true,"public_branch":"master","non_empty_denied":true,"file_transport_denied":true,"timeout_removes_folder":true}
```

卡指定的 12 个布尔项全部为 true，`public_branch` 为 master。覆盖中文多层建目录、保留大小写、已有目录不重复创建、工作区根可选、工作区外/知识库拒绝、文件挡路、junction 拒绝、只读拒绝、公开仓库 clone、非空目录拒绝、file 传输拒绝、超时清理。

探针按自己的 finally 清理测试夹具、助手、exec-server 与临时目录后正常退出。隔离应用与源码副本保留供复核。没有对现装代理执行安装、升级、启停，也没有操作所有者的账号、项目或登录任务。

## 私有仓库：未验

卡将私有仓库列为可选且需所有者本人提供令牌。本轮未使用私有地址或令牌，未验证 private_without_token、private_with_token 或凭据记住行为。

## Windows 全量单测：undecidable，未执行

单测源码准备于隔离目录 `windows-agent-041/tests/agent`。执行者在复制命令尚未结束时启动 Windows pnpm 冻结安装，pnpm 查找 package.json 时文件尚未复制到位，退出 1。随后复制命令正常结束。

失败的安装命令（从隔离 tests/agent 目录执行）：

```powershell
& 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\node\node.exe' 'C:\Users\zymun\sunmoon-probe-runs\windows-agent-1d-20261008\corepack\v1\pnpm\10.24.0\bin\pnpm.cjs' install --frozen-lockfile --registry=https://registry.npmmirror.com
```

失败原文：

```text
ERR_PNPM_NO_PKG_MANIFEST  No package.json found in C:\Users\zymun\sunmoon-probe-runs\windows-agent-041\tests\agent
```

这是执行者把有依赖关系的准备操作提前启动造成的顺序错误，**不是代理代码失败或 Windows 沙箱失败的证据**。没有启动 vitest，不能填写通过/失败/跳过数，也不能声称 localProjects.test.ts 的 Linux 专用用例在 Windows 上已通过或已失败。

卡规定：“任何一步失败就停在那一步……不改代码、不重试成功了再报。”因此本轮没有重试依赖安装或继续跑单测。后续仍须独立跑 Windows 全量单测，并逐条报告 Linux 专用用例的结果；当前探针通过不能代替这一项。

## 交回范围

- pass：基线核对、构建、隔离应用核验、Windows 项目探针。
- fail：执行者的 Windows 单测依赖准备命令。
- undecidable：Windows 全量单测与 Linux 专用用例在 Windows 上的结果。
- 未验：可选私有仓库；现网安装/升级；网页创建项目及工作对话写 hello.txt 的端到端路径（不属于本卡探针结果）。
- 只提交本回执；不 push、不发布、不改其他仓。

exit=1
