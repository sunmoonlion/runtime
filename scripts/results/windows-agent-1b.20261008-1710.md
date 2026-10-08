# Windows 第 1 段补验：POSIX 只读后备目录规则

基线 runtime/luna `526401c`；反馈 k8s `f14dbc1e` 最后一节。
2026-10-08 下午，仅改 runtime；未 fetch/pull/rebase/push，未改工作台、部署或数据库。

## 结论

反馈允许的规则已实现，代码回归完成。**1b 尚未通过，不进入第 2 段。**
本轮未启动现网 Windows 代理、未进行网页三项验收；只读核查发现现网 runner
还在把 Windows 目录发送到顶层 cwd，待办 34 的前提尚未满足。

## 本轮改动与边界

- `windowsPolicy.ts`：共享判定只接受纯 POSIX 文件 URI、`read`、`skip` 同时成立。
- `windowsBridge.ts`：在固定目录及转发之前删除上述无效项。
- 真实 Windows 保护项保留；写、deny、没有 skip、混合 `/data/C:\…`、
  Windows 越界/别名/设备/UNC 路径仍拒绝。没有剥前缀、转换路径或开放新目录。
- `fs/*` 白名单没有放宽；Windows `.codex` 保护不会被本规则移除。
- 新增策略/转发用例；原生受限命令用例加入 `file:///data/.codex` 只读跳过项，
  验项目和受管 temp 写入成功、项目外及用户全局 Temp 写入被 OS 拒绝。

| 约束 | 本轮落实 |
| --- | --- |
| C-C7/C-C8 | 仍固定 Codex 0.155.1，公开协议，未升版 |
| C-A7/C-A11 | 仅按反馈丢弃不能提供 Windows 权限的项；拒绝写越界及关闭沙箱 |
| F-AGENT-10 | 无新增凭据读取；本輪未复制现网令牌到 Windows |

## 测试

Windows Node 24.19.0 / pnpm 10.24.0 / Codex 0.155.1。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Windows build/typecheck | 退出 0 | [build](windows-agent-1d-20261008/windows-build.log)、[typecheck](windows-agent-1d-20261008/windows-typecheck.log) |
| Windows 回归 | **130 passed、1 skipped**，11 个文件 | [原始输出](windows-agent-1d-20261008/windows-tests.log) |
| Linux build/typecheck | 退出 0 | 本轮工具执行记录 |
| Linux 回归 | **107 passed、24 Windows 专用 skipped** | [原始输出](windows-agent-1d-20261008/linux-tests.txt) |
| Windows 测试副本与本地源码 | 14 个 src 文件逐文件摘要相同 | [摘要](windows-agent-1d-20261008/tested-source.json) |

Windows 跳过的仍是 `precreated native symbolic links`：没有重建需管理员的独立夹具。
其余 ordinary/elevated 写边界、junction、hardlink、目录替换、临时目录、真实 CLI 生命周期
均运行。不得把这个结果写成 Windows 全套无跳过。没有调用模型，不能替代网页验收。

Linux 第一次在助手受限环境运行，子进程及 loopback listen 被 EPERM 阻止：
16 failed、91 passed、24 skipped。获准在宿主环境重跑后上述 107 项通过；没有改测试
来绕过失败。Linux 模型服务端到端脚本本轮未重跑。

## 待办 34 与下一轮准备

17 点前后只读核查 `app-platform-dev/deploy/investment-runner`，镜像仍为：

`harbor.sunmoonai.com:30443/platform/investment-backend@sha256:ac5bdcd5ea531648b41b0248ce53fac2b17e1e1e90d427323b5bce34b5050b2e`

实际运行源码仍在 `projects.py` 的工作/项目聊天设置以及 `runner.py` 的旧设置分支
写顶层 Windows cwd。核查时间、源码摘要、原代码摘录见
[deployed-runner-cwd.json](windows-agent-1d-20261008/deployed-runner-cwd.json)。
这是核查时的状态，不代表远程尚未写好代码；修复提交 `7ac05d2a` 由待办 34 发布。
本轮没有代替 Cursor 执行跨仓构建/发布。

已创建并核对 Windows 项目目录（未覆盖既有文件）：

`C:\Users\zymun\sunmoon-probe-runs\windows-agent-1b-20261007\workspace\myproject`

只有 `README.md`，`browser-check.txt` 尚不存在。见
[workspace-prepared.json](windows-agent-1d-20261008/windows-workspace-prepared.json)。
代理产品本身仍不会替用户自动创建不存在的 cwd。

下一轮顺序：确认新 runner 代码生效 → 核对目录及代理现状 → 限时连接 Windows，
捕获脱敏的实际权限路径 → 所有者从项目页新聊天列文件、新工作写
`browser-check.txt`（`Windows stage1b OK`）、请一次专家 → 完整拒绝明细 → 恢复并交审。

## 连接与临时副本

本轮没有替换原 Linux 代理。只读检查发现：原 status.json 停在
`2026-10-07T16:29:11.193Z`，PID 4066402 已不存在；未找到另一个 cli.js start 进程。
因此不能沿用历史“connected”字段宣称当前在线。本轮未猜测原因、未自动重启或换令牌。
下一轮连接前须重新核对；临时替换后按实际起始状态恢复。

Windows `windows-agent-1d-20261008` 测试副本与上述项目目录暂留供待办 34 后立即复验；
不含复制的现网令牌，未创建 live-home。测试自有临时工作目录由用例收尾。
完成网页验收后再清理本轮副本/项目夹具，不能把这条写成已清理。
