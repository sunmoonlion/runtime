/** Match known relay reasons, never echo an arbitrary remote error or token. */
export function rejectionInfo(reason: unknown): { reason: string; message: string } {
  const r = typeof reason === "string" ? reason : "";
  if (r === "replaced by a newer agent for this user") return { reason: r, message: "同一账号已有另一台代理连接，本代理已停止。请保留需要使用的那一个代理。" };
  if (r === "token revoked") return { reason: r, message: "代理令牌已吊销。请在网页“设置 → 本地代理”重新取得 init 命令，在本机执行后再启动。" };
  if (r === "bad token" || r.startsWith("jwt ") || r === "malformed jwt") return { reason: r === "bad token" ? r : "invalid or expired token", message: "代理令牌无效或已过期。请从网页重新取得 init 命令；不要在日志或对话里粘贴令牌。" };
  if (r.startsWith("codex version mismatch") || r.startsWith("protocol ") || r === "missing codex version") return { reason: "version mismatch", message: "代理与服务端版本不匹配，连接已拒绝。请安装与服务端配套的代理版本后重试。" };
  return { reason: "relay rejected agent", message: "会合点拒绝连接，本代理已停止。请核对服务地址和代理版本，再从网页重新取得配置。" };
}
