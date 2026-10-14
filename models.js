// Procedural furniture models. Every builder returns a Group whose origin is the
// bottom-centre of the item, width along x, height along y, depth along z, front facing +z.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
  return mats.get(key).clone(); // clone so selection highlight is per item
}
function screenMat() {
  const m = new THREE.MeshStandardMaterial({ color: SCREEN, emissive: "#1d3550", emissiveIntensity: 0.7, roughness: 0.2 });
  m.userData.screen = true; // keep the glow when the item is highlighted
  return m;
}
const WOOD = "#6e5039", METAL = "#2c3036", SCREEN = "#0b0d12", WHITE = "#f2f2ef";

function part(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// box by size, placed by its bottom-centre (x, y0, z)
function box(g, w, h, d, material, x = 0, y0 = 0, z = 0, r = 0) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const geo = r > 0.004 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  const m = part(geo, material);
  m.position.set(x, y0 + h / 2, z);
  g.add(m);
  return m;
}
function cyl(g, r0, r1, h, material, x = 0, y0 = 0, z = 0, seg = 18) {
  const m = part(new THREE.CylinderGeometry(r0, r1, h, seg), material);
  m.position.set(x, y0 + h / 2, z);
  g.add(m);
  return m;
}
function legs4(g, w, d, h, r, material, inset = 0.05) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    cyl(g, r, r * 0.8, h, material, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
}

const B = {
  sofa(g, w, h, d, c) {
    const fabric = mat(c, { roughness: 0.95 });
    const legH = 0.09, seatTop = Math.max(0.38, h * 0.5), cushT = 0.12;
    const armW = Math.min(0.2, w * 0.12), armH = Math.min(h * 0.75, seatTop + 0.2), backD = Math.min(0.24, d * 0.28);
    legs4(g, w, d, legH, 0.022, mat(WOOD), 0.08);
    box(g, w, seatTop - cushT - legH, d, fabric, 0, legH, 0, 0.03);
    for (const sx of [-1, 1]) box(g, armW, armH - legH, d, fabric, sx * (w / 2 - armW / 2), legH, 0, 0.06);
    box(g, w - armW * 2, h - legH, backD, fabric, 0, legH, -d / 2 + backD / 2, 0.07);
    const n = w > 1.7 ? 3 : 2, inner = w - armW * 2, cw = inner / n;
    for (let i = 0; i < n; i++)
      box(g, cw - 0.015, cushT, d - backD - 0.02, fabric, -inner / 2 + cw * (i + 0.5), seatTop - cushT, backD / 2 + 0.01, 0.045);
  },
  armchair(g, w, h, d, c) {
    const fabric = mat(c, { roughness: 0.95 });
    const seatTop = Math.min(0.48, h * 0.48), legH = seatTop - 0.14;
    // splayed wooden legs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = cyl(g, 0.018, 0.012, legH, mat(WOOD), sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07), 10);
      l.rotation.z = sx * 0.08; l.rotation.x = -sz * 0.08;
    }
    box(g, w * 0.94, 0.14, d * 0.9, fabric, 0, legH, d * 0.03, 0.05);
    const back = box(g, w * 0.92, h - seatTop, 0.14, fabric, 0, seatTop - 0.04, -d / 2 + 0.1, 0.06);
    back.rotation.x = -0.12;
  },
  chair(g, w, h, d, c) {
    const seatTop = Math.min(0.46, h * 0.46);
    legs4(g, w, d, seatTop - 0.04, 0.016, mat(METAL), 0.04);
    box(g, w, 0.04, d, mat(c), 0, seatTop - 0.04, 0, 0.015);
    box(g, w, h - seatTop, 0.03, mat(c), 0, seatTop, -d / 2 + 0.02, 0.012);
  },
  office_chair(g, w, h, d, c) {
    const dark = mat(METAL), seatTop = 0.48;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = box(g, 0.04, 0.03, w * 0.42, dark, 0, 0.05, 0);
      spoke.rotation.y = a;
      spoke.position.set(Math.sin(a) * w * 0.2, 0.065, Math.cos(a) * w * 0.2);
      const caster = part(new THREE.SphereGeometry(0.03, 10, 8), dark);
      caster.position.set(Math.sin(a) * w * 0.4, 0.03, Math.cos(a) * w * 0.4);
      g.add(caster);
    }
    cyl(g, 0.025, 0.025, seatTop - 0.12, dark, 0, 0.08, 0);
    box(g, w * 0.85, 0.08, d * 0.8, mat(c), 0, seatTop - 0.06, 0.02, 0.03);
    const back = box(g, w * 0.78, h - seatTop - 0.05, 0.07, mat(c), 0, seatTop + 0.05, -d / 2 + 0.1, 0.03);
    back.rotation.x = -0.1;
    for (const sx of [-1, 1]) box(g, 0.05, 0.03, d * 0.45, dark, sx * w * 0.42, seatTop + 0.18, 0, 0.01);
  },
  desk(g, w, h, d, c) {
    const top = mat(c, { roughness: 0.6 });
    box(g, w, 0.03, d, top, 0, h - 0.03, 0, 0.006);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.045, h - 0.03, 0.045, mat(METAL), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
  },
  table(g, w, h, d, c) { B.desk(g, w, h, d, c); },
  monitor(g, w, h, d, c) {
    const bez = mat("#1a1c20", { roughness: 0.4 });
    const screenH = Math.min(h * 0.68, w * 0.6), screenY = h - screenH;
    box(g, Math.min(0.26, w * 0.4), 0.015, Math.min(0.2, Math.max(d, 0.12)), bez, 0, 0, 0, 0.005);
    box(g, 0.045, screenY + screenH * 0.4, 0.025, bez, 0, 0, -0.03);
    box(g, w, screenH, 0.025, bez, 0, screenY, 0, 0.006);
    const glass = part(new THREE.PlaneGeometry(w - 0.02, screenH - 0.03),
      screenMat());
    glass.position.set(0, screenY + screenH / 2 + 0.005, 0.0131);
    g.add(glass);
  },
  tv(g, w, h, d, c) { B.monitor(g, w, h, Math.max(d, 0.25), c); },
  laptop(g, w, h, d, c) {
    const shell = mat(c, { roughness: 0.35, metalness: 0.5 });
    box(g, w, 0.016, d, shell, 0, 0, 0, 0.004);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.016, -d / 2);
    const lid = part(new THREE.BoxGeometry(w, 0.008, d), shell);
    lid.position.z = d / 2;
    const scr = part(new THREE.PlaneGeometry(w - 0.02, d - 0.02),
      screenMat());
    scr.rotation.x = Math.PI / 2; scr.position.set(0, -0.0045, d / 2);
    hinge.add(lid, scr);
    hinge.rotation.x = -1.75; // ~100° open, leaning back
    g.add(hinge);
  },
  keyboard(g, w, h, d, c) {
    box(g, w, Math.max(0.018, Math.min(h, 0.04)), d, mat(c, { roughness: 0.5 }), 0, 0, 0, 0.005);
    box(g, w * 0.94, 0.004, d * 0.8, mat("#4a4f57", { roughness: 0.6 }), 0, Math.max(0.018, Math.min(h, 0.04)), 0);
  },
  mouse(g, w, h, d, c) { box(g, Math.max(w, 0.06), Math.max(h, 0.035), Math.max(d, 0.1), mat(c, { roughness: 0.4 }), 0, 0, 0, 0.03); },
  wardrobe(g, w, h, d, c) {
    const body = mat(c, { roughness: 0.6 }), line = mat("#8a867f"), handle = mat("#9aa0a6", { metalness: 0.7, roughness: 0.3 });
    box(g, w, 0.08, d - 0.04, mat("#9b968e"), 0, 0, 0);
    box(g, w, h - 0.06, d, body, 0, 0.06, 0, 0.008);
    const doors = w > 1.3 ? 3 : 2;
    for (let i = 1; i < doors; i++) box(g, 0.006, h - 0.12, 0.004, line, -w / 2 + (w * i) / doors, 0.09, d / 2);
    for (let i = 0; i < doors; i++) {
      const cx = -w / 2 + (w * (i + 0.5)) / doors, side = i < doors / 2 ? 1 : -1;
      box(g, 0.015, 0.16, 0.025, handle, cx + side * (w / doors / 2 - 0.05), h * 0.48, d / 2 + 0.012);
    }
  },
  shelf(g, w, h, d, c) {
    const m = mat(c);
    for (const sx of [-1, 1]) box(g, 0.02, h, d, m, sx * (w / 2 - 0.01), 0, 0);
    const n = Math.max(2, Math.round(h / 0.35));
    for (let i = 0; i <= n; i++) box(g, w - 0.04, 0.02, d, m, 0, (i * (h - 0.02)) / n, 0);
    box(g, w - 0.04, h, 0.005, m, 0, 0, -d / 2 + 0.003);
  },
  dresser(g, w, h, d, c) {
    box(g, w, h, d, mat(c, { roughness: 0.6 }), 0, 0, 0, 0.008);
    const n = Math.max(2, Math.round(h / 0.25));
    for (let i = 1; i < n; i++) box(g, w * 0.96, 0.006, 0.004, mat("#8a867f"), 0, (h * i) / n, d / 2);
    for (let i = 0; i < n; i++) box(g, 0.12, 0.015, 0.02, mat("#9aa0a6", { metalness: 0.7 }), 0, (h * (i + 0.5)) / n, d / 2 + 0.01);
  },
  bed(g, w, h, d, c) {
    const frame = mat(c);
    box(g, w, 0.3, d, frame, 0, 0, 0, 0.02);
    box(g, w - 0.05, 0.2, d - 0.08, mat(WHITE, { roughness: 0.95 }), 0, 0.3, 0.02, 0.06);
    box(g, w, Math.max(h, 0.9), 0.08, frame, 0, 0, -d / 2 + 0.04, 0.02);
    for (const sx of [-1, 1]) box(g, w * 0.4, 0.12, 0.35, mat(WHITE), sx * w * 0.23, 0.5, -d / 2 + 0.3, 0.05);
  },
  ac(g, w, h, d, c) {
    box(g, w, h, d, mat(WHITE, { roughness: 0.5 }), 0, 0, 0, Math.min(0.05, h / 3));
    box(g, w * 0.88, 0.02, 0.01, mat("#3a3f46"), 0, h * 0.12, d / 2 - 0.004);
  },
  wall_art(g, w, h, d, c) {
    const t = Math.min(0.035, Math.max(d, 0.015));
    box(g, w, h, t, mat("#2a2a2a", { roughness: 0.5 }), 0, 0, 0);
    const canvas = part(new THREE.PlaneGeometry(w * 0.88, h * 0.88), mat(c, { roughness: 0.9 }));
    canvas.position.set(0, h / 2, t / 2 + 0.001);
    g.add(canvas);
  },
  printer3d(g, w, h, d, c) {
    const frame = mat(c, { roughness: 0.5 }), dark = mat(METAL);
    box(g, w, h * 0.16, d, frame, 0, 0, 0, 0.01);
    box(g, w * 0.78, 0.01, d * 0.78, mat("#c9c9c9", { metalness: 0.6, roughness: 0.3 }), 0, h * 0.16, 0);
    for (const sx of [-1, 1]) box(g, 0.035, h * 0.84, 0.035, dark, sx * (w / 2 - 0.03), h * 0.16, -d / 2 + 0.06);
    box(g, w, 0.04, 0.04, dark, 0, h - 0.04, -d / 2 + 0.06);
    box(g, w * 0.9, 0.025, 0.025, dark, 0, h * 0.62, -d / 2 + 0.06);
    box(g, 0.07, 0.08, 0.06, frame, 0, h * 0.56, -d / 2 + 0.1, 0.01);
    const spool = cyl(g, 0.09, 0.09, 0.06, mat("#d9a441"), w / 2 + 0.04, h * 0.6, -d / 2 + 0.06);
    spool.rotation.z = Math.PI / 2;
  },
  bag(g, w, h, d, c) {
    const fab = mat(c, { roughness: 0.9 });
    box(g, w, h, d, fab, 0, 0, 0, Math.min(w, h, d) * 0.3);
    if (h > w * 0.9) box(g, w * 0.75, h * 0.42, d * 0.35, fab, 0, h * 0.08, d / 2, 0.04); // backpack pocket
    const handle = part(new THREE.TorusGeometry(Math.min(0.07, w * 0.2), 0.012, 8, 16, Math.PI), fab);
    handle.position.set(0, h - 0.01, 0);
    g.add(handle);
  },
  pillow(g, w, h, d, c) {
    box(g, w, Math.max(h, 0.1), Math.max(d, 0.1), mat(c, { roughness: 1 }), 0, 0, 0, Math.min(0.07, Math.max(h, 0.1) / 2));
  },
  lamp(g, w, h, d, c) {
    cyl(g, Math.min(0.12, w / 2), Math.min(0.12, w / 2), 0.03, mat(METAL), 0, 0, 0);
    cyl(g, 0.012, 0.012, h * 0.75, mat(METAL), 0, 0.03, 0, 8);
    cyl(g, w * 0.3, w * 0.5, h * 0.25, mat(c, { emissive: "#ffd9a0", emissiveIntensity: 0.25 }), 0, h * 0.75, 0);
  },
  plant(g, w, h, d, c) {
    cyl(g, w * 0.3, w * 0.24, h * 0.3, mat("#b7714f"), 0, 0, 0);
    const leaves = part(new THREE.SphereGeometry(w * 0.5, 14, 10), mat("#4f7d4a", { roughness: 1 }));
    leaves.scale.y = (h * 0.7) / w; leaves.position.y = h * 0.3 + h * 0.35;
    g.add(leaves);
  },
  deskmat(g, w, h, d, c) { box(g, w, 0.004, d, mat(c, { roughness: 0.9 }), 0, 0, 0); },
  rug(g, w, h, d, c) { box(g, w, 0.008, d, mat(c, { roughness: 1 }), 0, 0, 0); },
  headphones(g, w, h, d, c) {
    const m = mat(c, { roughness: 0.4 });
    const band = part(new THREE.TorusGeometry(Math.max(w, 0.16) / 2, 0.012, 8, 20, Math.PI), m);
    band.position.y = Math.max(h, 0.18) / 2;
    g.add(band);
    for (const sx of [-1, 1]) {
      const cup = cyl(g, 0.045, 0.045, 0.035, m, sx * Math.max(w, 0.16) / 2, Math.max(h, 0.18) / 2 - 0.05, 0);
      cup.rotation.z = Math.PI / 2;
    }
  },
  textile(g, w, h, d, c) { box(g, w, Math.max(h, 0.03), d, mat(c, { roughness: 1 }), 0, 0, 0, 0.012); },
  box(g, w, h, d, c) { box(g, w, h, d, mat(c), 0, 0, 0, Math.min(w, h, d) * 0.12); },
};

export const SHAPES = Object.keys(B);

export function buildModel(shape, w, h, d, color) {
  const g = new THREE.Group();
  (B[shape] || B.box)(g, w, h, d, color);
  return g;
}
