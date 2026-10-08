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
      const finish = (yes: boolean) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted); resolve(yes); reader.close(); };
      const aborted = () => finish(false);
      const timer = setTimeout(() => finish(false), 60000);
      signal?.addEventListener("abort", aborted, { once: true });
      reader.once("close", () => finish(false));
      reader.question(`${description}\n仅在本机确认。60秒内输入 ${challenge} 才允许；其它输入拒绝：`, answer => finish(answer.trim() === challenge));
    });
  } finally { active = false; reader.close(); }
}
