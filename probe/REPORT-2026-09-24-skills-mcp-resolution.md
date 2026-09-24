# 探针报告：远端环境下 skills 与 MCP 配置从哪一端解析

日期 2026-09-24 · codex-cli 0.155.1 · app-server（沙箱角色）`CODEX_HOME=~/.codex-probe`，exec-server（用户机器角色）`CODEX_HOME=~/.codex-probe-exec`，cwd = `probe/user-ws`。脚本 `probe_skills.py`。

## 问题

Codex 拆成两半后，"用户的配置"指哪一边？用户自己的 skills、MCP 配置还生不生效？

## 做法

三处各放一个带标记的 skill，让模型在远端环境的 thread 里列出它看到的 skills，不许跑命令：

| 位置 | 在哪台机 | 标记 |
| --- | --- | --- |
| 项目目录 `cwd/.agents/skills/project-skill/` | 用户机器（经 exec-server 读） | `PROJECT_SKILL_MARKER` |
| 执行端 `CODEX_HOME/skills/executor-skill/` | 用户机器 | `EXECUTOR_SKILL_MARKER` |
| 编排端 `CODEX_HOME/skills/cloud-skill/` | 沙箱 | `CLOUD_SKILL_MARKER` |

## 结果

| 位置 | 看见了吗 |
| --- | --- |
| 项目 `.agents/skills`（用户机器） | **是** |
| 执行端 `CODEX_HOME/skills`（用户机器） | **否** |
| 沙箱 `CODEX_HOME/skills` | **是** |

模型还列出了沙箱 Codex 自带的 `imagegen`、`openai-docs`、`plugin-creator` 等内置 skills；零条命令执行，说明 skills 列表是 Codex 在 turn 前自己收集的，项目级的那一份是经 exec-server 的 `fs/*` 从用户机器读来的。

MCP 配置（源码 `exec-server/src/environment_config.rs`）：编排端只从执行端读 `mcp_servers` 这一段（`environmentConfig/read`，路径 `["mcp_servers"]`），且只保留有 `url` 的 HTTP 型；执行端的其它配置（模型、审批、沙箱、skills）一律不读。

## 结论

| 用户在自己机器上放的 | 生效吗 | 为什么 |
| --- | --- | --- |
| 项目里的 `.agents/skills/`、`AGENTS.md` | 生效 | 跟着 cwd 走，经 exec-server 读 |
| `~/.codex/skills/`（全局 skills） | **不生效** | app-server 只读自己（沙箱）的 `CODEX_HOME` |
| `~/.codex/config.toml` 的模型、审批、沙箱偏好 | **不生效** | 同上；这些设置要经网页写进沙箱配置 |
| `~/.codex/config.toml` 的 `[mcp_servers]`（HTTP 型） | 生效 | 编排端专门从执行端读这一段 |
| `[mcp_servers]` stdio 型 | 未验，预计不按用户期望 | 进程会由沙箱那一端起，不在用户机器上 |

注意"执行端 `CODEX_HOME`"在产品里是**代理自己的** `~/.sunmoon-agent/codex-home`，不是用户日常的 `~/.codex`；用户的 HTTP MCP 要生效，代理得把用户 `~/.codex/config.toml` 里的 `[mcp_servers]` 合并到那里（或在代理里提供配置项）。

## 对设计的影响

- 我们给模型的两样东西各有位置：`sunmoon-data` skill 随沙箱镜像装在沙箱 `CODEX_HOME/skills`；知识服务 MCP 写在沙箱 `config.toml`。都由镜像入口脚本生成。
- 用户的全局 skills 想用，第一期的办法是放进项目 `.agents/skills`；把用户 `~/.codex/skills` 同步进沙箱是以后的功能（要上传，隐私不作约束所以可做）。
- 用户的模型与审批偏好是 thread 级设置，从网页设置页写进沙箱配置，不读用户本机。
- `decisions.md` 未验证事项「MCP 与 skills 在远端环境里的解析」关闭；新开一条：stdio 型 MCP 在远端环境下跑在哪一端。
