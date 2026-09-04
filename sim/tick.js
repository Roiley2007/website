#!/usr/bin/env node
// Advance the world by however many ticks real time owes it, then persist.
// This is what the scheduled workflow runs.

import { advance, ticksOwed, worldClock, MAX_CATCHUP_TICKS } from './engine.js';
import * as io from './io.js';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};

if (!io.exists()) {
  console.error('No world yet. Run `npm run init` first.');
  process.exit(1);
}

const db = io.load();
const forced = arg('ticks');
const owed = ticksOwed(db.state);
const ticks = forced != null ? Number(forced) : owed;

if (ticks <= 0) {
  console.log(`Nothing owed — the world is current at ${worldClock(db.state).label}.`);
  process.exit(0);
}
if (owed > MAX_CATCHUP_TICKS && forced == null) {
  console.log(`Owed ${owed} ticks but capping catch-up at ${MAX_CATCHUP_TICKS}.`);
}

const before = worldClock(db.state);
const out = advance(db, ticks);
const after = worldClock(db.state);

io.save(db);
io.appendJournals(out.journal);
io.appendChronicle(out.events);

console.log(`Advanced ${out.ticks} ticks: ${before.label} -> ${after.label} (${after.season}, ${db.state.weather}).`);
for (const p of out.newPrayers) console.log(`  PRAYER ${p.id}: ${p.agentName} prayed ${p.title}`);
for (const e of out.events) console.log(`  ${e.text}`);

const pending = db.prayers.prayers.filter((p) => p.status === 'pending');
if (pending.length) console.log(`${pending.length} prayer(s) awaiting an answer.`);
