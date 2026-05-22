/**
 * LiDAR viewer (z-up desktop, WebXR-ready scene graph).
 * Requires global THREE and THREE.OrbitControls.
 */
(function () {
  var BOX_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  var VR_MAX_POINTS = 80000;
  var VR_POINT_SIZE = 0.06;
  var DESKTOP_POINT_SIZE = 0.08;

  function cornersToLinePositions(corners) {
    var positions = [];
    for (var i = 0; i < BOX_EDGES.length; i++) {
      var a = BOX_EDGES[i][0];
      var b = BOX_EDGES[i][1];
      positions.push(
        corners[a][0], corners[a][1], corners[a][2],
        corners[b][0], corners[b][1], corners[b][2],
      );
    }
    return new Float32Array(positions);
  }

  var TYPE_COLORS = {
    Car: 0x00ff00,
    Van: 0x88ff00,
    Truck: 0xaaff00,
    Bus: 0xccaa00,
    Pedestrian: 0x00ffff,
    Person_sitting: 0x00aaff,
    Cyclist: 0xffff00,
    Motorcyclist: 0xffcc00,
    Tram: 0xffaa00,
    Misc: 0xff00ff,
  };

  function typeColorHex(type) {
    var hex = TYPE_COLORS[type];
    if (hex === undefined) hex = 0xcccccc;
    var s = (hex >>> 0).toString(16);
    while (s.length < 6) s = '0' + s;
    return '#' + s.toUpperCase();
  }

  function intensityRange(points, numPoints) {
    var iMin = Infinity;
    var iMax = -Infinity;
    var i;
    for (i = 0; i < numPoints; i++) {
      var inten = points[i * 4 + 3];
      if (inten < iMin) iMin = inten;
      if (inten > iMax) iMax = inten;
    }
    return { iMin: iMin, iMax: iMax, iRange: Math.max(iMax - iMin, 1e-6) };
  }

  function buildPositionColorArrays(points, numPoints, iMin, iRange) {
    var positions = new Float32Array(numPoints * 3);
    var colors = new Float32Array(numPoints * 3);
    var i;
    for (i = 0; i < numPoints; i++) {
      positions[i * 3] = points[i * 4];
      positions[i * 3 + 1] = points[i * 4 + 1];
      positions[i * 3 + 2] = points[i * 4 + 2];
      var t = (points[i * 4 + 3] - iMin) / iRange;
      var c = 0.35 + t * 0.55;
      colors[i * 3] = c;
      colors[i * 3 + 1] = c;
      colors[i * 3 + 2] = c * 0.95;
    }
    return { positions: positions, colors: colors };
  }

  function decimateForVr(points) {
    var numPoints = points.length / 4;
    if (numPoints <= VR_MAX_POINTS) {
      return {
        points: points,
        originalCount: numPoints,
        decimatedCount: numPoints,
        decimated: false,
      };
    }
    var stride = Math.ceil(numPoints / VR_MAX_POINTS);
    var outCount = Math.ceil(numPoints / stride);
    var out = new Float32Array(outCount * 4);
    var j = 0;
    var i;
    for (i = 0; i < numPoints; i += stride) {
      var base = i * 4;
      out[j * 4] = points[base];
      out[j * 4 + 1] = points[base + 1];
      out[j * 4 + 2] = points[base + 2];
      out[j * 4 + 3] = points[base + 3];
      j++;
    }
    return {
      points: out,
      originalCount: numPoints,
      decimatedCount: j,
      decimated: true,
    };
  }

  var viewer = {
    _container: null,
    _scene: null,
    _contentGroup: null,
    _xrRig: null,
    _camera: null,
    _renderer: null,
    _controls: null,
    _clock: null,
    _points: null,
    _vrPoints: null,
    _boxGroup: null,
    _lastBoxes: [],
    _vrDecimation: null,
    _initialCamera: null,
    _sceneCenter: null,
    _sceneMaxDim: 20,
    _circleTex: null,
    _sensorFrameGroup: null,
    _sensorArrow: null,
    _frontLabel: null,

    _buildSensorFrameMarker: function () {
      var group = new THREE.Group();
      group.name = 'sensorFrame';

      var dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x00ffff }),
      );
      group.add(dot);

      var arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 0),
        2,
        0xff6600,
        0.5,
        0.35,
      );
      group.add(arrow);
      this._sensorArrow = arrow;

      var canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#ff6600';
      ctx.font = 'bold 32px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FRONT (+X)', 128, 32);
      var tex = new THREE.CanvasTexture(canvas);
      var sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true }),
      );
      sprite.position.set(2.2, 0, 0.2);
      sprite.scale.set(1, 0.25, 1);
      group.add(sprite);
      this._frontLabel = sprite;

      return group;
    },

    _updateSensorFrameMarkerScale: function (maxDim) {
      if (!this._sensorArrow) return;
      var len = Math.min(Math.max(maxDim * 0.035, 1.2), 3.5);
      this._sensorArrow.setLength(len, len * 0.28, len * 0.18);
      if (this._frontLabel) {
        this._frontLabel.position.set(len * 1.08, 0, Math.max(0.15, len * 0.05));
        var s = Math.max(len * 0.22, 0.55);
        this._frontLabel.scale.set(s, s * 0.25, 1);
      }
    },

    init: function (container) {
      this._container = container;
      var w = container.clientWidth || window.innerWidth;
      var h = container.clientHeight || window.innerHeight;

      this._scene = new THREE.Scene();
      this._scene.background = new THREE.Color(0x1a1a1a);

      this._contentGroup = new THREE.Group();
      this._scene.add(this._contentGroup);

      this._xrRig = new THREE.Group();
      this._scene.add(this._xrRig);

      this._camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 10000);
      this._camera.up.set(0, 0, 1);
      this._camera.position.set(20, 20, 20);
      this._xrRig.add(this._camera);

      this._renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      this._renderer.setSize(w, h);
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this._renderer.xr.enabled = true;
      this._renderer.xr.setReferenceSpaceType('local-floor');
      if (this._renderer.xr.setFoveation) {
        this._renderer.xr.setFoveation(1.0);
      }
      container.appendChild(this._renderer.domElement);

      this._controls = new THREE.OrbitControls(this._camera, this._renderer.domElement);
      this._controls.target.set(0, 0, 0);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.05;
      this._configureOrbitLimits(20);

      var ambient = new THREE.AmbientLight(0xffffff, 0.6);
      this._contentGroup.add(ambient);
      var dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(1, 1, 1);
      this._contentGroup.add(dir);

      this._boxGroup = new THREE.Group();
      this._contentGroup.add(this._boxGroup);

      var axes = new THREE.AxesHelper(3);
      this._contentGroup.add(axes);

      this._sensorFrameGroup = this._buildSensorFrameMarker();
      this._contentGroup.add(this._sensorFrameGroup);

      this._clock = new THREE.Clock();

      var self = this;
      window.addEventListener('resize', function () {
        self._onResize();
      });

      function animate() {
        var delta = self._clock.getDelta();
        if (self._renderer.xr.isPresenting) {
          if (window.parmanuVr && window.parmanuVr.updateFrame) {
            window.parmanuVr.updateFrame(delta);
          }
        } else {
          self._controls.update();
        }
        self._renderer.render(self._scene, self._camera);
      }
      this._renderer.setAnimationLoop(animate);

      return this;
    },

    _onResize: function () {
      if (!this._container) return;
      var w = this._container.clientWidth;
      var h = this._container.clientHeight;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h);
      if (!this._renderer.xr.isPresenting) {
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      }
    },

    _circleTexture: function () {
      if (this._circleTex) return this._circleTex;
      var canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      var ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(16, 16, 15, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      this._circleTex = new THREE.CanvasTexture(canvas);
      return this._circleTex;
    },

    _makePointsMesh: function (positions, colors, size) {
      var geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      var mat = new THREE.PointsMaterial({
        size: size,
        sizeAttenuation: true,
        vertexColors: true,
        map: this._circleTexture(),
        alphaTest: 0.5,
        transparent: true,
        opacity: 0.85,
      });
      return new THREE.Points(geom, mat);
    },

    loadScene: function (scene) {
      var points = scene.points;
      var boxes = scene.boxes;
      this._clearScene();

      var numPoints = points.length / 4;
      var range = intensityRange(points, numPoints);
      var built = buildPositionColorArrays(
        points,
        numPoints,
        range.iMin,
        range.iRange,
      );

      this._points = this._makePointsMesh(
        built.positions,
        built.colors,
        DESKTOP_POINT_SIZE,
      );
      this._contentGroup.add(this._points);

      var vrData = decimateForVr(points);
      this._vrDecimation = vrData.decimated
        ? {
            originalCount: vrData.originalCount,
            decimatedCount: vrData.decimatedCount,
          }
        : null;

      var vrBuilt = buildPositionColorArrays(
        vrData.points,
        vrData.decimatedCount,
        range.iMin,
        range.iRange,
      );
      this._vrPoints = this._makePointsMesh(
        vrBuilt.positions,
        vrBuilt.colors,
        VR_POINT_SIZE,
      );
      this._vrPoints.visible = false;
      this._contentGroup.add(this._vrPoints);

      this._lastBoxes = boxes;
      var i;
      for (i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var linePos = cornersToLinePositions(box.corners);
        var lineGeom = new THREE.BufferGeometry();
        lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
        var color = TYPE_COLORS[box.type];
        if (color === undefined) color = 0xcccccc;
        var lineMat = new THREE.LineBasicMaterial({ color: color });
        var segs = new THREE.LineSegments(lineGeom, lineMat);
        this._boxGroup.add(segs);
      }

      this._fitCamera(built.positions);
      return {
        numPoints: numPoints,
        numBoxes: boxes.length,
        vrDecimation: this._vrDecimation,
      };
    },

    _configureOrbitLimits: function (maxDim) {
      var cameraDistance = Math.max(maxDim * 2.0, 10);
      this._controls.minDistance = 0.001;
      this._controls.maxDistance = cameraDistance * 10;
      this._controls.zoomSpeed = 2.0;
      this._controls.panSpeed = 0.8;
      this._controls.rotateSpeed = 0.8;
      this._camera.near = Math.max(0.001, Math.min(0.01, maxDim * 0.0001));
      this._camera.far = Math.max(10000, cameraDistance * 20);
      this._camera.updateProjectionMatrix();
    },

    _bboxCenter: function (positions) {
      var xmin = Infinity, ymin = Infinity, zmin = Infinity;
      var xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
      var i;
      for (i = 0; i < positions.length; i += 3) {
        var x = positions[i];
        var y = positions[i + 1];
        var z = positions[i + 2];
        if (x < xmin) xmin = x;
        if (y < ymin) ymin = y;
        if (z < zmin) zmin = z;
        if (x > xmax) xmax = x;
        if (y > ymax) ymax = y;
        if (z > zmax) zmax = z;
      }
      return {
        cx: (xmin + xmax) / 2,
        cy: (ymin + ymax) / 2,
        cz: (zmin + zmax) / 2,
        maxDim: Math.max(xmax - xmin, ymax - ymin, zmax - zmin, 1),
      };
    },

    _setSitVizCamera: function (cx, cy, cz, maxDim) {
      var cameraDistance = Math.max(maxDim * 2.0, 10);
      this._controls.target.set(0, 0, 0);
      this._camera.position.set(
        cx + cameraDistance * 0.7,
        cy + cameraDistance * 0.7,
        cz + cameraDistance * 0.7,
      );
      this._controls.update();
    },

    /** Near Velodyne origin, looking toward +X (KITTI forward). */
    _setSensorPovCamera: function (maxDim) {
      var back = Math.max(maxDim * 0.06, 2);
      this._controls.target.set(0, 0, 0);
      this._camera.position.set(-back, 0, 1.6);
      this._controls.update();
    },

    _fitCamera: function (positions) {
      if (positions.length === 0) return;
      var b = this._bboxCenter(positions);
      this._sceneCenter = { x: b.cx, y: b.cy, z: b.cz };
      this._sceneMaxDim = b.maxDim;
      this._updateSensorFrameMarkerScale(b.maxDim);
      this._configureOrbitLimits(b.maxDim);
      this._setSitVizCamera(b.cx, b.cy, b.cz, b.maxDim);
      this._initialCamera = {
        position: this._camera.position.clone(),
        target: this._controls.target.clone(),
      };
    },

    _setOverviewCamera: function () {
      var c = this._sceneCenter;
      if (!c) return;
      var cameraDistance = Math.max((this._sceneMaxDim || 20) * 2.0, 10);
      this._controls.target.set(c.x, c.y, c.z);
      this._camera.position.set(
        c.x + cameraDistance * 0.7,
        c.y + cameraDistance * 0.7,
        c.z + cameraDistance * 0.7,
      );
      this._controls.update();
    },

    goToSensorPov: function () {
      if (!this._points) return;
      this._setSensorPovCamera(this._sceneMaxDim || 20);
    },

    goToOverview: function () {
      this._setOverviewCamera();
    },

    resetView: function () {
      if (!this._initialCamera) return;
      this._camera.position.copy(this._initialCamera.position);
      this._controls.target.copy(this._initialCamera.target);
      this._controls.update();
    },

    hasScene: function () {
      return !!this._points;
    },

    getRenderer: function () {
      return this._renderer;
    },

    getCamera: function () {
      return this._camera;
    },

    getScene: function () {
      return this._scene;
    },

    getContentGroup: function () {
      return this._contentGroup;
    },

    getXrRig: function () {
      return this._xrRig;
    },

    getControls: function () {
      return this._controls;
    },

    getSceneMaxDim: function () {
      return this._sceneMaxDim;
    },

    getVrDecimation: function () {
      return this._vrDecimation;
    },

    getLegendEntries: function () {
      var counts = {};
      var i;
      for (i = 0; i < this._lastBoxes.length; i++) {
        var t = this._lastBoxes[i].type;
        counts[t] = (counts[t] || 0) + 1;
      }
      var types = Object.keys(counts).sort();
      var entries = [];
      for (i = 0; i < types.length; i++) {
        entries.push({
          type: types[i],
          hex: typeColorHex(types[i]),
          count: counts[types[i]],
        });
      }
      return entries;
    },

    setVrPointVisibility: function (inVr) {
      if (this._points) this._points.visible = !inVr;
      if (this._vrPoints) this._vrPoints.visible = inVr;
    },

    _disposePointsMesh: function (mesh) {
      if (!mesh) return;
      this._contentGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },

    _clearScene: function () {
      this._disposePointsMesh(this._points);
      this._points = null;
      this._disposePointsMesh(this._vrPoints);
      this._vrPoints = null;
      this._vrDecimation = null;
      this._lastBoxes = [];
      while (this._boxGroup.children.length) {
        var ch = this._boxGroup.children[0];
        ch.geometry.dispose();
        ch.material.dispose();
        this._boxGroup.remove(ch);
      }
    },

    dispose: function () {
      this._clearScene();
      if (this._controls && this._controls.dispose) this._controls.dispose();
      if (this._renderer) {
        this._renderer.setAnimationLoop(null);
        this._renderer.dispose();
      }
      if (this._circleTex) this._circleTex.dispose();
      if (this._sensorFrameGroup) {
        var i;
        for (i = 0; i < this._sensorFrameGroup.children.length; i++) {
          var ch = this._sensorFrameGroup.children[i];
          if (ch.geometry) ch.geometry.dispose();
          if (ch.material) {
            if (ch.material.map) ch.material.map.dispose();
            ch.material.dispose();
          }
          if (ch.line && ch.line.geometry) ch.line.geometry.dispose();
          if (ch.line && ch.line.material) ch.line.material.dispose();
          if (ch.cone && ch.cone.geometry) ch.cone.geometry.dispose();
          if (ch.cone && ch.cone.material) ch.cone.material.dispose();
        }
        this._contentGroup.remove(this._sensorFrameGroup);
        this._sensorFrameGroup = null;
        this._sensorArrow = null;
        this._frontLabel = null;
      }
    },

    getTypeColorHex: typeColorHex,

    TYPE_COLORS: TYPE_COLORS,
  };

  window.viewer = viewer;
})();
