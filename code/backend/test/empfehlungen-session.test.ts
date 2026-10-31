import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ChatService } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
import { fixture } from './empfehlungen-fixture.js';
import type { AblaufStand } from '../src/beratung/ablauf.js';
const rails = () => new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8')));
// Seed a fully calculated synthetic session to isolate cache/lifecycle from profile extraction.
async function setup(generate: () => Promise<string>) {
 const chat = new ChatService({ generate }, rails(), 'Berater');
 const sessions = (chat as unknown as { sessions: Map<string, { ablauf: AblaufStand; revision: number; updated: number; busy: boolean; messages: []; entfernt: number }> }).sessions;
 const session = { ablauf: await fixture(), revision: 1, updated: Date.now(), busy: false, messages: [] as [], entfernt: 0 };
 sessions.set('synthetic', session);
 return { chat, session };
}
test('cache is session/revision scoped and expiry/deletion is respected', async () => {
 let calls = 0; const { chat, session } = await setup(async () => { calls++; return JSON.stringify({ status: 'offen', statusText: 'Weitere Angaben prüfen', empfehlungen: [] }); });
 await chat.empfehlungen({ sessionId: 'synthetic' });
 await chat.empfehlungen({ sessionId: 'synthetic' });
 assert.equal(calls, 1);
 session.revision++;
 await chat.empfehlungen({ sessionId: 'synthetic' }); assert.equal(calls, 2);
 await assert.rejects(chat.empfehlungen({ sessionId: 'unknown' }), { status: 410 });
 await assert.rejects(chat.empfehlungen({ sessionId: 'synthetic', revision: 1 }), { status: 400 });
 session.updated = 0; chat.removeExpired();
 await assert.rejects(chat.empfehlungen({ sessionId: 'synthetic' }), { status: 410 });
});
test('parallel mutation is blocked and deleted session cannot return pending model result', async () => {
 let finish!: (value: string) => void;
 const { chat } = await setup(() => new Promise(resolve => { finish = resolve; }));
 const pending = chat.empfehlungen({ sessionId: 'synthetic' });
 await assert.rejects(chat.empfehlungen({ sessionId: 'synthetic' }), { status: 409 });
 chat.deleteSession({ sessionId: 'synthetic' }); finish(JSON.stringify({ status: 'offen', statusText: 'Weitere Angaben prüfen', empfehlungen: [] }));
 await assert.rejects(pending, { status: 410 }); assert.equal(chat.sessionCount, 0);
});
