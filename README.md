# parmanu-viz

Browser-based 3D visualization for KITTI Velodyne point clouds and `label_2` annotations (desktop v1).

## Quick start

```bash
cd parmanu-viz
python -m http.server 8000
```

Open http://localhost:8000 (use a local server; `file://` will not work).

## Load one frame

Pick three files with the same frame id (e.g. `000042`):

| File | Typical path |
|------|----------------|
| Point cloud | `data_object_velodyne/training/velodyne/000042.bin` |
| Labels | `data_object_label_2/training/label_2/000042.txt` |
| Calibration | `data_object_calib/training/calib/000042.txt` |

Click **Visualize**.

## Stack

- Pure HTML + ES modules
- Three.js (bundled under `assets/`)
- KITTI box math ported from the [KITTI object devkit](https://github.com/bostondiditeam/kitti) / [kitti_object_vis](https://github.com/kuixu/kitti_object_vis)

## License

TBD
