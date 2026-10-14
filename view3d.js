// 3D room view: walls from the scanned bounds, items as sized blocks you can tap.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const WALL_H = 2.6;

export function createView(container, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 6, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 1;
  controls.maxDistance = 14;

  let roomGroup = null, walls = [], pickables = [], selected = null;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function label(text) {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.font = "600 44px -apple-system, Segoe UI, sans-serif";
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w; c.height = 72;
    ctx.font = "600 44px -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(14,17,22,.85)";
    ctx.beginPath(); ctx.roundRect(0, 0, w, 72, 36); ctx.fill();
    ctx.fillStyle = "#e8ecf2"; ctx.textBaseline = "middle"; ctx.fillText(text, 20, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(w / 72 * 0.16, 0.16, 1);
    s.renderOrder = 10;
    return s;
  }

  function setRoom(room) {
    if (roomGroup) { scene.remove(roomGroup); roomGroup.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
    roomGroup = new THREE.Group(); walls = []; pickables = []; selected = null;
    scene.add(roomGroup);
    if (!room) return;

    const { xmin, xmax, zmin, zmax } = room.bounds;
    const W = xmax - xmin, D = zmax - zmin, cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xcfc8bd, roughness: .9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz);
    roomGroup.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D) * 2), 0x9a9387, 0xb8b1a5);
    grid.position.set(cx, 0.002, cz);
    grid.scale.set(W / Math.max(W, D), 1, D / Math.max(W, D));
    roomGroup.add(grid);

    const wallMat = () => new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: .95, side: THREE.DoubleSide });
    // [width, x, z, rotationY, outward normal]
    const defs = [
      [W, cx, zmin, 0, new THREE.Vector3(0, 0, -1)],
      [W, cx, zmax, 0, new THREE.Vector3(0, 0, 1)],
      [D, xmin, cz, Math.PI / 2, new THREE.Vector3(-1, 0, 0)],
      [D, xmax, cz, Math.PI / 2, new THREE.Vector3(1, 0, 0)],
    ];
    for (const [len, x, z, ry, n] of defs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, 0.06), wallMat());
      m.position.set(x, WALL_H / 2, z); m.rotation.y = ry; m.userData.normal = n;
      roomGroup.add(m); walls.push(m);
    }

    // where the scan was taken from
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.17, 32), new THREE.MeshBasicMaterial({ color: 0x4fd1a5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
    roomGroup.add(ring);

    for (const it of room.items) {
      const w = clamp(it.w, .05, 3), h = clamp(it.h, .02, 2.5), d = clamp(it.d, .05, 3);
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(safeHex(it.color)), roughness: .7 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      // wall-mounted things (AC) float near the ceiling
      const y = /\b(ac|air ?condition|mazgan)/i.test(it.name + " " + it.category) ? WALL_H - 0.35 - h / 2 : h / 2;
      box.position.set(it.x, y, it.z);
      // face the scan origin so long items run along the wall
      box.rotation.y = Math.atan2(it.x, it.z);
      box.userData.item = it;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: .35 }));
      box.add(edges);
      const tag = label(it.name);
      tag.position.set(0, h / 2 + 0.14, 0);
      box.add(tag);
      roomGroup.add(box); pickables.push(box);
    }

    controls.target.set(cx, 0.4, cz);
    // portrait phones need to stand further back to fit the room's width
    const k = 1 / Math.min(1, (container.clientWidth / container.clientHeight || 1) * 1.1);
    const M = Math.max(W, D);
    camera.position.set(cx + M * 0.55 * k, (M * 1.1 + 1.2) * k, cz + (M * 0.95 + 0.8) * k);
    controls.update();
  }

  function select(item) {
    for (const p of pickables) p.material.emissive.setHex(p.userData.item === item ? 0x2a6f5a : 0x000000);
    selected = item;
  }

  // tap (not drag) → pick
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit) { select(hit.object.userData.item); onPick(hit.object.userData.item); }
  });

  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (!container.clientWidth) return;
    controls.update();
    // hide walls between the camera and the room so you can see inside
    for (const w of walls) {
      tmp.copy(camera.position).sub(w.position);
      w.visible = tmp.dot(w.userData.normal) < 0;
    }
    renderer.render(scene, camera);
  });

  return { setRoom, select, resize };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, +v || a));
const safeHex = h => /^#[0-9a-f]{6}$/i.test(h || "") ? h : "#8b95a7";
