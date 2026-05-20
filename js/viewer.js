/**
 * Desktop LiDAR viewer (z-up, OrbitControls).
 * Patterns informed by mmdetection3d sit_viz_logic.js (reference only).
 */
import * as THREE from '../assets/three.module.js';
import { OrbitControls } from '../assets/OrbitControls.js';
import { KITTILoader } from './datasets/kitti.js';

const TYPE_COLORS = {
  Car: 0x00ff00,
  Van: 0x88ff00,
  Truck: 0xaaff00,
  Pedestrian: 0x00ffff,
  Person_sitting: 0x00aaff,
  Cyclist: 0xffff00,
  Tram: 0xffaa00,
  Misc: 0xff00ff,
};

export const viewer = {
  _container: null,
  _scene: null,
  _camera: null,
  _renderer: null,
  _controls: null,
  _points: null,
  _boxGroup: null,
  _initialCamera: null,
  _animId: null,

  init(container) {
    this._container = container;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a1a);

    this._camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 10000);
    this._camera.up.set(0, 0, 1);
    this._camera.position.set(20, 20, 20);

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this._renderer.domElement);

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.target.set(0, 0, 0);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.05;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this._scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 1, 1);
    this._scene.add(dir);

    this._boxGroup = new THREE.Group();
    this._scene.add(this._boxGroup);

    const axes = new THREE.AxesHelper(3);
    this._scene.add(axes);

    window.addEventListener('resize', () => this._onResize());
    this._animate();

    return this;
  },

  _onResize() {
    if (!this._container) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  },

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());
    this._controls.update();
    this._renderer.render(this._scene, this._camera);
  },

  loadScene({ points, boxes }) {
    this._clearScene();

    const numPoints = points.length / 4;
    const positions = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);

    let iMin = Infinity;
    let iMax = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const inten = points[i * 4 + 3];
      if (inten < iMin) iMin = inten;
      if (inten > iMax) iMax = inten;
    }
    const iRange = Math.max(iMax - iMin, 1e-6);

    for (let i = 0; i < numPoints; i++) {
      positions[i * 3] = points[i * 4];
      positions[i * 3 + 1] = points[i * 4 + 1];
      positions[i * 3 + 2] = points[i * 4 + 2];
      const t = (points[i * 4 + 3] - iMin) / iRange;
      const c = 0.35 + t * 0.55;
      colors[i * 3] = c;
      colors[i * 3 + 1] = c;
      colors[i * 3 + 2] = c * 0.95;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
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

    for (const box of boxes) {
      const linePos = KITTILoader.cornersToLinePositions(box.corners);
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute(
        'position',
        new THREE.BufferAttribute(linePos, 3),
      );
      const color = TYPE_COLORS[box.type] ?? 0xcccccc;
      const lineMat = new THREE.LineBasicMaterial({ color });
      const segs = new THREE.LineSegments(lineGeom, lineMat);
      segs.userData.type = box.type;
      this._boxGroup.add(segs);
    }

    this._fitCamera(positions);
    return { numPoints, numBoxes: boxes.length };
  },

  _circleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  },

  _fitCamera(positions) {
    if (positions.length === 0) return;
    let xmin = Infinity, ymin = Infinity, zmin = Infinity;
    let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      xmin = Math.min(xmin, x);
      ymin = Math.min(ymin, y);
      zmin = Math.min(zmin, z);
      xmax = Math.max(xmax, x);
      ymax = Math.max(ymax, y);
      zmax = Math.max(zmax, z);
    }
    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    const cz = (zmin + zmax) / 2;
    const maxDim = Math.max(xmax - xmin, ymax - ymin, zmax - zmin, 1);
    const dist = maxDim * 0.85;
    this._controls.target.set(cx, cy, cz);
    this._camera.position.set(cx + dist * 0.7, cy + dist * 0.5, cz + dist * 0.6);
    this._controls.update();
    this._initialCamera = {
      position: this._camera.position.clone(),
      target: this._controls.target.clone(),
    };
  },

  resetView() {
    if (!this._initialCamera) return;
    this._camera.position.copy(this._initialCamera.position);
    this._controls.target.copy(this._initialCamera.target);
    this._controls.update();
  },

  _clearScene() {
    if (this._points) {
      this._scene.remove(this._points);
      this._points.geometry.dispose();
      this._points.material.dispose();
      if (this._points.material.map) this._points.material.map.dispose();
      this._points = null;
    }
    while (this._boxGroup.children.length) {
      const ch = this._boxGroup.children[0];
      ch.geometry.dispose();
      ch.material.dispose();
      this._boxGroup.remove(ch);
    }
  },

  dispose() {
    if (this._animId) cancelAnimationFrame(this._animId);
    this._clearScene();
    this._controls?.dispose();
    this._renderer?.dispose();
    if (this._renderer?.domElement?.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
  },
};
