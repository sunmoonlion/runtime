import { humanizeReject, type HumanError } from "./connectionMessages.js";

/** Match known relay reasons, never echo an arbitrary remote error or token. */
export function rejectionInfo(reason: unknown): { reason: string; message: string } {
  const info: HumanError = humanizeReject(reason);
  return { reason: info.code, message: info.message };
}
