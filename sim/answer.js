#!/usr/bin/env node
// Grasshollow — the other end of the prayer.
//
//   node sim/answer.js list
//   node sim/answer.js show p-0003
//   node sim/answer.js grant  p-0003 --name "A lantern that will not blow out" \
//        --desc "Brass, heavier than it looks." --icon "🏮" \
//        --effects comfort=25,spirit=15 --modifiers comfortDecay=0.7 --provides lantern \
//        --message "Carry it to the well and back."
//   node sim/answer.js resource  p-0003 --target granary --amount 120
//   node sim/answer.js structure p-0003 --kind library --label "The Fenn Library"
//   node sim/answer.js sign      p-0003 --message "I heard you."
//   node sim/answer.js deny      p-0003 --message "Not this. Ask again in spring."
//
// Answers are queued into world/blessings.json and land on the next tick.

import { worldClock, NEED_KEYS } from './engine.js';
import { STRUCTURE_KINDS } from './world.js';
import * as io from './io.js';

const argv = process.argv.slice(2);
const cmd = argv[0];

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const has = (name) => argv.includes(`--${name}`) || argv.some((a) => a.startsWith(`--${name}=`));

/** "hunger=30,spirit=10" -> { hunger: 30, spirit: 10 } */
const pairs = (raw) => {
  if (!raw) return null;
  const out = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) out[k.trim()] = Number(v);
  }
  return out;
};

if (!io.exists()) {
  console.error('No world yet. Run `npm run init` first.');
  process.exit(1);
}
const db = io.load();
const all = db.prayers.prayers;

const bar = (v) => {
  const n = Math.round(v / 10);
  return '█'.repeat(n) + '·'.repeat(10 - n);
};

function printPrayer(p, full) {
  const queued = db.blessings.pending.find((b) => b.prayerId === p.id);
  const mark = p.status === 'pending' ? (queued ? '[queued]' : '[PENDING]') : `[${p.status}]`;
  console.log(`\n${mark} ${p.id}  ${p.agentName} — ${p.title}`);
  console.log(`  Day ${p.day}, ${p.time}${p.askedBefore ? `  (asked ${p.askedBefore}x before)` : ''}`);
  if (!full) return;
  console.log(`  ${p.context.weather}, ${p.context.season}`);
  console.log('  needs: ' + NEED_KEYS.map((k) => `${k} ${bar(p.context.needs[k])} ${String(p.context.needs[k]).padStart(3)}`).join('\n         '));
  console.log(`  house: larder ${p.context.house.larder}, warmth ${p.context.house.warmth}, repair ${p.context.house.repair}`);
  console.log(`  village: ${JSON.stringify(p.context.village)}`);
  console.log('\n' + p.text.split('\n').map((l) => '  | ' + l).join('\n'));
  if (p.answer) {
    console.log(`\n  ANSWERED (day ${p.answeredDay}): ${p.answer.granted ? 'granted' : 'refused'}`);
    if (p.answer.message) console.log(`  "${p.answer.message}"`);
    if (p.answer.applied?.length) console.log(`  applied: ${p.answer.applied.join(', ')}`);
  }
}

function queue(entry) {
  const p = all.find((x) => x.id === entry.prayerId);
  if (!p) { console.error(`No prayer ${entry.prayerId}.`); process.exit(1); }
  if (p.status !== 'pending') { console.error(`${p.id} is already ${p.status}.`); process.exit(1); }
  db.blessings.pending = db.blessings.pending.filter((b) => b.prayerId !== entry.prayerId);
  db.blessings.pending.push(entry);
  io.save(db);
  console.log(`Queued an answer to ${p.id} (${p.agentName}, ${p.title}).`);
  console.log('It reaches them on the next tick.');
}

const target = argv[1];
const message = flag('message');

switch (cmd) {
  case 'list': {
    const pending = all.filter((p) => p.status === 'pending');
    const clock = worldClock(db.state);
    console.log(`Grasshollow — ${clock.label} (${clock.season}, ${db.state.weather})`);
    console.log(`${all.length} prayers all told, ${pending.length} unanswered.`);
    for (const p of (has('all') ? all : pending)) printPrayer(p, false);
    if (!pending.length) console.log('\nNothing is being asked of you right now.');
    else console.log(`\nRead one with:  node sim/answer.js show ${pending[0].id}`);
    break;
  }
  case 'show': {
    const p = all.find((x) => x.id === target);
    if (!p) { console.error(`No prayer ${target}.`); process.exit(1); }
    printPrayer(p, true);
    break;
  }
  case 'grant': {
    queue({
      prayerId: target, granted: true, message,
      gift: {
        kind: 'item',
        name: flag('name') ?? 'A gift',
        description: flag('desc') ?? '',
        icon: flag('icon') ?? '✦',
        effects: pairs(flag('effects')) ?? undefined,
        modifiers: pairs(flag('modifiers')) ?? undefined,
        provides: flag('provides') ? flag('provides').split(',') : undefined,
        public: has('public'),
      },
    });
    break;
  }
  case 'resource': {
    const t = flag('target');
    if (!t) { console.error('--target is required (granary, fieldYield, wellWater, firewood, larder, warmth, repair)'); process.exit(1); }
    queue({
      prayerId: target, granted: true, message,
      gift: { kind: 'resource', resource: { target: t, amount: Number(flag('amount') ?? 50), house: flag('house') ?? undefined }, public: has('public') },
    });
    break;
  }
  case 'structure': {
    const kind = flag('kind');
    if (!kind || !STRUCTURE_KINDS[kind]) {
      console.error(`--kind must be one of: ${Object.keys(STRUCTURE_KINDS).join(', ')}`);
      process.exit(1);
    }
    queue({
      prayerId: target, granted: true, message,
      gift: {
        kind: 'structure',
        structure: { kind, label: flag('label') ?? undefined },
        effects: pairs(flag('effects')) ?? undefined,
        provides: flag('provides') ? flag('provides').split(',') : undefined,
      },
    });
    break;
  }
  case 'sign': {
    if (!message) { console.error('--message is required for a sign.'); process.exit(1); }
    queue({ prayerId: target, granted: true, message, gift: { kind: 'sign', public: true } });
    break;
  }
  case 'deny': {
    queue({ prayerId: target, granted: false, message });
    break;
  }
  default:
    console.log(`Grasshollow — answering prayers

  list                    unanswered prayers  (--all for every prayer ever)
  show <id>               the full prayer, with the state of the world around it
  grant <id> ...          give them a thing they can carry
  resource <id> ...       give the village grain, water, firewood, repairs
  structure <id> ...      raise a building: ${Object.keys(STRUCTURE_KINDS).join(', ')}
  sign <id> --message     no gift, only an answer. They still hear it.
  deny <id> --message     refuse. Being refused is not the same as being ignored.

Every answer takes --message, which is what the villager hears.`);
}
