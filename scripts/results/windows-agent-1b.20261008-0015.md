# Windows 第 1 段补验 1b：代理四项修复与第二次网页停点

基线：runtime/luna `0c5779d`；任务反馈：k8s `c8428efb` 最后一节。
时间：2026-10-07 23:30 至 2026-10-08 00:20（Asia/Shanghai）。
本轮只改 runtime；未 fetch、pull、rebase、push，也未改应用、k8s 代码或数据库。

## 结论与下一步

**1b 仍未通过，不进入第 2 段。**代理侧 a–d 已实现并通过本轮覆盖的测试；
真实网页读/写失败，专家未做。下一步需要远程核对 Linux 编排端的目录处理，
修好后再约所有者做三项，不能以本机确定性模型探针代替网页验收。

所有者确认新版沙箱已经重建，供给器检查退出 0，fable 本地提交 `42651574`；
Pod `sandbox-u-f1cee6277692-b87d4946d-8cjvc`，`[windows] sandbox="unelevated"` 已配置。
本轮实际读到这个 Pod 的两份 0.155.1 rollout。此前的沙箱级别前提已经满足。

## 1. 代理实现

| 反馈项 | 本轮改动 | 验证与边界 |
| --- | --- | --- |
| a 受管临时目录 | Windows init/start 各创建 `%LOCALAPPDATA%\sunmoon-agent\tmp\executor-<随机后缀>`，执行器与命令的 TEMP/TMP/TMPDIR 固定到它；生命周期持有目录固定进程，逐请求核对环境、目录身份和固定进程存活 | 远端大小写变体 TEMP/TMP/TMPDIR 都拒；模拟执行器环境被改、固定进程死亡后目录被替换为 junction，都拒；项目及受管 temp 可写，用户全局 Temp 和外部目录均被 OS 拒 |
| a slash_tmp | 接受固定 Windows 0.155.1 的精确特殊项，不添加任意目录 | 原生 project-only / tmpdir / slash_tmp / both 四组对照：slash_tmp 不增加写入位置；默认工作策略可用 |
| b 缺失路径 | 沙箱助手在已验证的目录内区分文件缺失和父目录缺失，回 `-32004`；错误消息从本机固定版原生执行器校准 | 六组 metadata/readFile（缺文件、缺父目录、多级父目录）逐字段相同；不存在的外部路径仍拒；缺失目标前有 dangling junction 仍拒，不伪装 not-found |
| c 结束命令 terminate | 每流保留结束 ID 60 秒、最多 256 条，补发 terminate 回 `{running:false}` | 实际进程结束后与原生相同；未知 ID、别流 ID、过期 ID 不放行；无相应活动命令的下游 closed 消息不能凭空登记 |
| d 固定配置读取 | 只允许真实客户端的 `configPaths=[["mcp_servers"]]`、`requirementsPaths=[["mcp_servers"]]`；助手只读代理 home/config.toml，确认是当前生成的无凭据配置，返回原生格式的空配置层 | 项目 `.codex/config.toml` 不读取/合并；其他文件、查询字段、被硬链接替换的配置都拒。完整 MCP 导入仍留第 2 段 |
| 本轮网页诊断 | 对不存在的 process cwd 明确报 `Windows working directory does not exist; select an existing project directory` | 原生测试通过；不自动创建用户项目目录、不将它笼统归为 worker unavailable |

本轮无新依赖、无自编译 exe、无 Python 文件助手，无管理员 setup 或安全策略修改。
临时目录只删本实例创建的子目录，不扫其他实例。异常断电残留回收尚未实现。
文件助手首次启动的两次缺失路径校准只读代理自有 home 下的随机不存在名称，不写探针文件。

## 2. 固定版本与测试证据

Windows Node 24.19.0、Codex 0.155.1、pnpm 10.24.0；Linux Node 24.18.0。

| 检查 | 结果 | 原件 |
| --- | --- | --- |
| Windows build + 回归 | 128 passed、1 skipped | [windows-tests-final.txt](windows-agent-1c-20261008/windows-tests-final.txt) |
| Linux build + 回归 | 105 passed、24 skipped（Windows 专用） | [linux-tests-final.txt](windows-agent-1c-20261008/linux-tests-final.txt) |
| 原生临时目录/缺失文件/配置/终止回包 | 已抓固定版真回包 | [native-contract.json](windows-agent-1c-20261008/native-contract.json) |
| Windows 客户端默认工作策略 | `client-created.txt = client probe OK`，命令和轮次成功；未排除 temp | [client-work-owned-temp.json](windows-agent-1c-20261008/client-work-owned-temp.json) |

Windows 唯一跳过项是 `precreated native symbolic links`：上一轮的独立 symlink 夹具已清理，
本轮未重新提权创建。用例仍保留，没有改成假通过；其此前证据在 1b 的原始结果中。
本轮实际重跑了 ordinary/elevated OS 写边界、junction、hardlink、替换竞态，以及新增 temp 攻击。
**不能写“本轮 Windows 全套全部通过”。**Linux 模型服务端到端脚本本轮未重跑。

第一版诊断只给 tmpdir 写权限、不给项目写权限，原生拒绝 split writable root sets；
另一条诊断漏传 Windows 必需环境，Node 启动失败。这两次都未当成沙箱成功。
改为真实客户端组合并传完整普通环境后，四组对照才成功。

原生请求/响应已追加 `probe/frames.jsonl`；环境值脱敏。
本机客户端对照仍有 12 条超白名单 metadata 探测被拒，但命令与轮次可以完成。
该对照两端都是 Windows，未覆盖 Linux 编排端的 Windows 路径规范化；这是本轮覆盖的缺口。

## 3. 真实网页：失败事实

临时机器仍叫 `luna-windows-stage1b-20261007`，根目录：
`C:\Users\zymun\sunmoon-probe-runs\windows-agent-1b-20261007\workspace`。
00:02:06 会合点确认连接；所有者在项目页实际发起读文件和建文件。
没有轮换令牌，使用现有私有配置；限定 10 分钟，由独立恢复控制器兜底。

| 项 | 实际结果 |
| --- | --- |
| 读项目文件 | 失败，5 次 process/start 被路径固定/工作进程保护拒绝 |
| 写 browser-check.txt | 失败，4 次权限路径无法解析；1 次请求无沙箱也被拒 |
| 请专家 | 未做；发现两个阻塞后停止重复请求 |

完整 59 条拒绝在 [live-denied.jsonl](windows-agent-1c-20261008/live-denied.jsonl)：

| 方法 / 原因 | 次数 |
| --- | ---: |
| fs/getMetadata：filesystem path outside the whitelisted roots | 49 |
| process/start：Windows path guard or sandboxed worker unavailable | 5 |
| process/start：unsupported filesystem permission path | 4 |
| process/start：Windows inner sandbox is required; disabled/none exceeds local ceiling | 1 |

本轮没有 environmentConfig/read、missing-file helper 或 late-terminate 的拒绝，
但不能仅凭没出现就宣称网页已完整验证所有补修。
运行日志：[live-agent.log](windows-agent-1c-20261008/live-agent.log)；
结束前状态：[live-status.json](windows-agent-1c-20261008/live-status.json)。

### 3.1 项目目录不存在

只读数据库确认两个会话的 project_root 都是上述根下面的 `myproject`：

- `e177465b-f1af-4ea4-be52-6bb6574c5f0d`（16:05:04 UTC 创建）；
- `6c63e644-650c-441f-9ffb-94f58bd2003c`（16:07:27 UTC 创建）。

Windows 只读盘点确认只有 workspace/README.md，没有 myproject 目录。
目录固定无法进入缺失的 cwd。这是读文件失败的具体原因之一，不应解释成原生沙箱整体不可用。
代理已补明确错误；后续用已有目录（项目相对路径留空），或由明确的创建项目流程建目录。

### 3.2 Linux 编排端生成混合路径

原始 rollout 投影：[live-rollout-projection.jsonl](windows-agent-1c-20261008/live-rollout-projection.jsonl)。

两条会话的 session_meta/turn_context.cwd 都被记录为：

```text
/data/C:\Users\zymun\sunmoon-probe-runs\windows-agent-1b-20261007\workspace\myproject
```

工作会话起初的 profile 有 Windows 路径和 `.git/.agents/.codex` 只读子目录。
正式 turn_context 又多出下面这一项：

```json
{
  "path": {
    "type": "path",
    "path": "/data/C:\\Users\\zymun\\sunmoon-probe-runs\\windows-agent-1b-20261007\\workspace\\myproject/.codex"
  },
  "access": "read",
  "missing_path_behavior": "skip"
}
```

这与桥同期的 `unsupported filesystem permission path` 一致。
本轮保存了完整拒绝日志和沙箱原始上下文投影，**没有抓到该网页轮次的原始 process/start
线上帧**，因此仍需远程核实 app-server 到 exec-server 的最终序列化。
新测试使用了相同混合路径的攻击变体，它是构造用例，不冒充线上抓包。

远程应优先核对：

1. `investment-backend/app/app/domain/workbench/projects.py` 的 `thread_settings()` 与
   `turn_settings()` 同时把 Windows directory 写进顶层 cwd 和 environments[].cwd。
2. `app/app/application/workbench/runner.py::_start_thread()` 旧设置分支也有同样结构。
3. 按固定版公开协议区分编排端本地目录和远端执行目录；用真实 Linux app-server → Windows
   exec-server 对照验证修改，确认不会再把盘符路径当 Linux 相对路径加 `/data`。
   不能只跑 Windows app-server 的本机对照。这里尚未给出经验证的具体修改方案。

**代理不得擅自删除只读限制、猜测性剥离 `/data` 或接受 sandbox:none 来绕过。**
这是跨仓问题；任务书要求交远程处理，本轮未改上述应用源文件或部署。

## 4. 恢复、清理与交接

收到失败结果后提前结束临时连接。控制器确认原 Linux 代理已恢复 connected，
PID `4066402`；原私有配置 SHA-256 与开始前一致。00:15 再次确认进程存在且在线。
原 Linux 启动 cwd、argv、环境原样恢复，没有重新生成或轮换令牌。

本轮测试副本、临时 Windows 私有配置及工作区清理由原生脚本在核实 PID 已退出后执行，
工作区须只有本轮创建的 README 才删除；清理回执见同目录 cleanup.json。
原 Linux 配置、旧 elevated 测试家和其他用户文件保留。

待远程修目录处理后：重新准备真实存在的测试目录 → 接 Windows 代理 → 项目页聊天列文件、
工作建文件、请专家三项 → 保存全部拒绝 → 恢复 Linux → 再交 1b。当前不能报交付完成。
