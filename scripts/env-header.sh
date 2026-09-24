#!/usr/bin/env bash
# 环境探测段（switch-test 约定）。被各测试脚本 source。
set -uo pipefail
WS="${WS:-fable}"
echo "===== 环境 ====="
echo "主机        $(hostname)"
echo "时间        $(date -Is)"
echo "工位        ${WS}"
echo "系统        $(uname -srm 2>/dev/null)"
echo "内存        $(free -h 2>/dev/null | awk '/Mem:/{print $2" 总 / "$7" 可用"}')"
echo "磁盘        $(df -h / | awk 'NR==2{print $4" 可用 / "$5" 已用"}')"
echo "Python      $(python3 -V 2>&1)"
echo "Node        $(node --version 2>/dev/null || echo '无')"
echo "uv          $(uv --version 2>/dev/null || echo '无')"
echo "Codex       $(codex --version 2>/dev/null || echo '无')  CODEX_HOME=${CODEX_HOME:-未设}"
for r in k8s info-app investment-app knowledge-app tpl-app runtime; do
  d="${HOME}/worktrees/${WS}/${r}"
  [ -d "${d}/.git" ] || [ -f "${d}/.git" ] || continue
  printf "%-22s %s  %s\n" "${r}" "$(git -C "${d}" rev-parse --short HEAD)" "$(git -C "${d}" branch --show-current)"
  for s in "${d}"/*-backend; do
    [ -e "${s}/.git" ] && printf "  %-20s %s  %s\n" "$(basename "${s}")" "$(git -C "${s}" rev-parse --short HEAD)" "$(git -C "${s}" branch --show-current)"
  done
done
echo "===== 开始 ====="
