# parmanu-viz

Browser-based visualizer for 3D point clouds with annotations.

**No server required.** Open `index.html` in Chrome or Firefox (double-click or `file://`).

![KITTI point cloud and 3D bounding boxes in parmanu-viz](screenshots/v1-kitti.png)

![SiT point cloud](screenshots/v1-kitti.png)

## Supported Datasets
- **KITTI Object** — `.bin` + `label_2` + calib
- **SiT** — `velo/concat` `.pcd` + optional `label_3d` + `ego_trajectory` (browser-only, no conversion)

## Usage

1. Open `index.html` in your browser.
2. Choose **Dataset** in the panel.

### KITTI

Select three files for the same frame (e.g. `000001`):

- `data_object_velodyne/training/velodyne/000001.bin`
- `data_object_label_2/training/label_2/000001.txt`
- `data_object_calib/training/calib/000001.txt`

### SiT

- **Point cloud (required):** `{scene}/{seq}/velo/concat/data/{frame}.pcd`
- **Labels (optional):** `{scene}/{seq}/label_3d/{frame}.txt` — if provided, also pick **ego trajectory** `{scene}/{seq}/ego_trajectory/{frame}.txt` with the same frame id.
- Sequences without `label_3d` (e.g. `Lobby_1`): pick `.pcd` only for points-only view.

3. Click **Visualize**.

Controls: drag to orbit, scroll to zoom, right-drag to pan, **R** to reset view.

## Files

| Script | Role |
|--------|------|
| `assets/three.min.js` | Three.js r134 (global `THREE`) |
| `assets/OrbitControls.js` | Orbit controls |
| `assets/PCDLoader.js` | SiT `.pcd` loader (`binary_compressed`) |
| `js/datasets/registry.js` | Dataset registry + selector |
| `js/datasets/kitti.js` | KITTI parsers + box math |
| `js/datasets/sit.js` | SiT PCD + label_3d + ego |
| `js/viewer.js` | Point cloud + 3D boxes |
| `js/explorer.js` | KITTI file pickers |
| `js/app.js` | Wiring |

Plain `<script>` tags — no npm, no build, no ES modules.

### Add another dataset

1. Add `js/datasets/waymo.js` with `WaymoLoader` and `loadFrame()` returning `{ points, boxes }`.
2. Register in that file: `DatasetRegistry.register('waymo', { name, fileHint, Loader, createExplorer })`.
3. Add `<script src="js/datasets/waymo.js"></script>` to `index.html` after the other dataset scripts.

The **Dataset** dropdown updates automatically.

## KITTI math

Ported from the [KITTI object devkit](https://github.com/bostondiditeam/kitti) / [kitti_object_vis](https://github.com/kuixu/kitti_object_vis). Optional local clones under `.reference/` for development only.

## License

MIT — see [LICENSE](LICENSE).
