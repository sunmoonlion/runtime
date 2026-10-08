# 下载与接入实现记录（2026-10-09）

依据 k8s `d1cc2d65` 最后一节：所有者批准最小路线、代理令牌 **30 天**；托管位置由远程定，
后端配置为空即暂不可下载。仅本地提交；发布前另报具体对象。旧方案 24 小时不执行。

## 顺序

| 阶段 | 状态 |
| --- | --- |
| 0 包体审计、ZIP 实测 | 完成，见下 |
| 1 后端配置、30 天、并发/重放、no-store 与身份 | 26 项定向测试通过，pyright 0 错误，ruff 通过，分层 4/4 |
| 2 CLI 隐藏输入令牌 | Windows 16/16、Linux 15/1 Windows 专用跳过；真实 Linux PTY 非敏感夹具验证通过 |
| 3 网页接入迁到「我的机器」 | 待实施 |
| 4 固定源码组新包，核对最终 ZIP | 待实施，不自行发布 |

适用约束：C-I3/I5/I6 身份与 CSRF，C-I9 按本次所有者定案 30 天；C-A11 本机权限不变；
C-C3/C-C4 后端提供契约、网页配套；C-T5 分仓提交、C-R8 固定兼容版本。

## 包体审计

完整机器可读清单：[package-before.json](windows-agent-onboarding-20261009/package-before.json)。
路径前缀 `V` 为 `app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/`。

| 排名 | 包内路径 | 字节 |
| --- | --- | ---: |
| 1 | V/bin/codex.exe | 307108144 |
| 2 | node/node.exe | 92825416 |
| 3 | V/bin/codex-code-mode-host.exe | 72473904 |
| 4 | V/codex-resources/codex-windows-sandbox-setup.exe | 15498544 |
| 5 | V/codex-resources/codex-command-runner.exe | 8217904 |
| 6 | V/codex-path/rg.exe | 4218880 |
| 7 | licenses/node-LICENSE | 157606 |
| 8 | app/node_modules/ws/lib/websocket.js | 37367 |
| 9 | app/node_modules/smol-toml/dist/index.cjs | 26378 |
| 10 | app/node_modules/ws/lib/receiver.js | 17439 |

89 文件共 **500974988 字节（477.77 MiB）**。只有一个 Codex 主程序，六个 exe 均不同；
无 PDB/map 调试符号、无其它 OS/CPU 平台包。code-mode-host 是官方随包的另一程序，
没有“不需要它”的证据，不能当重复主程序删；沙箱辅助程序及许可证保留。JS 的零星辅助文件
不构成大体积来源，本轮不改官方签名二进制或冒险删依赖。

对已有固定包 `21f864b` 实际 ZIP Deflate-9：**174242372 字节（166.17 MiB）**；
SHA256 `576799e69496663b472f80143ae6bfee474508f53417945a8397e5481bd66d36`。
ZIP CRC 及解压后全部 89 文件摘要与原文件逐一相等。此为基线测量，**不是新功能发布包**；
大幅缩小的是传输压缩，安装占用仍 477.77 MiB。最终包组装后另报实测。

## 后端检查与失败记录

`tests/test_agent_onboarding.py test_workbench_tokens.py test_workbench_provisioning.py test_auth_routes_security.py`：
**26 passed**。覆盖并发首次请求仅一份签发、旧 revision 重放拒绝、锁跨提交/错误释放、
代理 30 天/沙箱 90 天、状态只给元数据、未配置下载、非法配置、鉴权、两个动作的 Origin/CSRF。
运行于临时容器 `sunmoon-onboarding-tests-20261009` 的 `onboarding_tests`；业务卷未挂载。

初次失败：测试 Settings 使用小写字段而本配置要求环境别名，导致 download 为 null，已修夹具；
临时 PostgreSQL 初始 HBA 不接受 Docker 网关、SQL_ASCII 编码令驱动报 bytes 类型错误，
已仅在临时实例修 HBA 并重建空 UTF-8 测试库后通过。首次 pytest 工作目录错误，无测试运行。
失败输出及最终结果在 [证据目录](windows-agent-onboarding-20261009/)，不把这些失败算产品通过。

后端契约/配置说明在 investment-backend `app/contracts/agent-onboarding.md`。
还未改网页、CLI，也未发布后端；此时不能从新后端单独上线轮换接口，因为网页还未传 revision。

## CLI 阶段

后端本地 `8279c2c`，投资父仓 `f049fe6` 已跟随；子仓同步留下 detached HEAD，
已确认旧 luna 是祖先后快进并切回 luna，未丢弃或合并别人工位。

`init --token-prompt` 只从本机 TTY 隐藏输入，拒管道，支持退格、Ctrl+C 和两分钟超时；
错误不含输入，终止恢复原始终端模式，不保存配置。旧 --token 保留兼容；两种参数不能同时使用。
编译通过，Windows 原生 16/16、Linux 15 通过/1 Windows 专用跳过；实际 Linux PTY 用固定
无凭据字符串验证匹配、无回显、raw 模式恢复。没有为真实用户输入令牌或替人批准权限。

初次 Linux CLI 子进程受工具沙箱 EPERM 阻拦，主机权限重跑通过；首次原生 vitest 从 WSL
UNC 工作目录起时报告 Invalid regular expression，改从已有 Windows 本地测试目录运行通过。
未修改测试器依赖或系统策略。Windows 测试含真实 unelevated 沙箱准入，但不是新包完整验收。
