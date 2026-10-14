# HomeMap — feature checklist (kill-test prototype)

- [ ] Settings: save + test Anthropic key (stored on-device only)
- [ ] Scan: camera opens, compass permission asked (iOS), auto-capture every 45° (8 shots, 1024px) when held steady
- [ ] Scan: live mini map fills sectors, draws room outline + item dots; "+ item" chips pop in
- [ ] Scan: no compass → shutter captures sectors in order
- [ ] Scan auto-finishes when all 8 sectors are captured and identified; Finish works early (≥4)
- [ ] Upload mode: pick photos → same pipeline
- [ ] Consolidation merges duplicate sightings into one catalog with ₪ estimate + likely Israeli store
- [ ] Item card: free price links (Zap, KSP via Google, Google Shopping IL) + Google Lens via share sheet
- [ ] Cost meter: live $ during scan, "scan cost" saved on each room
- [ ] 3D view: walls from scan, items as sized labelled blocks, orbit/pinch, tap → item card
- [ ] Item card: name/price/store editable, delete
- [ ] Catalog: per-room chips + All, sorted by price, room totals
- [ ] Rescan of a room with the same name replaces it
- [ ] Export scans → one JSON (rooms, items, photos, cost, raw detections/walls) via share sheet
- [ ] `?mock` runs the whole flow with fake detections (no key, no cost)
- [ ] Works at 390px width
