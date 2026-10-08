// Read-only diagnostic: run the sibling frontend's actual projection functions.
// Synthetic event sequences only. This is NOT a browser/reconnection acceptance.
// node scripts/results/windows-agent-1e-20261008/reconnect-projection-probe.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const app = new URL('../../../../investment-app/investment-web-frontend/app/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/workbench/items') {
      return { url: new URL('lib/workbench/items.ts', app).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { thread, running } = await import(new URL('features/chat/model/thread.ts', app));
const { timeline } = await import(new URL('features/work/model/timeline.ts', app));
let cursor = 0;
const event = (type, payload) => ({
  id: `synthetic-${++cursor}`, cursor, type, payload,
  created_at: '2026-10-08T09:00:00Z',
});
const requested = event('turn/requested', { request_id: 'request', text: 'read a fixture' });
const accepted = event('turn/accepted', { request_id: 'request', turnId: 'turn' });
const started = event('turn/started', { turn: { id: 'turn' } });
const disconnected = event('thread/environment/disconnected', { threadId: 'thread' });
const error = event('error', { message: 'execution environment disconnected' });
const completed = (status) => event('turn/completed', { turn: { id: 'turn', status } });
const commandFailed = event('command/failed', { kind: 'turn.start', request_id: 'request' });
const active = [requested, accepted, started];
const cases = [
  ['active_disconnect_without_terminal_event', [...active, disconnected], true],
  ['active_disconnect_with_error_only', [...active, disconnected, error], true],
  ['active_disconnect_then_failed_terminal', [...active, disconnected, completed('failed')], false],
  ['active_disconnect_then_command_failed', [...active, disconnected, commandFailed], false],
  ['already_completed_then_disconnect', [...active, completed('completed'), disconnected], false],
];
const results = cases.map(([name, events, expectedBusy]) => {
  const chat = thread(events);
  const work = timeline(events);
  const chatBusy = running(chat) !== null;
  const workBusy = work.live !== null;
  assert.equal(chatBusy, expectedBusy, `${name}: chat`);
  assert.equal(workBusy, expectedBusy, `${name}: work`);
  return { name, chat_busy: chatBusy, work_busy: workBusy, chat_status: chat.at(-1)?.status, work_last: work.last };
});
const paths = ['features/chat/model/thread.ts', 'features/work/model/timeline.ts', 'lib/workbench/items.ts'];
console.log(JSON.stringify({
  checked_at: new Date().toISOString(),
  evidence_type: 'synthetic events applied to actual frontend projection functions; not live browser acceptance',
  limitation: 'Does not establish whether live app-server always emits a terminal turn event, or whether the next real command succeeds after agent reconnect.',
  source_sha256: Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(new URL(path, app))).digest('hex')])),
  results,
}, null, 2));
