# 0.2.8 桌面生命周期修复

依据：`~/switch-test/astra-028.md`。分支 luna；本地提交，不推送、不发布、不碰集群或现装代理。

| 顺序 | 工作 | 状态与验证 |
| --- | --- | --- |
| 1 | 显式显示、可见后写就绪、显示失败关闭、共享 P/Invoke | 完成；打包单测 33/33；Windows PowerShell Parser `desktop.ps1 parse: PASS`。原 22:34:20 枚举记录补入 0.2.7 报告，区分后续进程已退出的快照 |
| 2 | UI 看门狗和退出清理 | 代码完成；打包单测 34/34。设置、首次接入及托盘私有窗体共用 1 秒检查；正常关闭设置不关闭托盘；整体 finally 只清本 PID 的就绪记录。真机 Dispose 待验 |
| 3 | onboard 子进程兜底 | 代码完成；tsc 通过，desktopLaunch 5/5。启动宽限 15 秒，就绪消失立即收本子进程，记录 PID 死亡宽限 10 秒，上限 30 分钟；子进程退出后只清匹配 PID 的标记。真机终止待验 |
| 4 | 卸载按身份收尾 | 代码完成；进程分类及打包 39/39。按当前用户 SID、完整脚本路径识别，停止前复核创建时间/路径/命令防 PID 复用；未知占用者保留并脱敏报告；等待最多 10 秒。真机孤儿收尾待验 |
| 5 | 文件占用重试 | 代码完成；EPERM/EBUSY 首次失败后重试 10 次、每次 500ms；最终报精确路径。其他错误不重试；目录删除同规则 |
| 6 | 半卸修复、模板同步 | 代码完成；打包/进程测试 44/44。删除前写 .uninstall-incomplete，失败保留；损坏清单或标记返回 repair，外部可信包收尾后旁移残目录再安装；不执行损坏旧代码，配置不动；两个模板逐字节相同、无 BOM。真机半卸恢复待验 |
| 7 | 安装失败提示 | 代码完成；保留原始失败并提示退出托盘、关闭旧窗口再试；不吞错误；两个模板同步 |

全量、隔离组包安装、托盘真机打开、截图、异常退出、半卸恢复和连接按钮均待验。不得把静态检查写成真机通过。

第 1 项原始测试结果：`tests 33; pass 33; fail 0; skipped 0`。沙箱内首次 node test runner 只给文件级失败，重跑同一测试（允许外部执行）得到上述结果。

重跑：runtime 下 `node --test --test-reporter=spec agent/distribution/test/bundle.test.mjs`；Windows 用 `System.Management.Automation.Language.Parser.ParseFile` 解析 `agent/native/desktop.ps1`。

第 3 项：系统 pnpm 为 12.0.0，项目固定 10.24.0，调用被版本检查拒绝（`ERR_PNPM_BAD_PM_VERSION`）；没有改锁文件/版本。改用已装依赖 `npm run build` 和 `./node_modules/.bin/vitest run test/desktopLaunch.test.ts`，退出 0，`Test Files 1 passed; Tests 5 passed`。

第 5 项首次回归 `tests 40; pass 39; fail 1`：旧结构断言仍查 `invoke(['tray','stop'])`，而第 4 项已改为循环调用；`bundle.test.mjs:270 AssertionError false !== true`。更新该顺序断言检查循环入口，实际清残留语义保持。
