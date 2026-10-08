import readline from "node:readline";
import { randomBytes } from "node:crypto";

let active = false;
/** Local terminal only. No --yes, piped stdin or cloud-provided answer. A fresh
 * challenge prevents preloaded lines from approving a later remote request. */
export async function localConfirm(description: string, signal?: AbortSignal): Promise<boolean> {
  if (active || !process.stdin.isTTY || !process.stderr.isTTY || signal?.aborted) return false;
  active = true;
  const challenge = `allow ${randomBytes(3).toString("hex")}`;
  const reader = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const finish = (yes: boolean, message: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted);
        // Explain failure locally without logging the answer or random code.
        process.stderr.write(`\n${message}\n`);
        resolve(yes); reader.close();
      };
      const aborted = () => finish(false, "请求已取消或连接已断开，本次未批准。");
      const timer = setTimeout(() => finish(false, "等待本机确认超过60秒，本次未批准。请重新发起请求后使用新码。"), 60000);
      signal?.addEventListener("abort", aborted, { once: true });
      reader.once("close", () => finish(false, "本机输入已关闭，本次未批准。"));
      reader.question(`${description}\n仅在本机确认。60秒内完整输入下面一行（包括 allow 和英文空格），然后回车：\n${challenge}\n> `, answer => {
        const yes = answer.trim() === challenge;
        finish(yes, yes ? "本机确认已收到。后续仍须通过权限及审计检查。" : "输入与本次确认码不一致，本次未批准。请使用新提示中的完整一行，不能只输入六个字符。");
      });
    });
  } finally { active = false; reader.close(); }
}
