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
| Drag | Pan |
| Scroll / pinch | Zoom around the cursor |
| Space | Pause / resume |
| 1 / 2 / 3 | 1× / 10× / 100× speed |
| F | Fit the world to the screen |
| ` | Toggle the debug overlay |

At 1×, one real second is one simulated hour.

## Layout

```
index.html          page and UI
css/style.css
src/config.js       shared constants (world size, tick length, speeds)
src/rng.js          seeded random numbers
src/camera.js       pan, zoom, fit
src/renderer.js     draws the world under the camera
src/render/soil.js  placeholder soil backdrop (replaced in Phase 1)
src/sim/worker.js   simulation loop and state
src/main.js         wiring, UI, frame loop
```
