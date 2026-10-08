# 第三段续作：托盘与权限链自动检查

## 范围与停点

所有者授权持续开发、逐功能段本地提交；真人确认、真实重启、网页人工查看、干净机暂留待验。
本轮不发布后端/relay，不同步远程。第一段提交 `b5ba251`。

## 第一段：状态与目录勾选

- 托盘显示在线/正在连接/离线/拒绝/停止；超过 15 秒的旧状态不显示在线。
- 真正的 CheckedListBox：已选目录是 `roots`；`rootChoices` 仅记住待选位置。
- 添加目录默认不勾选；全不选允许保存、后台仍可启动，但无项目根授权。
- 设置不上传，仍须 stop/start 生效；保护控制目录与安装目录。
- Windows 204/204；Linux 172 通过、32 专用跳过；TypeScript 编译通过。

## 第二段：实际界面保存和审批等待

`probe/windows-stage3-settings.mjs` 从 PowerShell AST 读取交付源码的三个函数，
不复制函数实现、不启动真实账号、不开权限确认或 UAC。真实 WinForms 控件自动执行：

1. 打开两行目录，取消第一行、勾第二行，按实际“保存设置”按钮。
2. 重新打开，确认只有第二行勾选；全不选并保存。
3. 再打开，确认全未选，取消退出；两行候选仍保留。

每一步经真实 CLI 读取配置断言；同时核六种连接状态文案。本次三轮均通过。
它证明设置窗口及保存事件，不冒充真人操作托盘菜单或 GUI 正向批准。

新增桥单测：本机确认完成前不报告；报告尚未收到持久化回执时不转发；
只有两者完成才转发且强制私有桌面；流关闭后迟到的批准回执不转发。
本机确认和审计在这两个单测中是可控回调，不代表云端真人闭环。
现有原生用例另实际执行受限写入、拒绝越界；已验 CLI 真人批准链，GUI 真人批准仍待验。

## 失败输出及修正

| 输出 | 事实与处理 |
| --- | --- |
| `settings-native.log` | WSL 沙箱 `UtilBindVsockAnyPort: socket failed 1`，改经批准的宿主执行 |
| `distribution-linux.log` | 沙箱内 Node 子测试退出 1，宿主同测试 27/27 通过 |
| `settings-native-host.log` | 测试器 30 秒超时，实际配置已经保存；未把该轮写成通过 |
| `settings-native-retry.log` | `Missing IDOK button`，本机 UIA 没有暴露提示框按钮 |
| `settings-native-final.log` | 等待按钮仍超时；保留原始命名，**此文件不是最终通过记录** |
| `settings-native-window-close.log` | 改为只关闭本测试 PID、标题恰好为 SunMoon 的保存通知，三轮通过；不关闭或批准权限窗口 |
| `approval-gating-linux.log` | 新夹具缺少协议必填 toolCallId，报告回调未调用，1 失败/7 通过；补齐夹具后 8/8 |

上述修正针对自动测试器，没有放宽产品权限或应用控制。
全部输出位于同目录 `windows-agent-3-ui-20261009/`。

## 重跑

先按 `agent/distribution/README.md` 安装冻结依赖并编译。Windows 普通用户：

```powershell
& 'C:\Program Files\nodejs\node.exe' '<runtime>\probe\windows-stage3-settings.mjs' '<runtime>\agent'
```

也可用包内 `node\node.exe`，第二参数用包的 `app` 目录。探针只新建 `sunmoon-settings-test-*`
隔离目录，成功后清除；失败时保留并输出路径，不能据失败目录重新连接真实账号。
自动关闭通知使用系统 UIAutomation；不编译自有 exe，不修改 PowerShell 执行策略。

## 下一段

Windows 增加用例后的全测 **206/206**、Linux **174 通过/32 专用跳过**，发行检查两端各 **27/27**。
当前源码 Linux 真实模型最小对退出 0，六项判定通过；输出 `linux-minimal-pair.log`
及 `linux-it-*`。L1 的逐命令结果是 None，因为它在进程创建前就被协议层拒绝，
通过依据是对应实际拒绝帧和未创建外部文件；L3 真正在执行端写入且 exit=0。
模型列表刷新出现多次 timeout，但两个实际 turn 完成，错误保留，不影响本次判定。

随后固定本地源码提交组新完整包，验安装/启停/卸载及已装程序的真实在线证据。
未完成这些动作前，最终候选仍是既有 `9f2b5c6` 包，不能把源码回归算作新包验收。
