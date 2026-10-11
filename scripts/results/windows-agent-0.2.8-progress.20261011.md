# 0.2.8 桌面生命周期修复

依据：`~/switch-test/astra-028.md`。分支 luna；本地提交，不推送、不发布、不碰集群或现装代理。

| 顺序 | 工作 | 状态与验证 |
| --- | --- | --- |
| 1 | 显式显示、可见后写就绪、显示失败关闭、共享 P/Invoke | 完成；打包单测 33/33；Windows PowerShell Parser `desktop.ps1 parse: PASS`。原 22:34:20 枚举记录补入 0.2.7 报告，区分后续进程已退出的快照 |
| 2 | UI 看门狗和退出清理 | 待做 |
| 3 | onboard 子进程兜底 | 待做 |
| 4 | 卸载按身份收尾 | 待做 |
| 5 | 文件占用重试 | 待做 |
| 6 | 半卸修复、模板同步 | 待做 |
| 7 | 安装失败提示 | 待做 |

全量、隔离组包安装、托盘真机打开、截图、异常退出、半卸恢复和连接按钮均待验。不得把静态检查写成真机通过。

第 1 项原始测试结果：`tests 33; pass 33; fail 0; skipped 0`。沙箱内首次 node test runner 只给文件级失败，重跑同一测试（允许外部执行）得到上述结果。

重跑：runtime 下 `node --test --test-reporter=spec agent/distribution/test/bundle.test.mjs`；Windows 用 `System.Management.Automation.Language.Parser.ParseFile` 解析 `agent/native/desktop.ps1`。
