## Orbital Pipes (Three.js)

Browser-based homage to the classic Windows 98 pipes screensaver. Multiple colored tubes grow through a cubic grid, bend smoothly, get stuck, shrink away, and respawn while a slow camera orbits the scene. A lightweight HUD (lil-gui) lets you live-tune simulation and rendering settings.

### Quick start

## Try it: https://stasoft91.github.io/pipespace/

```bash
yarn
yarn dev
# open the printed local URL
```

### Timeline + Modulation

The bottom pane is a Peaks.js timeline used as an editor for time-based LFO modulation:

- **Load MP3**: loads audio for waveform + playhead (preview only; video render outputs *no audio*).
- **BPM**: sets global BPM used for snapping and optional BPM-synced LFO frequency.
- **Segments = LFOs**: add/move/resize/delete segments; segments may overlap/intersect.
- **Snap to bars**: segment start/end snap to 4/4 bars.
- **Zoom**: buttons + slider; mouse wheel scrolls.
- **LFO list/editor**: select an LFO in the list to edit target + wave + amount/offset/range + start/end.

Modulation time follows the audio playhead when audio is loaded (helpful for debugging animation).

### Project save/load

Use **Save Project** / **Load Project** in the timeline to persist:

- pre-start simulation + render + mirror + camera settings
- timeline BPM, song length (duration), MP3 file name (for reference), and all LFOs

Waveform data is not saved; loading a project without loading its MP3 still works (timeline list/editor + rendering work, preview is silent).

### Rendering video (no audio)

Click **Render Video** in the timeline to render using the current LFO timetable. Output contains *video only*; add audio later in your editor.

**Optional backend renderer (recommended for long renders)**

In another terminal:

```bash
yarn render:server
```

Then, in the app, click **Render Video**. The backend uses Puppeteer and saves output to `Rendered/` in the repo root (you’ll see progress logs in the render server console).

Environment variables for the render server:

- `RENDER_PORT` (default `3333`)
- `APP_URL` (default `http://localhost:5173/`)
- `NAV_TIMEOUT_MS` (default `300000`)

### Converting `.ivf` to `.mp4` (optional)

Some renders produce VP9 `.ivf`. You can convert with ffmpeg:

```bash
ffmpeg -i Rendered/your-file.ivf -c:v libx264 -pix_fmt yuv420p -r 60 Rendered/your-file.mp4
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


