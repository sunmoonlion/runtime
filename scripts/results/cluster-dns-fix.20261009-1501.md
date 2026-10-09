# 集群重启 DNS 修复与验收回执

日期：2026-10-09（Asia/Shanghai）  
目标集群：`sunmoon-kind`  
代码候选：`k8s` 仓本地提交 `05d2f7d0`（未推送、未发布、未应用）

## 根因

Windows 全局 `SuffixSearchList` 为空；活动 Wi-Fi 网卡从 DHCP 收到的 `ConnectionSpecificSuffix` 和注册表 `DhcpDomain` 均为 `172.16.8.0/22`。它是 CIDR，不是 DNS 搜索域。WSL 原先从 `/mnt/wsl/resolv.conf` 继承该搜索项，进入 KIND 节点后又被放大为 Pod 的搜索查询。应用使用 `ndots:5` 时，短服务名解析超过应用就绪探针的 2 秒预算，导致 API readiness 超时并阻塞 Flux 健康检查。

Pod 内对比验证：不加结尾点的短服务名解析约 4 秒；完整服务名结尾加点时小于 1 毫秒。修复后默认 Kubernetes 搜索域保留，宿主 CIDR 不再进入 Pod resolver。

## 宿主改动与回退资料

- `/etc/wsl.conf` 设为 `generateResolvConf=false`。
- `/etc/resolv.conf` 从指向 `/mnt/wsl/resolv.conf` 的符号链接改为普通文件，仅含 `nameserver 10.255.255.254`；没有改写 `/mnt/wsl/resolv.conf`，没有设置 `search`。
- Windows 用户目录 `.wslconfig` 明确设置 `dnsTunneling=true`。该固定 nameserver 依赖 WSL DNS 隧道。
- 维护前资料在 `/etc/sunmoon-dns-fix-20261009/`，目录为 root:root、0700，包含旧 `wsl.conf`、旧 `resolv.conf` 链接和链接目标内容。`.wslconfig` 原件另存为 `C:\Users\zymun\.wslconfig.before-dnsTunneling-20261009`。
- WSL 已在所有者批准的窗口内完整关闭并启动；启动后数据盘正常挂载，未删除集群或数据。
- 路由器仍可能通过 DHCP 提供错误 suffix；本修复在宿主 resolver 层固定了 WSL DNS 入口，并不更改路由器。若关闭 WSL DNS 隧道或隧道地址失效，需重新检查。

## 重启后真实验收

- 三个 KIND 节点均为 `Ready`，版本 `v1.36.5`。
- 三个节点 `/etc/resolv.conf` 的 nameserver 均为 `172.18.0.1`，无 `search` 项。就绪应用 Pod 的 resolver 保留 `app-platform-dev.svc.cluster.local svc.cluster.local cluster.local`，无 `172.16.8.0/22`。
- 新增 `make cluster-dns-check` 只读探针已对真实集群运行通过。它检查全部三个节点的 resolver 搜索域，随后从一个 Ready 应用 API Pod 查询 `postgresql.data-platform-dev.svc.cluster.local` 十次；最新一次样本最大 `4.4 ms`，阈值为 `200 ms`。后续复测中最大样本仍为 `5.0 ms`。
- 重启后早期 20 次样本：PostgreSQL 服务查询最大 `25.5 ms`、中位 `1.6 ms`；Redis 服务查询最大 `22.1 ms`、中位 `1.5 ms`，均低于阈值。
- 最终状态核对：Flux Kustomization `71/71 Ready`；三个应用 API、Worker、Scheduler 均 Ready，MongoDB `1/1 Running`；`investment`、`info`、`knowledge` 的内部与公开 `application-check` 均 `failed=0`。
- MongoDB 原 readiness 命令 `mongosh --quiet --nodb --file /settings/health.js` 退出码为 0，Pod `Ready=True`。没有观察到与 DNS 修复分离的 MongoDB 故障。

## 韧性代码候选

提交 `05d2f7d0` 在 app-platform 的共用 API/Worker/Scheduler/Runner、Web/Admin 模板及身份、数据库、迁移、Redis、RabbitMQ、对象存储和初始化 Job 模板中加入 `dnsConfig.options.ndots=2`。它减少多标签服务名先拼接搜索域再查询的机会；短服务名仍保留 Kubernetes 搜索域解析。

同一提交把 DNS 健康检查接入原生 `cluster-status`。超过 200 ms、没有有效 nameserver、或节点搜索域包含路径/CIDR/非法域名时会以非零退出，并提示检查宿主 DNS suffix 与 WSL DNS tunnel。

### 候选验证

- `cluster/tests/test_check_dns.py`：5 项通过，覆盖有效/非法 resolver 搜索域和 200 ms 门槛。
- Jinja AST：app-platform 下 21 个 `.j2` 模板，语法错误 0。
- 原生 `application-render`：`tpl`、`info`、`knowledge` 成功；对应 27 个 Kustomize 目录全部构建成功。
- `investment` 渲染未完成：现有源锁断言失败，输出为 `app_images.backend.source_revision == source_lock.backend_revision`。本次没有改镜像锁或业务源码来绕过。
- `make cluster-dns-check` 对真实集群通过。
- `make cluster-status` 的集群总控验证未通过：当前 Luna 工位缺少 `infrastructure/.tools/bin/kind`，在 `kind get clusters` 前置步骤退出。失败不是集群 API/DNS 错误；本次没有为此下载或安装工具。
- 渲染检查发现 `info` 和 `knowledge` 的既有私有 TLS 主备输入均缺失；现有 prepare 流程按其“首次生成并独立备份”规则，在 `/etc/sunmoon/applications/sunmoon-kind/{info,knowledge}/tls/` 和对应备份目录生成了新的证书输入。值没有输出、没有进入 Git；没有把候选证书应用到集群。重新渲染前应核对这些本地输入与服务当前证书的关系。

### 发布约束

本候选没有 stage 到 Flux 消费的 GitOps YAML，没有发布 OCI、没有改变 Flux Source，也没有对运行集群应用 `ndots=2`。原因是 Job 的 `spec.template` 不可变：对现有完成态 Job 原名更新会导致晋级失败。晋级前需按各组件既有 revision/name 机制为需要更新的初始化 Job 生成新对象，并确认其重复运行语义；不能直接覆盖已完成 Job。应用源码锁差异也需先独立解决。

## 当前结论

宿主 DNS 修复、WSL 重启和真实集群健康验收通过。`ndots=2` 与持续健康探针已形成供 Fable 审阅的本地代码候选；候选尚未进入 GitOps 发布，因此不宣称它已在运行集群生效。Docker/kind 工具缺失和 investment 源锁不一致仍是本工位的候选验证阻塞项。
