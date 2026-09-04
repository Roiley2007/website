// Grasshollow — viewer.
//
// The committed state in world/state.json is canon. Because the engine is
// deterministic, this page can run it forward from that snapshot to show the
// village as it is *now* rather than as it was at the last commit. Everything
// extrapolated here will be reproduced exactly by the scheduled runner.

import { render } from '../sim/render.js';
import { step, ticksOwed, worldClock, TICK_MS, NEED_KEYS, MAX_CATCHUP_TICKS } from '../sim/engine.js';
import { AGENTS } from '../sim/agents.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const el = (id) => document.getElementById(id);
const RESYNC_MS = 5 * 60 * 1000;

let db = null;
let canonicalPrayerIds = new Set();
// When the world was last *committed*, as opposed to how far this page has
// since run it forward on its own.
let canonicalLastTick = null;
let acc = 0;
let lastFrame = performance.now();
let lastSync = 0;
let lastHealth = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function fetchJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function sync(first = false) {
  try {
    const [state, prayers] = await Promise.all([
      fetchJSON('world/state.json'),
      fetchJSON('world/prayers.json'),
    ]);
    db = { state, prayers, blessings: { pending: [], applied: [] } };
    canonicalPrayerIds = new Set(prayers.prayers.map((p) => p.id));
    // Captured before extrapolating, because stepping moves lastTickAt to now.
    canonicalLastTick = Date.parse(state.lastTickAt);

    // Catch the snapshot up to the present moment.
    const owed = Math.min(ticksOwed(state), MAX_CATCHUP_TICKS);
    for (let i = 0; i < owed; i++) step(db);

    lastSync = Date.now();
    acc = 0;
    drawPanels();
  } catch (err) {
    canonicalLastTick = null;
    setHealth('stopped', 'no world yet');
    if (first) {
      el('agents').innerHTML =
        `<div class="empty">Could not load <code>world/state.json</code>.<br>Run <code>npm run init</code>, commit it, and the village appears.</div>`;
    }
    console.warn(err);
  }
}

// ---------------------------------------------------------------------------
// Health
//
// This page runs the simulation forward locally, so it looks alive whether or
// not the scheduled runner is still committing. That is a good way to be
// fooled, so say out loud how long it has been since the world was last
// written down.
// ---------------------------------------------------------------------------

const LATE_MS = 45 * 60 * 1000;
const STOPPED_MS = 3 * 60 * 60 * 1000;

function setHealth(cls, text, title = '') {
  const dot = document.querySelector('.dot');
  if (dot) dot.className = `dot ${cls}`;
  const s = el('sync');
  s.textContent = text;
  s.title = title;
}

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function drawHealth() {
  if (canonicalLastTick == null || !Number.isFinite(canonicalLastTick)) return;
  const since = Date.now() - canonicalLastTick;
  if (since < LATE_MS) {
    setHealth('ok', `live · committed ${ago(since)}`, 'The scheduled runner is advancing and committing the world.');
  } else if (since < STOPPED_MS) {
    setHealth('late', `runner late · last commit ${ago(since)}`,
      'GitHub Actions cron is best-effort and often runs late. No time is lost — the engine catches up.');
  } else {
    setHealth('stopped', `not running · last commit ${ago(since)}`,
      'Nothing has been committed in hours. The village you are watching is being simulated in this browser only, and is not being saved. Check the Actions tab.');
  }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const needColor = (v) =>
  v > 60 ? '#8fae6a' : v > 32 ? '#d9b872' : v > 15 ? '#d08a5a' : '#c4645c';

function drawPanels() {
  if (!db) return;
  const { state } = db;
  const clock = worldClock(state);

  el('clock').textContent = clock.label;
  el('weather').textContent = `${clock.season} · ${state.weather}`;

  const faith = state.agents.reduce((s, a) => s + a.needs.spirit, 0) / state.agents.length;
  const f = el('faith');
  f.textContent = `${Math.round(faith)}%`;
  f.style.color = needColor(faith);

  const v = state.village;
  el('resources').innerHTML =
    `granary <b>${Math.round(v.granary)}</b> · field <b>${Math.round(v.fieldYield)}</b> · ` +
    `well <b>${Math.round(v.wellWater)}</b> · firewood <b>${Math.round(v.firewood)}</b> · ` +
    `tick <b>${state.tick}</b>`;

  el('agents').innerHTML = state.agents.map((a) => {
    const def = AGENTS.find((d) => d.id === a.id);
    const house = state.houses[def.home];
    return `
      <div class="agent">
        <div class="agent-head">
          <span class="swatch" style="background:${def.colors.shirt}"></span>
          <span class="agent-name">${esc(def.name)}</span>
          <span class="agent-role">${esc(def.role)}</span>
        </div>
        <div class="thought">“${esc(a.thought)}”</div>
        <div class="needs">
          ${NEED_KEYS.map((k) => `
            <span>${k}</span>
            <div class="meter"><div style="width:${a.needs[k]}%;background:${needColor(a.needs[k])}"></div></div>
            <i>${Math.round(a.needs[k])}</i>`).join('')}
        </div>
        <div class="inv">
          ${a.inventory.map((i) => `<span class="gift" title="${esc(i.description || '')}">${esc(i.icon || '✦')} ${esc(i.name)}</span>`).join('')}
          ${house.repair < 40 ? '<span class="gift" style="background:#33201f;border-color:#5c3434;color:#c4645c">roof failing</span>' : ''}
          ${house.warmth < 25 ? '<span class="gift" style="background:#33201f;border-color:#5c3434;color:#c4645c">cold house</span>' : ''}
        </div>
      </div>`;
  }).join('');

  const prayers = [...db.prayers.prayers].reverse();
  const pending = prayers.filter((p) => p.status === 'pending');
  el('prayer-count').textContent = `${pending.length} unanswered / ${prayers.length} all told`;

  el('prayers').innerHTML = prayers.slice(0, 14).map((p) => {
    const unrecorded = !canonicalPrayerIds.has(p.id);
    return `
      <div class="prayer">
        <div class="prayer-head">
          <span class="pid">${esc(p.id)}</span>
          <span class="who">${esc(p.agentName)}</span>
          <span class="when">Day ${p.day}, ${esc(p.time)}</span>
        </div>
        <div class="title">${esc(p.title)}</div>
        <div class="body">${esc(p.text)}</div>
        <span class="tag ${p.status}">${p.status}</span>
        ${unrecorded ? '<span class="tag unrecorded">happening now · not yet committed</span>' : ''}
        ${p.answer ? `<div class="answer"><b>${p.answer.granted ? 'Answered' : 'Refused'}</b>${p.answer.message ? ` — “${esc(p.answer.message)}”` : ''}</div>` : ''}
      </div>`;
  }).join('') || '<div class="empty">Nobody has asked for anything yet.</div>';

  el('log').innerHTML = [...state.events].reverse().map((e) =>
    `<div><time>D${e.day} ${esc(e.time)}</time>${esc(e.text)}</div>`).join('')
    || '<div class="empty">Nothing has happened worth writing down.</div>';

  drawHealth();

  const started = new Date(state.startedAt);
  const days = Math.max(0, (Date.now() - started) / 86400000);
  el('footer').textContent =
    `Running ${days.toFixed(1)} real days · ${state.tick} ticks · world day ${clock.day}` +
    (canonicalLastTick ? ` · last written down ${ago(Date.now() - canonicalLastTick)}` : '') +
    `. The villagers do not know about any of this.`;
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(1000, now - lastFrame);
  lastFrame = now;
  if (!db) return;

  acc += dt;
  let stepped = false;
  while (acc >= TICK_MS) { step(db); acc -= TICK_MS; stepped = true; }
  if (stepped) drawPanels();

  render(ctx, db.state, { alpha: acc / TICK_MS, labels: el('labels').checked });

  if (now - lastHealth > 20000) { lastHealth = now; drawHealth(); }
  if (Date.now() - lastSync > RESYNC_MS) { lastSync = Date.now(); sync(); }
}

// Exposed so the render can be inspected and screenshotted under different
// times of day and weather without waiting days for them to come round.
window.__gh = { get db() { return db; }, ctx, render, step, worldClock };

sync(true);
requestAnimationFrame(frame);
