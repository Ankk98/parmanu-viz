/**
 * KITTI: three file pickers per frame.
 */
function createKittiExplorer({
  pointInput,
  binInput,
  labelInput,
  calibInput,
  visualizeBtn,
  onReadyChange,
}) {
  const cloudInput = pointInput || binInput;
  const files = { point: null, label: null, calib: null };

  function stem(name) {
    const m = name.match(/(\d{6})/);
    return m ? m[1] : name.replace(/\.[^.]+$/, '');
  }

  function checkReady() {
    const ready = !!(files.point && files.label && files.calib);
    visualizeBtn.disabled = !ready;
    if (onReadyChange) onReadyChange(ready, files);
    return ready;
  }

  function bind(input, key) {
    input.addEventListener('change', function () {
      files[key] = input.files && input.files[0] ? input.files[0] : null;
      checkReady();
    });
  }

  bind(cloudInput, 'point');
  bind(labelInput, 'label');
  bind(calibInput, 'calib');

  return {
    reset() {
      files.point = null;
      files.label = null;
      files.calib = null;
      if (cloudInput) cloudInput.value = '';
      if (labelInput) labelInput.value = '';
      if (calibInput) calibInput.value = '';
      checkReady();
    },

    getFilesAsync() {
      if (!files.point || !files.label || !files.calib) {
        return Promise.reject(
          new Error('Select point cloud, labels, and calibration files.'),
        );
      }
      const sPoint = stem(files.point.name);
      const sLabel = stem(files.label.name);
      const sCalib = stem(files.calib.name);
      const mismatch =
        sPoint !== sLabel || sPoint !== sCalib
          ? 'Frame IDs differ: cloud=' +
            sPoint +
            ', label=' +
            sLabel +
            ', calib=' +
            sCalib
          : null;
      return files.calib.text().then(function (text) {
        if (!text.includes('Tr_velo_to_cam:')) {
          throw new Error(
            'Calibration file must contain Tr_velo_to_cam (did you pick label_2 by mistake?)',
          );
        }
        return {
          pointCloudFile: files.point,
          labelFile: files.label,
          calibFile: files.calib,
          frameId: sPoint,
          mismatch: mismatch,
        };
      });
    },
  };
}

window.createKittiExplorer = createKittiExplorer;
