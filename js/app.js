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
    filePanel: document.getElementById('file-inputs'),
    bin: document.getElementById('file-bin'),
    label: document.getElementById('file-label'),
    calib: document.getElementById('file-calib'),
    visualize: document.getElementById('btn-visualize'),
    resetView: document.getElementById('btn-reset-view'),
  };

  let datasetId = 'kitti';
  let explorer = null;
  let loader = null;

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

  try {
    window.viewer.init(els.container);
  } catch (err) {
    console.error(err);
    setStatus('Viewer init failed: ' + (err.message || err), true);
    return;
  }

  function bindExplorer() {
    const entry = DatasetRegistry.get(datasetId);
    els.fileHint.textContent = entry.fileHint;
    explorer = DatasetRegistry.createExplorer(datasetId, {
      binInput: els.bin,
      labelInput: els.label,
      calibInput: els.calib,
      visualizeBtn: els.visualize,
    });
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
    if (explorer && explorer.reset) explorer.reset();
    bindExplorer();
    els.resetView.disabled = true;
    setStatus('Dataset: ' + DatasetRegistry.get(datasetId).name + ' — select files, then Visualize');
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
          setStatus(
            DatasetRegistry.get(datasetId).name +
              ' · frame ' +
              files.frameId +
              ': ' +
              stats.numPoints.toLocaleString() +
              ' points, ' +
              stats.numBoxes +
              ' boxes (' +
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'r' || e.key === 'R') window.viewer.resetView();
  });

  setStatus('Dataset: KITTI Object — select files, then Visualize');
})();
