# 探针报告：Linux 上本地上限的外沙箱

日期 2026-09-24 · Ubuntu 24.04（内核 6.8，bubblewrap 0.9.0，AppArmor 默认配置）· codex-cli 0.155.1 · 一台机扮两端。脚本 `probe_local_ceiling.py`（CASES=L1..L4）；输出 `ceiling-outer*.out`、`ceiling-landlock.out`；Landlock 包装器 `landlock_wrap.py`（否定证据，留档）。

## 问题

`security.md`「本地上限」要求本地代理把 exec-server 进程本身放进一个 OS 级外沙箱：只能写白名单目录，云端要 `danger-full-access` 也写不出去。Codex 自己的内层沙箱（bwrap + seccomp）必须还能在外层里正常工作，否则 `workspace-write` 的命令一条都跑不了。

## 四种做法，一种成立

| 外层 | L1 danger 写 `$HOME` | L2 workspace-write 写外 | L3 workspace-write 写内 | 结论 |
| --- | --- | --- | --- | --- |
| `/usr/bin/bwrap` | 挡住（Read-only file system） | **内层 bwrap 起不来**：`No permissions to create new namespace` | 同左 | 否 |
| Landlock（ABI 4，`landlock_wrap.py`） | 挡住（Permission denied） | 内层 bwrap `Failed to make / slave`：**Landlock 域内禁止一切 mount 操作** | 同左 | 否 |
| `/usr/bin/bwrap` + 内层改 `features.use_legacy_landlock` | 挡住 | 内层 panic：`permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock`（远端环境的权限档带附加可读根，退不回 legacy 策略） | 同左 | 否 |
| **Codex 自带的 bwrap 做外层**（`@openai/codex-linux-x64/vendor/…/codex-resources/bwrap`） | 挡住（Read-only file system） | 内层正常：挡住 | 内层正常：写成 | **是** |

第一种失败的原因：Ubuntu 24.04 给 `/usr/bin/bwrap` 挂了 AppArmor 配置 `bwrap-userns-restrict`，它的子进程转入 `unpriv_bwrap` 域，不允许再建用户命名空间；`apparmor_restrict_unprivileged_userns` 是 0 也一样。换一个路径的 bwrap 二进制（拷贝一份，或直接用 Codex 包里那份）就不受这份配置约束，嵌套成立。Codex 自己在顶层能跑也是同一个原因。

L4（cwd 放在白名单之外，如 `/tmp/probe-outside-root`）在外层里不存在（`/tmp` 是 tmpfs），exec-server 直接拒绝请求：白名单外的根从此在 OS 层面就不可达，不只靠协议过滤。

## 定下的外层命令（Linux）

```bash
<bundled-bwrap> --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$CODEX_HOME" "$CODEX_HOME" \
  --bind "$ROOT1" "$ROOT1" [--bind "$ROOT2" "$ROOT2" ...] \
  --unshare-pid --die-with-parent \
  -- codex exec-server --listen ws://127.0.0.1:$PORT
```

- 整个文件系统只读，只有 `CODEX_HOME`（会话与日志）与白名单根可写；`/tmp` 是私有 tmpfs；
- 网络命名空间**不**分离：exec-server 要让桥从回环连进来。网络上限第一期由协议过滤加 Codex 自己的 `workspace-write` 网络策略承担；要硬禁网时改用 unix socket 监听加 `--unshare-net`，留作后续；
- 白名单变更 = 重启 exec-server（bind 是启动时定的），这正好与「抬高上限只对当前 Session 有效」一致；
- bwrap 二进制随代理带（拷 Codex 包里那份，或自带一份），**不用系统路径的 `/usr/bin/bwrap`**。

## 对设计的影响

- `security.md`「本地上限」外沙箱一行：Linux = 自带 bwrap，不是 landlock；Landlock 与 Codex 内层沙箱互斥，删掉这个选项。
- `0005-agent`：exec-server 由代理经外层 bwrap 拉起；`F-AGENT-03` 的"拒绝"在 OS 层面成立，协议过滤负责干净的错误与可观测。
- macOS：待做 macOS 版时验 `sandbox-exec` 外层与 Codex seatbelt 内层的嵌套（seatbelt 可叠加，预期成立，未验）。
- Windows：待探（见 `REPORT-2026-09-24-windows-exec-server.md`）。
