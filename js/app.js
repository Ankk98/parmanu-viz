import { KITTILoader } from './datasets/kitti.js';
import { viewer } from './viewer.js';
import { createExplorer } from './explorer.js';

const loader = new KITTILoader();

const els = {
  container: document.getElementById('container'),
  status: document.getElementById('status'),
  legend: document.getElementById('legend'),
  bin: document.getElementById('file-bin'),
  label: document.getElementById('file-label'),
  calib: document.getElementById('file-calib'),
  visualize: document.getElementById('btn-visualize'),
  resetView: document.getElementById('btn-reset-view'),
};

viewer.init(els.container);

const explorer = createExplorer({
  binInput: els.bin,
  labelInput: els.label,
  calibInput: els.calib,
  visualizeBtn: els.visualize,
});

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function updateLegend(boxes) {
  const counts = {};
  for (const b of boxes) {
    counts[b.type] = (counts[b.type] || 0) + 1;
  }
  els.legend.innerHTML = '<div><strong>Objects</strong></div>';
  for (const [type, n] of Object.entries(counts).sort()) {
    const row = document.createElement('div');
    row.className = 'legend-item';
    row.textContent = `${type}: ${n}`;
    els.legend.appendChild(row);
  }
  if (Object.keys(counts).length === 0) {
    els.legend.innerHTML = '<div><strong>Objects</strong></div><div class="legend-item">None</div>';
  }
}

els.visualize.addEventListener('click', async () => {
  try {
    setStatus('Loading…');
    els.visualize.disabled = true;
    const files = explorer.getFiles();
    if (files.mismatch) setStatus(`Warning: ${files.mismatch}. Loading anyway…`);

    await explorer.validateCalib(files.calibFile);
    const t0 = performance.now();
    const scene = await loader.loadFrame({
      pointCloudFile: files.pointCloudFile,
      labelFile: files.labelFile,
      calibFile: files.calibFile,
    });
    const stats = viewer.loadScene(scene);
    const ms = (performance.now() - t0).toFixed(0);
    updateLegend(scene.boxes);
    els.resetView.disabled = false;
    setStatus(
      `Frame ${files.frameId}: ${stats.numPoints.toLocaleString()} points, ${stats.numBoxes} boxes (${ms} ms)`,
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    els.visualize.disabled = false;
  }
});

els.resetView.addEventListener('click', () => viewer.resetView());

document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') viewer.resetView();
});

setStatus('Select .bin, label_2 .txt, and calib .txt, then Visualize');
