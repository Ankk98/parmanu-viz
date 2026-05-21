/**
 * parmanu-viz v1 — desktop viewer, no server.
 */
(function () {
  const els = {
    container: document.getElementById('container'),
    status: document.getElementById('status'),
    legend: document.getElementById('legend'),
    datasetSelect: document.getElementById('dataset-select'),
    fileHint: document.getElementById('file-hint'),
    panelKitti: document.getElementById('file-panel-kitti'),
    panelSit: document.getElementById('file-panel-sit'),
    kitti: {
      pointcloud: document.getElementById('kitti-pointcloud'),
      label: document.getElementById('kitti-label'),
      calib: document.getElementById('kitti-calib'),
    },
    sit: {
      pointcloud: document.getElementById('sit-pointcloud'),
      label: document.getElementById('sit-label'),
      ego: document.getElementById('sit-ego'),
      skipEgo: document.getElementById('sit-skip-ego'),
    },
    visualize: document.getElementById('btn-visualize'),
    sensorPov: document.getElementById('btn-sensor-pov'),
    overview: document.getElementById('btn-overview'),
    resetView: document.getElementById('btn-reset-view'),
  };

  let datasetId = 'kitti';
  let explorer = null;
  let loader = null;
  const explorers = {};

  function setStatus(msg, isError) {
    els.status.textContent = msg;
    els.status.classList.toggle('error', !!isError);
  }

  if (typeof registerKittiDataset === 'function') {
    registerKittiDataset();
  }
  DatasetRegistry.fillSelect(els.datasetSelect, 'kitti');
  datasetId = els.datasetSelect.value || 'kitti';

  if (typeof window.viewer === 'undefined') {
    setStatus('Viewer failed to load. Check that js/viewer.js is present.', true);
    return;
  }

  if (typeof THREE.PCDLoader === 'undefined') {
    setStatus('PCDLoader failed to load. Check assets/PCDLoader.js.', true);
    return;
  }

  try {
    window.viewer.init(els.container);
  } catch (err) {
    console.error(err);
    setStatus('Viewer init failed: ' + (err.message || err), true);
    return;
  }

  function applyDatasetUi(id) {
    const isSit = id === 'sit';
    els.panelKitti.hidden = isSit;
    els.panelSit.hidden = !isSit;
  }

  function clearFileInputs() {
    els.kitti.pointcloud.value = '';
    els.kitti.label.value = '';
    els.kitti.calib.value = '';
    els.sit.pointcloud.value = '';
    els.sit.label.value = '';
    els.sit.ego.value = '';
    if (els.sit.skipEgo) els.sit.skipEgo.checked = false;
  }

  function bindExplorer() {
    const entry = DatasetRegistry.get(datasetId);
    applyDatasetUi(datasetId);
    els.fileHint.textContent = entry.fileHint;

    if (!explorers[datasetId]) {
      if (datasetId === 'sit') {
        explorers.sit = DatasetRegistry.createExplorer('sit', {
          pointInput: els.sit.pointcloud,
          labelInput: els.sit.label,
          egoInput: els.sit.ego,
          skipEgoInput: els.sit.skipEgo,
          visualizeBtn: els.visualize,
        });
      } else {
        explorers.kitti = DatasetRegistry.createExplorer('kitti', {
          pointInput: els.kitti.pointcloud,
          labelInput: els.kitti.label,
          calibInput: els.kitti.calib,
          visualizeBtn: els.visualize,
        });
      }
    }
    explorer = explorers[datasetId];
    loader = DatasetRegistry.createLoader(datasetId);
  }

  function updateLegend(boxes) {
    var counts = {};
    var i;
    for (i = 0; i < boxes.length; i++) {
      var t = boxes[i].type;
      counts[t] = (counts[t] || 0) + 1;
    }
    els.legend.innerHTML = '<div class="legend-title"><strong>Objects</strong></div>';
    var types = Object.keys(counts).sort();
    for (i = 0; i < types.length; i++) {
      var typeName = types[i];
      var hex =
        window.viewer && window.viewer.getTypeColorHex
          ? window.viewer.getTypeColorHex(typeName)
          : '#CCCCCC';

      var row = document.createElement('div');
      row.className = 'legend-item';

      var swatch = document.createElement('div');
      swatch.className = 'legend-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = hex;

      var label = document.createElement('div');
      label.className = 'legend-label';
      label.innerHTML =
        '<span class="legend-type">' +
        typeName +
        '</span>' +
        '<span class="legend-meta">' +
        hex +
        ' · ' +
        counts[typeName] +
        '</span>';

      row.appendChild(swatch);
      row.appendChild(label);
      els.legend.appendChild(row);
    }
    if (types.length === 0) {
      els.legend.innerHTML =
        '<div class="legend-title"><strong>Objects</strong></div>' +
        '<div class="legend-item legend-empty">None</div>';
    }
  }

  function onDatasetChange() {
    datasetId = els.datasetSelect.value;
    clearFileInputs();
    bindExplorer();
    if (explorer && explorer.reset) explorer.reset();
    els.resetView.disabled = true;
    els.sensorPov.disabled = true;
    els.overview.disabled = true;
    setStatus(
      'Dataset: ' +
        DatasetRegistry.get(datasetId).name +
        ' — select files, then Visualize',
    );
  }

  els.datasetSelect.addEventListener('change', onDatasetChange);

  bindExplorer();

  els.visualize.addEventListener('click', function () {
    els.visualize.disabled = true;
    setStatus('Loading…');
    explorer
      .getFilesAsync()
      .then(function (files) {
        if (files.mismatch) {
          setStatus('Warning: ' + files.mismatch + '. Loading anyway…');
        }
        const t0 = performance.now();
        return loader.loadFrame(files).then(function (scene) {
          const stats = window.viewer.loadScene(scene);
          const ms = (performance.now() - t0).toFixed(0);
          updateLegend(scene.boxes);
          els.resetView.disabled = false;
          els.sensorPov.disabled = false;
          els.overview.disabled = false;
          var suffix = files.pointsOnly ? ' (points only)' : '';
          if (files.skipEgoTransform && !files.pointsOnly) {
            suffix += ' · skip ego (yaw flip only)';
          } else if (!files.pointsOnly && datasetId === 'sit') {
            suffix += ' · official viz transform';
          }
          setStatus(
            DatasetRegistry.get(datasetId).name +
              ' · frame ' +
              files.frameId +
              ': ' +
              stats.numPoints.toLocaleString() +
              ' points, ' +
              stats.numBoxes +
              ' boxes' +
              suffix +
              ' (' +
              ms +
              ' ms)',
          );
        });
      })
      .catch(function (err) {
        console.error(err);
        setStatus(err.message || String(err), true);
      })
      .finally(function () {
        els.visualize.disabled = false;
      });
  });

  els.resetView.addEventListener('click', function () {
    window.viewer.resetView();
  });

  els.sensorPov.addEventListener('click', function () {
    if (window.viewer.hasScene && window.viewer.hasScene()) {
      window.viewer.goToSensorPov();
    }
  });

  els.overview.addEventListener('click', function () {
    if (window.viewer.hasScene && window.viewer.hasScene()) {
      window.viewer.goToOverview();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
      return;
    }
    if (e.key === 'r' || e.key === 'R') window.viewer.resetView();
    if (e.key === 'o' || e.key === 'O') {
      if (window.viewer.hasScene && window.viewer.hasScene()) {
        window.viewer.goToSensorPov();
      }
    }
    if (e.key === 'v' || e.key === 'V') {
      if (window.viewer.hasScene && window.viewer.hasScene()) {
        window.viewer.goToOverview();
      }
    }
  });

  setStatus('Dataset: KITTI Object — select files, then Visualize');
})();
