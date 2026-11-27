# Mushroom Simulator

A living fungal network growing through a cross-section of forest soil. You shape the conditions (water, food, terrain) and watch the network explore, build supply highways, and reorganize itself around what it finds.

Plain JavaScript, no build step. The simulation runs in a Web Worker, separate from rendering.

## Run locally

Any static server works (modules and workers don't load from `file://`):

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `?seed=1234` to load a specific world.

## Controls

| Input | Action |
| --- | --- |
| Click the soil | Plant a spore (one per world for now) |
| Drag | Pan |
| Scroll / pinch | Zoom around the cursor |
| Space | Pause / resume |
| 1 / 2 / 3 | 1× / 10× / 100× speed |
| F | Fit the world to the screen |
| R | Resource view (moisture in blue, nutrients in amber) |
| ` | Toggle the debug overlay |

At 1×, one real second is one simulated hour. The Rain button starts an 8-hour shower (a test tool until weather arrives in Phase 4).

## Layout

```
index.html          page and UI
css/style.css
src/config.js       shared constants (world size, tick length, speeds)
src/rng.js          seeded random numbers
src/camera.js       pan, zoom, fit
src/renderer.js     draws the world under the camera
src/soilTypes.js    soil materials: water holding, drainage, growth resistance
src/noise.js        1D noise and polygon helpers
src/render/soil.js  bakes the static world (layers, rocks, litter, wood)
src/render/overlays.js  wet-soil darkening and the resource view
src/sim/world.js    procedural world generation
src/sim/environment.js  water, evaporation, rain, nutrient leaching
src/sim/network.js  the fungal network: growth, food scent, supply routes, thickening, die-back
src/render/network.js   draws cords by thickness, flow pulses and smoothly growing tips
src/sim/worker.js   simulation loop and state
src/main.js         wiring, UI, frame loop
```
