# 探针报告：本地上限由谁挡（D5）

日期 2026-09-23 · codex-cli 0.155.1 · 同一台机器扮演两端：app-server（编排端 = 我们的云）`CODEX_HOME=~/.codex-probe`，exec-server（执行端 = 用户机器）`CODEX_HOME=~/.codex-probe-exec`。脚本 `probe_local_ceiling.py`，输出 `ceiling.out`，exec-server 日志 `es-ceiling.log`。

## 问题

执行端（用户机器上的 `codex exec-server`）自己的本地配置，能不能拒绝编排端（云端 app-server）要求的更高权限？如果能，本地上限可以交给 Codex；如果不能，本地代理必须自己挡。

## 执行端的配置

```toml
# ~/.codex-probe-exec/config.toml
sandbox_mode = "read-only"
approval_policy = "never"

# ~/.codex-probe-exec/requirements.toml   （Codex 的 managed requirements 层）
allowed_sandbox_modes = ["read-only"]
allowed_approval_policies = ["never", "on-request"]
```

## 案例与结果

编排端每个 thread 用 `approvalPolicy: never`，所以任何"越界"要么被沙箱当场拒绝，要么直接成功；不会有审批请求把结果搅混。

| 案例 | 编排端要求 | 命令 | 结果 | 判定 |
| --- | --- | --- | --- | --- |
| L1 | `danger-full-access`，cwd = user-ws | `touch $HOME/probe-ceiling-L1-*.txt` | exit 0，`$HOME` 下文件已创建 | **执行端配置 read-only 无效** |
| L2 | `workspace-write`，cwd = user-ws | `touch $HOME/probe-ceiling-L2-*.txt` | `Read-only file system` | 沙箱按**编排端**的要求实施，正常 |
| L3 | `workspace-write`，cwd = user-ws | `echo L3 > PROBE_L3_*.txt` | exit 0，cwd 内文件已创建 | **执行端 requirements.toml 的 `allowed_sandbox_modes=["read-only"]` 无效** |
| L4 | `read-only`，cwd = `/tmp/probe-outside-root`，`runtimeWorkspaceRoots=[user-ws]` | `pwd && ls -la` | exit 0，在 `/tmp/probe-outside-root` 执行 | **执行端没有根目录白名单的概念**；cwd 在声明根之外照跑 |

另外，前一轮误跑的旧探针 B 阶段再次证明：编排端（客户端）对 `item/commandExecution/requestApproval` 回 `accept`，执行端就在 `workspace-write` 沙箱之外创建了 `$HOME` 下的文件。审批的决定权也完全在编排端。

**结论：exec-server 不设本地上限。** 沙箱策略、cwd、workspace roots、审批决定全部由编排端随每个请求下发，执行端只负责实施。

## 源码印证（`~/repo/codex`，HEAD 2026-08-28；与 0.155.1 不完全同版，行为以上表为准）

- `exec-server/src/process_sandbox.rs`：`permissions` 直接来自请求里的 `sandbox_context.permissions`；执行端唯一的拒绝是"要求了沙箱但本机没有沙箱实现"（`sandbox intent cannot be enforced on this executor`）；请求里 `sandbox` 为空（即 danger-full-access）时直接 `SandboxType::None` 跑。
- `exec-server/src/environment_config.rs`：执行端的本地 `config.toml`/`requirements.toml` 只是被**编排端读取**（`environment/config/read`，目前只用于发现 `mcp_servers`）；`allowed_sandbox_modes` 这类约束由编排端的配置加载器应用。也就是说约束的实施方就是我们威胁模型里不可信的那一端。
- `exec-server-protocol/src/protocol.rs`：协议不止 `process/*`；还有 `fs/readFile`、`fs/writeFile`、`fs/remove`、`fs/walk`…（各带可选 `sandbox: FileSystemSandboxContext`，同样由编排端给），以及 `http/request`、`network/policyRequest`。上限必须盖住这三族，不只是进程。

## 对设计的影响

D5 关闭：**本地代理自己挡**，两层（写进 `tree-build/SDD/architecture/security.md`「本地上限」）：

1. **OS 级外沙箱**：代理把 exec-server 进程本身放进只能写白名单目录、按策略限网的 OS 沙箱（Linux bwrap/landlock，macOS sandbox-exec）。这是硬上限，不依赖协议解析，Codex 升版不失效，`fs/*`、`http/*`、`process/*` 一并盖住。
2. **出站桥内的协议过滤**：桥解析 exec-server JSON-RPC，`process/start` 沙箱意图高于上限、cwd 或 roots 在白名单外、`fs/*` 路径在白名单外、`http/request` 与 `network/policyRequest` 越出策略，直接回 JSON-RPC 错误不转发。给的是干净的拒绝与可观测（`AT-09`），抬高上限的弹窗挂在这里。

推论：**不能**用 Codex 自带的 `exec-server --remote <URL> --remote-transport noise` 注册模式让沙箱与执行端端到端加密直连——桥看不到协议就过滤不了。③ 在桥内保持明文 JSON-RPC，公网段的加密由代理与沙箱到会合点的 WSS 承担。

## 新发现，记入未验证事项

`codex exec-server --help`（0.155.1）有 `--remote <URL>`、`--remote-transport noise|direct`、`--environment-id`、`--use-agent-identity-auth`、`forward` 子命令：Codex 自带一套"执行端出站注册到远端"的机制。它能不能当我们的会合点用、noise 模式下桥还能不能过滤，是 `0004-relay` 探针（第一段第 3 项）要先回答的问题。

## 复现

```bash
# 执行端
setsid env CODEX_HOME=$HOME/.codex-probe-exec codex exec-server --listen ws://127.0.0.1:47001 > es-ceiling.log 2>&1 < /dev/null &
# 编排端
env CODEX_HOME=$HOME/.codex-probe python3 -u probe_local_ceiling.py > ceiling.out
# 结束：按端口找 pid，不要 pkill -f
kill $(ss -ltnp | grep ':47001 ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
```
