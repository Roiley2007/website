// Grasshollow — world geometry.
// Pure, deterministic, shared by the Node tick runner and the browser viewer.

export const TILE = 20;
export const MAP_W = 48;
export const MAP_H = 32;

export const T = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  TREE: 3,
  FIELD: 4,
  WALL: 5,
  FLOOR: 6,
  FLOWER: 7,
  STONE: 8,
  FENCE: 9,
  SHORE: 10,
};

const BLOCKED = new Set([T.WATER, T.TREE, T.WALL, T.FENCE]);
export const isBlocked = (t) => BLOCKED.has(t);

// ---------------------------------------------------------------------------
// Static buildings. Rects are inclusive of x..x+w-1, y..y+h-1.
// `door` must sit on the bottom row of the rect; it is carved walkable and is
// the tile agents path to when they want to "be" at the building.
// ---------------------------------------------------------------------------

export const BUILDINGS = [
  {
    id: 'house_bram', kind: 'house', label: "Bram's Cottage", owner: 'bram',
    x: 6, y: 5, w: 8, h: 5, door: { x: 9, y: 9 },
    wall: '#cbb79a', beam: '#6b4a2f', roof: '#8c5a34', roofDark: '#6d4325',
  },
  {
    id: 'house_odile', kind: 'house', label: "Odile's House", owner: 'odile',
    x: 34, y: 6, w: 8, h: 5, door: { x: 37, y: 10 },
    wall: '#d3c4ab', beam: '#5d4433', roof: '#7d6a4a', roofDark: '#5f5038',
  },
  {
    id: 'house_tam', kind: 'house', label: "Tam's Shed", owner: 'tam',
    x: 7, y: 22, w: 7, h: 5, door: { x: 10, y: 26 },
    wall: '#c2ae90', beam: '#57402c', roof: '#9a6a3a', roofDark: '#77502b',
  },
  {
    id: 'temple', kind: 'temple', label: 'The Temple', owner: null,
    x: 31, y: 19, w: 10, h: 8, door: { x: 35, y: 26 },
    wall: '#c9c6bd', beam: '#8e8a80', roof: '#7a8b94', roofDark: '#5c6b73',
  },
];

// The well is an object, not a building: two tiles of stone, walkable ring.
export const WELL = { x: 23, y: 15, w: 2, h: 2 };

// Points of interest agents can walk to.
export const POI = {
  well: { x: 23, y: 17 },
  square: { x: 25, y: 19 },
  field: { x: 23, y: 6 },
  altar: { x: 35, y: 27 },
  woods: { x: 42, y: 27 },
  pond: { x: 8, y: 18 },
};

export const FIELD_RECT = { x: 18, y: 3, w: 11, h: 5 };
export const POND_RECT = { x: 3, y: 15, w: 7, h: 5 };

// ---------------------------------------------------------------------------
// Granted structures. When you answer a prayer with a `structure` grant, the
// building is appended to state.structures and stamped onto the map here.
// ---------------------------------------------------------------------------

export const STRUCTURE_KINDS = {
  granary:  { w: 5, h: 4, label: 'Granary',   wall: '#c9ad7c', beam: '#6a4a2a', roof: '#a97b45', roofDark: '#845c30' },
  mill:     { w: 5, h: 5, label: 'Mill',      wall: '#d0c2a6', beam: '#5b452f', roof: '#8a6f4a', roofDark: '#69543a' },
  bakery:   { w: 5, h: 4, label: 'Bakery',    wall: '#d9c3a1', beam: '#6b3f2a', roof: '#b4653c', roofDark: '#8c4c2c' },
  shrine:   { w: 3, h: 3, label: 'Shrine',    wall: '#cfd2cb', beam: '#8d9089', roof: '#8e9aa2', roofDark: '#6d7982' },
  workshop: { w: 6, h: 4, label: 'Workshop',  wall: '#c4b294', beam: '#4f3b28', roof: '#7f6340', roofDark: '#5f4a30' },
  library:  { w: 6, h: 5, label: 'Library',   wall: '#cdc6b4', beam: '#4a4335', roof: '#6f7a6a', roofDark: '#545e50' },
  garden:   { w: 5, h: 4, label: 'Garden',    open: true },
  statue:   { w: 2, h: 2, label: 'Statue',    open: true },
};

// Free plots granted structures get dropped into, in order.
export const PLOTS = [
  { x: 17, y: 22 }, { x: 25, y: 10 }, { x: 43, y: 14 },
  { x: 16, y: 12 }, { x: 3, y: 8 },   { x: 27, y: 27 },
  { x: 43, y: 4 },  { x: 19, y: 16 },
];

// ---------------------------------------------------------------------------
// Map construction — deterministic from a fixed seed plus granted structures.
// ---------------------------------------------------------------------------

function noise(x, y) {
  // Cheap deterministic hash noise; identical in Node and the browser.
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function fillRect(grid, r, tile) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) grid[y * MAP_W + x] = tile;
    }
  }
}

function carvePath(grid, a, b) {
  // L-shaped corridor, horizontal leg first, 1 tile wide.
  let x = a.x, y = a.y;
  const put = () => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
    const i = y * MAP_W + x;
    if (grid[i] === T.GRASS || grid[i] === T.FLOWER || grid[i] === T.FIELD) grid[i] = T.PATH;
  };
  put();
  while (x !== b.x) { x += Math.sign(b.x - x); put(); }
  while (y !== b.y) { y += Math.sign(b.y - y); put(); }
}

const TREE_CLUSTERS = [
  { x: 1, y: 1, r: 3 }, { x: 45, y: 2, r: 3 }, { x: 46, y: 10, r: 3 },
  { x: 2, y: 27, r: 4 }, { x: 44, y: 28, r: 4 }, { x: 30, y: 1, r: 2 },
  { x: 16, y: 29, r: 3 }, { x: 40, y: 16, r: 2 }, { x: 12, y: 14, r: 2 },
  { x: 47, y: 22, r: 2 }, { x: 22, y: 30, r: 3 },
];

/** Build the tile grid. Pass state to include granted structures. */
export function buildMap(state) {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(T.GRASS);

  // Scattered wildflowers for texture.
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (noise(x, y) > 0.94) grid[y * MAP_W + x] = T.FLOWER;
    }
  }

  // The pond: an ellipse perturbed by noise, so it has a coastline rather
  // than corners, then a band of shore around whatever that produced.
  const pcx = POND_RECT.x + POND_RECT.w / 2;
  const pcy = POND_RECT.y + POND_RECT.h / 2;
  for (let y = POND_RECT.y - 3; y <= POND_RECT.y + POND_RECT.h + 3; y++) {
    for (let x = POND_RECT.x - 3; x <= POND_RECT.x + POND_RECT.w + 3; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const dx = (x + 0.5 - pcx) / (POND_RECT.w / 2 + 1.2);
      const dy = (y + 0.5 - pcy) / (POND_RECT.h / 2 + 0.6);
      const d = Math.sqrt(dx * dx + dy * dy) + (noise(x * 2, y * 2) - 0.5) * 0.42;
      if (d < 1) grid[y * MAP_W + x] = T.WATER;
    }
  }
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (grid[i] !== T.GRASS && grid[i] !== T.FLOWER) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && grid[ny * MAP_W + nx] === T.WATER;
        });
      if (near) grid[i] = T.SHORE;
    }
  }

  fillRect(grid, FIELD_RECT, T.FIELD);

  for (const c of TREE_CLUSTERS) {
    for (let y = c.y - c.r; y <= c.y + c.r; y++) {
      for (let x = c.x - c.r; x <= c.x + c.r; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        const d = (x - c.x) ** 2 + (y - c.y) ** 2;
        if (d <= c.r * c.r && noise(x * 3, y * 5) > 0.28) grid[y * MAP_W + x] = T.TREE;
      }
    }
  }

  // Well platform.
  fillRect(grid, WELL, T.STONE);

  const all = allBuildings(state);
  for (const b of all) {
    if (b.open) continue;
    fillRect(grid, b, T.WALL);
  }

  // Temple forecourt.
  fillRect(grid, { x: 33, y: 27, w: 6, h: 2 }, T.STONE);

  // Paths: every door to the square, and the square to the landmarks.
  const sq = POI.square;
  for (const b of all) {
    if (!b.door) continue;
    carvePath(grid, { x: b.door.x, y: b.door.y + 1 }, sq);
  }
  carvePath(grid, sq, POI.well);
  carvePath(grid, sq, POI.field);
  carvePath(grid, sq, { x: POI.woods.x, y: POI.woods.y });
  carvePath(grid, POI.well, { x: POI.pond.x + 2, y: POI.pond.y + 3 });

  // Carve doors last so nothing overwrites them.
  for (const b of all) {
    if (b.door) grid[b.door.y * MAP_W + b.door.x] = T.FLOOR;
  }

  // Gardens are walkable field tiles rather than solid buildings.
  for (const b of all) {
    if (b.open) fillRect(grid, b, b.kind === 'garden' ? T.FIELD : T.STONE);
  }

  return grid;
}

/** Static buildings plus any structures granted by answered prayers. */
export function allBuildings(state) {
  const extra = (state?.structures ?? []).map((s) => {
    const spec = STRUCTURE_KINDS[s.kind] ?? STRUCTURE_KINDS.shrine;
    const b = {
      id: s.id, kind: s.kind, label: s.label ?? spec.label, granted: true,
      x: s.x, y: s.y, w: spec.w, h: spec.h,
      wall: spec.wall, beam: spec.beam, roof: spec.roof, roofDark: spec.roofDark,
      open: !!spec.open,
    };
    if (!spec.open) b.door = { x: s.x + Math.floor(spec.w / 2), y: s.y + spec.h - 1 };
    return b;
  });
  return [...BUILDINGS, ...extra];
}

export function buildingById(state, id) {
  return allBuildings(state).find((b) => b.id === id) ?? null;
}

/** Next unoccupied plot for a newly granted structure. */
export function nextPlot(state) {
  const used = new Set((state.structures ?? []).map((s) => `${s.x},${s.y}`));
  for (const p of PLOTS) if (!used.has(`${p.x},${p.y}`)) return p;
  // Fall back to nudging the last plot along.
  const last = PLOTS[PLOTS.length - 1];
  return { x: last.x, y: Math.min(MAP_H - 6, last.y + 2 * (state.structures?.length ?? 1)) };
}

// ---------------------------------------------------------------------------
// Pathfinding — A* on the 48x32 grid. Deterministic tie-breaking.
// ---------------------------------------------------------------------------

export function walkable(grid, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  return !isBlocked(grid[y * MAP_W + x]);
}

/** Nearest walkable tile to (x,y), searched in rings. Returns null if none. */
export function nearestWalkable(grid, x, y) {
  if (walkable(grid, x, y)) return { x, y };
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(grid, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** A* from tile `from` to tile `to`. Returns array of {x,y} excluding `from`. */
export function findPath(grid, from, to) {
  const start = nearestWalkable(grid, Math.round(from.x), Math.round(from.y));
  const goal = nearestWalkable(grid, Math.round(to.x), Math.round(to.y));
  if (!start || !goal) return [];
  if (start.x === goal.x && start.y === goal.y) return [];

  const idx = (x, y) => y * MAP_W + x;
  const size = MAP_W * MAP_H;
  const gScore = new Float32Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const startI = idx(start.x, start.y);
  gScore[startI] = 0;
  // Small open list; linear scan is plenty for 1536 tiles.
  const open = [{ i: startI, x: start.x, y: start.y, f: h(start.x, start.y) }];

  while (open.length) {
    let best = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[best].f) best = k;
    const cur = open.splice(best, 1)[0];
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;

    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [];
      let i = cur.i;
      while (i !== startI && i !== -1) {
        path.push({ x: i % MAP_W, y: Math.floor(i / MAP_W) });
        i = came[i];
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!walkable(grid, nx, ny)) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      // Paths and stone are pleasant to walk; grass slightly slower.
      const tile = grid[ni];
      const cost = tile === T.PATH || tile === T.STONE || tile === T.FLOOR ? 1 : 1.4;
      const tentative = gScore[cur.i] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        came[ni] = cur.i;
        open.push({ i: ni, x: nx, y: ny, f: tentative + h(nx, ny) });
      }
    }
  }
  return [];
}
