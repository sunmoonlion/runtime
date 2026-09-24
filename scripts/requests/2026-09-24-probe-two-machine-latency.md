# 请求：两机公网延迟（本地侧）

**前提**：所有者同意在远程临时开放 47100 端口，远程先起 `scripts/probe-two-machine-latency-remote.sh`；远程说「起好了」再跑。

```text
跑：RELAY=ws://43.153.135.74:47100 USER_ID=luna DURATION=600 bash runtime/scripts/probe-two-machine-latency.sh
仓与提交：runtime <本文件所在提交>
预计：10 分钟内结束；要联网；要 Codex 0.155.1（执行端不要登录态）；不要 Docker
看什么：本地侧连上会合点并桥接（输出末行 pass）；RTT 表在远程侧，远程对照回环数据出结论
```

输出落 `scripts/results/probe-two-machine-latency.<时间>.txt`，提交并 `git push origin fable`。
