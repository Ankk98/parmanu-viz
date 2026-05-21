# SiT Dataset Support Plan (parmanu-viz)

Plan for adding **SiT** (Socially Interactive Trajectory) raw-data visualization to [parmanu-viz](../README.md).

**Runtime constraint:** SiT support is **browser-only**. No Python, Open3D, PCL CLI, Node preprocess step, or “convert to `.bin` first” workflow. Users pick raw files from disk; parsing happens in JavaScript.

Grounded in:

- Local inspection of `/run/media/ankk98/Ankk98 SSD Part 3/datasets/sit/raw`
- Official [SPALaboratory/SiT-Dataset](https://github.com/SPALaboratory/SiT-Dataset) (optional clone to `.reference/SiT-Dataset/`, gitignored)
- Box/ego math ported from published MMDet3D SiT tooling (read-only reference for formulas — **not** a runtime dependency)

---

## Goals

| Goal | Notes |
|------|--------|
| Visualize **concat LiDAR** + optional **3D boxes** | Same viewer contract as KITTI when boxes present |
| **Zero local tooling** | Browser + files on disk only |
| Load **raw `.pcd`** via bundled **Three.js `PCDLoader` (r134)** | `DATA binary_compressed` (SiT velodyne) |
| Match GT alignment when labels used | `label_3d` is **world**; `ego_trajectory` required **with labels** |
| **Points-only OK** | Sequences/episodes without `label_3d` → cloud only, no error |
| Do **not** use KITTI rect-camera box pipeline | LiDAR `[x,y,z,l,w,h,yaw]` after ego transform |

**Out of scope (v1):** cameras, `label_2d`, IMU/RTK, trajectory prediction, folder browser, `.bin` for SiT, **PCD intensity coloring** (see note below).

**Explicitly rejected:**

- Pre-converting PCD → KITTI `.bin`
- WASM Pyodide / Open3D in the browser

---

## SiT vs KITTI in parmanu-viz

| Aspect | KITTI (`kitti.js`) | SiT (`sit.js`) |
|--------|-------------------|----------------|
| Point cloud | `.bin` (`parseBin`) | **`.pcd` only** (`THREE.PCDLoader.parse`) |
| Labels | `label_2` (required) | `label_3d` (optional) |
| Calibration | Required | Hidden (not used) |
| Extra file | — | `ego_trajectory` (required **only if** labels provided) |
| Box math | KITTI devkit + calib | `box7ToCorners` (z-yaw, LiDAR) |
| Three addons | `OrbitControls` | `OrbitControls` + **`PCDLoader`** (r134) |
| Intensity in PCD | Used (from `.bin`) | **Ignored v1** — write `0` in 4th channel |

---

## Raw dataset layout (verified locally)

Root example: `.../datasets/sit/raw/`

```
raw/
├── ImageSets/
│   ├── train.txt    # 7000 lines — scene*seq*frame
│   ├── val.txt
│   └── test.txt
├── Cafe_street/
│   └── Cafe_street_1/
│       ├── calib/
│       ├── cam_img/{1..5}/data_rgb/
│       ├── ego_trajectory/
│       ├── label_2d/
│       ├── label_3d/          # may be absent in some sequences
│       └── velo/concat/data/  # ← default for viz
...
```

**Sequences with velodyne but no `label_3d` (verified):** `Lobby/Lobby_1`, `Outdoor_Alley/Outdoor_Alley_1`, `Subway_Entrance/Subway_Entrance_1`. For these, v1 supports **point cloud only** (pick `.pcd` only).

**ImageSets line:** `{scene}*{sequence}*{frame_index}` (e.g. `Cafe_street*Cafe_street_1*0`).

**Sample annotated sequence:** 200 frames; concat PCD ~49k points/frame (`binary_compressed`).

---

## Concrete data structures

### 1. Frame identity

```javascript
const SitFrameId = {
  scene: 'Cafe_street',
  sequence: 'Cafe_street_1',
  frame: '0',  // stem from filename, not zero-padded
};
```

Stem rule: strip extension from filename (`0.pcd` → `0`). Do **not** require KITTI’s 6-digit regex.

---

### 2. Point cloud (viewer contract)

```javascript
/** Float32Array length 4*N — [x,y,z,intensity]; intensity = 0 in v1 */
points: Float32Array;
```

**On-disk PCD (verified `velo/concat/data/0.pcd`):**

```
VERSION 0.7
FIELDS x y z intensity ring time
...
DATA binary_compressed
```

### Intensity (deferred)

Stock **r134 `PCDLoader`** reads `x,y,z` (and optional rgb/normal) but **not** the `intensity` field. v1 does not patch the loader.

- `pcdToFloat32Array` sets `out[i*4+3] = 0` for all points.
- `viewer.js` still grayscale-colors from intensity → uniform mid-gray (acceptable for v1).
- **Later:** patch vendored `PCDLoader.js` or read `intensity` in a custom parse pass.

`ring` and `time` are ignored.

---

### 3. `label_3d` (raw, world frame)

```
{class_name} {instance_token} {h} {l} {w} {x} {y} {z} {yaw}
```

Nine fields per line (per [official README](https://github.com/SPALaboratory/SiT-Dataset)). On-disk order **`h, l, w`**. Reorder to **`w, l, h`** for `box_center_to_corner_3d` (same as `sit_converter.py`). Map `Pedestrain_sitting` → `Pedestrian` for display.

**Classes seen in raw data:** `Pedestrian`, `Car`, `Pedestrain_sitting`, `Cyclist`, `Motorcyclist`, `Truck`, `Bus` — v1 uses `TYPE_COLORS` defaults for unknown names (gray).

---

### 4. Ego trajectory

Single line, 16 comma-separated floats → 4×4 row-major matrix.

Required **only when** user provides `label_3d`. If labels omitted, ego is not read.

---

### 5. LiDAR box (after ego transform)

```javascript
// [x, y, z, w, l, h, yaw] in LiDAR frame (dims match official sit_converter)
```

---

### 6. Viewer output

```javascript
const LoadFrameResult = {
  points: Float32Array,
  boxes: ViewerBox[],       // [] when points-only
  annotations: SitBoxLidar[],
};
```

---

## Point cloud loading: `PCDLoader` (Three.js r134)

### Version pin (critical)

Bundled `assets/three.min.js` is Three.js **r134** (revision `134`), not r170.

| Asset | Source |
|-------|--------|
| `three.min.js` | Already in repo (r134) |
| `OrbitControls.js` | Same release as `three.min.js` |
| `PCDLoader.js` | [r134 `examples/js/loaders/PCDLoader.js`](https://github.com/mrdoob/three.js/blob/r134/examples/js/loaders/PCDLoader.js) — IIFE, assigns `THREE.PCDLoader` |

Do **not** use `examples/jsm/loaders/PCDLoader.js` from a newer Three.js — API/module format will not match.

```
assets/
├── three.min.js      # r134
├── OrbitControls.js
└── PCDLoader.js      # NEW — r134 examples/js only
```

```html
<script src="assets/three.min.js"></script>
<script src="assets/OrbitControls.js"></script>
<script src="assets/PCDLoader.js"></script>
<script src="js/datasets/registry.js"></script>
<!-- … -->
<script src="js/datasets/sit.js"></script>
```

### `pcdToFloat32Array`

```javascript
function pcdToFloat32Array(buffer) {
  const loader = new THREE.PCDLoader();
  const pointsObj = loader.parse(buffer, ''); // url optional for file picker
  const pos = pointsObj.geometry.attributes.position;
  const n = pos.count;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4]     = pos.getX(i);
    out[i * 4 + 1] = pos.getY(i);
    out[i * 4 + 2] = pos.getZ(i);
    out[i * 4 + 3] = 0; // intensity deferred — see above
  }
  pointsObj.geometry.dispose();
  pointsObj.material.dispose();
  return out;
}
```

- `accept=".pcd"` only for SiT point input.
- Expect ~48k points for `Cafe_street_1/0.pcd`.

---

## UI / DOM (dataset-specific file panel)

Current `index.html` is KITTI-only (`#file-bin`, `#file-label`, `#file-calib`). SiT needs a **third slot for ego**, not calib.

### HTML structure

Add a dedicated ego row; toggle visibility by dataset:

```html
<div id="file-inputs">
  <!-- shared row ids; labels/accept updated in app.js -->
  <label id="row-pointcloud">
    Point cloud
    <input type="file" id="file-pointcloud">
  </label>
  <label id="row-labels">
    Labels
    <input type="file" id="file-label">
  </label>
  <label id="row-calib" data-dataset="kitti">
    Calibration
    <input type="file" id="file-calib">
  </label>
  <label id="row-ego" data-dataset="sit" hidden>
    Ego trajectory
    <input type="file" id="file-ego">
  </label>
</div>
```

Rename conceptually: KITTI keeps using `#file-bin` **or** alias `#file-pointcloud` to the same element (pick one ID in implementation — plan recommends **renaming to `#file-pointcloud`** with KITTI `accept=".bin"` and SiT `accept=".pcd"`).

### `app.js` — `applyDatasetUi(datasetId)`

On dataset change and init:

| | KITTI | SiT |
|---|--------|-----|
| Point label | “Point cloud (.bin)” | “Point cloud (.pcd)” |
| `accept` (point) | `.bin` | `.pcd` |
| Label label | “Labels (label_2 .txt)” | “Labels (label_3d .txt) — optional” |
| Row `#row-calib` | visible | **hidden** |
| Row `#row-ego` | hidden | **visible** |
| `fileHint` | from registry | from registry |

Call `explorer.reset()` after UI swap.

### `bindExplorer(datasetId)`

```javascript
function bindExplorer() {
  const entry = DatasetRegistry.get(datasetId);
  applyDatasetUi(datasetId);
  if (datasetId === 'kitti') {
    explorer = DatasetRegistry.createExplorer('kitti', {
      pointInput: els.pointcloud,
      labelInput: els.label,
      calibInput: els.calib,
      visualizeBtn: els.visualize,
    });
  } else if (datasetId === 'sit') {
    explorer = DatasetRegistry.createExplorer('sit', {
      pointInput: els.pointcloud,
      labelInput: els.label,
      egoInput: els.ego,
      visualizeBtn: els.visualize,
    });
  }
  loader = DatasetRegistry.createLoader(datasetId);
}
```

Refactor `createKittiExplorer` to accept `pointInput` (same element, was `binInput`).

### `createSitExplorer` — readiness rules

| Files | Visualize enabled? |
|-------|-------------------|
| `.pcd` only | **yes** (points-only) |
| `.pcd` + `label_3d` | **no** until `ego_trajectory` also selected |
| `.pcd` + `ego` only | **yes** — treat as points-only (ignore ego) |
| `label` without `.pcd` | **no** |

`getFilesAsync()` returns:

```javascript
{
  pointCloudFile: File,
  labelFile: File | null,
  egoFile: File | null,
  frameId: string,
  mismatch: string | null,  // stem mismatch warning
  pointsOnly: boolean,
}
```

Validation when labels present:

- Each label line: 9 fields (reject KITTI 15-field with hint).
- Ego: exactly 16 comma-separated floats.
- Stems: warn if `0.pcd` vs `1.txt` mismatch; still allow load.

When `pointsOnly`: skip label/ego reads; `loadFrame` returns `{ points, boxes: [], annotations: [] }`.

---

## Coordinate frames & label math (pure JS)

```text
world  ── label_3d (optional)
   │     inv(ego_trajectory) when labels provided
   ▼
LiDAR  ── PCDLoader (x,y,z)
```

Port `egoYaw`, `transformBoxesWorldToLidar`, `box7ToCorners`, `parseSitLabel3d`, `parseEgoMatrix`, `invert4x4` / `mul4x4Vec` as in prior plan sections.

**Alignment gate (S1):** On `Cafe_street_1` frame `0` with labels+ego, boxes must visually overlap pedestrians/cars. If not, debug `inv(ego)` vs `ego` and box center semantics before shipping.

**Optional later:** `PCD_LIMIT_RANGE` filter toggle.

---

## `SitLoader.loadFrame`

```javascript
async loadFrame({ pointCloudFile, labelFile, egoFile, pointsOnly }) {
  const points = pcdToFloat32Array(await pointCloudFile.arrayBuffer());

  if (pointsOnly || !labelFile) {
    return { points, boxes: [], annotations: [] };
  }

  if (!egoFile) {
    throw new Error('SiT: ego_trajectory required when label_3d is provided.');
  }

  const ego = parseEgoMatrix(await egoFile.text());
  const raw = parseSitLabel3d(await labelFile.text());
  const boxes7 = transformBoxesWorldToLidar(raw.map((o) => o.box7), ego);
  const boxes = boxes7.map((b7, i) => ({
    type: raw[i].type,
    corners: box7ToCorners(b7),
  }));

  return { points, boxes, annotations: raw };
}
```

---

## Browser-only verification

| # | Check | Pass |
|---|--------|------|
| 1 | `Cafe_street_1/velo/concat/data/0.pcd` only | ~48k points, orbit OK |
| 2 | + `label_3d/0.txt` + `ego/0.txt` | Boxes overlap objects |
| 3 | `Lobby_1` `.pcd` only (no label dir) | Points only, no error |
| 4 | Labels without ego | Clear error message |
| 5 | KITTI `label_2` as SiT label | Rejected (9-field hint) |
| 6 | Reload frame | No leak / duplicate geometry |
| 7 | `file://` open | Works with file picker |

---

## parmanu-viz integration

### New / changed files

```
assets/PCDLoader.js       # r134 examples/js
js/datasets/sit.js        # loader, explorer, math, registerSitDataset()
index.html                # row-ego, unified file-pointcloud id
js/app.js                 # applyDatasetUi, bindExplorer per dataset
js/explorer.js            # createKittiExplorer → pointInput param name
```

### Registry

```javascript
DatasetRegistry.register('sit', {
  name: 'SiT',
  fileHint: 'concat .pcd; optional label_3d + ego (same frame id)',
  Loader: SitLoader,
  createExplorer: createSitExplorer,
});
```

`app.js` on load:

```javascript
if (typeof registerSitDataset === 'function') registerSitDataset();
DatasetRegistry.fillSelect(els.datasetSelect, 'kitti');
```

---

## Implementation phases

### Phase S1

1. Add `assets/PCDLoader.js` from **r134** `examples/js/loaders/PCDLoader.js`.
2. Update `index.html` + `app.js` per **UI / DOM** section.
3. Implement `sit.js` (PCD parse, optional labels, ego math).
4. Refactor `createKittiExplorer` input ids if renamed.
5. Run verification table (including Lobby points-only).

**Done when:** Raw `.pcd` works; annotated frame shows aligned boxes; unlabeled sequences work points-only.

### Phase S2 — Polish

- README SiT paths; class colors for Cyclist/Truck/etc.
- Alignment doc / screenshot
- **Intensity** from PCD (patch loader or custom field read)

### Phase S3 — Later

- `label_2d`, calib, ImageSets picker, VR

---

## Example paths

**Annotated (frame 0):**

| Role | Path |
|------|------|
| Points | `.../Cafe_street/Cafe_street_1/velo/concat/data/0.pcd` |
| Labels | `.../label_3d/0.txt` |
| Ego | `.../ego_trajectory/0.txt` |

**Points-only:**

| Role | Path |
|------|------|
| Points | `.../Lobby/Lobby_1/velo/concat/data/0.pcd` |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| PCDLoader vs three version skew | **r134 only** for both |
| No intensity in stock PCDLoader | v1: fourth channel `0`; note in UI/README; fix in S2 |
| Wrong ego / box frame | S1 alignment gate on Cafe_street frame 0 |
| KITTI/SiT DOM confusion | Separate `#row-calib` / `#row-ego`; `applyDatasetUi` |
| User picks `top/` not `concat/` | Hint: use `velo/concat/data` |
| Labels without ego | Hard error with clear message |

---

## Relation to [PARMANU_VIZ_PLAN.md](./PARMANU_VIZ_PLAN.md)

- KITTI unchanged: `.bin` + calib + required `label_2`.
- SiT: `.pcd` via r134 `PCDLoader`; optional labels; shared `viewer.js`.
