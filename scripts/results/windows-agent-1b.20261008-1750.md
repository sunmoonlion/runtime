# Windows 网页联调：专家断后重连未续跑，聊天/工作复核

交远程 Fable；2026-10-08。所有者要求报告并检查三种入口。
本轮只在 runtime 保存报告与脱敏证据，没有修改工作台代码、任务状态或账号数据。
本地提交由所有者同步，不 push。第 1 段 1b **仍未通过**，不进入第 2 段。

## 1. 当前结论

| 入口 | 已取得的证据 | 结论 |
| --- | --- | --- |
| 请专家 | 真实网页、机器在线状态、Task/Attempt/会话状态和时间线 | **fail**：断线进入 WAITING(ENVIRONMENT)，机器重连后仍未续跑，页面一直等机器 |
| 项目聊天 | 代理重启前后同一 chat/session/thread 实际读文件，命令真帧、终态与用户回执齐全 | **pass（空闲时重启后发下一问）**；执行中断线仍未实测 |
| 普通工作 | 断线前实际建文件成功，内容字节独立核对；同上投影诊断完成 | 普通会话的重连后写文件**待网页实测**；不可把首次读写成功当作重连验收 |

17:47 所有者要求重新按单项做。17:48 新建的项目聊天已实际读取 `browser-check.txt` 成功，
只读查库确认 kind=chat、wheel=user。17:50:38 受控停止代理，17:50:58 同名机器重新上线，
Windows PID 从 16368 换为 9244，exec-server 端口从 56785 换为 56347。
17:51:49 同一 thread 发出新的 process/start，17:52:03 新 turn 完成；所有者确认网页实际读取
11 字节（BOM + `hello！`），不是复述旧结果。我独立核对文件摘要不变。聊天该用例通过。
现已引导所有者新建普通工作会话做写入基线，之后再在同一工作验重连写入。

聊天 session=`52511429-3a68-4bb3-a102-55db1e6b4c3f`，
thread=`01a11aea-2193-75c0-a17a-8e399be33281`。

## 2. 专家故障复现（已发生）

机器名 `luna-windows-stage1b-20261007`，Windows unelevated 内层沙箱 + 严格协议过滤。
runtime `3bf4d3d`，Codex 两端固定 0.155.1。
本地只读核查的工作台版本：investment-backend `7ac05d2ab2188b866336e92875fe25d170bf5ded`；
investment-web-frontend `624df4f1c0783e8131c7d3be6ece636b2b7d17d1`。
后端三份关键源码的现网摘要与该检出一致，摘要保存在证据 JSON。

北京时间（原始 JSON 为 UTC）：

| 时间 | 事实 |
| --- | --- |
| 17:19–17:24 | 项目列文件与工作建文件成功 |
| 17:24:52 | 所有者请专家，方向盘交给 advisor，Profile 为 DATA_QUERY |
| 17:24:53–17:25:05 | 第一步 rewrite 完成，第二步 sql_generate 开始 |
| 17:25:29 | **我的第一轮 10 分钟联调计时器到期**，代理有序停止，退出 0；不是已证实的家庭网络故障 |
| 17:25:57 | 第二步 Attempt FAILED，failure_code=environment、retryable=true；Task 进入 WAITING(ENVIRONMENT) |
| 17:28:48 | 同一测试机器重新连接会合点，随后工作台同步为 online |
| 17:37:19 | 再查：机器 online，Task 仍 WAITING(ENVIRONMENT)，没有新的 Attempt |
| 17:45 左右 | 只读再查会话仍由 advisor 持有，active_task_id 未清除 |

定位用 ID：

- environment：`c4f8711a-5506-4b59-9469-0ed11e1d8b40`
- session：`6e0bc2cf-7c86-4784-9156-5b4d3c7a6e5e`
- task：`5e77067c-983d-4e0d-a88e-e4e77f68fa71`
- 失败 Attempt：`72f46157-0ef3-49c0-a373-ee71cde6aadb`
- 失败 turn：`01a11ad4-a4bb-7132-bc2a-1450f9a19fe6`
- current_step=1（从 0 起，即 UI 第 2 步），active_attempt_id=null、active_interaction_id=null。

用户实际看到：第一步“改写问题”通过，第二步“生成 SQL”暂停，“你的机器断开了，在等它回来”；
机器恢复在线后状态不变，页面无普通对话输入框。

测试安排有两点需更正：计时器在专家执行中到期是我安排不当；此前我建议用“请专家读文件”，
但实际选到的 DATA_QUERY 是 SQL 查询流程，与文件检查不匹配。两者都已告知所有者。
这不改变本次已出现的环境等待无恢复事实，但这次不能作为专家业务流程成功的证据。

## 3. 代码定位与原因

以下路径属于 investment-backend，均为只读审查：

| 路径/位置 | 行为 |
| --- | --- |
| `app/app/application/workbench/machines.py:77`，`MachineSync.sync_once` | 更新机器 online/offline；未恢复绑定该机器的 WAITING(ENVIRONMENT) 任务，也未发送 task.drive |
| `app/app/application/workbench/advisor.py:217` | environment_lost 将 Attempt 记 FAILED/retryable，再将 Task 记 WAITING(ENVIRONMENT) |
| 同文件 `:115`，`_step_once` | 只处理 QUEUED/RUNNING；即使单独重新投 task.drive，WAITING 也直接返回 |
| `app/app/infrastructure/workbench/repository.py:1543` | `active_tasks_for_sandbox` 只取 QUEUED/RUNNING；runner 接管恢复不会捞出此 WAITING 任务 |

所以需要工作台的合法状态迁移与重新调度，单纯把代理连上线或刷新网页不能补齐。

前端 `app/app/[locale]/(dashboard)/workbench/projects/[project]/c/[conversation]/conversation-view.tsx:27`
在会话有 active_task_id 时展示 ExpertRunScreen，普通聊天/工作输入框不挂载。
专家页仍有“停止”→“停下”的取消路径；`Ledger.request_cancel` 对非 RUNNING 任务可直接收敛取消，
然后交回方向盘。**这是取消当前委托，不是接着完成原任务**；本轮未代用户调用取消 API 或改库。

## 4. 聊天和工作：已查到什么，尚缺什么

普通聊天和工作没有上述专家 Task WAITING 恢复分支，不能因专家卡住就宣布它们也卡住。
但它们的页面忙碌状态都依赖终结事件：

- `app/features/chat/model/thread.ts:90`：turn/completed 或 command/failed 才收尾；running 决定发送按钮是否忙。
- `app/features/work/model/timeline.ts:121`：同样靠终结事件清空 live；普通环境断线事件没有独立收尾逻辑。
- `app/components/workbench/composer.tsx:35`：busy 时不能发送下一条；普通页的文本框本身与专家页不同。

已用**原前端纯函数**做五组确定性事件投影，源码未修改：

| 合成输入序列 | 聊天/工作结果 |
| --- | --- |
| turn 已开始 → environment/disconnected，无终结事件 | 两者均保持忙碌 |
| 上述序列再加 error，仍无终结事件 | 两者均保持忙碌 |
| 断线后有 turn/completed(status=failed) | 两者均结束忙碌、显示失败 |
| 断线后有 command/failed(kind=turn.start) | 两者均结束忙碌、显示失败 |
| turn 已完成后才断线 | 两者均保持空闲 |

这是**条件性风险的复现**：如果真实断线未产生终结事件，页面会一直忙；它没有证明现网普通轮次
真的缺终结事件，也没有证明重连后原 thread 能调用新 exec-server。不能以该诊断替代网页验收。
运行命令：

```bash
node scripts/results/windows-agent-1e-20261008/reconnect-projection-probe.mjs
```

五组断言通过，退出 0；Node 对兄弟仓 TS 的 module-type 警告不影响结果，未改它的 package.json。

## 5. 请远程处理/复验的范围

1. 绑定机器恢复可用后，依法恢复 WAITING(ENVIRONMENT) 并可靠投递调度命令；状态迁移、事件与
   调度应具备原子性/幂等性，重复心跳、重复消息、runner 重启都不得产生并行 Attempt。
2. 保留已完成步骤、交回物及预算账，从失败步骤继续；先确认机器、用户、项目绑定仍有效。
   不自动恢复 WAITING(INPUT/RESOURCE)，不绕过批准、不改本地执行上限。
3. 失败步骤可能已经产生副作用，恢复规则应识别“结果未知”；不能盲目重放写入或外部动作。
4. 页面区分“机器离线”和“机器已回连、任务待恢复”；提供符合账房状态机的恢复/取消反馈，
   不让用户只能刷新或重建会话。取消后应清除 active_task_id 并恢复普通输入入口。
5. 聊天/工作各验两类：空闲时断线后在**同一会话**发下一问；执行中断线后有明确终结/暂停，
   重连后能继续操作。核对终结事件落库、事件续传和 UI 忙碌状态，不仅检查机器列表 online。
6. 分开覆盖：短时网络断开（exec-server 未退出）与代理进程重启（exec-server 重建）。
   本次专家故障属于后者，不能用此前 20 秒隔离生命周期测试代替本轮网页测试。

附加只读发现：runner.py `_feed_turn_waiters` 对 environment/disconnected 当前遍历所有 waiter，
没有按 thread/environment 筛选；请远程检查隔离范围。**未做多会话并发复现，不列为本次已证实故障。**

## 6. 证据与清理状态

都在 [windows-agent-1e-20261008/](windows-agent-1e-20261008/)：

- `expert-waiting-evidence.json`：只读事务取得任务/尝试/事件时间与现网代码摘要。
- `read-write-result.json`：实际文件 `hello！`，带 BOM，hex=`efbbbf68656c6c6fefbc81`；
  SHA-256=`194115ce89f5837bfb5f5491f7ea389eca5b6c7daf90a113a611a36593be22aa`。
- `round1/`：95 条桥请求的脱敏投影、状态、日志、退出记录；62 条 denied 全为越白名单
  fs/getMetadata，完整清单 `denied.jsonl`。process/start 未因本地边界拒绝；保护没有放宽。
- `round2/`：32 条请求投影、19 条越白名单 fs/getMetadata 拒绝、状态与正常退出记录；
  记录了新的聊天基线读取。`chat-reconnect-result.json` 记录原聊天身份与验收状态。
- `reconnect-projection-probe.mjs` / `reconnect-projection-result.json`：合成事件诊断与被测源文件摘要。

证据不保存请求 argv、环境变量值、文件内容回包、令牌或模型 key。
第一次代理退出后，原 Linux 代理保持**启动前已经停止**的状态，原配置摘要未变。
第二轮 17:50:38 已正常退出、原配置未变、临时令牌副本已删除。第三轮 17:50:58 上线，
限时至 18:20:53；监督程序退出时删除本轮临时令牌副本。第三轮仍在进行，尚不能写
“全部临时产物已清理”；完成后补该轮退出与普通会话重连结果。
