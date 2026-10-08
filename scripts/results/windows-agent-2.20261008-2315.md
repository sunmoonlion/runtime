# 第 2 段真实审批回执与延期项（2026-10-08）

所有者决定先完成代码和测试，真实 MCP 联网稍后做，并争取午夜前完成第三段。
因此本报告不把第二段标成全部通过，也不让延期项阻塞第三段独立交付。
本轮只本地提交，不 push；通过所有者既有同步流程交 Fable 审读。

## 已实际通过：本机确认 → 事务 → 回执 → Windows 写入

使用现有 myproject 测试会话，测试代理保持 read-only、network=false。
所有者在真实本机终端输入当次确认码；不记录或回显该码。

| 事件（UTC） | 事实 |
| --- | --- |
| 14:25:59.648 | 打开本机确认，申请白名单内 workspace-write，网络仍关闭 |
| 14:26:10.103 | 本机确认成功 |
| 14:26:11.547202 | 工作台事件事务已提交；cursor 402 |
| 14:26:11.560 | 代理收到对应 recorded 回执 |
| 14:26:11.639 | 在回执后才放行 process/start |

- report ID：`5bc865c4-f0df-4f76-aee9-5624746c4f32`
- event ID：`02ca5364-c4d6-4ff4-949c-d66350983807`
- conn：`b71b5ab8`；thread：`01a11ad1-53f3-7711-8509-b367c7696c65`
- request digest：`6ac91404ca95e804981eaaa55928a4b59d0cafc8b6d8343909efd6ddaaf1cb80`
- permission digest：`e55b44ee8a7145beea28c4a8a9d4750d019b2d5f3d1f188effb20dc8d6757604`

`stage2-permission-check.txt` 实际产生：22 字节，UTF-8 BOM + `local approval OK` + CRLF，
SHA256 `569738e9656a736b65bdf3c431dc351bc0a810542a32abfa757efb16b93d3599`。
原 `browser-check.txt` 和 `reconnect-work-20261008.txt` 摘要不变，分别为
`194115ce89f5837bfb5f5491f7ea389eca5b6c7daf90a113a611a36593be22aa`、
`39e5ed241ed8cb16a9ed7cf7a096d7d078acb7563315f8d6c958ff3e5c629d36`。

前三次尝试均拒绝并有持久化回执，未写文件。第一轮有超时，另外两次旧代码未记录
足够具体的原因，不能事后断言输入错误。`66a78f2` 增加明确本机结果提示与 5 项测试，
仍不记录确认码或输入。后续所有者真实批准成功。证据目录 `windows-agent-2-20261008-live/`。

## MCP 的实际发现和更正

用户原生 Codex 配置没有可导入的无认证 HTTP 项，因此通过隔离 USERPROFILE 提供
公开回显夹具。导入在真实终端经所有者确认，未改真实用户 `.codex`。

真实帧表明：**固定版 Codex 把 MCP HTTP 经 `http/request` 交给 Windows exec-server**。
所以 URL localhost 指用户电脑，之前文档“调用端在云端”的判断错误，现已更正。
真实字段：method、url、headers、bodyBase64、timeoutMs、redirectPolicy、requestId、streamResponse。

已按真实契约补严格校验：禁网上限拒绝；不接受凭据环境变量读取、URL 用户信息、未知字段、
异常 Base64、过量头或正文。导入不自动开网。普通/流式 HTTP 原生隔离调用均通过（20 项）。
真实联网夹具应在 Windows 回环运行，旧云端夹具已停止。未擅自把测试代理网络上限改为 true。

**待补**：所有者允许时，隔离代理临时联网 → 本机确认导入 → 实际 mcpServer/callTool →
返回固定公开 marker → 停止代理并恢复原状态。当前不得标为真实 MCP 全链路通过。

## 两次旧投影拒绝

有一轮恢复会话后再次出现拒绝；选择器均是 `[["mcp_servers"]]`，早期探针把 cwd
归为粗粒度 other，缺失真实拒绝路径。改进后的正常请求是
`file:///C:/Users/zymun/sunmoon-probe-runs/windows-agent-1b-20261007/workspace/myproject`。
尚未抓齐拒绝原始路径，不能宣称已解释旧两例；没有放宽任何配置读取范围。

## 恢复与清理

四轮临时 Windows 代理均正常退出，退出码 0；仅其 config.json 凭据副本已移除。
原 Linux 代理开始时已停止，结束保持停止；原配置 SHA256
`c80e10838cac82599861d996b94a5d095f67457e6192e99bb9d798c28bb4fe16` 不变。
测试项目内验收文件保留。后台 Python 只用于集群只读审计，不是 Windows 客户端依赖。
本轮没有重新构建/部署投资后端或 relay；运行版本仍为 Cursor 回执的版本。

## Fable 审读要点

1. 核对上述真实事务顺序；本机“允许”不是绕过审计回执。
2. 审 HTTP 网络执行位置及新白名单：没有用户凭据转发，也未把禁网静默改成联网。
3. 第三段 GUI 继续复用相同 SessionPermissions/审计链，不能建立自动批准接口。
4. MCP 真实联调与旧投影追踪仍在待办，按所有者新决定后置；本次推进第三段是明确授权。
