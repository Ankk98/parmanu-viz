# parmanu-viz: Browser-Based 3D Point Cloud Visualization

## Philosophy & Vision

**parmanu-viz** (Sanskrit: "parmanu" = atom/particle) is built on core principles:

- **Simplicity First**: Zero installation, zero dependencies, zero complexity. Just open a browser and start visualizing.
- **Offline-First**: Works completely offline after initial load. No servers, no cloud, no internet required.
- **Open Source**: Built for the community, by the community. Extensible and transparent.
- **Extensibility**: Adding support for new datasets should be as simple as adding one JavaScript file. No core modifications needed.
- **Ease of Use**: Researchers should spend time on research, not fighting with tools. Click, select, visualize.

## Primary Use Case

**Target Audience**: Researchers working with 3D point cloud datasets for quick visualization during experimentation.

**Default Workflow (v1)**:
1. Researcher has KITTI files on disk (any layout — official `data_object_*` zips or devkit-style folders)
2. Opens browser, navigates to parmanu-viz (hosted on GitHub Pages)
3. Selects **three files for one frame** (same sample ID recommended):
   - Velodyne point cloud: `*.bin` (e.g. `data_object_velodyne/training/velodyne/000042.bin`)
   - Labels: `*.txt` from `label_2` (e.g. `data_object_label_2/training/label_2/000042.txt`)
   - Calibration: `*.txt` from `calib` (e.g. `data_object_calib/training/calib/000042.txt`)
4. App loads and visualizes point cloud + 3D boxes aligned in **Velodyne** coordinates
5. Uses mouse/keyboard (OrbitControls) to explore on **desktop**

**v2+**: HTML export, Quest 3 / WebXR VR

**Key Requirements**:
- No local installation required
- Works with standard KITTI file formats (no folder layout detection in v1)
- **Desktop browser v1** (Chrome/Edge/Firefox); VR deferred to v2
- Fast, responsive, GPU-accelerated
- Easy to extend for other datasets (Waymo, nuScenes, custom formats)

## Architecture

### Technology Stack

- **Frontend**: Pure HTML + JavaScript (ES6+)
- **3D Rendering**: Three.js (bundled locally for offline support)
- **VR Support**: WebXR API (**v2+**)
- **File Access**: Per-file pickers (v1); directory API (v2+)
- **Deployment**: GitHub Pages (static hosting)

### Project Structure

```
parmanu-viz/
├── index.html                 # Main application entry point
├── js/
│   ├── app.js                 # Main application orchestrator
│   ├── viewer.js             # Three.js visualization engine
│   ├── explorer.js            # v1: per-file pickers; v2+: dataset folder browser
│   ├── exporter.js            # HTML export (v2+)
│   └── datasets/
│       ├── base.js            # Abstract DatasetLoader interface
│       └── kitti.js           # KITTI dataset implementation
├── assets/
│   ├── three.min.js          # Bundled Three.js (offline-first)
│   ├── OrbitControls.js      # Three.js addon (UMD/global, same version as three)
│   └── styles.css            # HUD / file panel (based on SiT layout, simpler)
├── README.md                  # User documentation
├── CONTRIBUTING.md            # Developer guide for adding datasets
└── LICENSE                    # Open source license (MIT/Apache)
```

### External references (read-only — do not copy into repo)

Implementation is **greenfield** in parmanu-viz. Use these only to understand behavior; **do not vendor or extract** their source into this project.

| Reference | Location | Use for |
|-----------|----------|---------|
| KITTI object devkit | `.reference/kitti-official-devkit/` (clone locally) | **Port** label/calib/box math into `kitti.js` |
| `kitti_object_vis` | `.reference/kitti_object_vis/` | Same; Python mirror of devkit |
| SiT Three.js viewer | `~/repos/mmdetection3d/tools/analysis_tools/assets/sit_viz_template.html`, `sit_viz_logic.js` | **Viewer/UI patterns** (z-up, points, line boxes, HUD) |
| SiT render pipeline | `~/repos/mmdetection3d/tools/analysis_tools/render_sit_gt.py` | **Data flow** (flat points array, box → line segments); SiT uses pkl GT, not raw KITTI |
| SiT editor (skip v1) | `sit_editor_template.html`, `sit_editor_logic.js` | Multi-frame edit + VR — **v2+ ideas only** |

SiT boxes are already LiDAR `[x,y,z,l,w,h,yaw]` from MMDet3D; parmanu-viz must use **KITTI devkit corners + calib** instead. SiT does not replace `kitti.js`.

### Core Components

#### 1. Data Explorer (`explorer.js`)

**v1 UI** (static `index.html` regions; logic in `explorer.js`):

| Control | `accept` / hint | Validation |
|---------|-----------------|------------|
| Point cloud | `.bin` | Non-empty; `byteLength % 16 === 0` |
| Labels (`label_2`) | `.txt` | Filename shown; must parse as label lines |
| Calibration | `.txt` | Must contain substring `Tr_velo_to_cam:` (distinguish from labels) |
| **Visualize** button | — | Disabled until all three files chosen |
| Status line | — | Errors, loading, frame ID warning |

**Sample ID check**: extract 6-digit stem from each `File.name` (e.g. `000042`); if stems differ, show non-blocking warning: “Files may be from different frames.”

**Optional v1**: “Labels optional” checkbox — if unchecked and label missing, call `loadFrame` with empty labels (points only). Default: all three required.

**v2+**: Folder mapping, browse `data_object_*` trees.

#### 2. Data Visualizer (`viewer.js`)

New implementation informed by SiT `sit_viz_logic.js`, adapted for live `loadFrame` data (not Python-injected JSON).

**Scene (Velodyne z-up — match SiT, not y-up remap)**:

```javascript
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 10000);
camera.up.set(0, 0, 1);  // LiDAR z-up; same frame as KITTI .bin
const renderer = new THREE.WebGLRenderer({ antialias: true });
// v1: NO renderer.xr.enabled, NO VRButton, NO FlyControls/FPS
```

**Lighting** (from SiT): `AmbientLight(0.6)` + `DirectionalLight(0.8)` at `(1,1,1)`.

**Point cloud**:

- Input: `Float32Array` length `4*N` from `kitti.js`
- `BufferGeometry` attribute `position`: stride 4, itemSize 3 (x,y,z) OR copy xyz into `3*N` float buffer
- `PointsMaterial`: size `0.05`–`0.1`, `sizeAttenuation: true`, circular `CanvasTexture` (SiT pattern), color from intensity:
  - `intensity` → grayscale or simple colormap (`min/max` per frame)
- **Dispose** previous `Points` on reload

**Bounding boxes**:

- Input per box: `{ type: string, corners: number[8][3] }` in Velodyne
- Convert 8 corners → 12 undirected edges (KITTI / SiT edge list):

```javascript
const BOX_EDGES = [
  [0,1],[1,2],[2,3],[3,0],  // bottom
  [4,5],[5,6],[6,7],[7,4],  // top
  [0,4],[1,5],[2,6],[3,7],  // verticals
];
// LineSegments: positions length 12*2*3 floats
```

- One `LineSegments` per object (or merged geometry per class); `LineBasicMaterial` color by `type` (fixed map: Car=green, Pedestrian=cyan, Cyclist=yellow, default=gray)
- **Dispose** prior box meshes on reload

**Camera / controls (v1 desktop only)**:

- `OrbitControls(camera, domElement)`: `enableDamping: true`, `dampingFactor: 0.05`
- **Target**: `(0, 0, 0)` (Velodyne origin / sensor), not bbox of points (SiT uses origin for orbit)
- **Initial position**: from scene bounds — `center = (pmin+pmax)/2`, `maxDim = max(size)`, `camera.position = center + (maxDim*0.7, maxDim*0.7, maxDim*0.7)` (same idea as `render_sit_gt._compute_scene_range`)
- **Reset view** button or `R` key: restore initial pose
- Window `resize` → update camera aspect + renderer size

**Public API** (`viewer.js` exports one object or class):

```javascript
const viewer = {
  init(containerElement),           // once on load
  loadScene({ points, boxes }),     // clears + rebuilds
  resetView(),
  dispose(),
};
```

**HUD** (`index.html` + `styles.css`, simplified from `sit_viz_template.html`):

- `#container` full viewport
- `#hud` top-left: title, control hints (orbit: drag / scroll; R reset)
- `#status` top-right: app messages
- `#legend` bottom-right: filled by `viewer` from box `type` counts

**v2+** (see SiT `sit_viz_logic.js` / editor): WebXR, FlyControls, FPS, export HTML injection.

#### 3. Application flow (`app.js`)

```text
DOMContentLoaded
  → viewer.init(#container)
  → explorer.init(#file-form)  // wires 3 inputs + Visualize button
User clicks Visualize
  → explorer.getFiles() → { pointCloudFile, labelFile, calibFile }
  → show loading on #status
  → KITTILoader.loadFrame(files)
  → viewer.loadScene(result)
  → update #legend, #status “Loaded N points, M boxes”
on error → #status red message, no partial scene (or points-only if labels failed — TBD)
```

Script order in `index.html`: `three` bundle → `OrbitControls` → `base.js` → `kitti.js` → `viewer.js` → `explorer.js` → `app.js` (classic scripts, no CDN import map — offline-first).

**`index.html` skeleton (v1)**:

```html
<div id="file-panel">
  <label>Point cloud (.bin) <input type="file" id="file-bin" accept=".bin"></label>
  <label>Labels (label_2 .txt) <input type="file" id="file-label" accept=".txt"></label>
  <label>Calibration (.txt) <input type="file" id="file-calib" accept=".txt"></label>
  <button id="btn-visualize" disabled>Visualize</button>
  <button id="btn-reset-view" disabled>Reset view</button>
</div>
<div id="container"></div>
<div id="hud">…control hints…</div>
<div id="status">Select three files</div>
<div id="legend"></div>
```

**Local dev**: serve over `http://localhost` (`python -m http.server`); `file://` is unsupported for modules and unreliable for file inputs.

#### 4. HTML Exporter (`exporter.js`) — **v2+**
- Embeds point cloud + boxes in standalone HTML
- Quest 3 workflow deferred until VR phase

#### 5. Dataset Loaders (`datasets/`)
- Abstract base class defining interface
- **Single file** `kitti.js` — all KITTI parsing, calib, and coordinate transforms in v1
- Extensible architecture for custom datasets (additional datasets = additional JS files)

## KITTI Dataset Support

### v1 Scope

| In v1 (desktop MVP) | Deferred (v2+) |
|---------------------|------------------|
| Manual pick of 3 files per frame | Folder / dataset browser |
| `.bin` + `label_2` `.txt` + calib `.txt` | `image_2` / `image_3` overlay |
| 3D box wireframes in Velodyne (port of devkit math) | Pickle labels |
| Skip `DontCare` for 3D | HTML export + Quest / WebXR |
| OrbitControls desktop viewer | Auto-pair files across `data_object_*` trees |

**No folder mapping in v1.** Users navigate their OS file picker to the correct paths. Typical official layout (for reference only):

```
kitti/
├── data_object_velodyne/training/velodyne/000000.bin
├── data_object_label_2/training/label_2/000000.txt
└── data_object_calib/training/calib/000000.txt
```

Devkit-style `training/velodyne/` layouts work the same way — user picks files manually.

### Format Specification

**Point Clouds (`.bin`)**:
- Binary, little-endian `float32`
- 4 values per point: `x, y, z, intensity`
- Coordinate frame: **Velodyne** (x forward, y left, z up)
- ~115k points per frame (~1.8 MB); reshape `Float32Array` to `N × 4` for the viewer

**Annotations (`label_2` `.txt`)**:
- Text, space-separated, one object per line
- 15 columns (16th `score` optional — uncommon in raw KITTI downloads):
  ```
  type truncated occluded alpha
  bbox_left bbox_top bbox_right bbox_bottom
  dim_h dim_w dim_l
  loc_x loc_y loc_z
  rotation_y [optional_score]
  ```
- 3D fields are in **rectified camera** coordinates:
  - `(loc_x, loc_y, loc_z)` = bottom center of the 3D box
  - `dim_h, dim_w, dim_l` = height, width, length
  - `rotation_y` = yaw about camera Y axis
- `bbox_*` are 2D pixels on the **left color camera** (`image_2`) — not used for v1 lidar view
- Example:
  ```
  Car 0.00 0 -1.58 587.01 173.33 614.12 200.12 1.65 1.67 3.64 -1.65 1.57 22.50 1.59
  ```

**Calibration (`calib` `.txt`)**:
- One key per line: `P0:`, `P1:`, `P2:`, `P3:`, `R0_rect:`, `Tr_velo_to_cam:`, `Tr_imu_to_velo:`
- Values are space-separated; matrices stored **row-major** (official readme)
- Extend `R0_rect` (3×3) and `Tr_velo_to_cam` (3×4) to 4×4 homogeneous form (bottom row `0 0 0 1`)
- **v1 requires all three** (labels are in **rectified camera** coordinates):
  - `P2` — used by `compute_box_3d` (KITTI devkit convention; also validates “in front of camera”)
  - `R0_rect` — rect ↔ reference camera
  - `Tr_velo_to_cam` — reference camera ↔ Velodyne
- `Tr_imu_to_velo` not used in v1

**`DontCare` labels**:
- KITTI evaluation regions — “do not penalize detections here”
- Often valid 2D bbox but **invalid 3D** (`-1` or `-1000` sentinels)
- Example:
  ```
  DontCare -1 -1 -10 503.89 169.71 590.61 190.13 -1 -1 -1 -1000 -1000 -1000 -10
  ```
- **v1**: Do not draw 3D boxes for `type === 'DontCare'` or when 3D location contains sentinel values (e.g. `loc_z <= -999`)

### Coordinate Frames (from KITTI devkit)

| Frame | Axes (KITTI) |
|-------|----------------|
| **Velodyne** | x forward, y left, z up — same as `.bin` points |
| **Rectified camera** | x right, y down, z forward — where `label_2` 3D `(x,y,z)` and `rotation_y` live |
| **Reference camera** | intermediate; `Tr_velo_to_cam` maps velo → ref; `R0_rect` maps ref → rect |

Official projection (readme): `y_image = P2 * R0_rect * Tr_velo_to_cam * x_velo`

**v1 lidar pipeline** (matches `kitti_object_vis` / official `computeBox3D.m`):

```
label line → Object3d (h,w,l, t[3], ry)
         → compute_box_3d → 8 corners in rect camera (3×8)
         → project_rect_to_velo → 8 corners in Velodyne (8×3)
         → viewer draws LineSegments from corners
```

Do **not** use raw `location` / `rotation_y` as a single center+yaw box in Velodyne without this pipeline.

### Reference Implementations (port to JS — do not vendor Python/MATLAB)

Official C++/MATLAB/Python devkits **cannot run in the browser**. They **do** remove math uncertainty if we **port the same functions** into `kitti.js`.

Cloned locally under `.reference/` (gitignored, not shipped):

| Repo | Role | Key files |
|------|------|-----------|
| [bostondiditeam/kitti](https://github.com/bostondiditeam/kitti) | Official object devkit | `resources/devkit_object/readme.txt`, `matlab/computeBox3D.m` |
| [kuixu/kitti_object_vis](https://github.com/kuixu/kitti_object_vis) | Python port used for lidar+box viz | `kitti_util.py` (`Calibration`, `compute_box_3d`, `project_rect_to_velo`), `kitti_object.py` (DontCare skip + call chain) |

**Attribution**: Port algorithms with credit in `kitti.js` / README; follow each repo’s license if redistributing derived code.

#### Port spec: `parseBin`

Same as `load_velo_scan` in `kitti_util.py`:

```javascript
// Float32Array → view as (-1, 4): x, y, z, intensity
const floats = new Float32Array(buffer);
const numPoints = floats.length / 4;
```

#### Port spec: `parseCalib`

Parse `key: f1 f2 ...` lines into `P2` (3×4), `R0_rect` (3×3), `Tr_velo_to_cam` (3×4). Build:

- `C2V` = inverse rigid transform of `V2C` (`inverse_rigid_trans` in `kitti_util.py`: R' and -R't on 3×4)
- Use `R0` as 3×3; `project_rect_to_ref` uses `R0⁻¹`

#### Port spec: label → `Object3d`

Map columns to fields (see `Object3d.__init__` in `kitti_util.py`):

- `h,w,l` = `dimensions[0,1,2]` from file (indices 8–10)
- `t` = `(loc_x, loc_y, loc_z)` (indices 11–13)
- `ry` = `rotation_y` (index 14)

#### Port spec: `compute_box_3d` (rect camera corners)

Port from `kitti_util.py` / `computeBox3D.m` (identical logic):

1. `R = roty(ry)` — rotation about camera Y: `[[c,0,s],[0,1,0],[-s,0,c]]`
2. Corner template (length `l`, width `w`, height `h`), **before** rotation:
   - `x_corners = [l/2, l/2, -l/2, -l/2, l/2, l/2, -l/2, -l/2]`
   - `y_corners = [0, 0, 0, 0, -h, -h, -h, -h]` (bottom of box at y=0; `t` is bottom center)
   - `z_corners = [w/2, -w/2, -w/2, w/2, w/2, -w/2, -w/2, w/2]`
3. `corners_3d = R @ [x_corners; y_corners; z_corners]`, then add `t` to each row
4. Optional: skip if any `corners_3d[2] < 0.1` (behind camera), same as devkit
5. Return `corners_3d` as **8×3** (corner order per `draw_projected_box3d` comment: 0–7)

#### Port spec: `project_rect_to_velo`

Port `Calibration.project_rect_to_velo`:

```
pts_ref  = R0⁻¹ @ pts_rect   (per point, homogeneous 3×3)
pts_velo = C2V   @ pts_ref   (3×4 rigid inverse)
```

Batch: `n×3` corners → `n×3` in Velodyne.

#### Port spec: `loadFrame` output (viewer contract)

```javascript
{
  points: Float32Array,           // length 4*N, velodyne x,y,z,intensity
  boxes: Array<{ type, corners }>, // corners: number[8][3] in Velodyne
  annotations: Array              // raw parsed objects (legend / debug)
}
```

`viewer.js` converts each `corners` array to **12 line segments** via `BOX_EDGES` (same topology as `draw_gt_boxes3d` / SiT `boxes_to_lines` edge list).

#### Three.js scene axes

KITTI Velodyne is **z-up**. **v1 convention** (from SiT `sit_viz_logic.js`): render in native z-up — `camera.up.set(0, 0, 1)`, no parent `Group` rotation. Points and box corners from `kitti.js` are used **without** axis permutation. Do not apply a separate y-up remap on top of devkit corner math.

### Implementation (`js/datasets/kitti.js` only)

Single file containing: parsers above, `compute_box_3d`, `project_rect_to_velo`, `isValid3DBox`, `loadFrame`.

```javascript
class KITTILoader extends DatasetLoader {
  getName() { return 'KITTI'; }

  async loadFrame({ pointCloudFile, labelFile, calibFile }) {
    const points = this.parseBin(await pointCloudFile.arrayBuffer());
    const calib = this.parseCalib(await calibFile.text());
    const objects = this.parseLabels(await labelFile.text())
      .filter((o) => this.isValid3DBox(o));
    const boxes = objects.map((o) => ({
      type: o.type,
      corners: this.boxToVelodyneCorners(o, calib), // 8×3
    }));
    return { points, boxes, annotations: objects };
  }

  isValid3DBox(o) {
    if (o.type === 'DontCare') return false;
    if (o.h <= 0 || o.w <= 0 || o.l <= 0) return false;
    if (o.t[0] <= -999 || o.t[1] <= -999 || o.t[2] <= -999) return false;
    return true;
  }

  boxToVelodyneCorners(o, calib) {
    const cornersRect = this.computeBox3d(o);      // 8×3 rect cam
    return this.projectRectToVelo(cornersRect, calib);
  }
}
```

**Calib file validation (v1)**: Reject with clear error if `Tr_velo_to_cam`, `R0_rect`, or `P2` missing. Distinguish label vs calib `.txt` in UI (both same extension).

**Note on Pickle Files**:
- KITTI standard release uses `.txt` labels, not pickle
- v1: `.txt` only
- Future versions may add pickle via JS libraries if needed

**Note on images**:
- `image_2` / `image_3` are not required for v1
- Testing split has velodyne + calib but no `label_2` — user supplies labels only when visualizing training (or custom) frames

## Extensibility Model

### Adding New Dataset Support

To add support for a new dataset (e.g., Waymo), users simply:

1. Create `datasets/waymo.js` (single file per dataset, same pattern as KITTI):
```javascript
class WaymoLoader extends DatasetLoader {
  async loadFrame(files) { /* implementation */ }
  getName() { return 'Waymo'; }
}

// Auto-register
window.DatasetRegistry.register('waymo', WaymoLoader);
```

2. Include in HTML:
```html
<script src="js/datasets/waymo.js"></script>
```

3. Done! No core modifications needed.

### DatasetLoader Interface

All dataset loaders must implement:

```javascript
class DatasetLoader {
  // v1: load one frame from user-selected files (shape varies by dataset)
  async loadFrame(files) { throw new Error('Not implemented'); }

  getName() { throw new Error('Not implemented'); }
  // KITTI returns boxes as 8×3 corners in Velodyne; other datasets may differ
}
```

**v2+ optional**: `getFileStructure()`, folder browser, `loadPointCloud` / `loadAnnotations` split helpers.

## Implementation Plan

### v1 Definition of Done (desktop MVP)

1. User selects `.bin` + `label_2` `.txt` + `calib` `.txt` (warn on ID mismatch).
2. `kitti.js` ports devkit box pipeline; boxes align with objects on a known training frame (e.g. `000001`).
3. `viewer.js`: z-up OrbitControls, intensity-colored points, per-type box wireframes, legend.
4. Orbit pan/zoom; no tab freeze on ~115k points; Reset view works.
5. Errors: missing calib keys, empty/corrupt bin, calib/label file confused (validate `Tr_velo_to_cam:`).
6. Run via local static server — document in README.
7. No SiT/mmdetection3d source files committed to parmanu-viz.

### Phase 1: Core Infrastructure

**Tasks**:
1. `index.html` + `assets/styles.css`: `#container`, `#hud`, `#status`, `#legend`, three labeled file inputs, Visualize + Reset view
2. Bundle Three.js r170 + `OrbitControls` in `assets/` (UMD/global build, no jsdelivr import map)
3. `viewer.js`: z-up scene, points, `BOX_EDGES` line boxes, `loadScene` / `dispose`, orbit + resize (behavior per SiT **reference**, new code)
4. `explorer.js` + `app.js`: file pickers, ID warning, stub `loadScene` with dummy cube/points for layout test
5. `datasets/base.js` stub

**Deliverables**: Desktop shell runs on `http://localhost:8000`; viewer API stable before KITTI math.

**Not in Phase 1**: Copying SiT files into repo; WebXR; Python `render_sit_gt.py` pipeline.

### Phase 2: KITTI loader (port from `.reference/`)

**Tasks**:
1. `kitti.js`: `parseBin`, `parseCalib`, `parseLabels` / `Object3d` fields
2. Port `compute_box_3d`, `roty`, `inverse_rigid_trans`, `project_rect_to_velo`
3. `DontCare` + sentinel filtering
4. `loadFrame` → `{ points, boxes }` per viewer contract
5. Golden-frame test against `kitti_object_vis` output (optional script in `.reference/`)

**Deliverables**: Aligned lidar + boxes on real KITTI files.

### Phase 3: Polish & deploy (v1)

**Tasks**:
1. Loading states, error messages, sample ID warning
2. Point size / decimation toggle if FPS low
3. README (local server, triple-file paths, `.reference/` clone instructions)
4. GitHub Pages deployment

### Phase 4: v2 — Export & VR

**Tasks**: HTML export (SiT-style template injection like `render_sit_gt._generate_html`), Quest/WebXR (patterns from `sit_viz_logic.js`), folder browser, images.

**Note**: All application code is written for parmanu-viz; external repos remain read-only references.

## Technical Decisions

### File Access (v1)

**Per-file pickers** — no directory mapping in v1:

```javascript
// Three separate inputs or showOpenFilePicker calls
input.accept = '.bin';           // point cloud
input.accept = '.txt';           // labels (label_2)
input.accept = '.txt';           // calib
```

**Primary**: `showOpenFilePicker({ multiple: false })` (Chrome/Edge)  
**Fallback**: `<input type="file">` (all browsers)

**v2+**: `showDirectoryPicker()` + `data_object_*` layout detection and file pairing

### Data Embedding for Export (v2+)

Full-frame JSON export (~115k×4 floats) is heavy; defer until v2 with subsampling or binary embedding strategy.

### VR Support (v2+)

Quest 3 / WebXR after desktop MVP is stable. Requires export or live HTTPS and separate performance budget.

## Browser Compatibility

| Feature | Chrome/Edge | Firefox | Safari |
|---------|-------------|---------|--------|
| `showOpenFilePicker` | ✅ | Partial | Partial |
| Directory picker (v2+) | ✅ | ❌ (fallback) | ❌ (fallback) |
| WebGL | ✅ | ✅ | ✅ |
| WebXR | ✅ | ✅ | ✅ (iOS 17+) |
| File Reading | ✅ | ✅ | ✅ |

## Limitations & Future Work

### v1 Limitations

- **Desktop only** — no WebXR / Quest
- **Manual file selection** — three files per frame
- **No HTML export**
- **No pickle support**: KITTI `.txt` labels only
- **No camera images**: 2D bboxes not shown
- **No annotation editing**: View-only
- **Testing split**: No official `label_2` for test set
- **Devkit port risk**: JS must match Python/MATLAB math; validate on golden frame

### Future Enhancements (v2+)

- WebXR / Quest 3 + standalone HTML export
- KITTI folder browser and auto-pairing across `data_object_*` directories
- Camera image overlay and 2D bbox projection
- Pickle file support (if needed)
- Annotation editing capabilities
- Side-by-side comparison mode
- Video/screenshot export
- Live server mode for real-time Quest viewing
- Jupyter notebook integration
- More dataset formats (Waymo, nuScenes, custom)

## Success Metrics

**v1**
- Zero installation (static site + local server for dev)
- Works with KITTI `.bin` / `label_2` / calib (manual pick)
- Loads and visualizes one training frame in under 2 seconds on desktop
- 3D boxes visually aligned with lidar (devkit-equivalent math)
- Works offline after initial page load

**v2+**
- Exported HTML on Quest 3; folder browser; under 1 hour to add a new dataset loader

## Open Source Considerations

- **License**: MIT (see `LICENSE`)
- **Repository**: GitHub (public)
- **Documentation**: Comprehensive README + CONTRIBUTING guide
- **Examples**: Sample dataset loaders for common formats
- **Community**: Welcome contributions, clear contribution guidelines

## Deployment

**GitHub Pages**:
- Repository: `github.com/[username]/parmanu-viz`
- Live URL: `[username].github.io/parmanu-viz`
- Automatic deployment on push to `main` branch

**Requirements**:
- Static HTML/JS/CSS only
- No build step needed
- No server-side code

## Getting Started (For Users)

1. Open the app (GitHub Pages or `http://localhost:8000` after `python -m http.server`)
2. Select three files for the same frame (matching ID, e.g. `000042`):
   - Point cloud: `*.bin` from `velodyne`
   - Labels: `*.txt` from `label_2` (training; official test set has no labels)
   - Calibration: `*.txt` from `calib` (must contain `P2`, `R0_rect`, `Tr_velo_to_cam`)
3. Click **Visualize**
4. Orbit with mouse to explore

**v2+**: Export HTML → Quest 3

## Getting Started (For Developers — read-only references)

**KITTI math** (clone once, gitignored):

```bash
mkdir -p .reference && cd .reference
git clone --depth 1 https://github.com/bostondiditeam/kitti.git kitti-official-devkit
git clone --depth 1 https://github.com/kuixu/kitti_object_vis.git kitti_object_vis
```

Port algorithms into `js/datasets/kitti.js` from `kitti_util.py` / `computeBox3D.m`.

**Viewer/UI** (keep in mmdetection3d; open side-by-side while implementing):

- `~/repos/mmdetection3d/tools/analysis_tools/assets/sit_viz_template.html`
- `~/repos/mmdetection3d/tools/analysis_tools/assets/sit_viz_logic.js`
- `~/repos/mmdetection3d/tools/analysis_tools/render_sit_gt.py` (`load_points`, `boxes_to_lines`, scene centering)

Do not copy these files into parmanu-viz; reimplement the subset needed for v1 desktop.

## Getting Started (For Developers)

1. Fork repository
2. Create `datasets/yourdataset.js`
3. Extend `DatasetLoader` class
4. Implement required methods
5. Test with your dataset
6. Submit pull request

See `CONTRIBUTING.md` for detailed guidelines.

---

**Project Name**: parmanu-viz  
**Version**: 1.0.0 (planned)  
**Status**: Planning Phase (v1 = desktop; reference clones in `.reference/`)  
**License**: MIT
