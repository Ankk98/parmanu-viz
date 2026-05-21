/**
 * KITTI object detection loader (v1).
 * Box/calib math ported from KITTI devkit / kitti_object_vis (kitti_util.py).
 */
function KITTILoader() {
}

KITTILoader.prototype.getName = function () {
  return 'KITTI';
};

KITTILoader.prototype.loadFrame = async function ({
  pointCloudFile,
  labelFile,
  calibFile,
}) {
  const points = this.parseBin(await pointCloudFile.arrayBuffer());
  const calib = this.parseCalib(await calibFile.text());
  const objects = this.parseLabels(await labelFile.text()).filter((o) =>
    this.isValid3DBox(o),
  );
  const boxes = [];
  for (const obj of objects) {
    const corners = this.boxToVelodyneCorners(obj, calib);
    if (corners) boxes.push({ type: obj.type, corners: corners });
  }
  return { points: points, boxes: boxes, annotations: objects };
};

KITTILoader.prototype.parseBin = function (buffer) {
  const floats = new Float32Array(buffer);
  if (floats.length % 4 !== 0) {
    throw new Error(
      'Invalid .bin size ' + floats.length + ' floats (must be multiple of 4)',
    );
  }
  return floats;
};

KITTILoader.prototype.parseCalib = function (text) {
  const data = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.indexOf(':') === -1) continue;
    const parts = trimmed.split(':');
    const key = parts[0].trim();
    const vals = parts[1].trim().split(/\s+/).map(Number);
    data[key] = vals;
  }
  for (let j = 0; j < ['P2', 'R0_rect', 'Tr_velo_to_cam'].length; j++) {
    const req = ['P2', 'R0_rect', 'Tr_velo_to_cam'][j];
    if (!data[req]) {
      throw new Error('Calibration missing required key: ' + req);
    }
  }
  const P = reshape(data.P2, 3, 4);
  const V2C = reshape(data.Tr_velo_to_cam, 3, 4);
  const R0 = reshape(data.R0_rect, 3, 3);
  const C2V = inverseRigid(V2C);
  const R0inv = invert3x3(R0);
  return { P: P, V2C: V2C, R0: R0, C2V: C2V, R0inv: R0inv };
};

KITTILoader.prototype.parseLabels = function (text) {
  const lines = text.trim().split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const o = this.parseLabelLine(lines[i]);
    if (o) out.push(o);
  }
  return out;
};

KITTILoader.prototype.parseLabelLine = function (line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 15) return null;
  return {
    type: parts[0],
    truncated: parseFloat(parts[1]),
    occluded: parseInt(parts[2], 10),
    alpha: parseFloat(parts[3]),
    bbox_2d: parts.slice(4, 8).map(Number),
    h: parseFloat(parts[8]),
    w: parseFloat(parts[9]),
    l: parseFloat(parts[10]),
    t: [parseFloat(parts[11]), parseFloat(parts[12]), parseFloat(parts[13])],
    ry: parseFloat(parts[14]),
  };
};

KITTILoader.prototype.isValid3DBox = function (o) {
  if (o.type === 'DontCare') return false;
  if (o.h <= 0 || o.w <= 0 || o.l <= 0) return false;
  if (o.t[0] <= -999 || o.t[1] <= -999 || o.t[2] <= -999) return false;
  return true;
};

KITTILoader.prototype.boxToVelodyneCorners = function (obj, calib) {
  const cornersRect = this.computeBox3d(obj);
  if (!cornersRect) return null;
  return this.projectRectToVelo(cornersRect, calib);
};

KITTILoader.prototype.computeBox3d = function (obj) {
  const R = roty(obj.ry);
  const l = obj.l;
  const w = obj.w;
  const h = obj.h;
  const x_corners = [l / 2, l / 2, -l / 2, -l / 2, l / 2, l / 2, -l / 2, -l / 2];
  const y_corners = [0, 0, 0, 0, -h, -h, -h, -h];
  const z_corners = [w / 2, -w / 2, -w / 2, w / 2, w / 2, -w / 2, -w / 2, w / 2];

  const corners = [[], [], []];
  for (let i = 0; i < 8; i++) {
    const p = [x_corners[i], y_corners[i], z_corners[i]];
    const rp = mat3Vec(R, p);
    corners[0].push(rp[0] + obj.t[0]);
    corners[1].push(rp[1] + obj.t[1]);
    corners[2].push(rp[2] + obj.t[2]);
  }

  for (let i = 0; i < 8; i++) {
    if (corners[2][i] < 0.1) return null;
  }

  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push([corners[0][i], corners[1][i], corners[2][i]]);
  }
  return out;
};

KITTILoader.prototype.projectRectToVelo = function (cornersRect, calib) {
  const out = [];
  for (let i = 0; i < cornersRect.length; i++) {
    const p = cornersRect[i];
    const pref = mat3Vec(calib.R0inv, p);
    const pvelo = rigid3x4(calib.C2V, pref);
    out.push(pvelo);
  }
  return out;
};

function reshape(arr, rows, cols) {
  const m = [];
  for (let r = 0; r < rows; r++) {
    m.push(arr.slice(r * cols, (r + 1) * cols));
  }
  return m;
}

function roty(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function mat3Vec(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

function invert3x3(m) {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  let det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Singular R0_rect matrix');
  det = 1 / det;
  return [
    [A * det, D * det, G * det],
    [B * det, E * det, H * det],
    [C * det, F * det, I * det],
  ];
}

function inverseRigid(Tr) {
  const R = [
    [Tr[0][0], Tr[0][1], Tr[0][2]],
    [Tr[1][0], Tr[1][1], Tr[1][2]],
    [Tr[2][0], Tr[2][1], Tr[2][2]],
  ];
  const t = [Tr[0][3], Tr[1][3], Tr[2][3]];
  const Rt = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];
  const tinv = [
    -(Rt[0][0] * t[0] + Rt[0][1] * t[1] + Rt[0][2] * t[2]),
    -(Rt[1][0] * t[0] + Rt[1][1] * t[1] + Rt[1][2] * t[2]),
    -(Rt[2][0] * t[0] + Rt[2][1] * t[1] + Rt[2][2] * t[2]),
  ];
  return [
    [Rt[0][0], Rt[0][1], Rt[0][2], tinv[0]],
    [Rt[1][0], Rt[1][1], Rt[1][2], tinv[1]],
    [Rt[2][0], Rt[2][1], Rt[2][2], tinv[2]],
  ];
}

/** 3×4 @ homogeneous point [x,y,z,1] -> xyz */
function rigid3x4(Tr, p) {
  return [
    Tr[0][0] * p[0] + Tr[0][1] * p[1] + Tr[0][2] * p[2] + Tr[0][3],
    Tr[1][0] * p[0] + Tr[1][1] * p[1] + Tr[1][2] * p[2] + Tr[1][3],
    Tr[2][0] * p[0] + Tr[2][1] * p[1] + Tr[2][2] * p[2] + Tr[2][3],
  ];
}

window.KITTILoader = KITTILoader;

function registerKittiDataset() {
  DatasetRegistry.register('kitti', {
    name: 'KITTI Object',
    fileHint: 'velodyne .bin + label_2 .txt + calib .txt (same frame id)',
    Loader: KITTILoader,
    createExplorer: function (opts) {
      return createKittiExplorer(opts);
    },
  });
}

window.registerKittiDataset = registerKittiDataset;
registerKittiDataset();
