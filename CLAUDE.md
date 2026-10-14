# HomeMap

Kill-test prototype for the home-scan "digital twin" idea. Static site, no build step: index.html + app.js + ai.js (Claude) + view3d.js (three.js).

- Runs in the phone browser (Safari). NOT TestFlight/native — Ben explicitly wanted zero setup. Camera + compass need HTTPS.
- Claude is called browser-direct with the user's OWN key pasted in Settings (localStorage). Never put a key in code.
- Base iPhone 17 has no LiDAR; the map comes from compass heading + Claude's distance estimates, not AR.
- Israeli market: prices in ₪, Israeli retailers (zap/ksp/ivory/ikea.co.il...).
- `?mock` = fake detections for UI testing without a key.
