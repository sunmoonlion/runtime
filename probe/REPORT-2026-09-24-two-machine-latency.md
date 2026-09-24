# 探针报告：两机公网延迟（2026-09-24 22:09）

> 待办：switch-test inbox 02。本地侧：所有者的本地机（WSL，代理连 `ws://43.153.135.74:47100`）；远程侧：这台机（会合点 + 沙箱桥 + 编排端 Codex 0.155.1）。
> 结果文件：`scripts/results/probe-two-machine-latency-remote.20260924-215206.txt`；本地侧文件由本地助手回传。

## 结论

**公网一跳把每个 exec-server 请求的往返从约 8 ms 拉到约 420 ms，一个平凡 turn 从 2 到 3 秒变成 18 到 24 秒。**
原因不是带宽，是串行请求数：一个 turn 里编排端向执行端发了 68 个请求，其中 58 个是 `fs/getMetadata`，每个都要等上一个回来。

| 方法 | 次数 | 回环中位（ms） | 公网中位（ms） | 公网 p90（ms） |
| --- | --- | --- | --- | --- |
| initialize | 1 | 33 | 3669 | 3669 |
| environmentConfig/read | 3 | 3.4 | 500 | 693 |
| fs/getMetadata | 58 | 8.3 | 422 | 817 |
| fs/readFile | 2 | 2.1 | 632 | 632 |
| fs/writeFile | 2 | 45.6 | 677 | 677 |
| process/start | 2 | 5.4 | 966 | 966 |

回环对照来自 `probe/bridge-relay.log`（2026-09-23，同一探针、同一台机）。

## 对设计的影响

- 证实 `topology.md` 的判断：**边缘必须和用户同区**。这台机在境外，所有者在境内，单程约 200 ms；同区机房可以压到 20 到 40 ms，按 58 次串行算，一个 turn 的执行端开销从约 24 秒降到 1 到 3 秒。
- `fs/getMetadata` 的数量是 Codex 编排端的行为，我们不能改；能做的是让会合点和沙箱离用户近，以及在代理侧不做任何会增加往返的事（协议过滤要在本地判，不能回问）。
- `initialize` 3.7 秒是首个请求含 TLS 之外的握手与环境扫描，只发生一次。

## 本次没有验到的

- 两个 turn 的动作本身都失败了：R1 报 `exec-server: No such file or directory`，R2 写文件报 `CreateProcess` 错误。原因是探针把这台机的项目路径 `/home/zym/worktrees/fable/runtime/probe/user-ws` 当作 `cwd` 发给了本地执行端，而本地执行端是 Windows 侧的 Codex（`CreateProcess` 是 Windows 的错误），那个路径在它那里不存在。这不影响延迟数据，因为每个请求都真实走了一遍公网往返；但「文件经公网写到本地机」这一条要在两机脚本里把 `cwd` 改成本地侧的路径后再验一次。
- 版本：两端都是 0.155.1（本地助手为此装了钉版包，没用本机默认的 0.156.1）。

## 下一步

1. 两机脚本加 `LOCAL_ROOT` 参数，编排端用本地侧路径当 `cwd`，重验写文件。
2. 边缘选址：找一台境内节点重跑同一探针，拿到同区数字后写进 `topology.md` 的容量行。
