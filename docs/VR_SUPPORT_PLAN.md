# VR Support Plan (parmanu-viz)

Implementation plan for **immersive WebXR viewing on Meta Quest 3** (and other WebXR-capable browsers), with **VR controller navigation** and **GPU-accelerated rendering**.

**Status:** Not implemented (desktop v1 is complete).  
**Reference (read-only, proven on Quest):** `~/repos/mmdetection3d/tools/analysis_tools/assets/sit_viz_logic.js`, `sit_viz_template.html`, `sit_editor_logic.js` (editor has simpler VR — viz logic is the primary port source).

**Related:** [PARMANU_VIZ_PLAN.md](./PARMANU_VIZ_PLAN.md) (v2+ VR deferred), [SIT_DATASET_PLAN.md](./SIT_DATASET_PLAN.md) (dataset contracts unchanged in VR).

**Production URL:** [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/)

### Release sequencing (Three.js)

| Phase | Scope | Three.js |
|-------|--------|----------|
| **1 — This plan (ship first)** | WebXR VR on Quest + GHP file-picker flow | Stay on **r134** (`assets/three.min.js`); UMD `VRButton` + `js/vr.js` |
| **2 — Separate project / PR (later)** | Upgrade `three`, `OrbitControls`, `PCDLoader` to latest stable (npm **0.184.x** as of 2026-05) | Full desktop + SiT regression; optional ES modules / controller GLTF addons |

**Decision:** Do **not** block VR on a Three.js upgrade. VR and dependency modernization are **two releases**, not one.

---

## Primary user flow (confirmed)

This is the **only** end-user workflow we implement and document in README:

1. On a PC, copy the required frame files (KITTI or SiT) into a folder.
2. Transfer that folder to the Quest (USB → `Internal storage/Download/parmanu/`, or `adb push`).
3. On the headset, open **Quest Browser** → [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/).
4. Use the existing file inputs to select the copied files from headset storage.
5. Tap **Visualize**, then tap **Enter VR** (Three.js `VRButton` — see below).
6. Navigate with Touch controllers.

No LAN fetch of dataset bytes from the GitHub Pages origin. No “sync over Wi‑Fi” inside the app — Wi‑Fi/USB is only for getting files onto the headset filesystem before step 4.

Developer paths (local `python -m http.server`, TLS LAN) remain optional for testing unreleased builds.

---

## Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | Immersive stereo view in VR-enabled browsers | `immersive-vr` session starts; headset shows point cloud + boxes at stable framerate |
| G2 | Meta Quest 3 primary target | Tested on Quest 3 + **Quest Browser**; documented setup steps |
| G3 | Navigate with VR controllers | Thumbstick walk/strafe, trigger teleport, grip height/panels per spec below |
| G4 | GPU acceleration used where available | WebGL renderer + XR foveation + VR-specific pixel ratio cap; no CPU fallback for rendering |
| G5 | Same datasets as desktop | KITTI (`.bin` + labels + calib) and SiT (`.pcd` + optional labels/ego) via existing loaders |
| G6 | Zero npm / zero build | UMD scripts in `assets/`, same as v1 |
| G7 | README section for non-developers | Copy-paste Quest workflow (GitHub Pages + local files) |

## Non-goals (this phase)

- **Three.js upgrade** to latest stable (e.g. 0.184.x) — tracked as a **follow-up project** after VR ships (§Release sequencing).
- Annotation editing in VR (editor reference is view-only patterns only).
- FlyControls / desktop FPS mode (reference has them; **not required** for VR MVP).
- Fetching dataset bytes from a LAN URL while the page is hosted on `github.io` (CORS blocks this — see §Deployment).
- Standalone HTML export with embedded frames (separate future `exporter.js` work).
- Photorealistic controller/hand meshes (`XRControllerModelFactory`, `XRHandModelFactory` — ES-module-only on r134; deferred; see §WebXR addon strategy).
- Hand tracking as a requirement (optional later phase if controller models are added).
- AR / `immersive-ar` sessions.
- Multi-frame browsing inside VR (desktop file panel only; one loaded scene per session).

---

## Hard requirements (no assumptions)

### WebXR

| Requirement | Detail |
|-------------|--------|
| Secure context | Page **must** be served over **HTTPS** or `http://localhost` / `http://127.0.0.1`. `file://` **does not** support WebXR — update `index.html` subtitle when VR ships. |
| Session mode | `'immersive-vr'` only. |
| Reference space | `renderer.xr.setReferenceSpaceType('local-floor')` before first session. |
| Optional session features | `['local-floor', 'bounded-floor', 'hand-tracking', 'layers']` in `requestSession` init (same as reference). |
| Entry UI | `THREE.VRButton.createButton(renderer)` appended to `document.body` — **one button only** (see §Enter VR UI). |
| Animation loop | Replace `requestAnimationFrame` desktop loop with `renderer.setAnimationLoop(animate)` once VR is integrated (required for XR frame loop). |

### Enter VR UI — `VRButton` vs “debug Enter VR”

**Ship:** Three.js **`VRButton`** (`THREE.VRButton.createButton(renderer)`). This is the standard control: it checks WebXR support, shows “ENTER VR” / “EXIT VR”, and calls `navigator.xr.requestSession` through the renderer. Users tap this after **Visualize**.

**Do not ship:** The extra **debug “Enter VR”** button from `sit_viz_logic.js` (lines ~91–132). That was a second, hand-built `<button>` that:

- Calls `navigator.xr.requestSession('immersive-vr', …)` directly,
- Writes detailed errors into an on-page `#xr-status` div when the session fails (HTTPS, flags, permissions),
- Duplicates what `VRButton` already does for happy path.

It was useful while debugging Quest Browser during the MMDet3D MVP; it is redundant for parmanu-viz. Diagnostics belong in the non-blocking `#xr-status` line in `#hud`, not a second entry button.

### Three.js version lock

| Item | Value |
|------|--------|
| Bundled core | `assets/three.min.js` — **r134** (`REVISION === '134'`) |
| Desktop addons | `OrbitControls.js`, `PCDLoader.js` — legacy UMD from r134 `examples/js/` (unchanged) |
| VR addon | **One** new file: `assets/VRButton.js` (see §WebXR addon strategy) |

### WebXR addon strategy (r134 — mandatory)

**Problem:** The plan must **not** reference `examples/js/webxr/` on tag **r134** — that directory **does not exist**. WebXR helpers live only under **`examples/jsm/webxr/`** as ES modules (`import` / `export`). `XRControllerModelFactory.js` further depends on `GLTFLoader` (jsm) and `examples/jsm/libs/motion-controllers.module.js`, which conflicts with the zero-build, all-UMD stack.

**Chosen approach (Option A — minimal UMD):**

| Ship | Do not ship (v1) |
|------|------------------|
| `assets/VRButton.js` — UMD wrap of r134 `VRButton` | `XRControllerModelFactory.js` |
| Controller **ray lines** + gamepad logic in `js/vr.js` (from reference `addXRController`) | `XRHandModelFactory.js` / hand meshes |
| No `importmap`, no extra Three version bump | Full ES-module VR addon tree |

**Rejected alternatives:**

| Option | Why rejected |
|--------|----------------|
| **B — ES module block for VR** (`importmap` + `jsm/webxr/*`) | Breaks “plain `<script>` only” convention; mixed loader story on GHP |
| **C — Bump Three.js now (r170+ / 0.184.x)** | **Deferred to phase 2** — large migration; must not delay VR. For VR-only work, stay on r134 |

#### `assets/VRButton.js` — exact port steps

1. **Source (read-only):** [three.js r134 `examples/jsm/webxr/VRButton.js`](https://github.com/mrdoob/three.js/blob/r134/examples/jsm/webxr/VRButton.js) (~3.6 KB, **no** `import` from `three` — self-contained `class VRButton`).
2. **Wrap** in the same IIFE pattern as `assets/OrbitControls.js`:

```javascript
( function () {
  class VRButton { /* paste class body from jsm; drop export */ }
  THREE.VRButton = VRButton;
} )();
```

3. **Do not** change session logic: keep `optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']` and `immersive-vr` as in upstream.
4. **Verify after copy:** in browser console, `typeof THREE.VRButton.createButton === 'function'`.
5. **License:** preserve Three.js MIT header comment at top of `assets/VRButton.js`.

#### Controller visuals (no factory)

Reference attaches `XRControllerModelFactory` for cosmetic meshes; **locomotion and teleport use ray lines only**. v1 implements:

- `renderer.xr.getController(0|1)` + white `Line` along −Z (length 20 m)
- `getControllerGrip` **not** required for MVP (skip grip mesh factory)
- Gamepad axes/buttons on `controller.userData` (ported from reference)

Optional **v2+:** add UMD ports of `GLTFLoader` + `motion-controllers` + `XRControllerModelFactory` if users want Meta controller models (estimate +3 files, profile assets).

#### `index.html` scripts (VR)

Only **one** new script before `js/vr.js`:

```html
<script src="assets/VRButton.js"></script>
```

### Coordinate systems

| Mode | Up axis | Content parent | Camera |
|------|---------|----------------|--------|
| Desktop | Z-up (LiDAR) | `_contentGroup.rotation.x = 0` | Child of `_xrRig`; `camera.up.set(0,0,1)`; OrbitControls active |
| VR | Y-up (WebXR) | `_contentGroup.rotation.x = -Math.PI / 2` on `sessionstart` | Head tracking via XR; rig locomotion moves `_xrRig` |

All point clouds and box line segments stay in **Velodyne/LiDAR coordinates** inside `_contentGroup`; only the parent group rotates for VR.

### Scene graph (mandatory structure)

After refactor, `js/viewer.js` (and new `js/vr.js`) must use this graph:

```text
_scene                          // background, fog optional
├── _contentGroup               // Z-up LiDAR data (points, boxGroup, lights, axes)
├── _xrGround                   // invisible plane for teleport raycasts (Y-up when rotated)
├── _teleportMarker             // ring mesh, VR only
├── _gridHelper                 // GridHelper, VR only
├── _originMarker / _originLabel // optional sensor marker at (0,0,0) in content space
└── _xrRig                       // locomotion root
    ├── _camera                  // PerspectiveCamera — always child of rig
    ├── _xrController0, _xrController1   // ray lines only (no ControllerGrip / GLTF v1)
    ├── _controlsPanel           // canvas-texture help plane (VR)
    └── _vrLegendPanel           // canvas-texture legend (VR)
```

**Port rule:** Move `this._points`, `this._boxGroup`, lights, and axes from `this._scene` to `this._contentGroup`. Add `this._scene.add(this._contentGroup)` in `init()`.

**Initial rig pose on `sessionstart`:** `xrRig.position.set(0, -1.6, 3)` — places user eyes at LiDAR origin height with floor reference (matches reference: origin at eye level, floor 1.6 m below).

---

## VR controller navigation (exact behavior)

Port from `sit_viz_logic.js` (`updateXrLocomotion`, `addXRController`, `intersectGround`). Numbers are **normative** unless Quest profiling forces a single constant tweak (document in PR).

### Controller assignment

| Hand | Primary role | Fallback if `handedness` missing |
|------|--------------|----------------------------------|
| Left | Locomotion + height | `xrController0` |
| Right | Yaw/pitch adjustment + toggle help | `xrController1` |

Read `gamepad` from `controller.userData.gamepad`, refreshed on `connected` / `disconnected` XR events.

### Thumbstick axes (Quest Touch)

```javascript
const x = gamepad.axes[2] ?? gamepad.axes[0] ?? 0;
const y = gamepad.axes[3] ?? gamepad.axes[1] ?? 0;
const deadzone = 0.15;
```

### Left stick — locomotion

| Input | Action |
|-------|--------|
| Stick deflection (grip **not** pressed) | Walk/strafe on XZ plane at **2.0 m/s** × `delta` |
| Stick Y while **grip pressed** | Adjust `_xrRig.position.y` at **1.0 m/s** × `delta` |
| Forward direction | `camera.getWorldDirection`, then `dir.y = 0`, normalize |
| Strafe | `right = (-dir.z, 0, dir.x)` |
| Stick mapping | `xrRig += dir * (-ay) * speed * delta`; `xrRig += right * ax * speed * delta` |

### Right stick — look

| Input | Action |
|-------|--------|
| Stick X | Rig yaw: `_xrRig.rotateY(-ax * 2.0 * delta)` |
| Stick Y | Camera pitch: `camera.rotateOnAxis(X, ay * 2.0 * delta)` clamped to ±80° (`0.44 * π`) |

Head tracking still applies; stick adds seated/standing adjustment.

### Trigger — teleport

| Event | Action |
|-------|--------|
| `selectstart` | Set `controller.userData.isSelecting = true` |
| While selecting | Raycast from controller −Z; show `_teleportMarker` at hit |
| `selectend` | Move `_xrRig.position.x/z` to hit point; keep `y`; hide marker |

Ground mesh: `PlaneGeometry(2000,2000)`, invisible material, `rotation.x = -π/2`, `position.y = -1.6` in **root scene** (not inside `_contentGroup`).

### Grip — UI

| Controller | Action |
|------------|--------|
| Right only | `squeezestart` toggles visibility of `_controlsPanel` and `_vrLegendPanel` |
| Left | Reserved for height mode (grip + stick), no toggle |

### In-VR help panel content (canvas texture)

Fixed strings (same meaning as reference):

1. Trigger: point at ground → Teleport  
2. Left stick: Walk / Strafe  
3. Left grip + stick up/down: Height adjust  
4. Right stick: Look (yaw / pitch)  
5. Right grip: Toggle help panels  

Show controller floating labels for **8 seconds** after `sessionstart`, then hide.

### Desktop while VR module loaded

| State | OrbitControls | Keyboard (R/O/V) |
|-------|---------------|------------------|
| Not presenting | Enabled | Unchanged |
| `renderer.xr.isPresenting` | Disabled | Ignored |

---

## GPU acceleration & performance

### Renderer settings (apply in `viewer.init`)

```javascript
this._renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
this._renderer.xr.enabled = true;
this._renderer.xr.setReferenceSpaceType('local-floor');
if (this._renderer.xr.setFoveation) {
  this._renderer.xr.setFoveation(1.0);
}
```

| Setting | Desktop | VR presenting |
|---------|---------|---------------|
| `setPixelRatio` | `Math.min(devicePixelRatio, 2)` | `1` (fixed — Quest fill-rate limit) |
| Point `size` | `0.08` | `0.06` (tunable single constant `VR_POINT_SIZE`) |
| `antialias` | `true` | keep `true`; if frame time > 20 ms sustained, try `false` in VR only |

### Point budget (automatic subsampling)

Apply **only when entering VR** if point count exceeds threshold (keeps desktop full resolution).

| Dataset | Typical points | VR max without decimation | Decimation |
|---------|----------------|---------------------------|------------|
| KITTI | ~120k | 80,000 | Uniform stride: keep every `ceil(n/80000)`-th point |
| SiT concat | ~49k | 80,000 | No decimation |

Implementation:

```javascript
function decimatePositions(positions, colors, maxPoints) {
  const n = positions.length / 3;
  if (n <= maxPoints) return { positions, colors };
  const stride = Math.ceil(n / maxPoints);
  // copy indices 0, stride, 2*stride, ... into new Float32Arrays
}
```

Run on cloned geometry before building VR `BufferGeometry`; desktop `loadScene` unchanged.

### Dispose / memory

On `loadScene`, dispose previous VR clones if any. On `sessionend`, do not dispose desktop geometry.

### Performance targets (Quest 3)

| Metric | Target |
|--------|--------|
| Frame time | ≤ 14 ms average (72 Hz) after load stabilizes |
| Time to enter VR after scene loaded | < 2 s |
| Load frame (desktop path, KITTI) | Unchanged from v1 (< 2 s on desktop) |

---

## Deployment & data paths

| Path | Who | Role |
|------|-----|------|
| **B** | End users | **Primary** — GHP + files on headset |
| A | Developers | Local HTTP server for unreleased JS |
| C | Advanced | TLS LAN (optional) |
| D | All | How to copy files onto Quest storage |

### A — Local dev / full LAN app (developers only)

| Step | Command / action |
|------|------------------|
| 1 | On PC: `cd /path/to/parmanu-viz && python -m http.server 8000 --bind 0.0.0.0` |
| 2 | Find PC LAN IP: `hostname -I` (Linux) or `ipconfig` (Windows) |
| 3 | Quest Browser → `http://<PC_IP>:8000/` |
| 4 | Pick dataset files via Quest file picker (or files pushed to headset — see D) |
| 5 | Visualize → **Enter VR** |

WebXR works on `http://` private network addresses in Quest Browser when not `file://`. Prefer HTTPS for production.

### B — GitHub Pages + dataset files on headset (**primary end-user flow**)

| Step | Action |
|------|--------|
| 1 | Open **Quest Browser** → [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/) |
| 2 | Transfer dataset files to Quest storage (§D) — done before or after step 1 |
| 3 | Use normal file inputs → pick files from `Download/parmanu/` (or wherever copied) |
| 4 | **Visualize** → **Enter VR** (`VRButton`) |

**Critical:** The page on `github.io` reads files via `<input type="file">` and `FileReader` only. **Do not** implement `fetch('http://192.168.x.x/...')` from GHP origin — browser CORS will block it.

### C — GitHub Pages + PC on same Wi‑Fi (hybrid, optional helper script)

For teams that want the **latest unreleased JS** from PC but **HTTPS** for XR:

| Step | Action |
|------|--------|
| 1 | Serve repo with **TLS** local static server (e.g. `mkcert` + `npx serve` or Caddy) on `https://<PC_IP>:8443` |
| 2 | Quest opens that URL (accept certificate warning once) |
| 3 | Files from Quest storage or from PC via file picker |

Document as “Advanced” in README — not the default path.

### D — Transfer dataset files to Quest (Wi‑Fi / USB)

| Method | Steps |
|--------|--------|
| **USB** | Connect Quest → copy into `Internal storage/Download/parmanu/` (user-created folder) |
| **ADB** | `adb push 000001.bin /sdcard/Download/parmanu/` (repeat for label + calib) |
| **Wi‑Fi** | No native “push to Quest” from parmanu; use Meta Quest app file sharing, SideQuest, or SMB tools the user already has — README lists ADB/USB only as supported |

SiT: push `.pcd` (+ optional `.txt` ego/label) into the same folder.

**Quest file picker:** In Browser, `<input type="file">` opens Android file picker → `Download/parmanu/...`.

---

## File changes (complete list)

### New files

| File | Purpose |
|------|---------|
| `assets/VRButton.js` | UMD wrap of r134 `examples/jsm/webxr/VRButton.js` → `THREE.VRButton` (§WebXR addon strategy) |
| `js/vr.js` | XR session lifecycle, controller rays, locomotion, VR UI panels, `window.parmanuVr` API |

### Modified files

| File | Changes |
|------|---------|
| `index.html` | Script tags for VR addons + `js/vr.js` after `viewer.js`; add `#xr-status` in `#hud`; add class hook to hide `#file-panel` in VR via CSS |
| `js/viewer.js` | Scene graph refactor; `xr.enabled`; `setAnimationLoop`; expose `getRenderer`, `getCamera`, `getContentGroup`, `getScene`, `getSceneMaxDim`, `getLegendEntries()` for VR legend texture |
| `js/app.js` | `parmanuVr.init` after `viewer.init`; `setSceneReady` + `updateLegendPanel` on load; subsampling suffix in `#status` |
| `assets/styles.css` | `.vr-presenting #file-panel { display: none; }`; style `VRButton` bottom offset so not hidden by `#hud` |
| `README.md` | New § **Viewing in VR (Meta Quest 3)** — full text in §README section below |

### Unchanged contracts

| Module | Note |
|--------|------|
| `js/datasets/kitti.js`, `sit.js` | No VR-specific code |
| `js/explorer.js` | File pickers work on Quest Browser |
| `loadScene` return | Still `{ points: Float32Array (n×4), boxes: [...] }` |

---

## `index.html` script order (after implementation)

```html
<script src="assets/three.min.js"></script>
<script src="assets/OrbitControls.js"></script>
<script src="assets/PCDLoader.js"></script>
<script src="assets/VRButton.js"></script>
<script src="js/viewer.js"></script>
<script src="js/vr.js"></script>
<!-- datasets, explorer, app -->
```

---

## `js/vr.js` public API

```javascript
// js/vr.js — attaches window.parmanuVr
window.parmanuVr = {
  init: function (viewer) {},              // XR rig, controllers, VRButton, session listeners
  setSceneReady: function (ready) {},      // enable/disable VRButton (Q6)
  updateLegendPanel: function (entries) {}, // [{ type, hex, count }]
  updateFrame: function (delta) {},         // locomotion + teleport marker when presenting
  dispose: function () {},
};
```

`app.js` after successful `loadScene`:

```javascript
window.parmanuVr.updateLegendPanel(/* from scene.boxes */);
```

---

## WebXR diagnostics UI

Add to `#hud` (desktop only):

```html
<div id="xr-status"><strong>WebXR:</strong> checking…</div>
```

`vr.js` implements `updateXRStatus()`:

1. If `!('xr' in navigator)` → show “not available”  
2. Else `navigator.xr.isSessionSupported('immersive-vr')` → show YES/NO  
3. On NO: list fixes (HTTPS, Quest Browser, `chrome://flags` WebXR on Quest)

Do **not** ship a blocking full-screen modal on every load (reference does — reduce to non-blocking `#xr-status` line only).

---

## README section (copy into README.md on implementation)

Insert after **Usage** / before **Architecture**:

```markdown
## Viewing in VR (Meta Quest 3)

parmanu-viz supports **immersive WebXR** in the Quest Browser (and other WebXR browsers). You view the same point cloud and 3D boxes as on desktop, and move with the Touch controllers.

### Quick start (GitHub Pages + files on the headset)

1. On your PC, copy one frame’s files into a folder, e.g. `parmanu/`:
   - **KITTI:** `000001.bin`, `000001.txt` (label_2), `000001.txt` (calib)
   - **SiT:** `{frame}.pcd` and optional label/ego `.txt` files
2. Transfer that folder to the headset (USB cable → **Internal storage/Download/parmanu/**, or `adb push` — see below).
3. Put on the headset and open **Quest Browser**.
4. Go to the live app: [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/)
5. Choose the dataset, tap each file input, and pick files from **Download/parmanu/**.
6. Tap **Visualize**, then tap **Enter VR** (bottom of the view).
7. Use the controllers:
   - **Left stick:** walk and strafe
   - **Left grip + stick up/down:** change height
   - **Right stick:** turn and look up/down
   - **Trigger (point at floor):** teleport
   - **Right grip:** show/hide help and legend panels

### If “Enter VR” does not appear

- Use **Quest Browser** (not a non-XR browser).
- The site must be **HTTPS** (GitHub Pages is fine; `file://` will not work).
- In Quest Browser, open `chrome://flags` and ensure **WebXR** is enabled.
- Reload the page after enabling flags.

### Developer option: PC and headset on the same Wi‑Fi

Serve the repo from your computer so the headset loads the app over the LAN:

```bash
cd parmanu-viz
python -m http.server 8000 --bind 0.0.0.0
```

On the Quest, open `http://<your-pc-ip>:8000/` (replace with your computer’s LAN address). Then pick files and use **Enter VR** as above.

### Copy files with ADB (optional)

```bash
adb push 000001.bin /sdcard/Download/parmanu/
adb push 000001.txt /sdcard/Download/parmanu/   # repeat for label and calib files
```

### Comfort

- Teleport reduces motion sickness compared to stick-only movement; use trigger on the floor when possible.
- Stand or sit with space to move your arms.
- Large KITTI frames may use automatic point subsampling in VR to keep framerate smooth.
```

---

## Implementation phases & acceptance criteria

### Phase VR-1 — Assets & renderer XR flag

| Task | Done when |
|------|-----------|
| Add `assets/VRButton.js` (UMD port from r134 **jsm**, §WebXR addon strategy) | `THREE.VRButton.createButton` works in console |
| **Do not** add `XRControllerModelFactory` / `XRHandModelFactory` in v1 | Only `VRButton.js` + `vr.js` controller rays |
| Enable `renderer.xr` in `viewer.init` | `renderer.xr.enabled === true` |
| Wire `VRButton` in `vr.js`; disabled until `loadScene` succeeds | T8: no scene → button disabled or inert |
| Smoke test | Button visible on `http://localhost`; “VR NOT SUPPORTED” on insecure `file://` |

### Phase VR-2 — Scene graph & session lifecycle

| Task | Done when |
|------|-----------|
| Refactor `viewer.js` to `_contentGroup` + `_xrRig` + camera parenting | Desktop orbit/z-up view unchanged vs v1 screenshots |
| `setAnimationLoop` replaces rAF loop | No double loops; resize still works |
| `sessionstart` / `sessionend` rotate content ±90° X | Entering/exiting VR does not crash; desktop restored |

### Phase VR-3 — `js/vr.js` controllers & locomotion

| Task | Done when |
|------|-----------|
| Port `addXRController`, teleport, `updateXrLocomotion` | Quest 3: walk, strafe, turn, teleport, height adjust all work |
| Disable OrbitControls while presenting | Head + sticks only in VR |

### Phase VR-4 — VR UI

| Task | Done when |
|------|-----------|
| Canvas help panel + VR legend from `scene.boxes` | Right grip toggles; legend colors match `TYPE_COLORS` |
| Hide `#file-panel` while presenting | Immersive view not occluded by HTML panel |

### Phase VR-5 — Performance

| Task | Done when |
|------|-----------|
| VR pixel ratio = 1, foveation on | GPU bound; no software renderer |
| Decimation > 80k points in VR | KITTI frame remains interactive on Quest 3 |
| Status shows “VR (subsampled N points)” when decimated | User informed |

### Phase VR-6 — Docs & QA

| Task | Done when |
|------|-----------|
| README VR section added | Matches § above |
| Manual test matrix (below) all pass | Sign-off |

---

## Manual test matrix

| # | Environment | Steps | Expected |
|---|-------------|-------|----------|
| T1 | Desktop Chrome `localhost` | Load KITTI frame → Enter VR (if headset connected) or WebXR emulator | Session starts or emulator shows stereo |
| T2 | Quest 3 + Quest Browser + GHP HTTPS | Load KITTI from Download → VR | Stereo cloud + boxes aligned |
| T3 | Quest 3 + LAN `http://PC:8000` | Same as T2 | Same |
| T4 | SiT `.pcd` only | VR | Points visible, no boxes |
| T5 | SiT with labels + ego | VR | Boxes aligned (same as desktop) |
| T6 | Exit VR | Session end | Desktop orbit works; z-up restored |
| T7 | Large KITTI | VR | Subsampling message; no sustained judder |
| T8 | No scene loaded | Enter VR button | Disabled or no-op with status message |

---

## Browser / device matrix

| Client | WebXR | File picker | Notes |
|--------|-------|-------------|-------|
| Quest 3 Browser | ✅ target | ✅ | Primary |
| Chrome desktop + cable link | ✅ | ✅ | Dev |
| Firefox desktop | ✅ | ✅ | Secondary |
| Safari iOS | Partial | ✅ | Not a target for this plan |
| `file://` | ❌ | Unreliable | Unsupported — document |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| r134 has no `examples/js/webxr` | Use §WebXR addon strategy: UMD `VRButton` only; rays in `vr.js` |
| r134 `VRButton` vs reference (r170 modules) | Port **jsm** `VRButton` body unchanged; behavior matches reference session init |
| Users expect Meta controller models | Document in README: rays only v1; models optional v2+ |
| Quest Browser file picker UX poor for 3 files | README: pre-stage files in one `Download/parmanu/` folder |
| KITTI 120k points drops frames | VR subsampling + `powerPreference: 'high-performance'` |
| User opens GHP and expects Wi‑Fi auto-load | README + plan explicitly forbid cross-origin fetch; file picker only |
| `outputColorSpace` (r170) vs r134 | **Do not** add r170-only APIs; r134 uses `outputEncoding` if needed — only if colors look wrong |

---

## Reference line mapping (for implementers)

| Reference (`sit_viz_logic.js`) | parmanu-viz target |
|--------------------------------|-------------------|
| `sceneContainer` | `viewer._contentGroup` |
| `xrRig` + camera child | `viewer._xrRig` + `viewer._camera` |
| `renderer.xr.*` | `viewer.js` init |
| `VRButton.createButton` | `vr.js` |
| `addXRController` / teleport / locomotion | `vr.js` |
| `createVRControlsPanel` / `createVRLegendPanel` | `vr.js` (legend data from `viewer.getLegendEntries()`) |
| `setAnimationLoop(animate)` | `viewer.js` |
| FlyControls / FPS | **Skip** |
| `XRControllerModelFactory` / `XRHandModelFactory` | **Skip v1** — ray lines only (§WebXR addon strategy) |
| `sit_editor_logic.js` VR | Simpler; use only if viz port blocked — editor lacks thumbstick locomotion |

---

## Implementation readiness

### Product / architecture decisions — **none blocking**

All choices needed to start coding are in **Resolved decisions** (Q1–Q7) and the sections above. No further user sign-off required before Phase VR-1.

### What is **not** uncertain (locked for implementers)

| Topic | Locked spec |
|-------|-------------|
| Three.js | r134; VR does not wait on 0.184.x upgrade |
| Addons | `VRButton.js` UMD only; rays in `vr.js` |
| User flow | GHP + headset file picker |
| Controllers | Reference thumbstick/teleport numbers |
| Performance | 80k cap, stride decimation, pixel ratio 1 in VR |

### Remaining items — **validation only** (not design decisions)

| Item | Type | When |
|------|------|------|
| Quest 3 framerate with KITTI @ 80k | Tune `VR_POINT_SIZE` / max points if needed | T7 on device |
| Box/point alignment after −90° X | Visual QA | T2, T5 on device |
| Quest Browser file picker for 3× KITTI files | UX (documented; no code fix in v1) | T2 |
| `immersive-vr` on GHP after Meta OS updates | Smoke test | T2 periodically |

---

## Concrete specs (previously implicit — now required)

### VR point geometry (dual mesh)

`loadScene` behavior:

1. **Desktop mesh** — unchanged: build `_points` from full `scene.points` in `_contentGroup`.
2. **VR mesh** — on each successful `loadScene`, dispose prior `_vrPoints` if any; build `_vrPoints` from the same data with `decimateForVr(scene.points)` (§Point budget); same material settings except `size = VR_POINT_SIZE` (0.06).
3. **Visibility** — `_points.visible = true`, `_vrPoints.visible = false` by default; on `sessionstart` swap: `_points.visible = false`, `_vrPoints.visible = true`; reverse on `sessionend`.
4. **Boxes** — single `_boxGroup` in `_contentGroup` (no decimation); shared desktop + VR.

`decimateForVr` input: `Float32Array` n×4 (xyz + intensity); output same layout; stride logic per §Point budget.

### `viewer.js` exports (required)

```javascript
getRenderer: function () { return this._renderer; },
getCamera: function () { return this._camera; },
getScene: function () { return this._scene; },
getContentGroup: function () { return this._contentGroup; },
getXrRig: function () { return this._xrRig; },
getSceneMaxDim: function () { return this._sceneMaxDim; },
hasScene: function () { /* existing */ },
getLegendEntries: function () {
  // From current _boxGroup children / last loadScene boxes cache
  // Return [{ type: string, hex: string, count: number }, ...]
},
```

`app.js` after `loadScene`: `window.parmanuVr.updateLegendPanel(viewer.getLegendEntries());`

### `parmanuVr` lifecycle

| Call | When |
|------|------|
| `parmanuVr.init(viewer)` | Once in `app.js` after `viewer.init(container)` |
| `parmanuVr.setSceneReady(true)` | After successful `loadScene`; enables VR DOM button |
| `parmanuVr.setSceneReady(false)` | On new load start or `viewer.dispose` |
| `parmanuVr.updateLegendPanel(entries)` | After each successful `loadScene` |

**VRButton disabled until scene ready:** store `const vrBtn = THREE.VRButton.createButton(renderer)`; when not ready: `vrBtn.disabled = true`, `vrBtn.style.opacity = '0.35'`, `vrBtn.style.pointerEvents = 'none'`; when ready: reverse. Do not remove button from DOM.

### DOM / CSS (VR presenting)

On `renderer.xr` `sessionstart`:

```javascript
document.body.classList.add('vr-presenting');
```

On `sessionend`: `document.body.classList.remove('vr-presenting');`

**`assets/styles.css` additions:**

```css
body.vr-presenting #file-panel,
body.vr-presenting #hud,
body.vr-presenting #status,
body.vr-presenting #legend {
  display: none !important;
}
/* VRButton from three sits at bottom; keep above safe area */
body.vr-presenting #VRButton {
  bottom: 24px;
}
```

HTML `#VRButton` id comes from upstream `VRButton.js`.

### `index.html` copy changes

| Element | New text |
|---------|----------|
| `.subtitle` | `Desktop: open via http://localhost or GitHub Pages. VR: Quest Browser + HTTPS only.` |
| `#hud` | Add `<div id="xr-status"><strong>WebXR:</strong> checking…</div>` after control hints |

### Subsampling status string

When decimation applied, append to `#status` after load (desktop and VR prep):

`… (VR: 80,012 → 40,006 points)` — use actual counts from `decimateForVr`.

### Animation loop ownership

Single loop in `viewer.js`:

```javascript
function animate() {
  var delta = clock.getDelta();
  if (renderer.xr.isPresenting) {
    window.parmanuVr.updateFrame(delta);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
```

Remove the existing `requestAnimationFrame` recursion. `parmanuVr.updateFrame` runs locomotion + teleport marker (ported from reference).

### Helper object placement

| Object | Parent |
|--------|--------|
| `_contentGroup`, `_points`, `_vrPoints`, `_boxGroup`, lights, `AxesHelper(3)` | `_contentGroup` |
| `_xrGround`, `_teleportMarker`, `_gridHelper` | `_scene` (world-locked for teleport in Y-up session) |
| `_originMarker`, `_originLabel` | `_contentGroup` (at 0,0,0; rotates with LiDAR data) |
| `_xrRig`, camera, controllers, VR panels | `_xrRig` → `_scene` |

### `app.js` guard

If `typeof window.parmanuVr === 'undefined'` (script order error), log once; desktop viewer still works without VR.

---

## Resolved decisions

| # | Decision |
|---|----------|
| Q1 | GitHub Pages URL: [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/) |
| Q2 | **No** debug “Enter VR” button — `VRButton` only; errors in `#xr-status` |
| Q3 | Axes: `AxesHelper(3)` in `_contentGroup`; origin marker scale pulse in VR only |
| Q4 | Primary flow: copy files to headset → GHP in Quest Browser → file picker → Visualize → VR |
| Q5 | **Addon strategy:** Option A — UMD `VRButton.js` only; controller/hand GLTF factories deferred |
| Q6 | Disable **Enter VR** until `loadScene` succeeds | Yes (T8) — `parmanuVr.setSceneReady` |
| Q7 | **Ship VR first** on r134; **Three.js → latest** is a separate later project (not in VR PR scope) | Yes |
| Q8 | Dual point mesh (full desktop + decimated `_vrPoints` for VR) | Yes |
| Q9 | Hide all HTML overlays in VR (`body.vr-presenting`) | Yes |
| Q10 | Single `setAnimationLoop`; `parmanuVr.updateFrame` when presenting | Yes |

### Follow-up project (after VR merge) — Three.js upgrade

Out of scope for the VR implementation PR. When started, treat as its own effort:

- Replace `assets/three.min.js`, `OrbitControls.js`, `PCDLoader.js` at the **same** revision (target: current npm stable, e.g. **0.184.0**).
- Re-test KITTI + SiT loaders, `viewer.js`, and VR on desktop + Quest.
- Optionally adopt `importmap` + official `three/addons` (align with MMDet reference) and add `XRControllerModelFactory` if desired.
- Document in a dedicated plan (e.g. `docs/THREE_UPGRADE_PLAN.md`) or issue — **do not** fold into VR PR.

---

## Changelog entry (on merge)

Add to README intro line: “**VR (WebXR):** Meta Quest 3 and immersive browsers — see [Viewing in VR](#viewing-in-vr-meta-quest-3).”

Update `docs/PARMANU_VIZ_PLAN.md` § “VR Support (v2+)” with link to this file instead of one-line deferral.
