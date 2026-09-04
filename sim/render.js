// Grasshollow — canvas renderer. A pure function of world state.

import { TILE, MAP_W, MAP_H, T, buildMap, allBuildings, WELL, FIELD_RECT, POI } from './world.js';
import { worldClock } from './engine.js';
import { AGENTS } from './agents.js';

const GRASS = ['#7fa653', '#79a04d', '#86ac59', '#74994a'];
const PATHC = ['#c2a878', '#bda372', '#c7ae7f'];
const STONEC = ['#b9b6ad', '#c2bfb6', '#b0ada4'];
const FIELDC = ['#a98b4e', '#a4864a', '#af9154'];
const WATERC = ['#4a7fa8', '#4478a1', '#5187ae'];
const SHOREC = ['#c8b489', '#c1ad82', '#cdb98e'];

function hash(x, y, s = 0) {
  let h = x * 374761393 + y * 668265263 + s * 2246822519;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
const pick = (arr, x, y, s = 0) => arr[Math.floor(hash(x, y, s) * arr.length) % arr.length];

export const CANVAS_W = MAP_W * TILE;
export const CANVAS_H = MAP_H * TILE;

// ---------------------------------------------------------------------------

function drawGround(ctx, grid, state, t) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const tile = grid[y * MAP_W + x];
      const px = x * TILE, py = y * TILE;
      switch (tile) {
        case T.WATER: {
          ctx.fillStyle = pick(WATERC, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          // Slow ripples so the pond is not a flat blue rectangle.
          const r = hash(x, y, 3);
          if (r > 0.7) {
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            const off = Math.sin(t / 900 + r * 7) * 3;
            ctx.fillRect(px + 3, py + 8 + off, TILE - 8, 1);
          }
          break;
        }
        case T.SHORE:
          ctx.fillStyle = pick(SHOREC, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          if (hash(x, y, 17) > 0.7) {
            ctx.fillStyle = 'rgba(150,130,95,0.5)';
            ctx.fillRect(px + 5 + hash(x, y, 18) * 8, py + 5 + hash(x, y, 19) * 8, 2, 2);
          }
          break;
        case T.PATH:
          ctx.fillStyle = pick(PATHC, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          if (hash(x, y, 5) > 0.75) {
            ctx.fillStyle = 'rgba(120,95,60,0.35)';
            ctx.fillRect(px + 4 + hash(x, y, 6) * 8, py + 4 + hash(x, y, 7) * 8, 2, 2);
          }
          break;
        case T.STONE:
        case T.FLOOR:
          ctx.fillStyle = pick(STONEC, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = 'rgba(0,0,0,0.10)';
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
          break;
        case T.FIELD: {
          ctx.fillStyle = pick(FIELDC, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          // Crop height tracks the actual yield in the simulation.
          const yield_ = state.village.fieldYield / 100;
          ctx.strokeStyle = `rgba(${120 - yield_ * 40},${110 + yield_ * 60},${60},0.8)`;
          ctx.lineWidth = 1;
          for (let i = 3; i < TILE; i += 5) {
            const h = 3 + yield_ * 9 * (0.6 + hash(x + i, y, 9) * 0.8);
            ctx.beginPath();
            ctx.moveTo(px + i + 0.5, py + TILE - 2);
            ctx.lineTo(px + i + 0.5, py + TILE - 2 - h);
            ctx.stroke();
          }
          break;
        }
        default: {
          ctx.fillStyle = pick(GRASS, x, y);
          ctx.fillRect(px, py, TILE, TILE);
          if (tile === T.FLOWER) {
            ctx.fillStyle = pick(['#e8e06a', '#e07a9a', '#dcdcdc', '#c98ae0'], x, y, 2);
            const fx = px + 5 + hash(x, y, 11) * 9, fy = py + 5 + hash(x, y, 12) * 9;
            ctx.fillRect(fx, fy, 2, 2);
            ctx.fillRect(fx + 3, fy + 4, 2, 2);
          } else if (hash(x, y, 13) > 0.82) {
            ctx.fillStyle = 'rgba(60,90,40,0.30)';
            ctx.fillRect(px + 6, py + 11, 5, 2);
          }
        }
      }
    }
  }
}

function drawTrees(ctx, grid, t) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y * MAP_W + x] !== T.TREE) continue;
      const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
      const r = 7 + hash(x, y, 21) * 3;
      const sway = Math.sin(t / 1400 + (x + y)) * 0.8;

      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + r - 1, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#5b4128';
      ctx.fillRect(cx - 1.5, cy - 1, 3, r);

      const dark = hash(x, y, 22) > 0.5 ? '#3f6b34' : '#47743a';
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(cx + sway, cy - 3, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hash(x, y, 23) > 0.5 ? '#568945' : '#5f924c';
      ctx.beginPath(); ctx.arc(cx - 2 + sway, cy - 5, r * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawWell(ctx, t) {
  const x = WELL.x * TILE, y = WELL.y * TILE, w = WELL.w * TILE, h = WELL.h * TILE;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(x + w / 2 + 2, y + h - 2, w * 0.55, h * 0.25, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#8f8c84';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.48, h * 0.30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b3a44';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.60, w * 0.34, h * 0.20, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6f6c65'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.48, h * 0.30, 0, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(x + 4, y - 12, 3, 22);
  ctx.fillRect(x + w - 7, y - 12, 3, 22);
  ctx.fillStyle = '#8c5a34';
  ctx.beginPath();
  ctx.moveTo(x - 1, y - 10); ctx.lineTo(x + w / 2, y - 20); ctx.lineTo(x + w + 1, y - 10);
  ctx.closePath(); ctx.fill();

  const bob = Math.sin(t / 1100) * 2;
  ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + w / 2, y - 12); ctx.lineTo(x + w / 2, y - 2 + bob); ctx.stroke();
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(x + w / 2 - 3, y - 2 + bob, 6, 5);
}

function drawBuilding(ctx, b, state, clock) {
  const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;

  if (b.kind === 'garden') {
    ctx.fillStyle = '#8a6a3f';
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < b.w * 2; i++) {
      ctx.fillStyle = ['#4f8a3d', '#68a04a', '#c4553f', '#d8a13c'][i % 4];
      ctx.beginPath();
      ctx.arc(x + 8 + i * 9, y + 10 + (i % 3) * 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#6b4a2f'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    return;
  }
  if (b.kind === 'statue') {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x + w / 2 + 2, y + h - 3, w * 0.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a8a49b'; ctx.fillRect(x + 4, y + h - 12, w - 8, 10);
    ctx.fillStyle = '#c0bcb2';
    ctx.fillRect(x + w / 2 - 4, y - 6, 8, h - 8);
    ctx.beginPath(); ctx.arc(x + w / 2, y - 9, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }

  const roofH = Math.round(h * (b.kind === 'temple' ? 0.62 : 0.55));
  const wallTop = y + roofH;

  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(x + 5, y + h - 3, w, 7);

  // Wall face with timber framing.
  ctx.fillStyle = b.wall;
  ctx.fillRect(x, wallTop, w, h - roofH);
  ctx.fillStyle = b.beam;
  ctx.fillRect(x, wallTop, w, 3);
  ctx.fillRect(x, y + h - 3, w, 3);
  for (let i = 0; i <= b.w; i++) ctx.fillRect(x + i * TILE - 1, wallTop, 3, h - roofH);

  // Roof: a simple gable, overhanging the wall.
  ctx.fillStyle = b.roof;
  ctx.beginPath();
  ctx.moveTo(x - 5, wallTop + 2);
  ctx.lineTo(x + w / 2, y - (b.kind === 'temple' ? 14 : 6));
  ctx.lineTo(x + w + 5, wallTop + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = b.roofDark;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y - (b.kind === 'temple' ? 14 : 6));
  ctx.lineTo(x + w + 5, wallTop + 2);
  ctx.lineTo(x + w / 2, wallTop + 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const fy = wallTop + 2 - (i / 5) * (wallTop + 2 - (y - 6));
    const inset = (i / 5) * (w / 2 + 5);
    ctx.beginPath(); ctx.moveTo(x - 5 + inset, fy); ctx.lineTo(x + w + 5 - inset, fy); ctx.stroke();
  }

  const night = clock.phase === 'night' || clock.phase === 'dusk';
  const lit = night;

  // Windows.
  const winY = wallTop + 10;
  for (let i = 0; i < b.w; i++) {
    const wx = x + i * TILE + 6;
    if (b.door && Math.abs(wx - (b.door.x * TILE + 3)) < TILE) continue;
    if (i % 2 === 1) continue;
    ctx.fillStyle = lit ? '#f2cf72' : '#5c6b73';
    ctx.fillRect(wx, winY, 8, 8);
    ctx.strokeStyle = b.beam; ctx.lineWidth = 1.5;
    ctx.strokeRect(wx - 0.5, winY - 0.5, 9, 9);
    ctx.beginPath(); ctx.moveTo(wx + 4, winY); ctx.lineTo(wx + 4, winY + 8); ctx.stroke();
  }

  // Door.
  if (b.door) {
    const dx = b.door.x * TILE + 3, dy = y + h - 16;
    ctx.fillStyle = '#5a3f28';
    if (b.kind === 'temple') {
      ctx.beginPath();
      ctx.moveTo(dx, dy + 16); ctx.lineTo(dx, dy + 6);
      ctx.arc(dx + 7, dy + 6, 7, Math.PI, 0);
      ctx.lineTo(dx + 14, dy + 16);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(dx, dy, 14, 16);
    }
    ctx.fillStyle = '#c8a44a';
    ctx.beginPath(); ctx.arc(dx + 11, dy + 9, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // Chimney and smoke, when there is a fire to make it.
  if (b.kind === 'house' || b.kind === 'bakery') {
    const cx = x + w - TILE;
    ctx.fillStyle = '#8a7566';
    ctx.fillRect(cx, y - 2, 8, roofH * 0.7);
    const warmth = state.houses[b.id]?.warmth ?? 60;
    if (warmth > 20) {
      ctx.fillStyle = 'rgba(230,230,230,0.35)';
      for (let i = 0; i < 3; i++) {
        const t2 = (Date.now() / 700 + i * 1.6) % 4;
        ctx.beginPath();
        ctx.arc(cx + 4 + Math.sin(t2 * 1.6) * 5, y - 4 - t2 * 9, 2.5 + t2 * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (b.kind === 'temple') {
    // Bell tower over the ridge, and a lit window at the gable.
    const cx = x + w / 2;
    ctx.fillStyle = b.roofDark; ctx.fillRect(cx - 6, y - 30, 12, 18);
    ctx.fillStyle = b.roof;
    ctx.beginPath(); ctx.moveTo(cx - 9, y - 28); ctx.lineTo(cx, y - 40); ctx.lineTo(cx + 9, y - 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8a44a';
    ctx.beginPath(); ctx.arc(cx, y - 20, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lit ? '#f4d98a' : '#6d8894';
    ctx.beginPath(); ctx.arc(cx, wallTop - 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8e8a80'; ctx.lineWidth = 2; ctx.stroke();
    // Steps.
    ctx.fillStyle = '#b3b0a7';
    ctx.fillRect(x + w / 2 - 18, y + h - 2, 36, 4);
    ctx.fillRect(x + w / 2 - 22, y + h + 2, 44, 4);
  }

  if (b.granted) {
    ctx.fillStyle = 'rgba(255,240,170,0.55)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦', x + w / 2, y - (b.kind === 'temple' ? 46 : 12));
  }
}

// ---------------------------------------------------------------------------

function drawAgent(ctx, agent, def, alpha, showLabel) {
  const px = (agent.prev.x + (agent.pos.x - agent.prev.x) * alpha) * TILE + TILE / 2;
  const py = (agent.prev.y + (agent.pos.y - agent.prev.y) * alpha) * TILE + TILE / 2;
  const moving = Math.hypot(agent.pos.x - agent.prev.x, agent.pos.y - agent.prev.y) > 0.05;
  const bob = moving ? Math.abs(Math.sin(Date.now() / 160)) * 1.6 : 0;
  const c = def.colors;

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(px, py + 8, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();

  const top = py - 10 - bob;
  ctx.fillStyle = c.trouser;
  ctx.fillRect(px - 3, top + 12, 2.5, 6);
  ctx.fillRect(px + 0.5, top + 12, 2.5, 6);
  ctx.fillStyle = c.shirt;
  ctx.fillRect(px - 4, top + 5, 8, 8);
  ctx.fillStyle = c.skin;
  ctx.fillRect(px - 3.5, top + 6, 1.5, 6);
  ctx.fillRect(px + 2, top + 6, 1.5, 6);
  ctx.fillRect(px - 3, top - 1, 6, 6);
  ctx.fillStyle = c.hair;
  ctx.fillRect(px - 3.5, top - 2, 7, 3);
  ctx.fillRect(px - 3.5, top - 2, 1.5, 5);

  const sleeping = agent.action?.kind === 'sleep' && agent.action.phase === 'do';
  const praying = agent.action?.kind === 'pray' && agent.action.phase === 'do';
  if (sleeping) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('z', px + 7, top - 4 + Math.sin(Date.now() / 500) * 2);
  }
  if (praying) {
    ctx.strokeStyle = 'rgba(255,236,170,0.75)'; ctx.lineWidth = 1.5;
    const r = 9 + Math.sin(Date.now() / 400) * 2;
    ctx.beginPath(); ctx.arc(px, top + 4, r, 0, Math.PI * 2); ctx.stroke();
  }

  if (showLabel) {
    const name = def.name.split(' ')[0];
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(name).width + 8;
    ctx.fillStyle = 'rgba(20,22,18,0.55)';
    ctx.fillRect(px - w / 2, top - 17, w, 12);
    ctx.fillStyle = '#f2efe4';
    ctx.fillText(name, px, top - 8);
  }
  return { px, py };
}

// ---------------------------------------------------------------------------

function drawWeather(ctx, state, clock, t) {
  const w = CANVAS_W, h = CANVAS_H;

  // Day/night tint.
  const mins = state.worldMinutes % 1440;
  const dayness = Math.max(0, Math.min(1, Math.sin(((mins - 300) / 1440) * Math.PI * 2) * 1.6 + 0.55));
  const dark = 1 - dayness;
  if (dark > 0.02) {
    ctx.fillStyle = `rgba(22,28,66,${dark * 0.62})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (clock.phase === 'dawn' || clock.phase === 'dusk') {
    ctx.fillStyle = `rgba(240,150,90,${0.14})`;
    ctx.fillRect(0, 0, w, h);
  }

  if (state.weather === 'rain' || state.weather === 'storm') {
    const heavy = state.weather === 'storm';
    ctx.strokeStyle = heavy ? 'rgba(190,205,225,0.45)' : 'rgba(190,205,225,0.30)';
    ctx.lineWidth = 1;
    const count = heavy ? 260 : 140;
    for (let i = 0; i < count; i++) {
      const seed = i * 97;
      const x = (hash(seed, 1) * w + t * (heavy ? 0.30 : 0.18)) % w;
      const y = (hash(seed, 2) * h + t * (heavy ? 0.95 : 0.62)) % h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + (heavy ? 9 : 6)); ctx.stroke();
    }
    if (heavy) {
      ctx.fillStyle = 'rgba(20,25,40,0.22)';
      ctx.fillRect(0, 0, w, h);
    }
  }
  if (state.weather === 'drought') {
    ctx.fillStyle = 'rgba(240,190,110,0.13)';
    ctx.fillRect(0, 0, w, h);
  }
  if (state.weather === 'cloudy') {
    ctx.fillStyle = 'rgba(120,130,145,0.10)';
    ctx.fillRect(0, 0, w, h);
  }
}

function drawLabels(ctx, state) {
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const put = (text, tx, ty) => {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(20,22,18,0.42)';
    ctx.fillRect(tx * TILE - w / 2, ty * TILE - 9, w, 12);
    ctx.fillStyle = 'rgba(245,242,232,0.9)';
    ctx.fillText(text, tx * TILE, ty * TILE);
  };
  for (const b of allBuildings(state)) {
    if (b.kind === 'statue') continue;
    put(b.label ?? b.kind, b.x + b.w / 2, b.y + b.h + 1.6);
  }
  put('The Well', WELL.x + 1, WELL.y + 3.2);
  put('East Field', FIELD_RECT.x + FIELD_RECT.w / 2, FIELD_RECT.y + FIELD_RECT.h + 1.2);
}

/**
 * Render one frame.
 * `alpha` interpolates each agent between its previous and current tile so the
 * village moves smoothly between one-minute ticks.
 */
export function render(ctx, state, { alpha = 1, labels = true, t = Date.now() } = {}) {
  const grid = buildMap(state);
  const clock = worldClock(state);

  ctx.imageSmoothingEnabled = false;
  drawGround(ctx, grid, state, t);
  drawWell(ctx, t);

  const buildings = allBuildings(state);
  // Painter's algorithm: things lower on the map occlude things above them.
  const drawables = [
    ...buildings.map((b) => ({ y: b.y + b.h, draw: () => drawBuilding(ctx, b, state, clock) })),
    ...state.agents.map((a) => ({
      y: a.prev.y + (a.pos.y - a.prev.y) * alpha,
      draw: () => drawAgent(ctx, a, AGENTS.find((d) => d.id === a.id), alpha, labels),
    })),
  ];
  drawTrees(ctx, grid, t);
  drawables.sort((p, q) => p.y - q.y);
  for (const d of drawables) d.draw();

  if (labels) drawLabels(ctx, state);
  drawWeather(ctx, state, clock, t);
}
