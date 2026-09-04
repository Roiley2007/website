// Grasshollow — simulation engine.
//
// Pure and deterministic: given the same state and the same tick count, Node
// and the browser produce byte-identical results. That is what lets the viewer
// extrapolate ahead of the last commit without drifting from canon.

import { buildMap, findPath, allBuildings, nextPlot, POI, MAP_W, MAP_H, walkable } from './world.js';
import { AGENTS, agentById } from './agents.js';
import { rngFor } from './rng.js';
import { composePrayer, composeThought, prayerTitle } from './text.js';

export const MINUTES_PER_TICK = 5;
export const TICK_MS = 60_000;              // one tick per real-world minute
export const MAX_CATCHUP_TICKS = 2880;      // cap a backlog at ~2 real days
export const MINUTES_PER_DAY = 1440;
export const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK; // 288
export const SPEED = 3.5;                   // tiles walked per tick

const PRAYER_COOLDOWN = 1400;  // ticks before the same plea may be repeated (~5 world days)
const PRESSURE_TRIGGER = 45;   // accumulated urgency needed to walk to the temple
const DOUBT_AFTER = 2600;      // ticks an unanswered prayer waits before doubt sets in

const DECAY = { hunger: 0.30, thirst: 0.42, energy: 0.42, social: 0.16, comfort: 0.13, spirit: 0.07 };
const NEED_KEYS = Object.keys(DECAY);

const DURATION = { eat: 4, drink: 3, work: 24, socialise: 10, pray: 6, fetch: 4, wander: 6, rest: 8, mend: 14, hearth: 10, forage: 10 };

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_DAYS = 20;
const SEASON_GROWTH = { spring: 1.10, summer: 1.25, autumn: 0.85, winter: 0.35 };
const SEASON_CHILL = { spring: 1.0, summer: 0.8, autumn: 1.15, winter: 1.7 };

const WEATHER = {
  clear:  { growth: 1.00, water: 1.00, chill: 1.00, label: 'clear' },
  cloudy: { growth: 0.95, water: 1.00, chill: 1.05, label: 'cloudy' },
  rain:   { growth: 1.50, water: 3.00, chill: 1.25, label: 'rain' },
  storm:  { growth: 1.10, water: 2.50, chill: 1.45, label: 'storm' },
  drought:{ growth: 0.15, water: 0.10, chill: 1.10, label: 'drought' },
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const VILLAGE_CAPS = { granary: 300, fieldYield: 100, wellWater: 100, firewood: 200 };

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export function worldClock(state) {
  const total = state.worldMinutes;
  const day = Math.floor(total / MINUTES_PER_DAY) + 1;
  const mins = total % MINUTES_PER_DAY;
  const hour = Math.floor(mins / 60);
  const minute = Math.floor(mins % 60);
  const h = hour % 24;
  let phase = 'day';
  if (h < 5 || h >= 21) phase = 'night';
  else if (h < 7) phase = 'dawn';
  else if (h >= 19) phase = 'dusk';
  const season = SEASONS[Math.floor((day - 1) / SEASON_DAYS) % SEASONS.length];
  return {
    day, hour: h, minute, phase, season,
    time: `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    label: `Day ${day}, ${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

const isNight = (c) => c.phase === 'night';

// ---------------------------------------------------------------------------
// World creation
// ---------------------------------------------------------------------------

export function createWorld(seed = 20260904) {
  const state = {
    version: 1,
    seed,
    rngState: seed | 0,
    tick: 0,
    startedAt: new Date().toISOString(),
    lastTickAt: new Date().toISOString(),
    worldMinutes: 6 * 60,           // the experiment opens at 06:00 on day one
    weather: 'clear',
    weatherUntil: 120,
    nextPrayerId: 1,
    agents: [],
    houses: {},
    village: { granary: 70, fieldYield: 60, wellWater: 85, firewood: 30 },
    structures: [],
    events: [],
  };

  for (const def of AGENTS) state.houses[def.home] = { larder: 30, warmth: 60, repair: 85 };

  const buildings = allBuildings(state);
  for (const def of AGENTS) {
    const b = buildings.find((x) => x.id === def.home);
    const spawn = { x: b.door.x, y: b.door.y + 1 };
    state.agents.push({
      id: def.id,
      pos: { x: spawn.x, y: spawn.y },
      prev: { x: spawn.x, y: spawn.y },
      path: [],
      action: null,
      needs: { hunger: 72, thirst: 68, energy: 80, social: 60, comfort: 65, spirit: 55 },
      inventory: [],
      memories: def.seedMemories.map((m, i) => ({
        tick: -1, day: 0, time: 'before', text: m.text, kind: m.kind, weight: m.weight, seed: true, i,
      })),
      relationships: Object.fromEntries(AGENTS.filter((o) => o.id !== def.id).map((o) => [o.id, 45])),
      pressure: {},
      prayedFor: {},
      prayerCounts: {},
      answeredCounts: {},
      pendingDesire: null,
      openPrayers: [],
      thought: 'Waking up.',
      stats: { prayers: 0, answered: 0, meals: 0, nights: 0, shifts: 0, conversations: 0 },
    });
  }

  const prayers = { prayers: [] };
  const blessings = { pending: [], applied: [] };
  return { state, prayers, blessings };
}

// ---------------------------------------------------------------------------
// Inventory modifiers
// ---------------------------------------------------------------------------

function modifiers(agent) {
  const m = {
    hungerDecay: 1, thirstDecay: 1, energyDecay: 1, socialDecay: 1, comfortDecay: 1, spiritDecay: 1,
    energyRestore: 1, comfortRestore: 1,
  };
  for (const item of agent.inventory) {
    for (const [k, v] of Object.entries(item.modifiers ?? {})) {
      if (k in m && typeof v === 'number') m[k] *= v;
    }
  }
  return m;
}

const provides = (agent, what) =>
  agent.inventory.some((i) => (i.provides ?? []).includes(what));

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

function remember(state, agent, text, kind, weight, out) {
  const c = worldClock(state);
  const mem = { tick: state.tick, day: c.day, time: c.time, text, kind, weight };
  agent.memories.push(mem);
  // Keep the working set small; the full history lives in the journals.
  if (agent.memories.length > 60) {
    // Forget the least significant non-seed memory rather than the oldest.
    let worst = -1, worstScore = Infinity;
    for (let i = 0; i < agent.memories.length; i++) {
      const m = agent.memories[i];
      if (m.seed) continue;
      const score = m.weight * 1000 - (state.tick - m.tick) * 0.01;
      if (score < worstScore) { worstScore = score; worst = i; }
    }
    if (worst >= 0) agent.memories.splice(worst, 1);
  }
  out?.journal.push({ agentId: agent.id, day: c.day, time: c.time, tick: state.tick, kind, text });
  return mem;
}

function record(state, text, out) {
  const c = worldClock(state);
  const ev = { tick: state.tick, day: c.day, time: c.time, text };
  state.events.push(ev);
  if (state.events.length > 40) state.events.shift();
  out?.events.push(ev);
}

// ---------------------------------------------------------------------------
// Desires — what an agent would ask for, if asking were free
// ---------------------------------------------------------------------------

function evaluateDesires(state, agent, def) {
  const n = agent.needs;
  const house = state.houses[def.home];
  const v = state.village;
  const out = [];

  const add = (kind, id, urgency, text, shortText) => {
    if (urgency > 0 && !provides(agent, id)) out.push({ kind, id, urgency, text, shortText });
  };

  if (n.hunger < 45 && house.larder < 8 && v.granary < 18)
    add('food', 'food', (45 - n.hunger) / 45, null, null);
  if (n.thirst < 45 && v.wellWater < 10)
    add('water', 'water', (45 - n.thirst) / 45, null, null);
  if (n.comfort < 42 && house.warmth < 28 && v.firewood < 6)
    add('warmth', 'warmth', (42 - n.comfort) / 42, null, null);
  if (house.repair < 28 && v.firewood < 6)
    add('shelter', 'shelter', (28 - house.repair) / 28, null, null);
  if (n.energy < 16 && (house.warmth < 30 || house.repair < 30))
    add('rest', 'rest', (16 - n.energy) / 16 * 0.8, null, null);
  if (n.social < 26)
    add('company', 'company', (26 - n.social) / 26 * 0.9, null, null);
  if (n.spirit < 28)
    add('spirit', 'spirit', (28 - n.spirit) / 28 * 0.7, null, null);

  // The personal longings only surface when spirits are low enough that the
  // villager stops pretending they do not want anything.
  if (n.spirit < 58) {
    for (const l of def.longings) {
      const linked = n[l.need] ?? 60;
      const urgency = l.weight * ((58 - n.spirit) / 58) * (0.5 + 0.5 * (100 - linked) / 100) * 0.55;
      out.push(...(provides(agent, l.id) ? [] : [{ kind: 'longing', id: l.id, urgency, text: l.text, shortText: l.title, selfTitle: l.selfTitle }]));
    }
  }
  return out;
}

function updatePressure(state, agent, def) {
  const desires = evaluateDesires(state, agent, def);
  const seen = new Set();

  for (const d of desires) {
    seen.add(d.id);
    agent.pressure[d.id] = (agent.pressure[d.id] ?? 0) + d.urgency;
  }
  for (const k of Object.keys(agent.pressure)) {
    if (!seen.has(k)) {
      agent.pressure[k] *= 0.985;
      if (agent.pressure[k] < 0.05) delete agent.pressure[k];
    }
  }

  if (agent.pendingDesire) return;

  let best = null;
  for (const d of desires) {
    const p = agent.pressure[d.id] ?? 0;
    if (p < PRESSURE_TRIGGER) continue;
    const unanswered = Math.max(0, (agent.prayerCounts[d.id] ?? 0) - (agent.answeredCounts?.[d.id] ?? 0));
    const patience = unanswered >= 4 ? 6 : 1 + 1.2 * unanswered;
    const last = agent.prayedFor[d.id];
    if (last != null && state.tick - last < PRAYER_COOLDOWN * patience) continue;
    if (agent.openPrayers.some((o) => o.desireId === d.id)) continue;
    if (!best || p > best.p) best = { d, p };
  }
  if (best) agent.pendingDesire = { ...best.d, pressure: best.p };
}

// ---------------------------------------------------------------------------
// Action selection
// ---------------------------------------------------------------------------

function foodAvailable(state, def) {
  return state.houses[def.home].larder >= 1;
}

function destinationFor(state, def, kind) {
  const bs = allBuildings(state);
  const home = bs.find((b) => b.id === def.home);
  switch (kind) {
    case 'sleep':
    case 'eat':
    case 'mend':
    case 'hearth':
    case 'rest':
      // The doorstep rather than the doorway, so they stay visible in front
      // of their own house instead of being occluded by it.
      return { x: home.door.x, y: home.door.y + 1 };
    case 'drink': return { ...POI.well };
    case 'pray': return { ...POI.altar };
    case 'socialise': return { ...POI.square };
    case 'fetch': {
      const granary = bs.find((b) => b.kind === 'granary');
      return granary ? { x: granary.door.x, y: granary.door.y } : { ...POI.square };
    }
    case 'forage': return { ...POI.woods };
    case 'work': {
      const p = POI[def.workplace] ?? POI.square;
      return { ...p };
    }
    default: return { ...POI.square };
  }
}

function chooseAction(state, agent, def, grid, rng) {
  const n = agent.needs;
  const c = worldClock(state);
  const night = isNight(c);
  const house = state.houses[def.home];
  const v = state.village;
  const scores = [];

  const push = (kind, score, extra = {}) => { if (score > 0) scores.push({ kind, score, ...extra }); };

  push('sleep', (100 - n.energy) * (night ? 1.8 : 0.35));
  if (foodAvailable(state, def)) push('eat', (100 - n.hunger) * 1.25);
  if (v.granary >= 1.5) push('fetch', (100 - n.hunger) * 1.15 * (house.larder < 6 ? 1.25 : 0.35));
  // Hedgerows and the wood's edge: slow, thin food, but it is always there.
  const noStores = house.larder < 1 && v.granary < 1.5;
  if (!night) push('forage', (100 - n.hunger) * (noStores ? 1.05 : 0.12));
  if (v.wellWater >= 3) push('drink', (100 - n.thirst) * 1.4);
  if (!night && n.energy > 12) push('work', 34 + (100 - Math.min(100, v.granary)) * 0.22, { thoughtKey: `work_${def.workplace}` });
  if (!night) push('socialise', (100 - n.social) * 0.85);
  // Devotion scales with how survivable the day is: the desperate eat first.
  const survival = clamp(Math.min(n.hunger, n.thirst, n.energy) / 55, 0.08, 1);
  if (!night || n.spirit < 25) {
    const devotion = agent.pendingDesire
      ? 95 + Math.min(30, agent.pressure[agent.pendingDesire.id] ?? 0)
      : (100 - n.spirit) * 0.28;
    push('pray', devotion * survival);
  }
  if (!night && house.repair < 62 && v.firewood > 4 && n.energy > 20)
    push('mend', (62 - house.repair) * 1.15);
  push('hearth', (100 - n.comfort) * 0.55);
  push('wander', 14);
  push('rest', night ? 4 : 8);

  // Starvation and thirst override everything, including sleep.
  if (n.hunger < 16) for (const s of scores) if (['eat', 'fetch', 'forage'].includes(s.kind)) s.score += 220;
  if (n.thirst < 16) for (const s of scores) if (s.kind === 'drink') s.score += 230;

  // Small deterministic jitter so identical days do not produce identical routines.
  for (const s of scores) s.score += rng.range(0, 6);

  scores.sort((a, b) => b.score - a.score);
  const chosen = scores[0] ?? { kind: 'rest', score: 1 };

  let dest = destinationFor(state, def, chosen.kind);
  if (chosen.kind === 'wander') {
    for (let i = 0; i < 20; i++) {
      const x = rng.int(2, MAP_W - 3), y = rng.int(2, MAP_H - 3);
      if (walkable(grid, x, y)) { dest = { x, y }; break; }
    }
  }

  return {
    kind: chosen.kind,
    thoughtKey: chosen.thoughtKey ?? chosen.kind,
    phase: 'travel',
    dest,
    remaining: DURATION[chosen.kind] ?? 6,
    meta: {},
  };
}

/** True when the current action should be abandoned mid-flight. */
function shouldInterrupt(state, agent, def) {
  const a = agent.action;
  if (!a) return true;
  const n = agent.needs;
  if (n.thirst < 12 && a.kind !== 'drink' && state.village.wellWater >= 3) return true;
  if (n.hunger < 12 && a.kind !== 'eat' && a.kind !== 'fetch') return true;
  if (agent.pendingDesire && a.kind !== 'pray' && a.phase === 'travel') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function stepMovement(state, agent, grid) {
  const a = agent.action;
  if (!a || a.phase !== 'travel') return;

  if (!agent.path.length) {
    agent.path = findPath(grid, agent.pos, a.dest);
    if (!agent.path.length) { a.phase = 'do'; return; }
  }

  let budget = SPEED;
  while (budget > 0 && agent.path.length) {
    const next = agent.path[0];
    const dx = next.x - agent.pos.x, dy = next.y - agent.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      agent.pos.x = next.x; agent.pos.y = next.y;
      agent.path.shift();
      budget -= dist;
    } else {
      agent.pos.x += (dx / dist) * budget;
      agent.pos.y += (dy / dist) * budget;
      budget = 0;
    }
  }
  if (!agent.path.length) a.phase = 'do';
}

// ---------------------------------------------------------------------------
// Action effects, applied once per tick while the agent is doing the thing
// ---------------------------------------------------------------------------

function performAction(db, state, agent, def, rng, out) {
  const a = agent.action;
  const n = agent.needs;
  const house = state.houses[def.home];
  const v = state.village;
  const m = modifiers(agent);

  switch (a.kind) {
    case 'sleep': {
      n.energy = clamp(n.energy + 1.05 * m.energyRestore);
      const heat = house.warmth / 100, sound = house.repair / 100;
      n.comfort = clamp(n.comfort + 0.40 * (0.4 + 0.6 * heat) * (0.5 + 0.5 * sound) * m.comfortRestore);
      if (v.firewood > 0 && house.warmth < 90) { v.firewood -= 0.10; house.warmth = clamp(house.warmth + 0.45); }
      const c = worldClock(state);
      if (n.energy > 93 || (c.hour >= 6 && c.hour < 20)) {
        a.remaining = 0;
        agent.stats.nights++;
        if (rng.chance(0.16)) remember(state, agent, nightMemory(state, agent, house, rng), 'rest', 3, out);
      } else {
        a.remaining = 2; // keep sleeping
      }
      break;
    }
    case 'eat': {
      if (a.meta.portion == null) {
        const portion = Math.min(6, house.larder);
        if (portion < 0.5) { a.remaining = 1; a.meta.portion = 0; break; }
        house.larder -= portion;
        a.meta.portion = portion;
      }
      if (!a.meta.portion) break;
      n.hunger = clamp(n.hunger + (45 * (a.meta.portion / 6)) / DURATION.eat);
      n.comfort = clamp(n.comfort + 0.5);
      if (a.remaining <= 1) {
        agent.stats.meals++;
        if (rng.chance(0.10)) remember(state, agent, `Ate at home. The larder is down to ${Math.round(house.larder)}.`, 'ordinary', 2, out);
      }
      break;
    }
    case 'drink': {
      if (a.remaining === DURATION.drink) {
        if (v.wellWater >= 2.5) v.wellWater -= 2.5;
        else { a.remaining = 1; break; }
      }
      n.thirst = clamp(n.thirst + 58 / DURATION.drink);
      break;
    }
    case 'fetch': {
      if (a.remaining <= 1) {
        const moved = Math.min(24, Math.max(0, v.granary));
        v.granary -= moved; house.larder += moved;
        if (moved < 4) remember(state, agent, 'Went to the store for grain. There was nothing worth carrying home.', 'hardship', 6, out);
      }
      break;
    }
    case 'work': {
      n.energy = clamp(n.energy - 0.22);
      if (def.workplace === 'field') {
        const take = Math.min(v.fieldYield, 0.90);
        v.fieldYield -= take; v.granary = clamp(v.granary + take, 0, 300);
        n.hunger = clamp(n.hunger + 0.25); // he eats a little as he works
      } else if (def.workplace === 'woods') {
        v.firewood = clamp(v.firewood + 0.36, 0, 200);
        if (rng.chance(0.012)) house.repair = clamp(house.repair + 3);
      } else if (def.workplace === 'well') {
        v.wellWater = clamp(v.wellWater + 0.10);
        n.spirit = clamp(n.spirit + 0.05);
      }
      if (a.remaining <= 1) {
        agent.stats.shifts++;
        if (rng.chance(0.14)) remember(state, agent, workMemory(def, state, rng), 'work', 3, out);
      }
      break;
    }
    case 'socialise': {
      let partner = null, bestD = 6;
      for (const other of state.agents) {
        if (other.id === agent.id) continue;
        const d = Math.hypot(other.pos.x - agent.pos.x, other.pos.y - agent.pos.y);
        if (d < bestD) { bestD = d; partner = other; }
      }
      if (partner) {
        const pdef = agentById(partner.id);
        a.meta.otherName = pdef.name.split(' ')[0];
        n.social = clamp(n.social + 2.4);
        n.spirit = clamp(n.spirit + 0.12);
        agent.relationships[partner.id] = clamp((agent.relationships[partner.id] ?? 45) + 0.35);
        if (a.remaining <= 1) {
          agent.stats.conversations++;
          if (rng.chance(0.3)) remember(state, agent, socialMemory(def, pdef, agent, rng), 'company', 4, out);
        }
      } else {
        n.social = clamp(n.social + 0.35);
        if (a.remaining <= 1 && rng.chance(0.22))
          remember(state, agent, 'Waited at the square a while. Nobody came by.', 'loneliness', 5, out);
      }
      break;
    }
    case 'pray': {
      n.spirit = clamp(n.spirit + 14 / DURATION.pray);
      if (a.remaining <= 1) emitPrayer(db, state, agent, def, rng, out);
      break;
    }
    case 'forage': {
      n.hunger = clamp(n.hunger + 2.0);
      n.energy = clamp(n.energy - 0.10);
      if (a.remaining <= 1) {
        house.larder += 3;
        if (rng.chance(0.16))
          remember(state, agent, 'Spent the afternoon along the hedgerows for berries and roots. It is not a meal. It is not nothing.', 'hardship', 5, out);
      }
      break;
    }
    case 'mend': {
      if (v.firewood > 0.2) {
        v.firewood -= 0.18;
        house.repair = clamp(house.repair + 0.75);
        n.energy = clamp(n.energy - 0.15);
      } else {
        a.remaining = 1;
      }
      if (a.remaining <= 1 && rng.chance(0.18))
        remember(state, agent, `Patched the roof and the north wall. It will hold for a while. It always holds for a while.`, 'work', 3, out);
      break;
    }
    case 'hearth': {
      const heat = house.warmth / 100;
      n.comfort = clamp(n.comfort + 0.95 * (0.35 + 0.65 * heat) * m.comfortRestore);
      n.energy = clamp(n.energy + 0.22);
      n.spirit = clamp(n.spirit + 0.04);
      break;
    }
    case 'wander': {
      n.comfort = clamp(n.comfort + 0.15);
      n.spirit = clamp(n.spirit + 0.05);
      break;
    }
    default:
      n.comfort = clamp(n.comfort + 0.22);
      n.energy = clamp(n.energy + 0.10);
  }
}

function nightMemory(state, agent, house, rng) {
  if (house.warmth < 25) return rng.pick([
    'Woke in the dark, cold right through. Lay there counting the gaps in the wall.',
    'Slept badly. The fire had been out for hours.',
  ]);
  if (agent.needs.hunger < 30) return 'Slept hungry. That is a particular kind of dream.';
  return rng.pick([
    'Slept well enough. The house was warm.',
    'Woke before dawn, listened to the rain, went back under.',
    'A whole night, unbroken. Rare.',
  ]);
}

function workMemory(def, state, rng) {
  if (def.workplace === 'field') {
    return state.village.fieldYield < 12
      ? 'Worked the rows. There is very little coming up. Pulled more stones than grain.'
      : rng.pick(['A good shift in the field. Back hurts in the ordinary way.', 'Turned the east rows. The soil is behaving.']);
  }
  if (def.workplace === 'woods') {
    return rng.pick(['Cut and split until my arms went. Good pile.', 'The axe head is loose again. Wedged it with a shim. It will hold or it will not.']);
  }
  return rng.pick(['Cleared the well and wrote the water level in the ledger.', 'Water is a little lower than last week. Noted it.']);
}

function socialMemory(def, pdef, agent, rng) {
  const aff = agent.relationships[pdef.id] ?? 45;
  const first = pdef.name.split(' ')[0];
  if (aff > 72) return rng.pick([
    `Talked with ${first} for a long while. Did not want it to end, which I would not say out loud.`,
    `${first} makes the day shorter. That is the highest thing I can say about a person.`,
  ]);
  return rng.pick([
    `Spoke with ${first} at the square. News, weather, nothing.`,
    `${first} asked after me. I said I was fine, which was mostly true.`,
    `Sat with ${first}. Comfortable quiet, mostly.`,
  ]);
}

// ---------------------------------------------------------------------------
// Prayers
// ---------------------------------------------------------------------------

function emitPrayer(db, state, agent, def, rng, out) {
  const desire = agent.pendingDesire;
  if (!desire) {
    quietPrayer(state, agent, rng, out);
    return;
  }
  const c = worldClock(state);
  const id = `p-${String(state.nextPrayerId++).padStart(4, '0')}`;
  const asked = agent.prayerCounts[desire.id] ?? 0;

  const ctx = {
    duration: durationPhrase(state, agent, desire),
    previouslyAsked: asked,
  };
  const text = composePrayer(def, agent, desire, ctx, rng);

  const prayer = {
    id,
    agentId: agent.id,
    agentName: def.name,
    tick: state.tick,
    day: c.day,
    time: c.time,
    realTime: new Date().toISOString(),
    desire: { kind: desire.kind, id: desire.id, text: desire.text ?? null },
    title: prayerTitle(desire),
    selfTitle: prayerTitle(desire, true),
    text,
    status: 'pending',
    askedBefore: asked,
    context: snapshot(state, agent, def),
    answer: null,
    answeredTick: null,
  };
  db.prayers.prayers.push(prayer);

  agent.prayerCounts[desire.id] = asked + 1;
  agent.prayedFor[desire.id] = state.tick;
  agent.pressure[desire.id] = 0;
  agent.openPrayers.push({ id, desireId: desire.id, tick: state.tick });
  agent.pendingDesire = null;
  agent.stats.prayers++;
  agent.needs.spirit = clamp(agent.needs.spirit + 6);

  remember(state, agent, `Went to the temple and asked ${prayer.selfTitle}. Said it out loud, which was harder than expected.`, 'prayer', 8, out);
  record(state, `${def.name} prayed ${prayer.title}.`, out);
  out.newPrayers.push(prayer);
}

function quietPrayer(state, agent, rng, out) {
  if (rng.chance(0.2)) {
    remember(state, agent, rng.pick([
      'Sat in the temple a while without asking for anything. It was quiet and that was the point.',
      'Went to the temple out of habit. Said nothing. Felt marginally better.',
    ]), 'prayer', 3, out);
  }
}

function durationPhrase(state, agent, desire) {
  const t = agent.prayedFor[desire.id];
  const ticks = t == null ? state.tick : state.tick - t;
  const days = Math.max(1, Math.round(ticks / TICKS_PER_DAY));
  return days === 1 ? 'a day' : `${days} days`;
}

function snapshot(state, agent, def) {
  const h = state.houses[def.home];
  const c = worldClock(state);
  return {
    needs: Object.fromEntries(NEED_KEYS.map((k) => [k, Math.round(agent.needs[k])])),
    house: { larder: Math.round(h.larder), warmth: Math.round(h.warmth), repair: Math.round(h.repair) },
    village: {
      granary: Math.round(state.village.granary),
      fieldYield: Math.round(state.village.fieldYield),
      wellWater: Math.round(state.village.wellWater),
      firewood: Math.round(state.village.firewood),
    },
    weather: state.weather,
    season: c.season,
  };
}

// ---------------------------------------------------------------------------
// Blessings — answers arriving from outside the world
// ---------------------------------------------------------------------------

export function applyBlessings(db, out) {
  const { state, prayers, blessings } = db;
  if (!blessings.pending?.length) return;

  const remaining = [];
  for (const b of blessings.pending) {
    const prayer = prayers.prayers.find((p) => p.id === b.prayerId);
    if (!prayer) { remaining.push(b); continue; }      // wait for a prayer that has not happened yet
    if (prayer.status !== 'pending') continue;          // already settled

    const agent = state.agents.find((a) => a.id === prayer.agentId);
    const def = agentById(prayer.agentId);
    if (!agent || !def) continue;

    const granted = b.granted !== false;
    const gift = b.gift ?? {};
    const c = worldClock(state);
    const applied = [];

    if (granted) {
      if (gift.effects) {
        for (const [k, v] of Object.entries(gift.effects)) {
          if (k in agent.needs && typeof v === 'number') agent.needs[k] = clamp(agent.needs[k] + v);
        }
      }
      if (gift.kind === 'item' || gift.name) {
        const item = {
          id: gift.id ?? `${prayer.desire.id}-${prayer.id}`,
          name: gift.name ?? 'A gift',
          description: gift.description ?? '',
          icon: gift.icon ?? '✦',
          modifiers: gift.modifiers ?? {},
          provides: gift.provides ?? [prayer.desire.id],
          fromPrayer: prayer.id,
          receivedDay: c.day,
        };
        agent.inventory.push(item);
        applied.push(`item:${item.name}`);
      }
      if (gift.resource) {
        const r = Array.isArray(gift.resource) ? gift.resource : [gift.resource];
        for (const one of r) {
          const amt = Number(one.amount) || 0;
          if (one.target in state.village) {
            state.village[one.target] = clamp(state.village[one.target] + amt, 0, VILLAGE_CAPS[one.target] ?? 300);
          } else if (['larder', 'warmth', 'repair'].includes(one.target)) {
            const h = state.houses[one.house ?? def.home];
            if (h) h[one.target] = clamp(h[one.target] + amt, 0, 400);
          }
          applied.push(`resource:${one.target}+${amt}`);
        }
      }
      if (gift.structure) {
        const plot = gift.structure.at ?? nextPlot(state);
        const s = {
          id: `s-${state.structures.length + 1}-${gift.structure.kind}`,
          kind: gift.structure.kind,
          label: gift.structure.label ?? null,
          x: plot.x, y: plot.y,
          grantedDay: c.day,
          fromPrayer: prayer.id,
        };
        state.structures.push(s);
        applied.push(`structure:${s.kind}`);
        // Rebuilding the map can strand an agent inside a new wall.
        const grid = buildMap(state);
        for (const a of state.agents) {
          if (!walkable(grid, Math.round(a.pos.x), Math.round(a.pos.y))) {
            const spot = nearestFree(grid, a.pos);
            if (spot) { a.pos = { x: spot.x, y: spot.y }; a.path = []; }
          }
        }
      }

      agent.needs.spirit = clamp(agent.needs.spirit + (gift.kind === 'sign' ? 28 : 36));
      agent.stats.answered++;
      agent.answeredCounts = agent.answeredCounts ?? {};
      agent.answeredCounts[prayer.desire.id] = (agent.answeredCounts[prayer.desire.id] ?? 0) + 1;
      agent.openPrayers = agent.openPrayers.filter((o) => o.id !== prayer.id);
      delete agent.pressure[prayer.desire.id];

      const heard = b.message
        ? `Something answered. It said: "${b.message}"`
        : 'Something answered. There were no words, only the thing itself.';
      const what = gift.name
        ? ` I have it now: ${gift.name}.`
        : gift.structure
          ? ` ${gift.structure.label ?? `A ${gift.structure.kind}`} stands where there was nothing.`
          : '';
      remember(state, agent, `${heard}${what} I asked ${prayer.selfTitle ?? prayer.title} and I was not ignored.`, 'answered', 10, out);
      record(state, `${def.name}'s prayer ${prayer.title} was answered.`, out);

      // A visible miracle is witnessed by the whole village.
      if (gift.structure || gift.public) {
        for (const other of state.agents) {
          if (other.id === agent.id) continue;
          other.needs.spirit = clamp(other.needs.spirit + 12);
          remember(state, other, `${def.name.split(' ')[0]} asked for something and it arrived. I saw it with my own eyes. I do not know what to do with that.`, 'witness', 8, out);
        }
      }
    } else {
      agent.needs.spirit = clamp(agent.needs.spirit - 10);
      agent.openPrayers = agent.openPrayers.filter((o) => o.id !== prayer.id);
      const heard = b.message ? `The answer was no. It said: "${b.message}"` : 'The answer was no, and it did not explain itself.';
      remember(state, agent, `${heard} At least it was an answer.`, 'refused', 9, out);
      record(state, `${def.name}'s prayer ${prayer.title} was refused.`, out);
    }

    prayer.status = granted ? 'answered' : 'refused';
    prayer.answeredTick = state.tick;
    prayer.answeredDay = c.day;
    prayer.answer = { granted, message: b.message ?? null, gift, applied, at: new Date().toISOString() };
    blessings.applied.push({ prayerId: prayer.id, at: new Date().toISOString(), granted });
  }
  blessings.pending = remaining;
}

function nearestFree(grid, pos) {
  for (let r = 1; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(pos.x) + dx, y = Math.round(pos.y) + dy;
        if (walkable(grid, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function ageOpenPrayers(state, agent, def, out) {
  for (const open of [...agent.openPrayers]) {
    if (state.tick - open.tick < DOUBT_AFTER) continue;
    agent.openPrayers = agent.openPrayers.filter((o) => o.id !== open.id);
    agent.needs.spirit = clamp(agent.needs.spirit - 8);
    remember(state, agent, 'The thing I asked for at the temple has not come. I am not surprised. I am something, but not surprised.', 'unanswered', 7, out);
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function stepEnvironment(state, rng, out) {
  const c = worldClock(state);
  if (state.tick >= state.weatherUntil) {
    const table = {
      spring: ['clear', 'cloudy', 'rain', 'rain', 'clear', 'storm'],
      summer: ['clear', 'clear', 'cloudy', 'drought', 'rain', 'storm'],
      autumn: ['cloudy', 'rain', 'rain', 'clear', 'storm', 'cloudy'],
      winter: ['cloudy', 'clear', 'storm', 'cloudy', 'rain', 'clear'],
    }[c.season];
    const next = rng.pick(table);
    if (next !== state.weather) record(state, `The weather turned to ${WEATHER[next].label}.`, out);
    state.weather = next;
    state.weatherUntil = state.tick + rng.int(60, 260);
  }

  const w = WEATHER[state.weather] ?? WEATHER.clear;
  const v = state.village;
  v.fieldYield = clamp(v.fieldYield + 0.19 * w.growth * SEASON_GROWTH[c.season], 0, 100);
  v.wellWater = clamp(v.wellWater + 0.16 * w.water, 0, 100);

  for (const h of Object.values(state.houses)) {
    h.warmth = clamp(h.warmth - 0.055 * w.chill * SEASON_CHILL[c.season]);
    h.repair = clamp(h.repair - 0.007 - (state.weather === 'storm' ? 0.09 : 0));
  }
  if (state.weather === 'storm' && rng.chance(0.004)) {
    const ids = Object.keys(state.houses);
    const hit = rng.pick(ids);
    state.houses[hit].repair = clamp(state.houses[hit].repair - 7);
    record(state, 'A storm took shingles off one of the houses in the night.', out);
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export function step(db) {
  const { state } = db;
  const out = { events: [], journal: [], newPrayers: [] };
  const rng = rngFor(state);

  applyBlessings(db, out);

  state.tick += 1;
  state.worldMinutes += MINUTES_PER_TICK;

  stepEnvironment(state, rng, out);

  const grid = buildMap(state);
  const c = worldClock(state);
  const w = WEATHER[state.weather] ?? WEATHER.clear;

  for (const agent of state.agents) {
    const def = agentById(agent.id);
    const m = modifiers(agent);
    const n = agent.needs;
    const sleeping = agent.action?.kind === 'sleep' && agent.action.phase === 'do';

    agent.prev = { x: agent.pos.x, y: agent.pos.y };

    n.hunger = clamp(n.hunger - DECAY.hunger * m.hungerDecay);
    n.thirst = clamp(n.thirst - DECAY.thirst * m.thirstDecay * (state.weather === 'drought' ? 1.35 : 1));
    n.social = clamp(n.social - DECAY.social * m.socialDecay * (sleeping ? 0.3 : 1));
    n.spirit = clamp(n.spirit - DECAY.spirit * m.spiritDecay);
    if (!sleeping) {
      n.energy = clamp(n.energy - DECAY.energy * m.energyDecay);
      const outdoors = agent.action?.phase === 'travel' || !['sleep', 'eat'].includes(agent.action?.kind);
      n.comfort = clamp(n.comfort - DECAY.comfort * m.comfortDecay * (outdoors ? w.chill * SEASON_CHILL[c.season] : 1));
    }

    // Contentment slowly restores hope, so despair is a state the village can
    // climb out of rather than an absorbing one.
    if (n.hunger > 60 && n.thirst > 60 && n.comfort > 55 && n.energy > 50) {
      n.spirit = clamp(n.spirit + 0.10);
    }

    // Starving or parched costs health in the form of energy and spirit.
    if (n.hunger < 8) { n.energy = clamp(n.energy - 0.5); n.spirit = clamp(n.spirit - 0.12); }
    if (n.thirst < 8) { n.energy = clamp(n.energy - 0.6); n.spirit = clamp(n.spirit - 0.12); }

    updatePressure(state, agent, def);
    ageOpenPrayers(state, agent, def, out);

    if (shouldInterrupt(state, agent, def)) {
      agent.action = chooseAction(state, agent, def, grid, rng);
      agent.path = [];
    }

    stepMovement(state, agent, grid);

    if (agent.action.phase === 'do') {
      performAction(db, state, agent, def, rng, out);
      agent.action.remaining -= 1;
      if (agent.action.remaining <= 0) {
        agent.action = chooseAction(state, agent, def, grid, rng);
        agent.path = [];
      }
    }

    agent.thought = composeThought(agent, rng);
  }

  state.lastTickAt = new Date().toISOString();
  return out;
}

/** Advance the world by n ticks, collecting everything that happened. */
export function advance(db, ticks) {
  const total = { events: [], journal: [], newPrayers: [] };
  const n = Math.max(0, Math.min(MAX_CATCHUP_TICKS, Math.floor(ticks)));
  for (let i = 0; i < n; i++) {
    const out = step(db);
    total.events.push(...out.events);
    total.journal.push(...out.journal);
    total.newPrayers.push(...out.newPrayers);
  }
  total.ticks = n;
  return total;
}

/** How many ticks the world owes real time. */
export function ticksOwed(state, now = Date.now()) {
  const last = Date.parse(state.lastTickAt || state.startedAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.floor((now - last) / TICK_MS));
}

export { WEATHER, NEED_KEYS };
