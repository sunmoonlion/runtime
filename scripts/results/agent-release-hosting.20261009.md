# 私有安装包托管与接入页面：候选交回

## 结论与固定提交

按 k8s `67e9fa97` 最后一节的方案 A，以及所有者随后提出的四项页面修改实施。
**代码、本地检查及原安装包校验已完成；未发布、未建真实桶、未上传。**
保持反馈要求的发布前停点，由所有者同步后安排 Cursor 发布与真人验收。

| 仓 | 本地提交 | 内容 |
| --- | --- | --- |
| investment-backend | `a01db6f10f22d11116ba4421309ca676e2790f18` | 认证下载、固定对象与流式 Range、配置、测试、预览录制 |
| investment-web-frontend | `2095c04927a1510efc54bef5ffd28e0c52d25558` | 四项页面调整及双端预览样例 |
| investment-app | `231f305de2e0b72edb3d7cdd7c880151f8e3aaaf` | 提交上述两个子仓 gitlink |
| k8s | `2966f98b8454de051967b52b935a6b48f972cbb1` | 桶与身份声明、原部署链接入、Make 校验/上传入口、维护说明 |
| runtime | 本报告所在提交 | CHECKPOINT、检查归档；代理产品源码未改 |

所有改动在 luna；未自行 fetch/pull/push，父仓指针与上述子仓提交对应。
info、knowledge、tpl 未改。安装包沿用固定 `6de6002`，没有因网页/后端修改重组代理。

## 已实现

### 页面四项

1. 通用首页首次欢迎卡合并原来下方重复的“没有沙箱”提示，先设置模型 key，再接入电脑；两个链接顺序一致。
   显式聊天入口 `?mode=chat` 仍不提示接电脑。
2. 五步上方改为“前两步做完自己打勾，后三步做完会自动打勾。”，勾选项使用“校验值”；中英文同步。
3. 第三步只要已有令牌签发记录，或有电脑在线，就自动勾选。下载、安装仍由用户确认。
   这些进度不替代本机授权，也不改变令牌签发或失效规则。
4. 从真实本地后端路由补录 GET `/api/workbench/agent/download`：full/offline 为配置态，empty 为未配置态。
   三个预览 manifest 已引用样例；演示 URL/摘要只作夹具，不可用于实际安装。

### 后端下载

- GET/HEAD `/api/workbench/agent/package` 复核 Web 登录；对象名、ZIP 长度和摘要仅来自固定配置，拒绝查询参数指定对象。
- 六个公共下载字段不变，内部 `mode`、`object_key` 与存储身份不返回浏览器。
- 支持完整下载、单段 Range（含后缀/开放结尾）、206/416 与 If-Range；返回长度、附件名、完整 ZIP 校验值及清单校验值，`no-store`。
- boto3 只使用显式只读身份、HTTPS endpoint 和 CA，禁用代理与 SDK 跳转；HEAD 核长度及摘要元数据，GET 绑定原对象 ETag。
- 以 64 KiB 块转发，完整下载重算 SHA256，发送最后一块前核实长度/摘要；断开或失败关闭上游流。
  Range 片段依靠固定对象元数据与 ETag，不宣称仅凭一个片段重新计算了完整 ZIP 的摘要。
- `external` 模式返回配置的 HTTPS 地址，`object-storage` 模式返回同站后端下载地址。
  边缘就绪后只需换配置并发布，不改网页或代理。
- 未配置/非转发模式直接请求 package 返回 404；上游连接或元数据不符返回脱敏 503。
  流已开始后的损坏/断开终止传输，由接收端按长度/摘要判失败，不伪装成功。

### 桶、权限和上传

维护入口与配置同放：
`k8s/gitops/components/app-platform/investment-app/investment-backend/agent-releases/`。
详细发布、回退与日常方法见该目录的 `README.md`；本报告只保留实施证据。

- 私有桶 `agent-releases`，版本记录开启。API reader 只有本桶 `s3:GetObject`；独立 writer 只有本桶 `s3:PutObject`。
  无列桶、删除或管理权限。管理员仅供现有对象存储初始化 Job；API、Worker 等不拿管理员或上传密码。
- 凭据沿用已有私有输入、恢复副本、SOPS 和 Flux 流程；API 单独挂 reader Secret/CA，其他角色不挂。
  本轮没有生成真实凭据或密文。
- `agent-release-verify` 只读核 ZIP、清单和全部成员；拒绝路径越界、重复条目、链接及超限包。
- `agent-release-upload` 重复校验后检查容量和集群 UID；回环 port-forward、TLS CA、SigV4、无代理/无跳转。
  持有已校验文件描述符，上传前后核文件身份；`If-None-Match: *` 禁止同名覆盖。
- 上传后用独立 reader 流式读回 SHA256，并检查 writer 读取、reader 写入被拒。
  已存在对象只读回核对；失败不覆盖、不删除、不生成成功回执。
- 转发模式开启下载前，渲染要求私有发布回执与固定对象/大小/摘要一致。
  默认 `enabled: false`、`download_available: false`，本次提交本身不会开放下载。
- 接入原组件 prepare/stage/deploy/verify 与 Make；关闭开关时保留原应用运行摘要输入。

约束核对：C-D3/D4 独立桶/身份/Secret；C-I3/I5 后端复核浏览器身份；C-C4 双端契约测试；
C-T4/T5 父子仓提交对应；C-R1/R8 固定源码、包与 Codex 版本。没有数据库 schema 变更。

## 实际检查与边界

| 检查 | 本次结果 | 证据范围 |
| --- | --- | --- |
| 后端全套 | **667 passed, 258 skipped** | 本机未配置专用 `_tests` PostgreSQL，数据库相关项跳过；不等同此前有数据库的 881/5 结果 |
| 后端 lint / 分层 | ruff 通过，4 contracts kept | 全后端；新增 boto3 留在基础设施层 |
| 后端预览补录 | 3 passed | 本地真实 FastAPI descriptor 路由，非线上 HTTP |
| 网页全套 | **226 passed, 2 skipped** | 两项既有跳过；包含下载样例消费与在线勾选 |
| 网页工程检查 | 类型、lint、687 个 i18n 键、生产构建通过 | Node 24.18.0 / pnpm 10.24.0 |
| 上传与模板检查 | 10 个 unittest 方法通过 | 合成包/伪传输/模板；条件写、身份边界与失败拒绝，非真实 AIStor |
| Ansible 表达式 | 三种模式共 15 tasks，changed=0 | 转发关/开、外部地址；虚构凭据，不读真实私有输入 |
| Ansible 语法与阶段图 | 通过；72 stages / 40 objects | 新阶段及依赖可生成；未晋级 Flux |
| 原 ZIP 经 Make 校验 | 3 tasks 通过，changed=0，90 个文件一致 | 原 166 MiB ZIP；上传任务均跳过 |

原始成功、失败输出及独立表达式探针归档于
[checks.json.gz](agent-release-hosting-20261009/checks.json.gz)，含逐文件 SHA256。
归档中的探针凭据是明确的 `a…`/`b…`/`fixture`，不是真实身份。

### 失败及修正记录

保留失败原文，不以最终成功覆盖：

1. 沙箱内同步路由测试停滞，仅输出进度点；结束本轮两个精确 PID 后在宿主重跑。
2. 第一轮后端 **1 failed, 45 passed**：`KeyError: 'x-checksum-sha256'`。
   原异常处理中间层没有保留 416 头；下载路由直接返回带头 Response，未扩大修改全局异常处理。重跑 46 通过，新增边界亦纳入最终全套。
3. 首次预览补录 **2 failed, 1 passed**：`AssertionError: assert (None is None) == ('full' == 'empty' ...)`。
   夹具用了未生效的小写配置名，改为实际环境别名 `WORKBENCH_AGENT_DOWNLOAD`，三种场景全部通过。
4. 网页沙箱内 `Error: listen EPERM: operation not permitted 127.0.0.1`；宿主复跑时剩一项：
   `expected [...] to have a length of 2 but got 3`。旧测试仍按“在线不勾令牌”计数，依本次要求改为 3；最终 226/2。
5. Ansible 沙箱内 `TimeoutError: Local RPC server did not start.`；宿主运行实际只读 Make verify 通过。
6. Next 沙箱构建 `creating new process / binding to a port / Operation not permitted (os error 1)`；
   宿主构建通过，未改产品权限、依赖版本或测试断言来绕过执行环境。
7. boto3 首次离线解析因现有 duckdb 元数据缓存不足未完成；按项目清华源在线解析成功，锁定依赖后安装。
   未修改全局源/代理/TLS 设置；这次解析错误未另存独立日志，不冒称归档含该原始输出。

### 重跑

本轮无需 Windows。后端在 `investment-backend/app` 用项目虚拟环境执行：

```bash
.venv/bin/pytest -q
.venv/bin/ruff check .
.venv/bin/lint-imports
PREVIEW_AGENT_DOWNLOAD_OUT=../../investment-web-frontend/app/preview/fixtures .venv/bin/pytest -q tests/test_preview_agent_download.py
```

数据库检查须按项目现有测试约定配置独立测试库，不能拿业务库替代。
网页在 `investment-web-frontend/app` 使用 Node 24 与 pnpm 10.24.0，依次运行
`typecheck`、`lint`、`check:i18n`、`test`、`build`。本机 pnpm 入口是
`node /home/zymun/.cache/node/corepack/v1/pnpm/10.24.0/bin/pnpm.cjs`。
测试服务/Ansible RPC/构建需要本机回环监听；受限执行环境拒绝时按正常审批流程在宿主重跑。

上传模块单测与包校验，从 k8s 根目录运行：

```bash
python3 gitops/components/app-platform/investment-app/investment-backend/agent-releases/test_upload.py
AGENT_ZIP=/mnt/c/Users/zymun/sunmoon-probe-runs/windows-agent-3-20261009/sunmoon-agent-0.2.1-6de6002-windows-x64.zip make -C infrastructure agent-release-verify
```

Windows 安装包验证仍沿用原 `windows-agent-onboarding.20261009.md`，本轮未重新跑 Windows 发行测试。

## 固定包与 Cursor 下一步

| 项 | 值 |
| --- | --- |
| Agent / Codex / Node | 0.2.1 / 0.155.1 / 24.19.0 |
| 包内源码 | `6de600279ffc1996e19409b1bd6c4ee1eb1eccbe` |
| ZIP | `C:\Users\zymun\sunmoon-probe-runs\windows-agent-3-20261009\sunmoon-agent-0.2.1-6de6002-windows-x64.zip` |
| 大小 | 174243923 字节；166.17 MiB |
| ZIP SHA256 | `2d5421627198b9cf2eccf15d88b726c80d46f4180e2db30606120f5bd52aea5a` |
| manifest SHA256 | `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2` |
| 展开内容 | 90 个文件；500978970 字节 |

**发布顺序已写在 k8s 模块 README，所有者安排后执行：**

1. 固定上述后端/网页源码构建并记录原 Flux/镜像回退点；不能从尚未合入的 fable 发投资后端或 relay。
2. 开模块、保持下载关闭，通过原 stage→提交→Flux 发布→显式晋级建桶/身份与 API 只读配置。
3. 运行 upload；实测私有桶、外桶隔离、两项拒绝、条件写、重复上传无新增版本，核完整读回摘要。
4. 回执一致后开下载并晋级；实测登录/未登录、GET/HEAD、206/416、完整文件校验与 UI 预览。
5. 浏览器下载→安装→令牌→目录→在线；核 JWT 签名和 30 天到期。记录当时真实镜像/Flux 摘要。

这些实机项目仍为**待验**，不能因单测、Stubber 或模板通过就判正式发行。
失败可关下载或恢复原固定 Flux/镜像；保留桶、对象与凭据备份，不自动清桶。
原待验继续保留：GUI 真人允许→审计→执行、已装实例网页肉眼在线、重启登录自启、可选 UAC、
干净 Windows、两次旧投影拒绝原始参数；MCP 被拒的完整 URL 留下次自然实测补证。

## 现场收尾

本轮没有部署、上传、启动代理、改真实凭据或修改 Windows 安装实例。
原 ZIP、Windows 展开目录、工作区与真实代理配置保留。
原始日志归档并逐字节核对后，清理本轮独有的 `/tmp/luna-agent-hosting-checks`、
`/tmp/luna-ansible-hosting`、已定位的 Next 失败日志及新模块 Python 缓存；不广泛清理其他临时目录。
两项停滞测试的精确 PID 已不存在。最终本地提交后由所有者跑 `WS=luna bash ~/switch-test/human-remote.sh` 同步。

## Fable 审读后（2026-10-09）

审读基线 k8s `67e9fa97`；Fable 通过提交 `71048534` 接受候选，并要求钉投资源版本、准备 Cursor 三段发布卡、
归档旧待办。已完成：

- k8s `87f56ec2`：sources.yaml 固定 investment parent `231f305d`、backend `a01db6f1`、web `2095c049`；
  backend/web parent 字段同步到已审子仓提交，admin 与其他应用未变。
- k8s `b949c04c` + `59e2f08c` + `70528a59`：新增并完善 `inbox/2026-10-09-35-agent-release-hosting.md`，分 A（成对构建并部署、下载关闭）、
  B（私有桶上传及权限/读回实测）、C（读回核准后开放下载与接口检查）；失败即停。先交 Fable 审阅，收到通过与所有者通知后才由 Cursor 执行。
- 已完成的 `2026-10-08-luna-stage2-cursor.md` 从 inbox 移至 done，内容未改。
- 修改前本地 `luna` HEAD 与 `origin/luna` 均为审读合并提交 `723d637d`，因此在该同步基线上继续；
  未自行 fetch/pull/push。四笔新增提交均在本地 luna，尚未同步。

Cursor 卡不包含浏览器真人下载/安装/领令牌/在线验收；仍由所有者完成。此记录没有表示发布已经开始。
