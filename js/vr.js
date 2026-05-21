/**
 * WebXR VR for parmanu-viz.
 *
 * Design notes:
 * - All controller input is read *live* from `session.inputSources[i].gamepad`
 *   inside the XR animation loop. Nothing is cached on controllers; there is
 *   no per-controller state machine.
 * - Mapping follows the WebXR `xr-standard` gamepad layout used by Quest Touch:
 *     axes[2] = thumbstick X       axes[3] = thumbstick Y
 *     buttons[0] = trigger         buttons[1] = grip (squeeze)
 * - Three.js `renderer.xr.getController(i)` is used only for visualization
 *   (ray line) and for teleport raycasts (its matrixWorld follows the
 *   targetRaySpace of `session.inputSources[i]`).
 */
(function () {
  var STICK_DEADZONE = 0.15;
  var WALK_SPEED = 2.0;      // m/s
  var FLY_SPEED = 1.5;       // m/s (right stick Y)
  var TURN_SPEED = 2.0;      // rad/s (right stick X, yaw)

  var raycaster = new THREE.Raycaster();
  var _tmpMatrix = new THREE.Matrix4();
  var _dir = new THREE.Vector3();
  var _right = new THREE.Vector3();

  var state = {
    viewer: null,
    renderer: null,
    camera: null,
    scene: null,
    contentGroup: null,
    xrRig: null,
    controls: null,
    vrBtn: null,
    sceneReady: false,
    xrGround: null,
    teleportMarker: null,
    gridHelper: null,
    originMarker: null,
    originLabel: null,
    controlsPanel: null,
    vrLegendPanel: null,
    debugPanel: null,
    debugCtx: null,
    debugTexture: null,
    legendTexture: null,
    xrControllers: [],
    // Per-input edge-trigger state (key: XRInputSource).
    prevTrigger: new WeakMap(),
    prevGrip: new WeakMap(),
  };

  // ---------- WebXR status (HUD line) ---------------------------------------

  var xrStatusSettled = false;
  var xrStatusTimer = null;

  function setXrStatusHtml(html) {
    var el = document.getElementById('xr-status');
    if (el) el.innerHTML = html;
  }

  function updateXRStatus() {
    if (xrStatusTimer) {
      clearTimeout(xrStatusTimer);
      xrStatusTimer = null;
    }
    xrStatusSettled = false;

    if (!window.isSecureContext) {
      setXrStatusHtml(
        '<strong>WebXR:</strong> needs HTTPS (or localhost). ' +
          'Open <a href="https://ankk98.github.io/parmanu-viz/">GitHub Pages</a> for VR.',
      );
      xrStatusSettled = true;
      return;
    }
    if (!('xr' in navigator)) {
      setXrStatusHtml('<strong>WebXR:</strong> not available in this browser');
      xrStatusSettled = true;
      return;
    }

    xrStatusTimer = setTimeout(function () {
      if (xrStatusSettled) return;
      xrStatusSettled = true;
      setXrStatusHtml(
        '<strong>WebXR:</strong> check timed out — use Quest Browser, HTTPS, reload',
      );
    }, 8000);

    navigator.xr
      .isSessionSupported('immersive-vr')
      .then(function (supported) {
        if (xrStatusSettled) return;
        xrStatusSettled = true;
        if (xrStatusTimer) clearTimeout(xrStatusTimer);
        setXrStatusHtml(
          supported
            ? '<strong>WebXR:</strong> immersive-vr supported'
            : '<strong>WebXR:</strong> immersive-vr not supported. Use Quest Browser; enable WebXR in chrome://flags',
        );
      })
      .catch(function (err) {
        if (xrStatusSettled) return;
        xrStatusSettled = true;
        if (xrStatusTimer) clearTimeout(xrStatusTimer);
        var msg = err && err.message ? err.message : String(err);
        setXrStatusHtml('<strong>WebXR:</strong> check failed (' + msg + ')');
      });
  }

  // ---------- VR Button toggle ---------------------------------------------

  function setVrButtonReady(ready) {
    if (!state.vrBtn || !state.vrBtn.id) return;
    state.vrBtn.disabled = !ready;
    state.vrBtn.style.opacity = ready ? '' : '0.35';
    state.vrBtn.style.pointerEvents = ready ? '' : 'none';
  }

  // ---------- Canvas-texture panels ----------------------------------------

  var VR_HELP_LINES = [
    'Left stick: Walk / Strafe',
    'Right stick X: Turn (yaw)',
    'Right stick Y: Fly up / down',
    'Trigger: aim at floor -> Teleport',
    'Grip: toggle help / legend',
  ];

  function createVRControlsPanel() {
    var canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 1004, 492);
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('VR Controls', 40, 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = '34px Arial';
    var y = 160;
    for (var i = 0; i < VR_HELP_LINES.length; i++) {
      ctx.fillText(VR_HELP_LINES[i], 60, y);
      y += 64;
    }
    var texture = new THREE.CanvasTexture(canvas);
    var panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    panel.position.set(-0.75, 0.4, -2);
    panel.visible = false;
    return panel;
  }

  function drawLegendCanvas(entries) {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 496, 496);
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Legend', 30, 50);
    var y = 100;
    if (!entries || entries.length === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px Arial';
      ctx.fillText('No boxes to display', 30, y);
    } else {
      for (var i = 0; i < entries.length; i++) {
        var ent = entries[i];
        ctx.fillStyle = ent.hex;
        ctx.fillRect(30, y - 20, 35, 35);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(30, y - 20, 35, 35);
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px Arial';
        ctx.fillText(ent.type + ' (' + ent.count + ')', 80, y + 5);
        y += 55;
        if (y > 480) break;
      }
    }
    return canvas;
  }

  function createVRLegendPanel() {
    var canvas = drawLegendCanvas([]);
    var texture = new THREE.CanvasTexture(canvas);
    state.legendTexture = texture;
    var panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    panel.position.set(0.75, 0.4, -2);
    panel.visible = false;
    return panel;
  }

  function createOriginLabel() {
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LiDAR Sensor Origin', 256, 40);
    ctx.font = '32px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(0, 0, 0)', 256, 85);
    var texture = new THREE.CanvasTexture(canvas);
    var label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.125),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    label.position.set(0, 0.15, 0);
    label.visible = false;
    return label;
  }

  function createDebugPanel() {
    var canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    state.debugCtx = canvas.getContext('2d');
    state.debugTexture = new THREE.CanvasTexture(canvas);
    var panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.4),
      new THREE.MeshBasicMaterial({
        map: state.debugTexture,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    panel.position.set(0, 1.05, -1.5);
    panel.visible = false;
    return panel;
  }

  // ---------- Controllers (visual rays only) -------------------------------

  function addController(index) {
    var ctrl = state.renderer.xr.getController(index);
    var lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3),
    );
    var line = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    line.scale.z = 20;
    ctrl.add(line);
    state.xrRig.add(ctrl);
    state.xrControllers.push(ctrl);
    return ctrl;
  }

  function intersectGround(ctrl) {
    _tmpMatrix.identity().extractRotation(ctrl.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_tmpMatrix);
    var hits = raycaster.intersectObject(state.xrGround, false);
    return hits && hits.length > 0 ? hits[0] : null;
  }

  // ---------- Live input ---------------------------------------------------

  function deadzone(v) {
    return Math.abs(v) > STICK_DEADZONE ? v : 0;
  }

  /**
   * Pair an XRInputSource with the three.js controller Object3D at the same
   * index in `session.inputSources`. Three.js assigns inputSources to
   * `getController(i)` in order, so indices align.
   */
  function processInputs(delta) {
    var session = state.renderer.xr.getSession();
    if (!session) return null;
    var sources = session.inputSources;
    if (!sources) return null;

    // Find left/right sources; fall back to index 0/1 if handedness missing.
    var leftSrc = null;
    var rightSrc = null;
    var leftCtrl = null;
    var rightCtrl = null;

    var i;
    for (i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (!s) continue;
      if (s.handedness === 'left' && !leftSrc) {
        leftSrc = s;
        leftCtrl = state.xrControllers[i] || null;
      } else if (s.handedness === 'right' && !rightSrc) {
        rightSrc = s;
        rightCtrl = state.xrControllers[i] || null;
      }
    }
    if (!leftSrc && !rightSrc) {
      if (sources[0]) {
        leftSrc = sources[0];
        leftCtrl = state.xrControllers[0] || null;
      }
      if (sources[1]) {
        rightSrc = sources[1];
        rightCtrl = state.xrControllers[1] || null;
      }
    }

    handleLocomotion(delta, leftSrc, rightSrc);
    handleTriggerTeleport(leftSrc, leftCtrl);
    handleTriggerTeleport(rightSrc, rightCtrl);
    handleGripToggle(leftSrc);
    handleGripToggle(rightSrc);

    return {
      sources: sources,
      left: leftSrc,
      right: rightSrc,
    };
  }

  function handleLocomotion(delta, leftSrc, rightSrc) {
    // LEFT stick: walk + strafe on XZ plane, relative to camera facing.
    var lgp = leftSrc && leftSrc.gamepad;
    if (lgp && lgp.axes && lgp.axes.length >= 4) {
      var lx = deadzone(lgp.axes[2]);
      var ly = deadzone(lgp.axes[3]);
      if (lx !== 0 || ly !== 0) {
        state.camera.getWorldDirection(_dir);
        _dir.y = 0;
        if (_dir.lengthSq() > 1e-6) {
          _dir.normalize();
          _right.set(-_dir.z, 0, _dir.x);
          state.xrRig.position.addScaledVector(_dir, -ly * WALK_SPEED * delta);
          state.xrRig.position.addScaledVector(_right, lx * WALK_SPEED * delta);
        }
      }
    }

    // RIGHT stick: X = yaw, Y = fly up/down.
    var rgp = rightSrc && rightSrc.gamepad;
    if (rgp && rgp.axes && rgp.axes.length >= 4) {
      var rx = deadzone(rgp.axes[2]);
      var ry = deadzone(rgp.axes[3]);
      if (rx !== 0) {
        state.xrRig.rotateY(-rx * TURN_SPEED * delta);
      }
      if (ry !== 0) {
        // ly negative = stick up = move up
        state.xrRig.position.y += -ry * FLY_SPEED * delta;
      }
    }
  }

  function handleTriggerTeleport(src, ctrl) {
    if (!src || !ctrl) return;
    var gp = src.gamepad;
    var pressed = !!(gp && gp.buttons && gp.buttons[0] && gp.buttons[0].pressed);
    var prev = state.prevTrigger.get(src) || false;
    state.prevTrigger.set(src, pressed);

    if (pressed) {
      var hit = intersectGround(ctrl);
      if (hit) {
        state.teleportMarker.position.copy(hit.point);
        state.teleportMarker.visible = true;
      } else {
        state.teleportMarker.visible = false;
      }
    } else if (prev && !pressed) {
      // edge: trigger released -> commit teleport
      var releaseHit = intersectGround(ctrl);
      if (releaseHit) {
        state.xrRig.position.x = releaseHit.point.x;
        state.xrRig.position.z = releaseHit.point.z;
      }
      state.teleportMarker.visible = false;
    }
  }

  function handleGripToggle(src) {
    if (!src) return;
    var gp = src.gamepad;
    var pressed = !!(gp && gp.buttons && gp.buttons[1] && gp.buttons[1].pressed);
    var prev = state.prevGrip.get(src) || false;
    state.prevGrip.set(src, pressed);
    if (pressed && !prev) {
      var vis = !(state.controlsPanel && state.controlsPanel.visible);
      if (state.controlsPanel) state.controlsPanel.visible = vis;
      if (state.vrLegendPanel) state.vrLegendPanel.visible = vis;
    }
  }

  // ---------- Debug overlay ------------------------------------------------

  function fmtAxes(gp) {
    if (!gp || !gp.axes) return 'no gp';
    var parts = [];
    for (var i = 0; i < gp.axes.length; i++) {
      parts.push((gp.axes[i] || 0).toFixed(2));
    }
    return '[' + parts.join(', ') + ']';
  }

  function fmtButtons(gp) {
    if (!gp || !gp.buttons) return '';
    var pressed = [];
    for (var i = 0; i < gp.buttons.length; i++) {
      if (gp.buttons[i] && gp.buttons[i].pressed) pressed.push(i);
    }
    return pressed.length ? 'btn:' + pressed.join(',') : '';
  }

  function updateDebugPanel(snap) {
    var ctx = state.debugCtx;
    if (!ctx || !state.debugTexture || !state.debugPanel) return;
    if (!state.debugPanel.visible) return;
    ctx.clearRect(0, 0, 1024, 256);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 1012, 244);
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'left';
    var srcCount = snap && snap.sources ? snap.sources.length : 0;
    ctx.fillText('XR inputs: ' + srcCount + ' source(s)', 20, 36);
    ctx.font = '20px monospace';
    ctx.fillStyle = '#ffffff';
    var L = snap && snap.left ? snap.left.gamepad : null;
    var R = snap && snap.right ? snap.right.gamepad : null;
    ctx.fillText(
      'L: ' + fmtAxes(L) + '  ' + fmtButtons(L),
      20,
      80,
    );
    ctx.fillText(
      'R: ' + fmtAxes(R) + '  ' + fmtButtons(R),
      20,
      120,
    );
    ctx.fillStyle = '#ffd479';
    ctx.font = '18px monospace';
    ctx.fillText(
      'walk = left[2,3]   turn/fly = right[2,3]   trigger=btn0   grip=btn1',
      20,
      170,
    );
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(
      'Tip: grip toggles help panel. Press grip again to hide debug.',
      20,
      210,
    );
    state.debugTexture.needsUpdate = true;
  }

  // ---------- Session lifecycle --------------------------------------------

  function setDesktopControlsEnabled(enabled) {
    if (state.controls) state.controls.enabled = enabled;
  }

  function onSessionStart() {
    setDesktopControlsEnabled(false);
    document.body.classList.add('vr-presenting');
    state.contentGroup.rotation.x = -Math.PI / 2;
    state.xrRig.position.set(0, -1.6, 3);
    state.xrRig.rotation.set(0, 0, 0);
    state.renderer.setPixelRatio(1);
    state.viewer.setVrPointVisibility(true);

    state.gridHelper.visible = true;
    state.originMarker.visible = true;
    state.originLabel.visible = true;
    state.controlsPanel.visible = true;
    state.vrLegendPanel.visible = true;
    if (state.debugPanel) state.debugPanel.visible = true;
  }

  function onSessionEnd() {
    setDesktopControlsEnabled(true);
    document.body.classList.remove('vr-presenting');
    state.contentGroup.rotation.x = 0;
    state.xrRig.position.set(0, 0, 0);
    state.xrRig.rotation.set(0, 0, 0);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.viewer.setVrPointVisibility(false);

    state.gridHelper.visible = false;
    state.teleportMarker.visible = false;
    state.originMarker.visible = false;
    state.originLabel.visible = false;
    state.controlsPanel.visible = false;
    state.vrLegendPanel.visible = false;
    if (state.debugPanel) state.debugPanel.visible = false;
  }

  // ---------- Public API ---------------------------------------------------

  window.parmanuVr = {
    updateXRStatus: updateXRStatus,

    init: function (viewer) {
      try {
        state.viewer = viewer;
        state.renderer = viewer.getRenderer();
        state.camera = viewer.getCamera();
        state.scene = viewer.getScene();
        state.contentGroup = viewer.getContentGroup();
        state.xrRig = viewer.getXrRig();
        state.controls = viewer.getControls();

        state.xrGround = new THREE.Mesh(
          new THREE.PlaneGeometry(2000, 2000),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
          }),
        );
        state.xrGround.rotation.x = -Math.PI / 2;
        state.xrGround.position.set(0, -1.6, 0);
        state.scene.add(state.xrGround);

        state.teleportMarker = new THREE.Mesh(
          new THREE.RingGeometry(0.2, 0.3, 32),
          new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7,
          }),
        );
        state.teleportMarker.rotation.x = -Math.PI / 2;
        state.teleportMarker.visible = false;
        state.scene.add(state.teleportMarker);

        state.gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222);
        state.gridHelper.position.y = -1.6;
        state.gridHelper.visible = false;
        state.scene.add(state.gridHelper);

        state.originMarker = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 16, 16),
          new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.8,
          }),
        );
        state.originMarker.visible = false;
        state.contentGroup.add(state.originMarker);

        state.originLabel = createOriginLabel();
        state.contentGroup.add(state.originLabel);

        state.controlsPanel = createVRControlsPanel();
        state.xrRig.add(state.controlsPanel);

        state.vrLegendPanel = createVRLegendPanel();
        state.xrRig.add(state.vrLegendPanel);

        state.debugPanel = createDebugPanel();
        state.xrRig.add(state.debugPanel);

        addController(0);
        addController(1);

        state.renderer.xr.addEventListener('sessionstart', onSessionStart);
        state.renderer.xr.addEventListener('sessionend', onSessionEnd);

        if (typeof THREE.VRButton !== 'undefined') {
          state.vrBtn = THREE.VRButton.createButton(state.renderer);
          document.body.appendChild(state.vrBtn);
          setVrButtonReady(false);
        }
      } catch (err) {
        console.error('parmanuVr.init failed:', err);
        setXrStatusHtml(
          '<strong>WebXR:</strong> VR init failed — ' +
            (err && err.message ? err.message : err),
        );
        return;
      }
      updateXRStatus();
    },

    setSceneReady: function (ready) {
      state.sceneReady = !!ready;
      setVrButtonReady(state.sceneReady);
    },

    updateLegendPanel: function (entries) {
      if (!state.vrLegendPanel) return;
      var canvas = drawLegendCanvas(entries || []);
      if (state.legendTexture) state.legendTexture.dispose();
      state.legendTexture = new THREE.CanvasTexture(canvas);
      state.vrLegendPanel.material.map = state.legendTexture;
      state.vrLegendPanel.material.needsUpdate = true;
    },

    updateFrame: function (delta) {
      if (!state.renderer.xr.isPresenting) return;
      var snap = processInputs(delta);
      updateDebugPanel(snap);
      if (state.originLabel && state.originLabel.visible) {
        state.originLabel.lookAt(state.camera.position);
      }
      if (state.originMarker && state.originMarker.visible) {
        var s = 1.0 + 0.3 * Math.sin(Date.now() * 0.003);
        state.originMarker.scale.setScalar(s);
      }
    },

    dispose: function () {
      if (state.vrBtn && state.vrBtn.parentNode) {
        state.vrBtn.parentNode.removeChild(state.vrBtn);
      }
    },
  };

  function bootXrStatus() {
    updateXRStatus();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootXrStatus);
  } else {
    bootXrStatus();
  }
})();
