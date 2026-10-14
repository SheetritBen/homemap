// Claude calls. Browser-direct with the user's own key (stored on-device only).
import Anthropic from "anthropic";

// Sonnet 5.5 chosen for cost (Ben, 2026-10-14): recognition is what the kill test measures, so not Haiku.
const MODEL = "claude-sonnet-5-5";
const PRICE_IN = 2 / 1e6, PRICE_OUT = 10 / 1e6; // USD per token
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MOCK = new URLSearchParams(location.search).has("mock");

// running spend meter (USD), read and reset by the app per scan
export const spend = { usd: 0 };
function meter(res) {
  const u = res.usage || {};
  spend.usd += ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)) * PRICE_IN
    + (u.cache_read_input_tokens || 0) * PRICE_IN * 0.1 + (u.output_tokens || 0) * PRICE_OUT;
}

function client(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

// Server-side refusal fallback on; if the account/endpoint rejects the beta, retry without it.
async function create(apiKey, params) {
  const c = client(apiKey);
  let res;
  try {
    res = await c.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      console.warn("retrying without fallback beta:", err.message);
      res = await c.beta.messages.create(params);
    } else throw err;
  }
  meter(res);
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request");
  return res;
}

function textOf(res) {
  return res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

export async function testKey(apiKey) {
  const res = await create(apiKey, {
    model: MODEL, max_tokens: 64, output_config: { effort: "low" },
    messages: [{ role: "user", content: "Reply with OK." }],
  });
  return !!res.id;
}

// ---------- per-frame detection ----------

const num = { type: "number" }, str = { type: "string" };
const obj = (props) => ({ type: "object", additionalProperties: false, properties: props, required: Object.keys(props) });

const FRAME_SCHEMA = obj({
  room_type: str,
  floor: str,
  wall_color: str,
  wall_left_m: num, wall_center_m: num, wall_right_m: num,
  items: { type: "array", items: obj({
    name: str, category: str, brand: str, model: str, color_hex: str, description: str,
    x_center: num, bbox: obj({ x0: num, y0: num, x1: num, y1: num }),
    distance_m: num, width_m: num, depth_m: num, height_m: num, confidence: num,
  }) },
});

const FRAME_SYSTEM = `You catalog the contents of a home for an insurance-grade inventory. The user is standing roughly in the middle of a room in Israel, holding a phone camera, turning in a circle. You see one frame.

List every distinct physical item worth cataloging: furniture, electronics, appliances (including wall-mounted AC units), lighting, tools, 3D printers, bags, pillows/cushions, rugs, decor, storage (closets, shelves). Skip structural parts (doors, windows, outlets) and tiny clutter (pens, cables, papers).

For each item:
- name: specific and short ("27-inch monitor", "office chair", "3D printer", "2-seat sofa").
- brand / model: only if you can read a logo or the design is unmistakable; otherwise "".
- color_hex: dominant color as #rrggbb.
- x_center: horizontal center of the item in the frame, 0 = left edge, 1 = right edge.
- bbox: normalized 0-1 box around the item (x0,y0 top-left, x1,y1 bottom-right).
- distance_m: estimated horizontal distance from the camera to the item's center, in meters.
- width_m / depth_m / height_m: real-world size estimate in meters.
- confidence: 0-1.

Also estimate the horizontal distance in meters from the camera to the wall (where it meets the floor) at the left edge, center, and right edge of the frame. Use -1 when a wall isn't visible there. Use typical room sizes as a sanity check: a small home office is about 2.5-3.5 m across. Describe the floor type and wall color briefly.`;

export async function analyzeFrame(apiKey, b64jpeg) {
  if (MOCK) return mockFrame();
  const res = await create(apiKey, {
    model: MODEL, max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: FRAME_SCHEMA } },
    system: FRAME_SYSTEM,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64jpeg } },
      { type: "text", text: "Catalog this frame." },
    ] }],
  });
  return JSON.parse(textOf(res));
}

// ---------- consolidation (dedupe across frames + Israeli price estimate) ----------

const ROOM_SCHEMA = obj({
  floor: str, wall_color: str,
  items: { type: "array", items: obj({
    source_id: str, name: str, brand: str, model: str, category: str, color_hex: str, description: str,
    x: num, z: num, width_m: num, depth_m: num, height_m: num,
    est_price_ils: num, price_low_ils: num, price_high_ils: num, likely_store: str, confidence: num,
  }) },
});

const ROOM_SYSTEM = `You turn raw per-frame detections from a 360° room scan into one clean inventory for a home in Israel.

The same physical object is usually detected in 2-3 neighbouring frames under slightly different names and positions. Merge those into one item. Keep genuinely separate objects separate (two identical chairs at different spots = two items). Drop low-confidence junk and structural parts.

Coordinates: the scanner stood at (0,0). x = meters to the right, z = meters toward the back (negative z is the direction the user faced at the start). Keep each item's merged position inside the given room bounds.

For each item:
- source_id: the id of the single best detection to use as the photo (largest, clearest view).
- name, brand, model, category, color_hex, description: best merged values. Keep brand/model "" if unknown.
- est_price_ils: realistic current replacement price in Israel in shekels incl. VAT, for this kind of product at the quality level shown. price_low_ils / price_high_ils give the plausible range.
- likely_store: the Israeli retailer this would most likely be bought from, e.g. IKEA Israel, ACE, Home Center, KSP, Ivory, Bug, Zap, Golf & Co, Fox Home, Hamashbir, Shufersal Online, AliExpress, Amazon (shipped to Israel), or the brand's Israeli importer.`;

export async function consolidateRoom(apiKey, { roomName, bounds, detections, floor, wallColor }) {
  if (MOCK) return mockRoom(detections);
  const res = await create(apiKey, {
    model: MODEL, max_tokens: 32000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: ROOM_SCHEMA } },
    system: ROOM_SYSTEM,
    messages: [{ role: "user", content:
      `Room: ${roomName}\nRoom bounds (m): ${JSON.stringify(bounds)}\nFloor notes: ${floor}\nWall color notes: ${wallColor}\n\nDetections:\n${JSON.stringify(detections)}` }],
  });
  return JSON.parse(textOf(res));
}

// ---------- mock mode (?mock) for UI testing without a key ----------

const MOCK_SETS = [
  [["Desk", "furniture", "#c8a27a", .5, 1.4, 1.4, .7, .75], ["27-inch monitor", "electronics", "#222222", .5, 1.3, .62, .2, .45]],
  [["Mechanical keyboard", "electronics", "#333333", .45, 1.25, .44, .14, .04], ["Laptop", "electronics", "#9aa0a6", .7, 1.3, .32, .22, .02]],
  [["AC unit", "appliance", "#f2f2f2", .5, 1.6, .9, .25, .3]],
  [["Closet", "furniture", "#e9e4dc", .5, 1.3, 1.0, .58, 2.1]],
  [["2-seat sofa", "furniture", "#5b6b7a", .5, 1.5, 1.6, .85, .8], ["Throw pillow", "textile", "#d9a441", .35, 1.45, .45, .15, .45]],
  [["Office chair", "furniture", "#1d1d1d", .5, .9, .65, .65, 1.1]],
  [["3D printer", "electronics", "#3a3a3a", .5, 1.4, .4, .4, .48]],
  [["Backpack", "bag", "#2d3e50", .5, 1.2, .3, .2, .45]],
];
let mockI = 0;
async function mockFrame() {
  meter({ usage: { input_tokens: 1500, output_tokens: 900 } }); // typical real frame
  await new Promise(r => setTimeout(r, 600 + Math.random() * 900));
  const set = MOCK_SETS[mockI++ % MOCK_SETS.length];
  return {
    room_type: "home office", floor: "light porcelain tiles", wall_color: "off-white",
    wall_left_m: 1.6, wall_center_m: 1.5 + Math.random() * .3, wall_right_m: 1.6,
    items: set.map(([name, category, color_hex, x, d, w, dp, h]) => ({
      name, category, brand: "", model: "", color_hex, description: name, x_center: x,
      bbox: { x0: Math.max(0, x - .2), y0: .3, x1: Math.min(1, x + .2), y1: .8 },
      distance_m: d, width_m: w, depth_m: dp, height_m: h, confidence: .9 })),
  };
}
async function mockRoom(detections) {
  meter({ usage: { input_tokens: 5000, output_tokens: 4000 } });
  await new Promise(r => setTimeout(r, 800));
  const prices = { Desk: 890, "27-inch monitor": 1190, "Mechanical keyboard": 349, Laptop: 4200, "AC unit": 2900,
    Closet: 1450, "2-seat sofa": 2600, "Throw pillow": 79, "Office chair": 990, "3D printer": 2400, Backpack: 299 };
  const seen = new Set();
  return { floor: "light porcelain tiles", wall_color: "off-white", items: detections.filter(d => !seen.has(d.name) && seen.add(d.name)).map(d => ({
    source_id: d.id, name: d.name, brand: "", model: "", category: d.category, color_hex: d.color_hex, description: d.description,
    x: d.x, z: d.z, width_m: d.width_m, depth_m: d.depth_m, height_m: d.height_m,
    est_price_ils: prices[d.name] || 200, price_low_ils: (prices[d.name] || 200) * .8, price_high_ils: (prices[d.name] || 200) * 1.3,
    likely_store: "IKEA Israel", confidence: .9 })) };
}
