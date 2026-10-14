// 3D room view: walls from the scanned bounds, procedural furniture placed by layout.js, tap to inspect.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildModel } from "./models.js?v=7";
import { layoutRoom, WALL_H } from "./layout.js?v=7";

const SMALL = new Set(["mouse", "keyboard", "headphones", "pillow"]);

function floorLook(text = "") {
  const t = text.toLowerCase();
  if (/wood|parquet|laminate|oak/.test(t)) return { color: "#a98762", tiles: 0 };
  if (/carpet/.test(t)) return { color: "#9c958a", tiles: 0 };
  if (/concrete|cement/.test(t)) return { color: "#a7a39d", tiles: 0 };
  if (/dark/.test(t)) return { color: "#6f6a64", tiles: 0.6 };
  return { color: "#cfc8bc", tiles: 0.6 }; // Israeli default: light porcelain tiles
}
const hexOr = (h, f) => /^#[0-9a-f]{6}$/i.test(h || "") ? h : f;

function tileTexture(base, size) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(0,0,0,.12)"; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.userData.size = size;
  return t;
}

export function createView(container, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0e1116");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight("#ffffff", "#5a5048", 0.5));
  const sun = new THREE.DirectionalLight("#fff4e6", 1.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 0.8; controls.maxDistance = 14;

  let roomGroup = null, walls = [], pickables = [], labels = [], selected = null;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function label(text) {
    const c = document.createElement("canvas"), ctx = c.getContext("2d");
    const font = "600 40px -apple-system, Segoe UI, sans-serif";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 36;
    c.width = w; c.height = 64;
    ctx.font = font; ctx.fillStyle = "rgba(14,17,22,.82)";
    ctx.beginPath(); ctx.roundRect(0, 0, w, 64, 32); ctx.fill();
    ctx.fillStyle = "#e8ecf2"; ctx.textBaseline = "middle"; ctx.fillText(text, 18, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set((w / 64) * 0.12, 0.12, 1); s.renderOrder = 10;
    return s;
  }

  function dispose(o) {
    o.traverse(n => {
      n.geometry?.dispose();
      const m = n.material; if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(x => { x.map?.dispose(); x.dispose(); });
    });
  }

  function setRoom(room) {
    if (roomGroup) { scene.remove(roomGroup); dispose(roomGroup); }
    roomGroup = new THREE.Group(); walls = []; pickables = []; labels = [];
    scene.add(roomGroup);
    if (!room) return;

    const { xmin, xmax, zmin, zmax } = room.bounds;
    const W = xmax - xmin, D = zmax - zmin, cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2, M = Math.max(W, D);

    const fl = floorLook(room.floor);
    const floorMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.55 });
    if (fl.tiles) { floorMat.map = tileTexture(fl.color, fl.tiles); floorMat.map.repeat.set(W / fl.tiles, D / fl.tiles); }
    else floorMat.color.set(fl.color);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true;
    roomGroup.add(floor);

    // slightly darken near-white walls so furniture reads against them
  const wallColor = "#" + new THREE.Color(hexOr(room.wallColor, "#efebe4")).multiplyScalar(0.9).getHexString();
    const T = 0.08;
    const defs = [ // [length, x, z, rotY, outward normal]
      [W + T * 2, cx, zmin - T / 2, 0, [0, -1]], [W + T * 2, cx, zmax + T / 2, 0, [0, 1]],
      [D, xmin - T / 2, cz, Math.PI / 2, [-1, 0]], [D, xmax + T / 2, cz, Math.PI / 2, [1, 0]],
    ];
    for (const [len, x, z, ry, n] of defs) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, T), new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.95 }));
      body.position.y = WALL_H / 2; body.receiveShadow = true; body.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, T), new THREE.MeshStandardMaterial({ color: "#4a4f57" }));
      cap.position.y = WALL_H + 0.005;
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, T + 0.02), new THREE.MeshStandardMaterial({ color: "#d8d3cb", roughness: 0.6 }));
      base.position.y = 0.035;
      g.add(body, cap, base);
      g.position.set(x, 0, z); g.rotation.y = ry; g.userData.normal = new THREE.Vector3(n[0], 0, n[1]);
      roomGroup.add(g); walls.push(g);
    }
    const wallByKey = { front: walls[0], back: walls[1], left: walls[2], right: walls[3] };

    // shadow camera hugs the room
    sun.position.set(cx + M * 0.6, 5, cz + M * 0.9); sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -M, right: M, top: M, bottom: -M, near: 0.5, far: 15 });
    sun.shadow.camera.updateProjectionMatrix();

    for (const p of layoutRoom(room)) {
      const model = buildModel(p.shape, p.w, p.h, p.d, hexOr(p.it.color, "#8b95a7"));
      model.position.set(p.x, p.y, p.z);
      model.rotation.y = p.rot;
      if (p.tilt) model.rotation.x = p.tilt;
      model.userData.item = p.it;
      // wall-hung things disappear with their wall when it's hidden for the camera
      if (p.fixed && p.wall && !p.on) model.userData.wall = wallByKey[p.wall];
      roomGroup.add(model); pickables.push(model);
      const small = p.small || SMALL.has(p.shape) || Math.max(p.w, p.h, p.d) < 0.3 || !!p.on;
      const tag = label(p.it.name);
      tag.position.set(p.x, p.y + p.h + 0.12, p.z);
      tag.visible = !small; tag.userData = { item: p.it, small, model };
      roomGroup.add(tag); labels.push(tag);
    }

    controls.target.set(cx, 0.5, cz);
    const k = 1 / Math.min(1, (container.clientWidth / container.clientHeight || 1) * 1.1);
    camera.position.set(cx + M * 0.5 * k, (M * 1.05 + 1.2) * k, cz + (M * 0.95 + 0.8) * k);
    controls.update();
  }

  function select(item) {
    selected = item;
    for (const g of pickables) {
      const on = g.userData.item === item;
      g.traverse(n => { if (n.material?.emissive && !n.material.userData.screen) n.material.emissive.setHex(on ? 0x1f5c4a : 0x000000); });
    }
    for (const l of labels) l.visible = l.userData.item === item || !l.userData.small;
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    // raycasting ignores .visible, so skip things hung on currently-hidden walls
    const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    const hit = ray.intersectObjects(pickables, true).find(h => shown(h.object));
    if (!hit) return;
    let o = hit.object;
    while (o && !o.userData.item) o = o.parent;
    if (o) { select(o.userData.item); onPick(o.userData.item); }
  });

  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (!container.clientWidth) return;
    controls.update();
    for (const w of walls) { // hide walls between camera and room
      tmp.copy(camera.position).sub(w.position);
      w.visible = tmp.dot(w.userData.normal) < 0;
    }
    for (const m of pickables) if (m.userData.wall) m.visible = m.userData.wall.visible;
    for (const l of labels) if (l.userData.model.userData.wall && !l.userData.model.visible) l.visible = false;
      else if (l.userData.model.userData.wall) l.visible = !l.userData.small || l.userData.item === selected;
    renderer.render(scene, camera);
  });

  return { setRoom, select, resize };
}
