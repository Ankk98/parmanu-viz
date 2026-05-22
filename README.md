# parmanu-viz

[![GitHub](https://img.shields.io/badge/repo-Ankk98%2Fparmanu--viz-24292f?style=flat-square&logo=github)](https://github.com/Ankk98/parmanu-viz)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-r134-000000?style=flat-square&logo=three.js)](https://threejs.org/)
[![WebXR](https://img.shields.io/badge/WebXR-immersive--vr-5c4ee5?style=flat-square)](https://immersiveweb.dev/)
[![No build](https://img.shields.io/badge/build-none-555?style=flat-square)](index.html)

**Browser-based 3D LiDAR visualization** — load official dataset files from disk, view colored point clouds and 3D bounding boxes with zero install. Works offline after the first load; supports **immersive VR** on Meta Quest and other WebXR browsers.

**Live app:** [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/)

---

## Quick start

### PC (desktop)

1. Open the app:
   - **Online:** [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/)
   - **Local:** Just open index.html

2. Choose a **Dataset**.
3. Pick the frame files (see [Datasets](#datasets)).
4. Click **Visualize**.

Use mouse orbit / zoom / pan, or the panel buttons and keyboard shortcuts ([Normal (desktop)](#normal-desktop) controls).

### VR (Meta Quest and WebXR browsers)

VR needs **HTTPS** (GitHub Pages or `localhost`). `file://` will not enable WebXR.

1. On a PC, copy one frame’s files into a folder (e.g. `parmanu/`):
   - **KITTI:** `000001.bin`, `000001.txt` (label_2), `000001.txt` (calib)
   - **SiT:** `{frame}.pcd` and, if using labels, matching `label_3d` + `ego_trajectory` `.txt` files
2. Transfer the folder to the headset (USB → **Internal storage/Download/parmanu/**, or `adb push` below).
3. On the headset, open **Quest Browser** and go to [https://ankk98.github.io/parmanu-viz/](https://ankk98.github.io/parmanu-viz/).
4. Select the dataset, pick files from **Download/parmanu/**, tap **Visualize**, then **Enter VR**.
5. Move with controllers ([Immersive VR](#immersive-vr) controls).

**Same Wi‑Fi (developer):** serve from your PC and open `http://<your-pc-ip>:8000/` on the Quest:

```bash
python -m http.server 8000 --bind 0.0.0.0
```

**ADB (optional):**

```bash
adb push 000001.bin /sdcard/Download/parmanu/
adb push 000001.txt /sdcard/Download/parmanu/   # repeat for label and calib
```

**If “Enter VR” does not appear:** use Quest Browser (not a non-XR browser), ensure the URL is HTTPS, enable **WebXR** in `chrome://flags`, reload, and visualize a frame first (the button stays disabled until a scene is loaded).

---

## Viewing modes

### Normal (desktop)

Standard **z-up** orbit camera around the LiDAR frame. Intensity-colored points (when the dataset provides a fourth channel) and wireframe 3D boxes.

| Input | Action |
|--------|--------|
| Drag | Orbit |
| Scroll | Zoom |
| Right-drag | Pan |
| **O** | Sensor POV (orbit LiDAR origin) |
| **V** | Overview (orbit scene center) |
| **R** | Reset view |
| Panel | **Sensor POV**, **Overview**, **Reset view** buttons |

![KITTI — point cloud and 3D boxes (desktop)](screenshots/v1-kitti.png)

![SiT — concat LiDAR (desktop)](screenshots/v1-SiT.png)

### Immersive VR

**WebXR `immersive-vr`** in Quest Browser and other XR-capable browsers. Same point cloud and boxes as desktop, rendered in an **xr-standard** rig (y-up in-headset; content rotated for LiDAR alignment). Large clouds are **decimated to 80k points** in VR to keep framerate stable.

| Control | Action |
|---------|--------|
| **Left stick** | Walk forward/back and strafe (XZ, head-relative) |
| **Right stick X** | Turn (yaw) |
| **Right stick Y** | Fly up / down |
| **Trigger** (hold) | Aim teleport arc at the floor |
| **Trigger** (release) | Teleport to aimed point |
| **Grip** | Toggle in-world help and class legend panels |

Comfort tips: prefer **teleport** over stick-only movement; allow arm room; stand or sit as you prefer.

> **VR screenshot:** In-headset captures are welcome — add images under `screenshots/` (e.g. `vr-kitti.png`) via a pull request.

---

## Datasets

parmanu-viz reads **official raw files** via the browser file picker (`FileReader`). No Python preprocess step, no conversion to `.bin` for SiT.

| Dataset | Point cloud | Labels | Extra | Box pipeline |
|---------|-------------|--------|-------|----------------|
| **KITTI Object** | `velodyne/*.bin` (float32 ×4) | `label_2/*.txt` (required) | `calib/*.txt` (required) | KITTI devkit math + `Tr_velo_to_cam` |
| **SiT** | `velo/concat/data/*.pcd` (`binary_compressed`) | `label_3d/*.txt` (optional) | `ego_trajectory/*.txt` (required with labels unless skip ego) | Official SiT viz transform + LiDAR `box7` corners |

### KITTI Object

**Per frame** (same 6-digit id, e.g. `000001`):

| File | Typical path |
|------|----------------|
| Point cloud | `data_object_velodyne/training/velodyne/000001.bin` |
| Labels | `data_object_label_2/training/label_2/000001.txt` |
| Calibration | `data_object_calib/training/calib/000001.txt` |

**Notes:**

- Parses Velodyne `.bin` as `N×4` float32 (x, y, z, reflectance).
- Calibration must include `P2`, `R0_rect`, `Tr_velo_to_cam`.
- 3D boxes are projected to Velodyne using logic ported from the [KITTI object devkit](https://github.com/bostondiditeam/kitti) / [kitti_object_vis](https://github.com/kuixu/kitti_object_vis).
- Only objects that pass the loader’s 3D validity filter are drawn.

### SiT

**Per frame** under `{scene}/{sequence}/`:

| File | Typical path | Required |
|------|----------------|----------|
| Point cloud | `velo/concat/data/{frame}.pcd` | Yes |
| 3D labels | `label_3d/{frame}.txt` | No (points-only OK) |
| Ego pose | `ego_trajectory/{frame}.txt` | Yes **if** labels are loaded and “Skip ego” is unchecked |

**Notes:**

- Loads **`binary_compressed` PCD** via bundled `THREE.PCDLoader` (r134). PCD intensity is ignored in v1 (fourth channel set to `0`).
- `label_3d` lines are **world-frame**; with labels, pick the matching **ego trajectory** so boxes align with the cloud (same transform as [SiT-Dataset](https://github.com/SPALaboratory/SiT-Dataset) `visualize_3dbox_on_image.py`).
- **Skip ego transform:** checkbox applies raw xyz + yaw flip only (debug / comparison); default uses official viz math.
- Sequences **without** `label_3d` (e.g. `Lobby_1`, `Outdoor_Alley_1`, `Subway_Entrance_1`) work in **points-only** mode — select `.pcd` only.
- No KITTI-style rectified-camera pipeline; boxes are LiDAR `[x,y,z,l,w,h,yaw]` after ego transform.

---

## Architecture

Static site: plain HTML + classic `<script>` tags. **No npm, no bundler, no ES modules.**

**Scene graph (WebXR-ready):** `viewer.js` builds `_xrRig` → camera, and `_contentGroup` → point clouds (desktop + VR-decimated), box line segments, grid/origin helpers in VR. Desktop uses `OrbitControls`; VR disables orbit and drives `_xrRig` from `vr.js`.

**Data flow:** file pickers → `Loader.loadFrame()` → `{ points: Float32Array, boxes: [{ type, corners }] }` → `viewer.loadScene()`.

**Deployment:** GitHub Actions uploads the repo root to GitHub Pages (`.nojekyll` at root). See [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

### Technology stack

| Layer | Choice |
|-------|--------|
| UI | HTML + CSS (`assets/styles.css`) |
| Logic | Vanilla JavaScript (IIFE modules, globals) |
| 3D | Three.js **r134** (bundled in `assets/`) |
| Desktop camera | `OrbitControls` |
| SiT clouds | `PCDLoader` (`binary_compressed`) |
| VR | WebXR + `VRButton.js` + `js/vr.js` |
| Hosting | GitHub Pages (static) |

### Project files

| Path | Role |
|------|------|
| `index.html` | Shell: dataset selector, file panels, HUD, script order |
| `assets/styles.css` | Panel, HUD, VR presenting layout |
| `assets/three.min.js` | Three.js r134 |
| `assets/OrbitControls.js` | Desktop orbit / zoom / pan |
| `assets/PCDLoader.js` | SiT `.pcd` parsing |
| `assets/VRButton.js` | Enter / Exit VR control |
| `js/app.js` | Wiring: dataset UI, visualize, keyboard shortcuts |
| `js/viewer.js` | Scene graph, points, boxes, views, VR decimation |
| `js/vr.js` | WebXR session, locomotion, teleport, in-world panels |
| `js/explorer.js` | KITTI file-picker helper |
| `js/datasets/registry.js` | `DatasetRegistry` — register loaders without editing core app |
| `js/datasets/kitti.js` | KITTI parser, calib/box math, `registerKittiDataset` |
| `js/datasets/sit.js` | SiT PCD/label/ego, explorer, `registerSitDataset` |
| `screenshots/` | Desktop reference images |
| `docs/` | Design notes (`PARMANU_VIZ_PLAN.md`, `VR_SUPPORT_PLAN.md`, `SIT_DATASET_PLAN.md`) |
| `.github/workflows/deploy-pages.yml` | Pages deploy on `main` |

### Add another dataset

1. Add `js/datasets/<name>.js` with a `Loader` implementing `loadFrame()` → `{ points, boxes }`, plus `createExplorer` for file pickers.
2. Register: `DatasetRegistry.register('<id>', { name, fileHint, Loader, createExplorer })`.
3. Add `<script src="js/datasets/<name>.js"></script>` in `index.html` after `registry.js`.
4. Add a file panel block in `index.html` and hook visibility in `app.js` if the UI differs from existing datasets.

The **Dataset** dropdown updates from the registry automatically.

---

## Philosophy

**parmanu** (Sanskrit: atom / particle) — visualization should stay out of the way:

- **Zero install** — open a browser, pick files, visualize.
- **Offline-first** — works without a backend after the first load.
- **No mandatory conversion** — use official dataset files; ego/calib handled in loaders.
- **Extensible** — new datasets are one JS file + registry entry.

---

## Contributing

Issues and pull requests are welcome. No build step: test by serving the repo and loading sample frames.

- **New datasets** — loader under `js/datasets/` (see [Add another dataset](#add-another-dataset)).
- **Bugs / UX** — viewer, pickers, calibration or ego edge cases.
- **Docs** — dataset notes, screenshots (including VR captures).

For larger changes, open an issue first to align on approach.

---

## License

MIT — see [LICENSE](LICENSE).
