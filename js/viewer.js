/**
 * Desktop LiDAR viewer (z-up, OrbitControls).
 * Requires global THREE and THREE.OrbitControls.
 */
(function () {
  var BOX_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

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

  var viewer = {
    _container: null,
    _scene: null,
    _camera: null,
    _renderer: null,
    _controls: null,
    _points: null,
    _boxGroup: null,
    _initialCamera: null,
    _sceneCenter: null,
    _sceneMaxDim: 20,
    _animId: null,

    init: function (container) {
      this._container = container;
      var w = container.clientWidth || window.innerWidth;
      var h = container.clientHeight || window.innerHeight;

      this._scene = new THREE.Scene();
      this._scene.background = new THREE.Color(0x1a1a1a);

      this._camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 10000);
      this._camera.up.set(0, 0, 1);
      this._camera.position.set(20, 20, 20);

      this._renderer = new THREE.WebGLRenderer({ antialias: true });
      this._renderer.setSize(w, h);
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(this._renderer.domElement);

      this._controls = new THREE.OrbitControls(this._camera, this._renderer.domElement);
      this._controls.target.set(0, 0, 0);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.05;
      this._configureOrbitLimits(20);

      var ambient = new THREE.AmbientLight(0xffffff, 0.6);
      this._scene.add(ambient);
      var dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(1, 1, 1);
      this._scene.add(dir);

      this._boxGroup = new THREE.Group();
      this._scene.add(this._boxGroup);

      var axes = new THREE.AxesHelper(3);
      this._scene.add(axes);

      var self = this;
      window.addEventListener('resize', function () {
        self._onResize();
      });
      this._animate();

      return this;
    },

    _onResize: function () {
      if (!this._container) return;
      var w = this._container.clientWidth;
      var h = this._container.clientHeight;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(w, h);
    },

    _animate: function () {
      var self = this;
      function frame() {
        self._animId = requestAnimationFrame(frame);
        self._controls.update();
        self._renderer.render(self._scene, self._camera);
      }
      frame();
    },

    loadScene: function (scene) {
      var points = scene.points;
      var boxes = scene.boxes;
      this._clearScene();

      var numPoints = points.length / 4;
      var positions = new Float32Array(numPoints * 3);
      var colors = new Float32Array(numPoints * 3);

      var iMin = Infinity;
      var iMax = -Infinity;
      var i;
      for (i = 0; i < numPoints; i++) {
        var inten = points[i * 4 + 3];
        if (inten < iMin) iMin = inten;
        if (inten > iMax) iMax = inten;
      }
      var iRange = Math.max(iMax - iMin, 1e-6);

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

      var geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      var mat = new THREE.PointsMaterial({
        size: 0.08,
        sizeAttenuation: true,
        vertexColors: true,
        map: this._circleTexture(),
        alphaTest: 0.5,
        transparent: true,
        opacity: 0.85,
      });

      this._points = new THREE.Points(geom, mat);
      this._scene.add(this._points);

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

      this._fitCamera(positions);
      return { numPoints: numPoints, numBoxes: boxes.length };
    },

    _circleTexture: function () {
      var canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      var ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(16, 16, 15, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return new THREE.CanvasTexture(canvas);
    },

    /**
     * Orbit limits aligned with mmdet3d sit_viz_logic.js (render_sit_gt cameraDistance).
     * @param {number} maxDim — max extent of scene bbox (meters)
     */
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

    /**
     * Default SiT/MMDet-style view: orbit target at LiDAR origin (0,0,0),
     * camera placed from scene bbox center — sit_viz_logic.js / render_sit_gt.
     */
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

    _fitCamera: function (positions) {
      if (positions.length === 0) return;
      var b = this._bboxCenter(positions);
      this._sceneCenter = { x: b.cx, y: b.cy, z: b.cz };
      this._sceneMaxDim = b.maxDim;
      this._configureOrbitLimits(b.maxDim);
      this._setSitVizCamera(b.cx, b.cy, b.cz, b.maxDim);
      this._initialCamera = {
        position: this._camera.position.clone(),
        target: this._controls.target.clone(),
      };
    },

    /** Orbit target at cloud center; camera outside (overview). */
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

    /** LiDAR sensor POV — orbit (0,0,0), same as sit_viz_logic.js. */
    goToSensorPov: function () {
      var c = this._sceneCenter;
      if (!c) return;
      this._setSitVizCamera(c.x, c.y, c.z, this._sceneMaxDim || 20);
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

    _clearScene: function () {
      if (this._points) {
        this._scene.remove(this._points);
        this._points.geometry.dispose();
        this._points.material.dispose();
        if (this._points.material.map) this._points.material.map.dispose();
        this._points = null;
      }
      while (this._boxGroup.children.length) {
        var ch = this._boxGroup.children[0];
        ch.geometry.dispose();
        ch.material.dispose();
        this._boxGroup.remove(ch);
      }
    },

    dispose: function () {
      if (this._animId) cancelAnimationFrame(this._animId);
      this._clearScene();
      if (this._controls && this._controls.dispose) this._controls.dispose();
      if (this._renderer) this._renderer.dispose();
    },

    getTypeColorHex: typeColorHex,

    TYPE_COLORS: TYPE_COLORS,
  };

  window.viewer = viewer;
})();
