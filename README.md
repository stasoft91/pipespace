## Orbital Pipes (Three.js)

Browser-based homage to the classic Windows 98 pipes screensaver. Multiple colored tubes grow through a cubic grid, bend smoothly, get stuck, shrink away, and respawn while a slow camera orbits the scene. A lightweight HUD (lil-gui) lets you live-tune simulation and rendering settings.

### Quick start

## Try it: https://stasoft91.github.io/pipespace/

```bash
npm install
npm run dev
# open the printed local URL
```

### Controls

- **Simulation**: grid size (resets), pipe cap, max length, growth interval, pause/resume, reset.
- **Pipes**: radius, smoothness (tubular segments), radial slices, color shift, material roughness/metalness.
- **Head lights**: enable/disable, intensity, range, light cap.
- **Room**: roughness, metalness, reflectivity, toggle inner grid lines.
- **Camera**: orbit speed and bob strength.

### Notes

- Runs in WebGL via Three.js + Vite + TypeScript.
- Grid occupancy prevents overlaps; pipes that get stuck enter a dying state and retract.
- Tube meshes are rebuilt when paths change, using Catmull–Rom curves for smooth bends and per-vertex color gradients for subtle hue shifts.


