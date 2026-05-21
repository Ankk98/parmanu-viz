/**
 * KITTI: three file pickers per frame.
 */
function createKittiExplorer({
  binInput,
  labelInput,
  calibInput,
  visualizeBtn,
  onReadyChange,
}) {
  const files = { bin: null, label: null, calib: null };

  function stem(name) {
    const m = name.match(/(\d{6})/);
    return m ? m[1] : name.replace(/\.[^.]+$/, '');
  }

  function checkReady() {
    const ready = !!(files.bin && files.label && files.calib);
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

  bind(binInput, 'bin');
  bind(labelInput, 'label');
  bind(calibInput, 'calib');

  return {
    reset() {
      files.bin = null;
      files.label = null;
      files.calib = null;
      if (binInput) binInput.value = '';
      if (labelInput) labelInput.value = '';
      if (calibInput) calibInput.value = '';
      checkReady();
    },

    getFilesAsync() {
      if (!files.bin || !files.label || !files.calib) {
        return Promise.reject(
          new Error('Select point cloud, labels, and calibration files.'),
        );
      }
      const sBin = stem(files.bin.name);
      const sLabel = stem(files.label.name);
      const sCalib = stem(files.calib.name);
      const mismatch =
        sBin !== sLabel || sBin !== sCalib
          ? 'Frame IDs differ: bin=' +
            sBin +
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
          pointCloudFile: files.bin,
          labelFile: files.label,
          calibFile: files.calib,
          frameId: sBin,
          mismatch: mismatch,
        };
      });
    },
  };
}

window.createKittiExplorer = createKittiExplorer;
