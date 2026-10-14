import { analyzeFrame, consolidateRoom, testKey, spend, MOCK } from "./ai.js?v=5";
import { createView } from "./view3d.js?v=5";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ils = n => n ? "₪" + Math.round(n).toLocaleString("en-US") : "—";
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- storage ----------
const DB_KEY = "homemap.v1", KEY_KEY = "homemap.apiKey";
function load() { try { return JSON.parse(localStorage.getItem(DB_KEY)) || { rooms: [] }; } catch { return { rooms: [] }; } }
let db = load();
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch (e) { alert("Storage full: " + e.message); }
}
const getKey = () => { try { return localStorage.getItem(KEY_KEY) || ""; } catch { return ""; } };

// ---------- navigation ----------
let view3d = null, current3dRoom = null, currentCatRoom = "all";
function go(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.go === id));
  if (id === "home") renderHome();
  if (id === "catalog") renderCatalog();
  if (id === "view3d") render3d();
  if (id === "settings") $("#apiKey").value = getKey();
}
document.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(b.dataset.go); });
$("#btnSettings").onclick = () => go("settings");

function busy(msg, sub = "") { $("#busy").classList.toggle("on", !!msg); $("#busyMsg").textContent = msg || ""; $("#busySub").textContent = sub; }

// ---------- home ----------
function roomTotal(r) { return r.items.reduce((s, i) => s + (+i.price || 0), 0); }
function renderHome() {
  $("#keyWarn").hidden = !!getKey() || MOCK;
  $("#roomList").innerHTML = db.rooms.length ? db.rooms.map(r => `
    <div class="card room-row">
      <div class="meta"><b>${esc(r.name)}</b><div class="muted small">${r.items.length} items · ${ils(roomTotal(r))}${r.cost != null ? ` · scan cost ${usd(r.cost)}` : ""}</div></div>
      <button data-act="3d" data-id="${r.id}">3D</button>
      <button data-act="cat" data-id="${r.id}">List</button>
      <button data-act="del" data-id="${r.id}" aria-label="Delete room">✕</button>
    </div>`).join("") : `<p class="muted small" style="text-align:center">No rooms yet. Scan your first one.</p>`;
}
$("#roomList").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const r = db.rooms.find(x => x.id === b.dataset.id);
  if (b.dataset.act === "3d") { current3dRoom = r.id; go("view3d"); }
  if (b.dataset.act === "cat") { currentCatRoom = r.id; go("catalog"); }
  if (b.dataset.act === "del" && confirm(`Delete ${r.name}?`)) { db.rooms = db.rooms.filter(x => x !== r); save(); renderHome(); }
});

// ---------- settings ----------
$("#btnSaveKey").onclick = () => {
  try { localStorage.setItem(KEY_KEY, $("#apiKey").value.trim()); $("#keyMsg").textContent = "Saved."; } catch { $("#keyMsg").textContent = "Couldn't save (private browsing?)"; }
};
$("#btnTestKey").onclick = async () => {
  $("#keyMsg").textContent = "Testing…";
  try { await testKey($("#apiKey").value.trim()); $("#keyMsg").textContent = "✓ Key works."; }
  catch (e) { $("#keyMsg").textContent = "✗ " + e.message; }
};
// share everything as one JSON file (share sheet on iPhone, download elsewhere)
async function exportScans() {
  if (!db.rooms.length) return alert("Nothing to export yet.");
  const name = `homemap-export-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), build: 5, ua: navigator.userAgent, ...db }, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  try { if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: "HomeMap scan" }); }
  catch (e) { if (e.name === "AbortError") return; }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("#btnExport").onclick = exportScans;
$("#btnExport2").onclick = exportScans;
$("#btnWipe").onclick = () => { if (confirm("Delete every room and item?")) { db = { rooms: [] }; save(); go("home"); } };

// =====================================================================
// SCAN
// =====================================================================
const SECTORS = 8, SECTOR_DEG = 360 / SECTORS;
const MAX_PX = 1024; // longest side sent to Claude — image tokens scale with pixel count
let scan = null;
const usd = n => "$" + (n < 0.1 ? n.toFixed(3) : n.toFixed(2));

function newScan(roomName) {
  spend.usd = 0;
  return {
    roomName, frames: [], sectors: Array(SECTORS).fill(0), // 0 none, 1 analysing, 2 done
    walls: [], detections: [], floor: [], wallColor: [],
    heading: null, h0: null, hist: [], lastCapture: 0, inflight: 0, queue: [], finishing: false,
    stream: null, raf: 0, hasCompass: false, motion: [], lens: "wide", holding: false,
  };
}
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const relHeading = () => scan.heading == null ? null : (scan.heading - scan.h0 + 360) % 360;

$("#btnStartScan").onclick = startScan;
async function startScan() {
  if (!getKey() && !MOCK) return go("settings");
  scan = newScan($("#roomName").value.trim() || "Room");
  // iOS needs a user gesture for both camera and compass
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission();
    }
    if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
      await DeviceMotionEvent.requestPermission();
    }
  } catch { /* falls back to manual capture */ }
  window.addEventListener("deviceorientation", onOrient);
  window.addEventListener("deviceorientationabsolute", onOrient);
  window.addEventListener("devicemotion", onMotion);
  try {
    const size = { width: { ideal: 1920 }, height: { ideal: 1440 } };
    scan.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, ...size } });
    // prefer the 0.5x ultra-wide lens: sees floor-to-ceiling and whole pieces of furniture.
    // Device labels only appear after permission is granted, hence the second request.
    const ultra = (await navigator.mediaDevices.enumerateDevices())
      .find(d => d.kind === "videoinput" && /ultra/i.test(d.label) && !/front/i.test(d.label));
    if (ultra) {
      try {
        const s2 = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: ultra.deviceId }, ...size } });
        scan.stream.getTracks().forEach(t => t.stop());
        scan.stream = s2; scan.lens = "ultra";
      } catch (e) { console.warn("ultra-wide unavailable", e); }
    }
  } catch (e) { alert("Camera unavailable: " + e.message); return; }
  const v = $("#video"); v.srcObject = scan.stream; await v.play().catch(() => {});
  document.body.classList.add("scanning");
  $("#scanFeed").innerHTML = ""; $("#btnFinish").disabled = true;
  go("scan");
  scan.raf = requestAnimationFrame(tick);
}

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null || !scan) return;
  scan.hasCompass = true;
  if (scan.h0 == null) scan.h0 = h;
  scan.heading = h;
  scan.hist.push([performance.now(), h]);
  if (scan.hist.length > 20) scan.hist.shift();
}

function onMotion(e) {
  const r = e.rotationRate;
  if (!scan || !r || r.alpha == null) return;
  scan.motion.push([performance.now(), Math.hypot(r.alpha, r.beta, r.gamma)]); // deg/s
  if (scan.motion.length > 60) scan.motion.shift();
}

// held still for ~0.6 s: compass barely moving and (when available) the gyro quiet → sharp photo
function stable() {
  const now = performance.now();
  const recent = scan.hist.filter(([t]) => now - t < 600);
  if (recent.length < 4) return false;
  if (!recent.every(([, h]) => Math.abs(angDiff(h, recent[0][1])) < 2.5)) return false;
  const spin = scan.motion.filter(([t]) => now - t < 400);
  return !spin.length || spin.every(([, v]) => v < 12);
}

function tick() {
  if (!scan || scan.finishing) return;
  const rel = relHeading();
  let snap = false;
  if (rel != null) {
    const s = Math.round(rel / SECTOR_DEG) % SECTORS;
    const off = Math.abs(angDiff(rel, s * SECTOR_DEG));
    snap = !scan.sectors[s] && off < 9;
    scan.holding = snap && !stable();
    if (snap && !scan.holding && performance.now() - scan.lastCapture > 700) capture(rel, s);
  }
  $("#reticle").classList.toggle("snap", snap);
  drawMap();
  updateStatus();
  scan.raf = requestAnimationFrame(tick);
}

$("#btnShutter").onclick = () => {
  if (!scan) return;
  const rel = relHeading();
  if (rel != null) capture(rel, Math.round(rel / SECTOR_DEG) % SECTORS);
  else { // no compass (desktop): fill sectors in order
    const s = scan.sectors.findIndex(x => !x);
    capture((s < 0 ? scan.frames.length : s) * SECTOR_DEG, s < 0 ? null : s);
  }
};

function grabFrame() {
  const v = $("#video");
  const scale = Math.min(1, MAX_PX / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c;
}

function capture(angle, sector) {
  if (!scan.stream && !scan.uploadMode) return;
  scan.lastCapture = performance.now();
  const canvas = grabFrame();
  addFrame(canvas, angle, sector);
  navigator.vibrate?.(20);
}

function addFrame(canvas, angle, sector) {
  const f = { idx: scan.frames.length, angle, sector, canvas, status: "queued", lens: scan.lens };
  scan.frames.push(f);
  if (sector != null && !scan.sectors[sector]) scan.sectors[sector] = 1;
  scan.queue.push(f);
  pump();
}

function pump() {
  while (scan && scan.inflight < 3 && scan.queue.length) {
    const f = scan.queue.shift();
    scan.inflight++;
    const b64 = f.canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    analyzeFrame(getKey(), b64).then(res => ingest(f, res)).catch(err => {
      f.status = "error"; console.error(err);
      feed("⚠ " + (err.message || "frame failed").slice(0, 60));
    }).finally(() => {
      if (!scan) return;
      scan.inflight--;
      if (f.sector != null) scan.sectors[f.sector] = 2;
      pump(); maybeAutoFinish();
    });
  }
}

// horizontal field of view of the captured frame (iPhone 1x lens)
// horizontal field of view of the captured frame: iPhone 1x vs 0.5x ultra-wide
const hfov = (c, lens) => lens === "ultra" ? (c.width < c.height ? 90 : 105) : (c.width < c.height ? 51 : 65);

function ingest(f, res) {
  f.status = "done";
  const fov = hfov(f.canvas, f.lens);
  const toXZ = (deg, d) => [Math.sin(deg * Math.PI / 180) * d, -Math.cos(deg * Math.PI / 180) * d];
  [["wall_left_m", -.45], ["wall_center_m", 0], ["wall_right_m", .45]].forEach(([k, frac]) => {
    const d = res[k];
    if (d > 0.3 && d < 12) {
      const a = f.angle + frac * fov;
      const [x, z] = toXZ(a, d);
      scan.walls.push({ angle: a, dist: d, x, z });
    }
  });
  if (res.floor) scan.floor.push(res.floor);
  if (res.wall_color) scan.wallColor.push(res.wall_color);
  res.items.forEach((it, i) => {
    if (it.confidence < 0.35) return;
    const a = f.angle + (it.x_center - 0.5) * fov;
    const d = Math.max(0.3, it.distance_m || 1.5);
    const [x, z] = toXZ(a, d);
    const det = { id: `f${f.idx}-${i}`, frame: f.idx, angle: Math.round(a), distance_m: d, x: +x.toFixed(2), z: +z.toFixed(2),
      name: it.name, category: it.category, brand: it.brand, model: it.model, color_hex: it.color_hex, description: it.description,
      width_m: it.width_m, depth_m: it.depth_m, height_m: it.height_m, confidence: it.confidence, bbox: it.bbox,
      mount: it.mount, elevation_m: it.elevation_m, resting_on: it.resting_on };
    scan.detections.push(det);
    // only announce things we haven't announced nearby already
    const dup = scan.detections.some(o => o !== det && o.name.toLowerCase() === det.name.toLowerCase() && Math.hypot(o.x - det.x, o.z - det.z) < 0.9);
    if (!dup) feed("+ " + it.name);
  });
}

function feed(text) {
  const s = document.createElement("span"); s.textContent = text;
  const box = $("#scanFeed"); box.prepend(s);
  while (box.children.length > 14) box.lastChild.remove();
}

function mapDone() { return scan.sectors.every(s => s === 2); }
function updateStatus() {
  const got = scan.sectors.filter(Boolean).length;
  const waiting = scan.inflight + scan.queue.length;
  let msg;
  if (got < SECTORS && !scan.hasCompass && !scan.uploadMode) msg = `No compass — tap the shutter as you turn (${got}/${SECTORS})`;
  else if (got < SECTORS && scan.holding) msg = `<b>Hold still…</b> ${got}/${SECTORS}`;
  else if (got < SECTORS) msg = `Turn slowly · <b>${got}/${SECTORS}</b> captured`;
  else if (waiting) msg = `Map complete · identifying ${waiting} views…`;
  else msg = `<b>Map complete ✓</b>`;
  const items = new Set(scan.detections.map(d => d.name.toLowerCase())).size;
  $("#scanStatus").innerHTML = msg + `<div class="small muted">${items} items spotted · ${usd(spend.usd)}${scan.lens === "ultra" ? " · 0.5×" : ""}</div>`;
  $("#btnFinish").disabled = got < 4 || scan.finishing;
}

function maybeAutoFinish() {
  if (scan && !scan.finishing && mapDone() && !scan.queue.length && !scan.inflight) setTimeout(() => scan && !scan.finishing && finishScan(), 1200);
}

// ---------- live mini map ----------
function fitBounds(walls, dets) {
  const side = (dir, axisSign, proj) => {
    const ds = walls.filter(w => Math.abs(angDiff(w.angle, dir)) < 40).map(w => w.dist * Math.cos(angDiff(w.angle, dir) * Math.PI / 180)).sort((a, b) => a - b);
    if (ds.length) return axisSign * ds[Math.floor(ds.length / 2)];
    const ext = dets.map(proj); // fall back to the furthest item on that side
    return axisSign * Math.max(1.2, ...ext.map(v => v * axisSign + 0.4));
  };
  return {
    zmin: side(0, -1, d => d.z), xmax: side(90, 1, d => d.x),
    zmax: side(180, 1, d => d.z), xmin: side(270, -1, d => d.x),
  };
}

function drawMap() {
  const c = $("#minimap"), g = c.getContext("2d"), W = c.width, C = W / 2;
  g.clearRect(0, 0, W, W);
  const maxR = Math.max(2.2, ...scan.walls.map(w => w.dist), ...scan.detections.map(d => d.distance_m)) * 1.1;
  const k = (C - 14) / maxR;
  // sectors
  for (let s = 0; s < SECTORS; s++) {
    const a0 = (s * SECTOR_DEG - SECTOR_DEG / 2 - 90) * Math.PI / 180, a1 = a0 + SECTOR_DEG * Math.PI / 180;
    g.beginPath(); g.moveTo(C, C); g.arc(C, C, C - 6, a0, a1); g.closePath();
    g.fillStyle = scan.sectors[s] === 2 ? "#4fd1a533" : scan.sectors[s] === 1 ? "#f5b84b33" : "#ffffff08";
    g.fill(); g.strokeStyle = "#ffffff14"; g.stroke();
  }
  // walls as a room rectangle once each side has data
  if (scan.walls.length >= 3) {
    const b = fitBounds(scan.walls, scan.detections);
    g.strokeStyle = "#e8ecf2"; g.lineWidth = 3;
    g.strokeRect(C + b.xmin * k, C + b.zmin * k, (b.xmax - b.xmin) * k, (b.zmax - b.zmin) * k);
  }
  g.fillStyle = "#ffffff88";
  for (const w of scan.walls) { g.beginPath(); g.arc(C + w.x * k, C + w.z * k, 2.5, 0, 7); g.fill(); }
  for (const d of scan.detections) {
    g.fillStyle = /^#[0-9a-f]{6}$/i.test(d.color_hex) ? d.color_hex : "#4fd1a5";
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.beginPath(); g.arc(C + d.x * k, C + d.z * k, 5, 0, 7); g.fill(); g.stroke();
  }
  // you + facing cone
  const rel = relHeading();
  if (rel != null) {
    const a = (rel - 90) * Math.PI / 180, half = 25 * Math.PI / 180;
    g.beginPath(); g.moveTo(C, C); g.arc(C, C, 40, a - half, a + half); g.closePath();
    g.fillStyle = "#4fd1a555"; g.fill();
  }
  g.fillStyle = "#4fd1a5"; g.beginPath(); g.arc(C, C, 6, 0, 7); g.fill();
}

// ---------- finish ----------
$("#btnFinish").onclick = () => finishScan();
$("#btnCancelScan").onclick = () => { if (confirm("Discard this scan?")) endScan(); go("home"); };

function endScan() {
  if (!scan) return;
  cancelAnimationFrame(scan.raf);
  scan.stream?.getTracks().forEach(t => t.stop());
  window.removeEventListener("deviceorientation", onOrient);
  window.removeEventListener("deviceorientationabsolute", onOrient);
  window.removeEventListener("devicemotion", onMotion);
  document.body.classList.remove("scanning");
  scan = null;
}

const mode = arr => { const m = {}; arr.forEach(x => m[x] = (m[x] || 0) + 1); return Object.keys(m).sort((a, b) => m[b] - m[a])[0] || ""; };

async function finishScan() {
  if (!scan || scan.finishing) return;
  scan.finishing = true;
  cancelAnimationFrame(scan.raf);
  scan.stream?.getTracks().forEach(t => t.stop());
  busy("Finishing views…");
  while (scan.inflight || scan.queue.length) await new Promise(r => setTimeout(r, 300));
  const s = scan;
  if (!s.detections.length) { busy(); alert("No items were recognized. Check your API key and try again."); endScan(); go("home"); return; }

  busy("Building your room…", `Merging ${s.detections.length} sightings into one catalog`);
  const bounds = fitBounds(s.walls, s.detections);
  Object.keys(bounds).forEach(k => bounds[k] = +bounds[k].toFixed(2));
  let out;
  // photos are already analysed — on failure offer a retry instead of losing the scan
  while (!out) {
    try {
      out = await consolidateRoom(getKey(), {
        roomName: s.roomName, bounds, floor: mode(s.floor), wallColor: mode(s.wallColor),
        detections: s.detections.map(({ bbox, frame, ...d }) => d), // mount/elevation included
      });
    } catch (e) {
      console.error(e);
      busy();
      if (!confirm(`Couldn't build the room: ${e.message}\n\nTry again? (your photos are kept)`)) { endScan(); go("home"); return; }
      busy("Building your room…", "Retrying");
    }
  }

  busy("Saving photos…");
  const items = out.items.map(it => {
    const det = s.detections.find(d => d.id === it.source_id) || s.detections.find(d => d.name === it.name);
    return {
      id: uid(), name: it.name, brand: it.brand, model: it.model, category: it.category, color: it.color_hex,
      description: it.description,
      x: clampTo(it.x, bounds.xmin, bounds.xmax), z: clampTo(it.z, bounds.zmin, bounds.zmax),
      w: it.width_m, d: it.depth_m, h: it.height_m,
      price: it.est_price_ils, priceLow: it.price_low_ils, priceHigh: it.price_high_ils,
      store: it.likely_store, url: "", priceSource: "estimate", confidence: it.confidence,
      shape: it.shape, wall: it.against_wall, mount: it.mount, elev: it.elevation_m, small: !!it.small_item,
      thumb: det ? thumbFrom(s.frames[det.frame].canvas, det.bbox) : "",
    };
  });

  const existing = db.rooms.find(r => r.name.toLowerCase() === s.roomName.toLowerCase());
  const room = { id: existing?.id || uid(), name: s.roomName, scannedAt: Date.now(), cost: spend.usd, bounds, floor: out.floor, wallColor: out.wall_color, items,
    // raw scan data kept for tuning map accuracy (small: text only)
    raw: { frames: s.frames.length, walls: s.walls.map(w => ({ angle: Math.round(w.angle), dist: +w.dist.toFixed(2) })),
      detections: s.detections.map(({ bbox, ...d }) => d) } };
  db.rooms = db.rooms.filter(r => r !== existing).concat(room);
  save();
  endScan(); busy();
  current3dRoom = room.id; currentCatRoom = room.id;
  go("view3d");
}

const clampTo = (v, a, b) => Math.min(b - 0.15, Math.max(a + 0.15, +v || 0));

function thumbFrom(canvas, bbox) {
  const pad = 0.04;
  const x0 = Math.max(0, (bbox?.x0 ?? 0) - pad) * canvas.width, y0 = Math.max(0, (bbox?.y0 ?? 0) - pad) * canvas.height;
  const x1 = Math.min(1, (bbox?.x1 ?? 1) + pad) * canvas.width, y1 = Math.min(1, (bbox?.y1 ?? 1) + pad) * canvas.height;
  const sw = Math.max(8, x1 - x0), sh = Math.max(8, y1 - y0), side = 360, sc = side / Math.max(sw, sh);
  const c = document.createElement("canvas"); c.width = Math.round(sw * sc); c.height = Math.round(sh * sc);
  c.getContext("2d").drawImage(canvas, x0, y0, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}

function refreshVisible() {
  if ($("#catalog").classList.contains("active")) renderCatalog();
  if ($("#home").classList.contains("active")) renderHome();
}

// ---------- upload mode (no live camera) ----------
$("#btnUpload").onclick = () => { if (!getKey() && !MOCK) return go("settings"); $("#fileUpload").click(); };
$("#fileUpload").onchange = async e => {
  const files = [...e.target.files]; e.target.value = "";
  if (!files.length) return;
  scan = newScan($("#roomName").value.trim() || "Room");
  scan.uploadMode = true;
  busy(`Reading ${files.length} photos…`);
  const n = files.length;
  for (let i = 0; i < n; i++) {
    const img = await createImageBitmap(files[i]);
    const sc = Math.min(1, MAX_PX / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const angle = i * 360 / n, sector = n >= SECTORS ? Math.round(angle / SECTOR_DEG) % SECTORS : null;
    addFrame(c, angle, sector);
  }
  scan.sectors = scan.sectors.map(() => 1);
  while (scan.inflight || scan.queue.length) {
    busy("Identifying items…", `${scan.frames.filter(f => f.status !== "queued").length - scan.inflight}/${n} photos · ${scan.detections.length} sightings`);
    await new Promise(r => setTimeout(r, 400));
  }
  scan.sectors = scan.sectors.map(() => 2);
  finishScan();
};

// =====================================================================
// 3D + CATALOG
// =====================================================================
function chipsHtml(selected, withAll) {
  const opts = (withAll ? [{ id: "all", name: "All" }] : []).concat(db.rooms);
  return opts.map(r => `<button class="chip ${r.id === selected ? "on" : ""}" data-room="${r.id}">${esc(r.name)}</button>`).join("");
}

function render3d() {
  if (!view3d) view3d = createView($("#stage"), it => openSheet(it));
  if (!db.rooms.find(r => r.id === current3dRoom)) current3dRoom = db.rooms.at(-1)?.id;
  $("#roomChips3d").innerHTML = db.rooms.length ? chipsHtml(current3dRoom, false) : `<span class="muted small">Scan a room to see it in 3D.</span>`;
  view3d.setRoom(db.rooms.find(r => r.id === current3dRoom));
  requestAnimationFrame(() => view3d.resize());
}
$("#roomChips3d").addEventListener("click", e => { const b = e.target.closest("[data-room]"); if (b) { current3dRoom = b.dataset.room; render3d(); } });

function priceTag(it) {
  if (it.priceSource === "manual") return `<span class="tag ok">your price</span>`;
  return `<span class="tag">AI estimate</span>`;
}

// scans before build 5 have no small_item flag: treat cheap accessories as small
const isSmall = it => it.small ?? (+it.price || 0) < 100;
function itemRows(r, items) {
  return [...items].sort((a, b) => (b.price || 0) - (a.price || 0)).map(it => `
      <div class="item" data-room="${r.id}" data-item="${it.id}">
        ${it.thumb ? `<img src="${it.thumb}" alt="">` : `<div class="thumb-ph"></div>`}
        <div class="meta"><div class="name">${esc(it.name)}</div>
          <div class="muted small">${esc([it.brand, it.store].filter(Boolean).join(" · ") || it.category)}</div>${priceTag(it)}</div>
        <div class="price">${ils(it.price)}</div>
      </div>`).join("");
}

function renderCatalog() {
  $("#roomChips").innerHTML = chipsHtml(currentCatRoom, true);
  const rooms = currentCatRoom === "all" ? db.rooms : db.rooms.filter(r => r.id === currentCatRoom);
  if (!rooms.length) { $("#catalogList").innerHTML = `<p class="muted small" style="text-align:center">Nothing cataloged yet.</p>`; return; }
  $("#catalogList").innerHTML = rooms.map(r => `
    ${currentCatRoom === "all" ? `<h3 style="margin:14px 2px 8px">${esc(r.name)}</h3>` : ""}
    ${itemRows(r, r.items.filter(i => !isSmall(i)))}
    ${r.items.some(isSmall) ? `<details class="small-group"><summary>Small items (${r.items.filter(isSmall).length}) · ${ils(r.items.filter(isSmall).reduce((s, i) => s + (+i.price || 0), 0))}</summary>
      ${itemRows(r, r.items.filter(isSmall))}</details>` : ""}
    <div class="total"><span>${esc(r.name)} total</span><span>${ils(roomTotal(r))}</span></div>`).join("");
}
$("#roomChips").addEventListener("click", e => { const b = e.target.closest("[data-room]"); if (b) { currentCatRoom = b.dataset.room; renderCatalog(); } });
$("#catalogList").addEventListener("click", e => {
  const el = e.target.closest(".item"); if (!el) return;
  const it = db.rooms.find(r => r.id === el.dataset.room)?.items.find(i => i.id === el.dataset.item);
  if (it) openSheet(it);
});

// ---------- item sheet ----------
function findRoomOf(it) { return db.rooms.find(r => r.items.includes(it)); }
function openSheet(it) {
  const room = findRoomOf(it);
  const dims = [it.w, it.d, it.h].map(v => Math.round((+v || 0) * 100)).join(" × ");
  $("#sheet").innerHTML = `<div class="grab"></div>
    <div class="sheet-head">
      ${it.thumb ? `<img src="${it.thumb}" alt="">` : `<div class="thumb-ph"></div>`}
      <div><h2>${esc(it.name)}</h2>
        <div class="muted small">${esc(room?.name || "")}${it.brand ? " · " + esc(it.brand) : ""}${it.model ? " " + esc(it.model) : ""}</div>
        <div class="big-price">${ils(it.price)}</div>${priceTag(it)}</div>
    </div>
    <div class="kv">
      <span class="k">Name</span><input data-f="name" value="${esc(it.name)}">
      <span class="k">Price (₪)</span><input data-f="price" inputmode="decimal" value="${Math.round(it.price || 0)}">
      <span class="k">Bought at</span><input data-f="store" value="${esc(it.store)}">
      ${it.priceLow ? `<span class="k">Range</span><span>${ils(it.priceLow)} – ${ils(it.priceHigh)}</span>` : ""}
      ${it.matched ? `<span class="k">Matched</span><span>${esc(it.matched)}</span>` : ""}
      <span class="k">Category</span><span>${esc(it.category)}</span>
      <span class="k">Size (cm)</span><span>${dims}</span>
      <span class="k">Notes</span><span class="small">${esc(it.description)}</span>
    </div>
    <div class="k small muted" style="margin-top:16px">Check the real price (free)</div>
    <div class="price-links">
      <a href="${searchUrl("zap", it)}" target="_blank" rel="noopener">Zap</a>
      <a href="${searchUrl("ksp", it)}" target="_blank" rel="noopener">KSP</a>
      <a href="${searchUrl("shop", it)}" target="_blank" rel="noopener">Google Shopping</a>
      ${it.thumb ? `<button id="sheetLens">Google Lens</button>` : ""}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button id="sheetClose" class="primary" style="flex:1">Done</button>
      <button id="sheetDel">Delete</button>
    </div>`;
  $("#sheet").querySelectorAll("input[data-f]").forEach(inp => inp.onchange = () => {
    const f = inp.dataset.f;
    if (f === "price") { it.price = +inp.value || 0; it.priceSource = "manual"; } else it[f] = inp.value;
    save();
  });
  $("#sheetClose").onclick = closeSheet;
  if ($("#sheetLens")) $("#sheetLens").onclick = () => shareToLens(it);
  $("#sheetDel").onclick = () => {
    if (!confirm(`Remove ${it.name}?`)) return;
    room.items = room.items.filter(i => i !== it); save(); closeSheet();
    if ($("#view3d").classList.contains("active")) render3d();
  };
  $("#sheet").classList.add("on"); $("#sheetBack").classList.add("on");
}
function searchUrl(site, it) {
  const q = encodeURIComponent([it.brand, it.model, it.name].filter(Boolean).join(" "));
  if (site === "zap") return `https://www.zap.co.il/search.aspx?keyword=${q}`;
  if (site === "ksp") return `https://www.google.com/search?q=${q}+site%3Aksp.co.il`;
  return `https://www.google.com/search?tbm=shop&gl=il&hl=iw&q=${q}`;
}

// iPhone: share the item photo → pick the Google app → it runs Lens on it
async function shareToLens(it) {
  try {
    const blob = await (await fetch(it.thumb)).blob();
    const file = new File([blob], `${it.name.replace(/\W+/g, "-")}.jpg`, { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] });
  } catch (e) { if (e.name === "AbortError") return; }
  window.open(`https://lens.google.com/`, "_blank");
}

function closeSheet() {
  $("#sheet").classList.remove("on"); $("#sheetBack").classList.remove("on");
  view3d?.select(null); refreshVisible();
}
$("#sheetBack").onclick = closeSheet;

// resume any price checks interrupted by a reload
go("home");
