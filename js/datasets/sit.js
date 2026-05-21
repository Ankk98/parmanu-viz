/**
 * SiT dataset loader — raw .pcd + optional label_3d + ego_trajectory.
 * Point clouds via THREE.PCDLoader (r134); boxes in LiDAR frame after ego transform.
 */
function SitLoader() {}

SitLoader.prototype.getName = function () {
  return 'SiT';
};

SitLoader.prototype.loadFrame = async function (files) {
  const buf = await files.pointCloudFile.arrayBuffer();
  const points = pcdToFloat32Array(buf);

  if (files.pointsOnly || !files.labelFile) {
    return { points: points, boxes: [], annotations: [] };
  }

  if (!files.egoFile) {
    throw new Error('SiT: select ego_trajectory when label_3d is provided.');
  }

  const ego = parseEgoMatrix(await files.egoFile.text());
  const raw = parseSitLabel3d(await files.labelFile.text());
  const box7List = raw.map(function (o) {
    return o.box7;
  });
  const boxes7 = transformBoxesWorldToLidar(box7List, ego);
  const boxes = [];
  for (let i = 0; i < boxes7.length; i++) {
    boxes.push({
      type: raw[i].type,
      corners: box7ToCorners(boxes7[i]),
    });
  }
  return { points: points, boxes: boxes, annotations: raw };
};

function pcdToFloat32Array(buffer) {
  if (typeof THREE.PCDLoader === 'undefined') {
    throw new Error('THREE.PCDLoader not loaded. Include assets/PCDLoader.js.');
  }
  const loader = new THREE.PCDLoader();
  const pointsObj = loader.parse(buffer, '');
  const pos = pointsObj.geometry.attributes.position;
  if (!pos || pos.count === 0) {
    if (pointsObj.geometry) pointsObj.geometry.dispose();
    if (pointsObj.material) pointsObj.material.dispose();
    throw new Error('PCD contains no points.');
  }
  const n = pos.count;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = pos.getX(i);
    out[i * 4 + 1] = pos.getY(i);
    out[i * 4 + 2] = pos.getZ(i);
    out[i * 4 + 3] = 0;
  }
  if (pointsObj.geometry) pointsObj.geometry.dispose();
  if (pointsObj.material) pointsObj.material.dispose();
  return out;
}

function mapSitClass(name) {
  if (name === 'Pedestrain_sitting') return 'Pedestrian';
  return name;
}

function parseSitLabel3d(text) {
  const out = [];
  const lines = text.trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(/\s+/);
    if (p.length !== 9) {
      if (p.length >= 15) {
        throw new Error(
          'This looks like KITTI label_2 (15+ fields). Use SiT label_3d (9 fields).',
        );
      }
      throw new Error('SiT label_3d: expected 9 fields, got ' + p.length);
    }
    // Official README / sit_converter: fields 2–4 are h, l, w (not h, w, l).
    const h = parseFloat(p[2]);
    const l = parseFloat(p[3]);
    const w = parseFloat(p[4]);
    const x = parseFloat(p[5]);
    const y = parseFloat(p[6]);
    const z = parseFloat(p[7]);
    const yaw = parseFloat(p[8]);
    out.push({
      type: mapSitClass(p[0]),
      instance_token: p[1],
      // box_center_to_corner_3d uses l,w,h = dims[0..2] after h,l,w -> w,l,h reorder.
      box7: [x, y, z, w, l, h, yaw],
    });
  }
  return out;
}

function parseEgoMatrix(text) {
  const parts = text.trim().split(',');
  if (parts.length !== 16) {
    throw new Error('SiT ego_trajectory: expected 16 comma-separated values.');
  }
  const vals = parts.map(Number);
  for (let i = 0; i < vals.length; i++) {
    if (!Number.isFinite(vals[i])) {
      throw new Error('SiT ego_trajectory: invalid number at index ' + i);
    }
  }
  return [
    [vals[0], vals[1], vals[2], vals[3]],
    [vals[4], vals[5], vals[6], vals[7]],
    [vals[8], vals[9], vals[10], vals[11]],
    [vals[12], vals[13], vals[14], vals[15]],
  ];
}

function invert4x4(m) {
  const a = m[0][0],
    b = m[0][1],
    c = m[0][2],
    d = m[0][3];
  const e = m[1][0],
    f = m[1][1],
    g = m[1][2],
    h = m[1][3];
  const i = m[2][0],
    j = m[2][1],
    k = m[2][2],
    l = m[2][3];
  const M = m[3][0],
    N = m[3][1],
    O = m[3][2],
    P = m[3][3];

  const A00 = f * (k * P - l * O) - g * (j * P - l * N) + h * (j * O - k * N);
  const A01 = -(e * (k * P - l * O) - g * (i * P - l * M) + h * (i * O - k * M));
  const A02 = e * (j * P - l * N) - f * (i * P - l * M) + h * (i * N - j * M);
  const A03 = -(e * (j * O - k * N) - f * (i * O - k * M) + g * (i * N - j * M));

  const A10 = -(b * (k * P - l * O) - c * (j * P - l * N) + d * (j * O - k * N));
  const A11 = a * (k * P - l * O) - c * (i * P - l * M) + d * (i * O - k * M);
  const A12 = -(a * (j * P - l * N) - b * (i * P - l * M) + d * (i * N - j * M));
  const A13 = a * (j * O - k * N) - b * (i * O - k * M) + c * (i * N - j * M);

  const A20 = b * (g * P - h * O) - c * (f * P - h * N) + d * (f * O - g * N);
  const A21 = -(a * (g * P - h * O) - c * (e * P - h * M) + d * (e * O - g * M));
  const A22 = a * (f * P - h * N) - b * (e * P - h * M) + d * (e * N - f * M);
  const A23 = -(a * (f * O - g * N) - b * (e * O - g * M) + c * (e * N - f * M));

  const A30 = -(b * (g * l - h * k) - c * (f * l - h * j) + d * (f * k - g * j));
  const A31 = a * (g * l - h * k) - c * (e * l - h * i) + d * (e * k - g * i);
  const A32 = -(a * (f * l - h * j) - b * (e * l - h * i) + d * (e * j - f * i));
  const A33 = a * (f * k - g * j) - b * (e * k - g * i) + c * (e * j - f * i);

  let det =
    a * A00 + b * A01 + c * A02 + d * A03;
  if (Math.abs(det) < 1e-12) {
    throw new Error('SiT ego_trajectory matrix is singular.');
  }
  det = 1 / det;

  return [
    [A00 * det, A01 * det, A02 * det, A03 * det],
    [A10 * det, A11 * det, A12 * det, A13 * det],
    [A20 * det, A21 * det, A22 * det, A23 * det],
    [A30 * det, A31 * det, A32 * det, A33 * det],
  ];
}

function mul4x4Vec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3] * v[3],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
    m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3],
  ];
}

function transformYawWorldToLidar(yaw, inv) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const vx =
    inv[0][0] * c + inv[0][1] * s;
  const vy =
    inv[1][0] * c + inv[1][1] * s;
  return Math.atan2(vy, vx);
}

function transformBoxesWorldToLidar(boxes, ego) {
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    out.push(boxes[i].slice());
  }
  const inv = invert4x4(ego);
  for (let b = 0; b < out.length; b++) {
    const q = mul4x4Vec(inv, [out[b][0], out[b][1], out[b][2], 1]);
    out[b][0] = q[0];
    out[b][1] = q[1];
    out[b][2] = q[2];
    out[b][6] = transformYawWorldToLidar(out[b][6], inv);
    out[b][6] = ((out[b][6] + Math.PI) % (2 * Math.PI)) - Math.PI;
  }
  return out;
}

/**
 * Box wireframe corners — ports SiT-Dataset sit_converter.box_center_to_corner_3d_
 * (l along x, w along y, z-yaw, geometric center with z from -h/2 to +h/2).
 */
function box7ToCorners(box) {
  const x = box[0];
  const y = box[1];
  const z = box[2];
  const l = Math.abs(box[3]);
  const w = Math.abs(box[4]);
  const h = Math.abs(box[5]);
  let yaw = box[6];
  yaw = ((yaw + Math.PI) % (2 * Math.PI)) - Math.PI;

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hl = l / 2;
  const hw = w / 2;
  const hh = h / 2;
  const xLocal = [hl, hl, -hl, -hl, hl, hl, -hl, -hl];
  const yLocal = [hw, -hw, -hw, hw, hw, -hw, -hw, hw];
  const zLocal = [-hh, -hh, -hh, -hh, hh, hh, hh, hh];
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const lx = xLocal[i];
    const ly = yLocal[i];
    const lz = zLocal[i];
    corners.push([
      c * lx - s * ly + x,
      s * lx + c * ly + y,
      lz + z,
    ]);
  }
  return corners;
}

function createSitExplorer({
  pointInput,
  labelInput,
  egoInput,
  visualizeBtn,
}) {
  const files = { point: null, label: null, ego: null };

  function stem(name) {
    return name.replace(/\.[^.]+$/, '');
  }

  function hasLabels() {
    return !!files.label;
  }

  function checkReady() {
    let ready = !!files.point;
    if (hasLabels()) {
      ready = ready && !!files.ego;
    }
    visualizeBtn.disabled = !ready;
    return ready;
  }

  function bind(input, key) {
    input.addEventListener('change', function () {
      files[key] = input.files && input.files[0] ? input.files[0] : null;
      checkReady();
    });
  }

  bind(pointInput, 'point');
  bind(labelInput, 'label');
  bind(egoInput, 'ego');

  return {
    reset() {
      files.point = null;
      files.label = null;
      files.ego = null;
      if (pointInput) pointInput.value = '';
      if (labelInput) labelInput.value = '';
      if (egoInput) egoInput.value = '';
      checkReady();
    },

    getFilesAsync() {
      if (!files.point) {
        return Promise.reject(new Error('Select a SiT point cloud (.pcd).'));
      }

      const pointsOnly = !files.label;
      const sPoint = stem(files.point.name);
      let mismatch = null;

      if (files.label) {
        const sLabel = stem(files.label.name);
        if (sLabel !== sPoint) {
          mismatch =
            'Frame IDs differ: pcd=' + sPoint + ', label=' + sLabel;
        }
        if (files.ego) {
          const sEgo = stem(files.ego.name);
          if (sEgo !== sPoint) {
            mismatch =
              (mismatch ? mismatch + '; ' : '') +
              'pcd=' +
              sPoint +
              ', ego=' +
              sEgo;
          }
        }
      }

      const payload = {
        pointCloudFile: files.point,
        labelFile: files.label,
        egoFile: files.ego,
        frameId: sPoint,
        mismatch: mismatch,
        pointsOnly: pointsOnly,
      };

      if (!files.label) {
        return Promise.resolve(payload);
      }

      return files.label.text().then(function (text) {
        const first = text
          .trim()
          .split('\n')
          .find(function (ln) {
            return ln.trim();
          });
        if (first) {
          const n = first.trim().split(/\s+/).length;
          if (n >= 15) {
            return Promise.reject(
              new Error(
                'Labels look like KITTI label_2. Use SiT label_3d (9 fields per line).',
              ),
            );
          }
        }
        if (!files.ego) {
          return Promise.reject(
            new Error('SiT: select ego_trajectory when label_3d is provided.'),
          );
        }
        return files.ego.text().then(function (egoText) {
          parseEgoMatrix(egoText);
          return payload;
        });
      });
    },
  };
}

window.SitLoader = SitLoader;
window.createSitExplorer = createSitExplorer;

function registerSitDataset() {
  DatasetRegistry.register('sit', {
    name: 'SiT',
    fileHint:
      'velo/concat .pcd; optional label_3d + ego_trajectory (same frame id)',
    Loader: SitLoader,
    createExplorer: function (opts) {
      return createSitExplorer(opts);
    },
  });
}

window.registerSitDataset = registerSitDataset;
registerSitDataset();
