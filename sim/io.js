// Grasshollow — persistence. The repository is the database.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const WORLD_DIR = path.join(ROOT, 'world');
export const JOURNAL_DIR = path.join(WORLD_DIR, 'journals');

export const PATHS = {
  state: path.join(WORLD_DIR, 'state.json'),
  prayers: path.join(WORLD_DIR, 'prayers.json'),
  blessings: path.join(WORLD_DIR, 'blessings.json'),
  chronicle: path.join(WORLD_DIR, 'chronicle.md'),
};

export function ensureDirs() {
  fs.mkdirSync(WORLD_DIR, { recursive: true });
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
}

const readJSON = (p, fallback) => {
  if (!fs.existsSync(p)) return fallback;
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
};

// State is written compactly because it changes every tick and would otherwise
// dominate the repository's diff history.
//
// A file whose content is unchanged is left alone entirely. Prayers and
// blessings only move when something actually happens to them, so this keeps
// them out of the tick commits — which is what makes it safe for the workflow
// to treat a push touching world/blessings.json as "a human answered someone".
const writeJSON = (p, data, pretty) => {
  const next = JSON.stringify(data, null, pretty ? 2 : 0) + '\n';
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === next) return false;
  fs.writeFileSync(p, next);
  return true;
};

export function exists() {
  return fs.existsSync(PATHS.state);
}

export function load() {
  return {
    state: readJSON(PATHS.state, null),
    prayers: readJSON(PATHS.prayers, { prayers: [] }),
    blessings: readJSON(PATHS.blessings, { pending: [], applied: [] }),
  };
}

export function save(db) {
  ensureDirs();
  writeJSON(PATHS.state, db.state, false);
  writeJSON(PATHS.prayers, db.prayers, true);
  writeJSON(PATHS.blessings, db.blessings, true);
}

export function appendJournals(entries) {
  if (!entries.length) return;
  ensureDirs();
  const byAgent = new Map();
  for (const e of entries) {
    if (!byAgent.has(e.agentId)) byAgent.set(e.agentId, []);
    byAgent.get(e.agentId).push(e);
  }
  for (const [agentId, list] of byAgent) {
    const file = path.join(JOURNAL_DIR, `${agentId}.md`);
    let out = '';
    let lastDay = null;
    if (fs.existsSync(file)) {
      const tail = fs.readFileSync(file, 'utf8');
      const m = [...tail.matchAll(/^## Day (\d+)/gm)].pop();
      if (m) lastDay = Number(m[1]);
    }
    for (const e of list) {
      if (e.day !== lastDay) { out += `\n## Day ${e.day}\n\n`; lastDay = e.day; }
      out += `- **${e.time}** _(${e.kind})_ — ${e.text}\n`;
    }
    fs.appendFileSync(file, out);
  }
}

export function appendChronicle(events) {
  if (!events.length) return;
  ensureDirs();
  let lastDay = null;
  if (fs.existsSync(PATHS.chronicle)) {
    const m = [...fs.readFileSync(PATHS.chronicle, 'utf8').matchAll(/^## Day (\d+)/gm)].pop();
    if (m) lastDay = Number(m[1]);
  }
  let out = '';
  for (const e of events) {
    if (e.day !== lastDay) { out += `\n## Day ${e.day}\n\n`; lastDay = e.day; }
    out += `- **${e.time}** — ${e.text}\n`;
  }
  fs.appendFileSync(PATHS.chronicle, out);
}

export function initJournals(agents) {
  ensureDirs();
  for (const def of agents) {
    const file = path.join(JOURNAL_DIR, `${def.id}.md`);
    if (fs.existsSync(file)) continue;
    const header =
      `# The journal of ${def.name}\n\n` +
      `_${def.role}, age ${def.age}, of Grasshollow._\n\n` +
      `${def.backstory.trim().replace(/\n/g, ' ')}\n\n` +
      `## Before the experiment\n\n` +
      def.seedMemories.map((m) => `- _(${m.kind})_ — ${m.text}`).join('\n') + '\n';
    fs.writeFileSync(file, header);
  }
  if (!fs.existsSync(PATHS.chronicle)) {
    fs.writeFileSync(PATHS.chronicle,
      '# The Chronicle of Grasshollow\n\nEverything the village noticed, in the order it happened.\n');
  }
}
