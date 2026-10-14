# HomeMap — feature checklist (kill-test prototype)

- [ ] Settings: save + test Anthropic key (stored on-device only)
- [ ] Scan: camera opens, compass permission asked (iOS), auto-capture every 30° when held steady
- [ ] Scan: live mini map fills sectors, draws room outline + item dots; "+ item" chips pop in
- [ ] Scan: no compass → shutter captures sectors in order
- [ ] Scan auto-finishes when all 12 sectors are captured and identified; Finish works early (≥4)
- [ ] Upload mode: pick photos → same pipeline
- [ ] Consolidation merges duplicate sightings into one catalog with ₪ estimate + likely Israeli store
- [ ] Background web price check updates prices (verified / similar tags)
- [ ] 3D view: walls from scan, items as sized labelled blocks, orbit/pinch, tap → item card
- [ ] Item card: name/price/store editable, delete
- [ ] Catalog: per-room chips + All, sorted by price, room totals
- [ ] Rescan of a room with the same name replaces it
- [ ] `?mock` runs the whole flow with fake detections (no key, no cost)
- [ ] Works at 390px width
