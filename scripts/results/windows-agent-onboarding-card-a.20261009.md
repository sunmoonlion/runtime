# Windows 代理安装体验卡 A：入口实验回执

**结论：停止在卡 A，交所有者决定是否购买代码签名证书。** SDD 0012 规定候选入口全部被拦时停止；`.cmd`、`.vbs` 和指向包内签名 `node.exe` 的 `.lnk` 均未能启动。没有关闭或修改应用控制/执行策略，没有安装代理、轮换令牌或操作集群。

## 输入包与系统条件

| 项目 | 实测 |
| --- | --- |
| Edge 下载原件 | `C:\Users\zymun\Downloads\windows-x64.zip`，174,243,923 字节 |
| ZIP SHA256 | `2d5421627198b9cf2eccf15d88b726c80d46f4180e2db30606120f5bd52aea5a`，与已发布记录一致 |
| Mark-of-the-Web | `Zone.Identifier` 存在，`ZoneId=3` |
| Explorer 解压 | 使用 Windows Explorer ZIP Shell 处理器，解压 90 个文件；未用 `Expand-Archive`，未复用 Downloads 下原有解压目录 |
| 清单 | SHA256 `d72f5443be1fa13895a92cb97f37b9cef6ce5fe27e7707705f3ee0e56a11f1b2`；包内容清单校验通过，Agent 0.2.1、Codex 0.155.1、Node 24.19.0、源码 `6de600279ffc1996e19409b1bd6c4ee1eb1eccbe` |
| 解压后标记 | `install.cmd`、`app/native/run-hidden.vbs`、`node/node.exe` 均保留 `Zone.Identifier` |
| 应用控制 | Smart App Control `On`；Device Guard Code Integrity 与 User Mode enforcement 值均为 `2`（原始系统值） |
| 执行策略 | CurrentUser `RemoteSigned`；MachinePolicy、UserPolicy、Process、LocalMachine 均 `Undefined` |
| Node 签名 | Authenticode `Valid`，发布者 OpenJS Foundation；签名有效仍未使带网络来源的快捷方式目标成功启动 |

## 入口尝试

本机没有可供助手直接操作的鼠标/桌面控制接口，因此通过 Windows Shell 的默认打开动作各尝试一次；这不是人工鼠标双击，限制如实保留。没有显示可截图的 SmartScreen 模态窗口；Shell 在启动前返回拒绝。

| 入口 | 对象 | 结果 |
| --- | --- | --- |
| `.cmd` | ZIP 中真实 `install.cmd`，不带任何安装参数 | Shell 启动失败。Code Integrity Operational 事件 3033/3118 记于 2026-10-09 17:02:10 +08:00：PowerShell 请求启动 `C:\Windows\System32\cmd.exe`，未满足 Enterprise signing level；3118 为 Smart App Control Block Details。安装器没有运行。 |
| `.vbs` | ZIP 中真实 `app/native/run-hidden.vbs` | Shell 返回：`由于出现以下错误，无法运行此命令: 应用程序控制策略已阻止此文件。来自 Web 的危险文件扩展名。` 脚本没有运行。 |
| `.lnk` | 临时快捷方式，目标为包内签名 `node.exe`，参数 `-e "process.exit(0)"` | Shell 返回同一拒绝文本。快捷方式本身没有 `Zone.Identifier`，目标 `node.exe` 带 `ZoneId=3`；Node 未启动。 |

原始入口尝试均未重试。结束后复查，没有匹配本次探针目录的 `cmd.exe`、`wscript.exe`、`cscript.exe` 或 `node.exe` 残留。

## 边界与下一步

- 这证明当前设备的 Windows 应用控制策略不接受这些来自 Web 的入口组合；**不能据此断言签名证书一定能解除拦截**。是否购买/采用何种代码签名由所有者决定；在决定前不改设计、不进入卡 B/C/D/E。
- SDD 卡 A 的令牌期限核对未做：入口实验命中明确停止条件，且轮换会吊销当前令牌并可能滚动沙箱。现有用户连接与沙箱没有被改变。
- 报告没有截图，因为没有弹出可见对话框；保留的证据为 Shell 错误、Code Integrity 事件字段、ZIP/清单摘要和 ZoneId 检查结果。
- 隔离实验目录保留供审读：`C:\Users\zymun\sunmoon-probe-runs\windows-agent-onboarding-card-a-20261009`。原始 ZIP 和已有解压目录均未改动。远程审读后按既定收尾要求清理该临时目录。
