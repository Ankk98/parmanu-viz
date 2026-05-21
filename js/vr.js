/**
 * WebXR VR: controllers, locomotion, VR UI panels.
 * Requires THREE, THREE.VRButton, window.viewer.
 */
(function () {
  var VR_HELP_LINES = [
    'Trigger: point at ground -> Teleport',
    'Left stick: Walk / Strafe',
    'Left grip + stick up/down: Height adjust',
    'Right stick: Look (yaw / pitch)',
    'Right grip: Toggle help panels',
  ];

  var raycaster = new THREE.Raycaster();
  var _tmpMatrix = new THREE.Matrix4();
  var _dir = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var _axisX = new THREE.Vector3(1, 0, 0);
  var _worldDir = new THREE.Vector3();

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
    xrController0: null,
    xrController1: null,
    controlsHelpTimeout: null,
    legendTexture: null,
  };

  function updateXRStatus() {
    var el = document.getElementById('xr-status');
    if (!el) return;
    if (!('xr' in navigator)) {
      el.innerHTML =
        '<strong>WebXR:</strong> not available in this browser';
      return;
    }
    navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
      if (supported) {
        el.innerHTML = '<strong>WebXR:</strong> immersive-vr supported';
      } else {
        el.innerHTML =
          '<strong>WebXR:</strong> immersive-vr not supported. ' +
          'Use HTTPS, Quest Browser, and enable WebXR in chrome://flags';
      }
    });
  }

  function setVrButtonReady(ready) {
    if (!state.vrBtn || !state.vrBtn.id) return;
    state.vrBtn.disabled = !ready;
    state.vrBtn.style.opacity = ready ? '' : '0.35';
    state.vrBtn.style.pointerEvents = ready ? '' : 'none';
  }

  function setDesktopControlsEnabled(enabled) {
    if (state.controls) state.controls.enabled = enabled;
  }

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
    ctx.font = '36px Arial';
    var y = 150;
    var i;
    for (i = 0; i < VR_HELP_LINES.length; i++) {
      ctx.fillText(VR_HELP_LINES[i], 60, y);
      y += 70;
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
      var i;
      for (i = 0; i < entries.length; i++) {
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

  function addXRController(index) {
    var controller = state.renderer.xr.getController(index);
    controller.userData.index = index;
    controller.userData.isSelecting = false;
    controller.userData.gamepad = null;
    controller.userData.handedness = null;

    controller.addEventListener('connected', function (event) {
      controller.userData.gamepad = event.data && event.data.gamepad
        ? event.data.gamepad
        : null;
      controller.userData.handedness = event.data
        ? event.data.handedness
        : null;
    });
    controller.addEventListener('disconnected', function () {
      controller.userData.gamepad = null;
      controller.userData.handedness = null;
    });

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
    controller.add(line);

    controller.addEventListener('selectstart', function () {
      controller.userData.isSelecting = true;
    });
    controller.addEventListener('selectend', function () {
      controller.userData.isSelecting = false;
      state.teleportMarker.visible = false;
      var hit = intersectGround(controller);
      if (hit) {
        state.xrRig.position.x = hit.point.x;
        state.xrRig.position.z = hit.point.z;
      }
    });
    controller.addEventListener('squeezestart', function () {
      var isRight =
        controller.userData.handedness === 'right' ||
        (controller.userData.handedness !== 'left' &&
          controller.userData.index === 1);
      if (isRight && state.controlsPanel && state.vrLegendPanel) {
        var vis = !state.controlsPanel.visible;
        state.controlsPanel.visible = vis;
        state.vrLegendPanel.visible = vis;
      }
    });

    state.xrRig.add(controller);
    return controller;
  }

  function intersectGround(controller) {
    _tmpMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_tmpMatrix);
    var hits = raycaster.intersectObject(state.xrGround, false);
    if (hits && hits.length > 0) return hits[0];
    return null;
  }

  function updateXrLocomotion(delta) {
    if (!state.renderer.xr.isPresenting) return;

    var leftController =
      state.xrController0 &&
      state.xrController0.userData.handedness === 'left'
        ? state.xrController0
        : state.xrController1 &&
            state.xrController1.userData.handedness === 'left'
          ? state.xrController1
          : state.xrController0;

    var leftGp = leftController && leftController.userData.gamepad;
    if (leftGp && leftGp.axes && leftGp.axes.length >= 2) {
      var lx = leftGp.axes[2] != null ? leftGp.axes[2] : leftGp.axes[0];
      var ly = leftGp.axes[3] != null ? leftGp.axes[3] : leftGp.axes[1];
      var deadzone = 0.15;
      var ax = Math.abs(lx) > deadzone ? lx : 0;
      var ay = Math.abs(ly) > deadzone ? ly : 0;
      var gripPressed =
        leftGp.buttons &&
        leftGp.buttons.length > 1 &&
        leftGp.buttons[1].pressed;

      if (gripPressed && ay !== 0) {
        state.xrRig.position.y += ay * 1.0 * delta;
      } else if (ax !== 0 || ay !== 0) {
        var speed = 2.0;
        state.camera.getWorldDirection(_dir);
        _dir.y = 0;
        if (_dir.lengthSq() > 1e-6) {
          _dir.normalize();
          _right.set(-_dir.z, 0, _dir.x);
          state.xrRig.position.addScaledVector(_dir, -ay * speed * delta);
          state.xrRig.position.addScaledVector(_right, ax * speed * delta);
        }
      }
    }

    var rightController =
      state.xrController0 &&
      state.xrController0.userData.handedness === 'right'
        ? state.xrController0
        : state.xrController1 &&
            state.xrController1.userData.handedness === 'right'
          ? state.xrController1
          : state.xrController1;

    var rightGp = rightController && rightController.userData.gamepad;
    if (rightGp && rightGp.axes && rightGp.axes.length >= 2) {
      var rx = rightGp.axes[2] != null ? rightGp.axes[2] : rightGp.axes[0];
      var ry = rightGp.axes[3] != null ? rightGp.axes[3] : rightGp.axes[1];
      var dz = 0.15;
      var rax = Math.abs(rx) > dz ? rx : 0;
      var ray = Math.abs(ry) > dz ? ry : 0;
      var rotSpeed = 2.0;
      if (rax !== 0) {
        state.xrRig.rotateY(-rax * rotSpeed * delta);
      }
      if (ray !== 0) {
        state.camera.getWorldDirection(_worldDir);
        var currentPitch = Math.asin(-_worldDir.y);
        var newPitch = currentPitch + ray * rotSpeed * delta;
        var maxPitch = Math.PI * 0.44;
        if (Math.abs(newPitch) < maxPitch) {
          state.camera.rotateOnAxis(_axisX, ray * rotSpeed * delta);
        }
      }
    }
  }

  function updateTeleportMarker() {
    var found = false;
    var controllers = [state.xrController0, state.xrController1];
    var i;
    for (i = 0; i < controllers.length; i++) {
      var c = controllers[i];
      if (c && c.userData.isSelecting) {
        var hit = intersectGround(c);
        if (hit) {
          state.teleportMarker.position.copy(hit.point);
          state.teleportMarker.visible = true;
          found = true;
          break;
        }
      }
    }
    if (!found) state.teleportMarker.visible = false;
  }

  function onSessionStart() {
    setDesktopControlsEnabled(false);
    document.body.classList.add('vr-presenting');
    state.contentGroup.rotation.x = -Math.PI / 2;
    state.xrRig.position.set(0, -1.6, 3);
    state.renderer.setPixelRatio(1);
    state.viewer.setVrPointVisibility(true);

    state.gridHelper.visible = true;
    state.originMarker.visible = true;
    state.originLabel.visible = true;
    state.controlsPanel.visible = true;
    state.vrLegendPanel.visible = true;
  }

  function onSessionEnd() {
    setDesktopControlsEnabled(true);
    document.body.classList.remove('vr-presenting');
    if (state.controlsHelpTimeout) {
      clearTimeout(state.controlsHelpTimeout);
      state.controlsHelpTimeout = null;
    }
    state.contentGroup.rotation.x = 0;
    state.xrRig.position.set(0, 0, 0);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.viewer.setVrPointVisibility(false);

    state.gridHelper.visible = false;
    state.teleportMarker.visible = false;
    state.originMarker.visible = false;
    state.originLabel.visible = false;
    state.controlsPanel.visible = false;
    state.vrLegendPanel.visible = false;
  }

  window.parmanuVr = {
    init: function (viewer) {
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

      state.xrController0 = addXRController(0);
      state.xrController1 = addXRController(1);

      state.renderer.xr.addEventListener('sessionstart', onSessionStart);
      state.renderer.xr.addEventListener('sessionend', onSessionEnd);

      if (typeof THREE.VRButton !== 'undefined') {
        state.vrBtn = THREE.VRButton.createButton(state.renderer);
        document.body.appendChild(state.vrBtn);
        setVrButtonReady(false);
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
      updateXrLocomotion(delta);
      updateTeleportMarker();
      if (state.originLabel && state.originLabel.visible) {
        state.originLabel.lookAt(state.camera.position);
      }
      if (state.originMarker && state.originMarker.visible) {
        var scale = 1.0 + 0.3 * Math.sin(Date.now() * 0.003);
        state.originMarker.scale.setScalar(scale);
      }
    },

    dispose: function () {
      if (state.vrBtn && state.vrBtn.parentNode) {
        state.vrBtn.parentNode.removeChild(state.vrBtn);
      }
      if (state.controlsHelpTimeout) clearTimeout(state.controlsHelpTimeout);
    },
  };
})();
