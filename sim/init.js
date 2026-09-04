#!/usr/bin/env node
// Create a fresh world. Refuses to clobber an existing one without --force.

import fs from 'node:fs';
import { createWorld, worldClock } from './engine.js';
import { AGENTS } from './agents.js';
import * as io from './io.js';

const force = process.argv.includes('--force');
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 20260904;

if (io.exists() && !force) {
  console.error('world/state.json already exists. Re-run with --force to start over.');
  console.error('(That discards the village and everything the villagers remember.)');
  process.exit(1);
}

if (force) {
  for (const p of Object.values(io.PATHS)) fs.rmSync(p, { force: true });
  fs.rmSync(io.JOURNAL_DIR, { recursive: true, force: true });
}

const db = createWorld(seed);
io.ensureDirs();
io.initJournals(AGENTS);
io.save(db);

console.log(`Grasshollow created with seed ${seed}.`);
console.log(`It is ${worldClock(db.state).label}. Three people are waking up.`);
