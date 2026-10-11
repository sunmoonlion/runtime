# 0.2.8 审读补项：权限确认窗

依据 `switch-test/astra-028.md` 第一节第 4 条及 2026-10-12 远程审读。原七项接受，本补项之后继续 0020，不单独发布。

- 通用 `Initialize-VisibleForm`：Shown 显式 `ShowWindow(handle,5)`、Activate；不可见则 Close。本机设置及权限确认复用；onboard 后续在 0020 撤掉。
- confirm 使用 `New-FormWatchdog`，finally 停/释放两 Timer、释放窗体并 Application.Exit。挑战码、人工允许及权限协议未改。
- watchdog 增 confirm；隔离脚本在 Dispose 前查询真实 IsWindowVisible，onboard/confirm 必须为 True。未输入码或批准权限。

Windows 原文：

```
{"action":"onboard","exitCode":0,"elapsedAfterDisposeMs":44,"readyCleared":true}
{"action":"tray","exitCode":0,"elapsedAfterDisposeMs":766,"readyCleared":true}
{"action":"confirm","exitCode":0,"elapsedAfterDisposeMs":43,"readyCleared":true}
tests 3; pass 3; fail 0; skipped 0
```

Linux bundle/watchdog：44 项，41 通过、3 Windows 专用跳过，退出0。隔离 Windows 副本在 `C:\Users\zymun\sunmoon-probe-runs\windows-agent-028\test-source`；临时窗体夹具成功后删除，正式 0.2.7 安装与配置未改。

剩余：结合 0020/0.3.0 完整回归和真人配对验收；控制台闪出仍由所有者在后续 E 中观察，不冒充已验。
