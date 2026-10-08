// Synthetic terminal only: these tests never connect to relay or approve a real request.
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localConfirm } from "../src/localConfirm.js";

let restore: (() => void)[] = [];
let prompt: string;
let answer: (input: string) => void;
let reader: EventEmitter;
let output: string;

beforeEach(() => {
  vi.useFakeTimers(); output = "";
  for (const stream of [process.stdin, process.stderr]) {
    const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
    restore.push(() => descriptor ? Object.defineProperty(stream, "isTTY", descriptor) : Reflect.deleteProperty(stream, "isTTY"));
  }
  reader = new EventEmitter();
  Object.assign(reader, {
    question: (text: string, callback: (input: string) => void) => { prompt = text; answer = callback; },
    close: () => reader.emit("close"),
  });
  vi.spyOn(readline, "createInterface").mockReturnValue(reader as any);
  vi.spyOn(process.stderr, "write").mockImplementation(((text: string) => { output += text; return true; }) as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const fn of restore.splice(0)) fn(); });

it("accepts the whole fresh code, with explicit local feedback and no code in the result message", async () => {
  const result = localConfirm("synthetic fixture");
  const code = prompt.match(/allow [a-f0-9]{6}/)![0];
  expect(prompt).toContain("包括 allow 和英文空格");
  answer(code);
  expect(await result).toBe(true);
  expect(output).toContain("本机确认已收到");
  expect(output).not.toContain(code);
});
it("distinguishes a mismatched input without echoing it", async () => {
  const result = localConfirm("synthetic fixture");
  answer("synthetic-wrong-answer");
  expect(await result).toBe(false);
  expect(output).toContain("输入与本次确认码不一致");
  expect(output).not.toContain("synthetic-wrong-answer");
});
it("identifies timeout and rejects an answer received afterward", async () => {
  const result = localConfirm("synthetic fixture");
  const code = prompt.match(/allow [a-f0-9]{6}/)![0];
  await vi.advanceTimersByTimeAsync(60000);
  answer(code);
  expect(await result).toBe(false);
  expect(output).toContain("超过60秒");
  expect(output).not.toContain("本机确认已收到");
});
it("identifies cancellation without granting", async () => {
  const aborter = new AbortController();
  const result = localConfirm("synthetic fixture", aborter.signal);
  aborter.abort();
  expect(await result).toBe(false);
  expect(output).toContain("请求已取消或连接已断开");
});
it("identifies terminal input closing without granting", async () => {
  const result = localConfirm("synthetic fixture");
  reader.emit("close");
  expect(await result).toBe(false);
  expect(output).toContain("本机输入已关闭");
});
