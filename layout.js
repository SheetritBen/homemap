// Turns noisy scan positions into a tidy room layout:
// furniture flush against walls, desk things on desks, pillows on sofas, chairs facing desks, no overlaps.

export const WALL_H = 2.6;

const RULES = [ // order matters: first match wins
  [/pillow|cushion/, "pillow"], [/desk ?mat|mouse ?pad/, "deskmat"], [/\b(rug|carpet|mat)\b/, "rug"], [/lamp/, "lamp"],
  [/riser|stand riser/, "box"], [/3d printer|3-d printer|printer 3d/, "printer3d"],
  [/office chair|desk chair|gaming chair|task chair/, "office_chair"],
  [/sofa|couch|loveseat|sectional/, "sofa"], [/armchair|accent chair|lounge chair|recliner/, "armchair"],
  [/chair|stool/, "chair"], [/bedside|nightstand|side table|coffee table|table/, "table"],
  [/monitor|display|screen/, "monitor"], [/\btv\b|television/, "tv"], [/laptop|macbook|notebook/, "laptop"],
  [/keyboard/, "keyboard"], [/\bmouse\b/, "mouse"], [/headphone|headset/, "headphones"],
  [/wardrobe|closet|armoire|cabinet/, "wardrobe"], [/bookcase|bookshelf|shel(f|ves|ving)/, "shelf"],
  [/dresser|drawer|chest/, "dresser"], [/\bbed\b/, "bed"], [/desk/, "desk"],
  [/air ?condition|\bac\b|split unit|mazgan/, "ac"],
  [/poster|painting|art|canvas|frame|mirror|print\b|collection/, "wall_art"],
  [/backpack|bag|duffel|suitcase|luggage/, "bag"], [/scarf|blanket|throw|towel/, "textile"], [/plant|pot\b/, "plant"],
];
export function guessShape(it) {
  const s = `${it.name} ${it.category}`.toLowerCase();
  for (const [re, shape] of RULES) if (re.test(s)) return shape;
  return "box";
}

const AGAINST_WALL = new Set(["sofa", "wardrobe", "shelf", "dresser", "bed", "desk", "printer3d", "table"]);
const WALL_MOUNT = new Set(["ac", "wall_art"]);
const ON_SURFACE = new Set(["monitor", "laptop", "keyboard", "mouse", "headphones", "lamp", "deskmat"]);
const SURFACE = new Set(["desk", "table", "dresser", "shelf", "wardrobe"]);
const SOFT = new Set(["pillow", "textile"]); // go on seats, handled after chairs are placed
const SEATS = new Set(["chair", "office_chair", "armchair"]);

// local (item frame) <-> world, matching three.js rotation.y
const toWorld = (s, lx, lz) => [s.x + lx * Math.cos(s.rot) + lz * Math.sin(s.rot), s.z - lx * Math.sin(s.rot) + lz * Math.cos(s.rot)];
const toLocal = (s, x, z) => { const dx = x - s.x, dz = z - s.z; return [dx * Math.cos(s.rot) - dz * Math.sin(s.rot), dx * Math.sin(s.rot) + dz * Math.cos(s.rot)]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snap90 = a => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
const quarterOdd = rot => Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;

function walls(b) {
  return {
    front: { n: [0, -1], dist: p => p.z - b.zmin, set: (p, off) => { p.z = b.zmin + off; }, along: "x" },
    back: { n: [0, 1], dist: p => b.zmax - p.z, set: (p, off) => { p.z = b.zmax - off; }, along: "x" },
    left: { n: [-1, 0], dist: p => p.x - b.xmin, set: (p, off) => { p.x = b.xmin + off; }, along: "z" },
    right: { n: [1, 0], dist: p => b.xmax - p.x, set: (p, off) => { p.x = b.xmax - off; }, along: "z" },
  };
}
function nearestWall(W, p) {
  return Object.entries(W).map(([k, w]) => [k, w.dist(p)]).sort((a, b) => a[1] - b[1])[0];
}
function placeOnWall(W, b, p, wallKey, gap = 0.02) {
  const w = W[wallKey];
  p.rot = Math.atan2(-w.n[0], -w.n[1]); // front faces into the room
  p.wall = wallKey;
  w.set(p, p.d / 2 + gap);
  if (w.along === "x") p.x = clamp(p.x, b.xmin + p.w / 2, b.xmax - p.w / 2);
  else p.z = clamp(p.z, b.zmin + p.w / 2, b.zmax - p.w / 2);
}

export function layoutRoom(room) {
  // pre-build-5 scans have no small_item flag
  const isSmall = it => it.small ?? (+it.price || 0) < 100;
  const b = room.bounds, W = walls(b);
  const cx = (b.xmin + b.xmax) / 2, cz = (b.zmin + b.zmax) / 2;
  const P = room.items.map(it => ({
    it, shape: it.shape || guessShape(it),
    w: clamp(+it.w || 0.4, 0.04, 3.2), h: clamp(+it.h || 0.4, 0.01, 2.5), d: clamp(+it.d || 0.4, 0.02, 3.2),
    small: isSmall(it),
    x: clamp(+it.x || 0, b.xmin, b.xmax), z: clamp(+it.z || 0, b.zmin, b.zmax), y: 0, rot: 0,
    mount: it.mount || "", elev: +it.elev || 0, wallHint: it.wall && it.wall !== "none" ? it.wall : "",
  }));
  for (const p of P) {
    if (p.shape === "rug") p.mount = "floor";
    // small odds and ends (and draped textiles) never render bigger than a shoebox
    if (p.shape === "textile" || (p.small && p.shape === "box")) { p.w = Math.min(p.w, 0.35); p.d = Math.min(p.d, 0.3); p.h = Math.min(p.h, 0.12); }
  }

  // 1. wall-mounted things
  for (const p of P) {
    if (!(WALL_MOUNT.has(p.shape) || p.mount === "wall")) continue;
    if (p.mount === "on_furniture" || (p.shape === "wall_art" && p.elev > 0 && p.elev < 1.1 && p.h < 0.4)) continue; // standing photo frame
    placeOnWall(W, b, p, p.wallHint || nearestWall(W, p)[0], 0.01);
    p.y = p.elev > 0.3 ? p.elev : p.shape === "ac" ? WALL_H - 0.3 - p.h : clamp(1.55 - p.h / 2, 0.3, WALL_H - p.h - 0.1);
    p.fixed = true;
  }
  // 2. big floor furniture against walls
  for (const p of P) {
    if (p.fixed || !AGAINST_WALL.has(p.shape) || p.mount === "on_furniture") continue;
    const [k, dist] = nearestWall(W, p);
    const key = p.wallHint || (dist < (p.shape === "desk" ? 1.0 : 1.3) ? k : "");
    if (key) placeOnWall(W, b, p, key); else p.rot = snap90(Math.atan2(cx - p.x, cz - p.z));
    p.floor = true;
  }
  const surfaces = P.filter(p => SURFACE.has(p.shape) && p.floor);

  // 3. things that sit on furniture (desk items, bags on top of the wardrobe)
  for (const p of P) {
    if (p.fixed || p.floor || SOFT.has(p.shape)) continue;
    const wantsSurface = ON_SURFACE.has(p.shape) || p.mount === "on_furniture" || (p.elev > 0.3 && p.shape !== "pillow") ||
      (p.shape === "box" && Math.max(p.w, p.d, p.h) < 0.45) || (p.shape === "wall_art" && p.h < 0.4);
    if (!wantsSurface) continue;
    const cands = surfaces.map(s => {
      const [lx, lz] = toLocal(s, p.x, p.z);
      const out = Math.max(0, Math.abs(lx) - s.w / 2) + Math.max(0, Math.abs(lz) - s.d / 2);
      const elevMiss = p.elev > 0.3 ? Math.abs(p.elev - s.h) : (s.shape === "desk" || s.shape === "table" ? 0 : 1);
      return { s, lx, lz, score: out + elevMiss * 0.8 };
    }).sort((a, c) => a.score - c.score);
    const best = cands[0];
    if (!best || best.score > 1.4) { if (p.elev > 0.3) { p.y = p.elev; p.fixed = true; } continue; }
    const s = best.s;
    let lx = clamp(best.lx, -s.w / 2 + p.w / 2, s.w / 2 - p.w / 2), lz = clamp(best.lz, -s.d / 2 + p.d / 2, s.d / 2 - p.d / 2);
    if (p.shape === "monitor") lz = -s.d / 2 + Math.min(0.2, p.d) / 2 + 0.06; // monitors sit at the back
    if (p.shape === "keyboard" || p.shape === "laptop") lz = Math.max(lz, s.d / 2 - p.d / 2 - 0.1);
    [p.x, p.z] = toWorld(s, lx, lz);
    p.rot = s.rot; p.y = s.h; p.on = s; p.fixed = true;
  }
  // spread items sharing a surface so they don't stack inside each other
  for (const s of surfaces) {
    const on = P.filter(p => p.on === s && p.shape !== "monitor").sort((a, c) => toLocal(s, a.x, a.z)[0] - toLocal(s, c.x, c.z)[0]);
    for (let i = 1; i < on.length; i++) {
      const a = on[i - 1], c = on[i];
      const [ax, az] = toLocal(s, a.x, a.z), [cx2, cz2] = toLocal(s, c.x, c.z);
      if (Math.abs(cz2 - az) < (a.d + c.d) / 2 && cx2 - ax < (a.w + c.w) / 2 + 0.02) {
        const nx = Math.min(s.w / 2 - c.w / 2, ax + (a.w + c.w) / 2 + 0.02);
        [c.x, c.z] = toWorld(s, nx, cz2);
      }
    }
  }

  for (const p of P) if (p.on) p.local = toLocal(p.on, p.x, p.z);

  // 5. remaining floor items; seats face the nearest desk/table
  const desks = P.filter(p => p.shape === "desk" || p.shape === "table");
  for (const p of P) {
    if (p.fixed || p.floor || SOFT.has(p.shape)) continue;
    p.floor = true;
    if (SEATS.has(p.shape)) {
      const dsk = desks.map(d => [d, Math.hypot(d.x - p.x, d.z - p.z)]).sort((a, c) => a[1] - c[1])[0];
      const tgt = dsk && dsk[1] < 2 ? dsk[0] : { x: cx, z: cz };
      p.rot = snap90(Math.atan2(tgt.x - p.x, tgt.z - p.z));
      if (p.shape === "office_chair" && dsk && dsk[1] < 1.5) { // tuck it in front of the desk
        const [lx] = toLocal(dsk[0], p.x, p.z);
        [p.x, p.z] = toWorld(dsk[0], clamp(lx, -dsk[0].w / 2 + 0.3, dsk[0].w / 2 - 0.3), dsk[0].d / 2 + p.d / 2 - 0.1);
        p.rot = dsk[0].rot + Math.PI;
      }
    } else if (p.shape !== "rug") {
      const [k, dist] = nearestWall(W, p);
      if (dist < 0.6 && Math.max(p.w, p.d) > 0.25) placeOnWall(W, b, p, k);
      else p.rot = snap90(Math.atan2(cx - p.x, cz - p.z));
    }
  }

  // 5b. pillows onto the nearest sofa / bed; scarves and throws onto any seat
  const soft = p => p.shape === "pillow" ? ["sofa", "bed", "armchair"] : ["sofa", "bed", "armchair", "chair", "office_chair"];
  for (const p of P.filter(q => (q.shape === "pillow" || q.shape === "textile") && !q.fixed)) {
    const s = P.filter(q => soft(p).includes(q.shape)).map(s => [s, Math.hypot(s.x - p.x, s.z - p.z)]).sort((a, c) => a[1] - c[1])[0]?.[0];
    if (!s) { p.floor = true; continue; }
    const n = P.filter(q => q.pillowOn === s).length;
    p.pillowOn = s;
    const lx = clamp(-s.w / 2 + 0.35 + n * (p.w + 0.08), -s.w / 2 + p.w / 2 + 0.15, s.w / 2 - p.w / 2 - 0.15);
    const lz = -s.d / 2 + (s.shape === "sofa" ? Math.min(0.24, s.d * 0.28) : 0.12) + p.d / 2 + 0.02;
    [p.x, p.z] = toWorld(s, lx, lz);
    p.local = [lx, lz];
    p.rot = s.rot; p.y = s.shape === "bed" ? 0.5 : s.shape === "sofa" ? Math.max(0.38, s.h * 0.5) : Math.min(0.48, s.h * 0.48);
    p.tilt = -0.25; p.fixed = true;
  }

  // 6a. furniture sharing a wall is packed as a row (pairwise pushing oscillates when one piece is squeezed between two)
  for (const [key, w] of Object.entries(W)) {
    const ax = w.along, lo = ax === "x" ? b.xmin : b.zmin, hi = ax === "x" ? b.xmax : b.zmax;
    const row = P.filter(p => p.floor && p.wall === key).sort((a, c) => a[ax] - c[ax]);
    for (let i = 1; i < row.length; i++) row[i][ax] = Math.max(row[i][ax], row[i - 1][ax] + (row[i - 1].w + row[i].w) / 2 + 0.02);
    if (row.length && row.at(-1)[ax] > hi - row.at(-1).w / 2) {
      row.at(-1)[ax] = hi - row.at(-1).w / 2;
      for (let i = row.length - 2; i >= 0; i--) row[i][ax] = Math.min(row[i][ax], row[i + 1][ax] - (row[i + 1].w + row[i].w) / 2 - 0.02);
    }
    for (const p of row) p[ax] = clamp(p[ax], lo + p.w / 2, hi - p.w / 2); // a wall that's simply too full stays overlapped
  }

  // 6b. push remaining overlaps apart (wall items slide along their wall only)
  const floor = P.filter(p => p.floor && p.shape !== "rug");
  const ext = p => quarterOdd(p.rot) ? [p.d / 2, p.w / 2] : [p.w / 2, p.d / 2];
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
      const a = floor[i], c = floor[j], [ax, az] = ext(a), [cx3, cz3] = ext(c);
      const ox = ax + cx3 - Math.abs(a.x - c.x), oz = az + cz3 - Math.abs(a.z - c.z);
      if (ox <= 0.01 || oz <= 0.01) continue;
      moved = true;
      // move the lighter one (free items before wall items), along the axis it is allowed to move
      const [mv, st] = (a.wall && !c.wall) || (a.w * a.d > c.w * c.d && !(c.wall && !a.wall)) ? [c, a] : [a, c];
      const push = (m, o) => {
        const canX = !m.wall || W[m.wall].along === "x", canZ = !m.wall || W[m.wall].along === "z";
        const bx = m.x, bz = m.z;
        if ((ox < oz && canX) || !canZ) m.x += Math.sign(m.x - o.x || 1) * (ox + 0.02);
        else m.z += Math.sign(m.z - o.z || 1) * (oz + 0.02);
        const [ex, ez] = ext(m);
        m.x = clamp(m.x, b.xmin + ex, b.xmax - ex); m.z = clamp(m.z, b.zmin + ez, b.zmax - ez);
        return Math.abs(m.x - bx) + Math.abs(m.z - bz) > 0.005;
      };
      if (!push(mv, st)) push(st, mv); // pinned in a corner → move the other one
    }
    if (!moved) break;
  }
  // things resting on furniture follow it if the overlap pass moved it
  for (const p of P) {
    const base = p.on || p.pillowOn;
    if (!base || !p.local) continue;
    [p.x, p.z] = toWorld(base, p.local[0], p.local[1]);
    p.rot = base.rot;
  }
  return P;
}
