# parmanu-viz: Browser-Based 3D Point Cloud Visualization

## Philosophy & Vision

**parmanu-viz** (Sanskrit: "parmanu" = atom/particle) is built on core principles:

- **Simplicity First**: Zero installation, zero dependencies, zero complexity. Just open a browser and start visualizing.
- **Offline-First**: Works completely offline after initial load. No servers, no cloud, no internet required.
- **Open Source**: Built for the community, by the community. Extensible and transparent.
- **Extensibility**: Adding support for new datasets should be as simple as adding one JavaScript file. No core modifications needed.
- **Ease of Use**: Researchers should spend time on research, not fighting with tools. Click, select, visualize.

## Primary Use Case

**Target Audience**: Researchers working with 3D point cloud datasets for quick visualization during experimentation.

**Default Workflow**:
1. Researcher has KITTI dataset downloaded locally (e.g., `~/data/kitti/`)
2. Opens browser, navigates to parmanu-viz (hosted on GitHub Pages)
3. Clicks "Select Dataset Folder" → selects KITTI folder
4. Browses available point cloud files in the dataset
5. Clicks any file → instant 3D visualization with annotations
6. Uses gestures/controls to explore the point cloud
7. Exports visualization as standalone HTML
8. Copies HTML to Quest 3 VR headset (same WiFi network)
9. Opens HTML in Quest browser → immersive VR visualization

**Key Requirements**:
- No local installation required
- Works with standard KITTI dataset structure
- Supports VR viewing on Quest 3
- Fast, responsive, GPU-accelerated
- Easy to extend for other datasets (Waymo, nuScenes, custom formats)

## Architecture

### Technology Stack

- **Frontend**: Pure HTML + JavaScript (ES6+)
- **3D Rendering**: Three.js (bundled locally for offline support)
- **VR Support**: WebXR API
- **File Access**: File System Access API (Chrome/Edge) with fallback for Safari/Firefox
- **Deployment**: GitHub Pages (static hosting)

### Project Structure

```
parmanu-viz/
├── index.html                 # Main application entry point
├── js/
│   ├── app.js                 # Main application orchestrator
│   ├── viewer.js             # Three.js visualization engine
│   ├── explorer.js            # File browser and dataset explorer
│   ├── exporter.js            # HTML export functionality
│   └── datasets/
│       ├── base.js            # Abstract DatasetLoader interface
│       └── kitti.js           # KITTI dataset implementation
├── assets/
│   ├── three.min.js          # Bundled Three.js (offline-first)
│   └── styles.css            # Application styles
├── README.md                  # User documentation
├── CONTRIBUTING.md            # Developer guide for adding datasets
└── LICENSE                    # Open source license (MIT/Apache)
```

### Core Components

#### 1. Data Explorer (`explorer.js`)
- File System Access API integration
- Folder structure navigation
- File listing and filtering
- Sample selection UI

#### 2. Data Visualizer (`viewer.js`)
- Three.js scene setup
- Point cloud rendering
- 3D bounding box visualization
- Camera controls (Orbit, Fly, FPS modes)
- WebXR integration for VR
- Gesture support

#### 3. HTML Exporter (`exporter.js`)
- Embeds point cloud data in HTML
- Embeds annotation data in HTML
- Generates standalone, portable HTML files
- Optimized for Quest 3 browser

#### 4. Dataset Loaders (`datasets/`)
- Abstract base class defining interface
- KITTI loader implementation
- Extensible architecture for custom datasets

## KITTI Dataset Support

### Format Specification

**Point Clouds**:
- Format: `.bin` files (binary, float32)
- Structure: `training/velodyne/000000.bin`, `000001.bin`, ...
- Data: 4 floats per point (x, y, z, intensity)
- Reading: Binary file reader in JavaScript

**Annotations**:
- Format: `.txt` files (text, space-separated)
- Structure: `training/label_2/000000.txt`, `000001.txt`, ...
- Columns (15 required, 16th optional):
  ```
  type truncated occluded alpha 
  bbox_left bbox_top bbox_right bbox_bottom 
  dim_h dim_w dim_l 
  loc_x loc_y loc_z 
  rotation_y [optional_score]
  ```
- Example:
  ```
  Car 0.00 0 -1.58 587.01 173.33 614.12 200.12 1.65 1.67 3.64 -1.65 1.57 22.50 1.59
  ```

**Folder Structure**:
```
kitti/
├── training/
│   ├── velodyne/     # Point cloud .bin files
│   └── label_2/      # Annotation .txt files
└── testing/
    └── velodyne/     # Test set (no labels)
```

### Implementation Details

**KITTI Loader Interface**:
```javascript
class KITTILoader extends DatasetLoader {
  // Load point cloud from .bin file
  async loadPointCloud(file) {
    const buffer = await file.arrayBuffer();
    const floats = new Float32Array(buffer);
    // Reshape to [N, 4]: [x, y, z, intensity]
    return floats;
  }
  
  // Load annotations from .txt file
  async loadAnnotations(file) {
    const text = await file.text();
    const lines = text.trim().split('\n');
    return lines.map(line => this.parseKITTILabel(line));
  }
  
  // Parse single KITTI label line
  parseKITTILabel(line) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 15) return null;
    
    return {
      type: parts[0],
      truncated: parseFloat(parts[1]),
      occluded: parseInt(parts[2]),
      alpha: parseFloat(parts[3]),
      bbox_2d: [parseFloat(parts[4]), parseFloat(parts[5]), 
                parseFloat(parts[6]), parseFloat(parts[7])],
      dimensions: [parseFloat(parts[8]), parseFloat(parts[9]), 
                   parseFloat(parts[10])], // h, w, l
      location: [parseFloat(parts[11]), parseFloat(parts[12]), 
                 parseFloat(parts[13])], // x, y, z
      rotation_y: parseFloat(parts[14]),
      score: parts[15] ? parseFloat(parts[15]) : 1.0
    };
  }
  
  // Convert to internal box format: [x, y, z, l, w, h, yaw]
  toInternalBox(annotation) {
    return [
      annotation.location[0],      // x
      annotation.location[1],      // y
      annotation.location[2],      // z
      annotation.dimensions[2],    // l (length)
      annotation.dimensions[1],    // w (width)
      annotation.dimensions[0],   // h (height)
      annotation.rotation_y       // yaw
    ];
  }
}
```

**Note on Pickle Files**: 
- KITTI standard format uses `.txt` files, not pickle
- v1 will support `.txt` format only (Option C)
- Future versions may add pickle support if needed via JavaScript libraries

## Extensibility Model

### Adding New Dataset Support

To add support for a new dataset (e.g., Waymo), users simply:

1. Create `datasets/waymo.js`:
```javascript
class WaymoLoader extends DatasetLoader {
  async loadPointCloud(file) { /* implementation */ }
  async loadAnnotations(file) { /* implementation */ }
  getFileStructure() { return { /* structure */ }; }
}

// Auto-register
window.DatasetRegistry.register('waymo', WaymoLoader);
```

2. Include in HTML:
```html
<script src="js/datasets/waymo.js"></script>
```

3. Done! No core modifications needed.

### DatasetLoader Interface

All dataset loaders must implement:

```javascript
class DatasetLoader {
  // Load point cloud data
  async loadPointCloud(file) { throw new Error('Not implemented'); }
  
  // Load annotation data
  async loadAnnotations(file) { throw new Error('Not implemented'); }
  
  // Return expected folder structure
  getFileStructure() { throw new Error('Not implemented'); }
  
  // Convert annotations to internal box format [x, y, z, l, w, h, yaw]
  toInternalBox(annotation) { throw new Error('Not implemented'); }
  
  // Get display name
  getName() { throw new Error('Not implemented'); }
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

**Tasks**:
1. ✅ Set up GitHub repository structure
2. ✅ Extract and adapt Three.js viewer from existing codebase
3. ✅ Implement File System Access API wrapper with fallback
4. ✅ Create abstract DatasetLoader base class
5. ✅ Set up basic HTML structure and UI framework

**Deliverables**:
- Working HTML page with basic UI
- File System Access API integration
- Three.js viewer skeleton

### Phase 2: KITTI Support (Week 1-2)

**Tasks**:
1. ✅ Implement `.bin` file parser (binary Float32Array reader)
2. ✅ Implement `.txt` label parser (15-column format)
3. ✅ Convert KITTI format to internal representation
4. ✅ Integrate with Three.js viewer
5. ✅ Test with real KITTI dataset

**Deliverables**:
- Complete KITTI dataset loader
- Working visualization of KITTI point clouds + annotations

### Phase 3: UI & Export (Week 2)

**Tasks**:
1. ✅ Build file explorer UI (list files, navigate, select)
2. ✅ Implement HTML export (embed data as JSON/base64)
3. ✅ Add loading states and error handling
4. ✅ Test export functionality
5. ✅ Test on Quest 3 VR headset

**Deliverables**:
- Complete user interface
- Working HTML export
- Quest 3 compatibility verified

### Phase 4: Polish & Deployment (Week 3)

**Tasks**:
1. ✅ Error handling and edge cases
2. ✅ Performance optimization (large datasets)
3. ✅ Documentation (README, CONTRIBUTING)
4. ✅ GitHub Pages deployment
5. ✅ Browser compatibility testing (Chrome, Edge, Safari, Firefox)

**Deliverables**:
- Production-ready application
- Complete documentation
- Live deployment on GitHub Pages

## Technical Decisions

### File System Access

**Primary**: File System Access API (Chrome/Edge)
```javascript
const dirHandle = await window.showDirectoryPicker();
```

**Fallback**: `<input type="file" webkitdirectory>` for Safari/Firefox
```javascript
const input = document.createElement('input');
input.type = 'file';
input.webkitdirectory = true;
```

### Data Embedding for Export

**Strategy**: Embed as JSON (not base64 for better compression)
```javascript
const sceneData = {
  points: Array.from(points), // Convert Float32Array
  boxes: boxes,
  metadata: { /* ... */ }
};
```

**Optimization**: Consider compression for very large datasets (future)

### VR Support

**Quest 3 Workflow**:
1. User exports HTML on desktop
2. Copies HTML file to Quest 3 (via USB/network share)
3. Opens HTML in Quest Browser
4. WebXR automatically enables VR mode

**WebXR Features**:
- Immersive VR rendering
- Controller support (teleport, locomotion)
- Hand tracking (if available)

## Browser Compatibility

| Feature | Chrome/Edge | Firefox | Safari |
|---------|-------------|---------|--------|
| File System Access API | ✅ | ❌ (fallback) | ❌ (fallback) |
| WebGL | ✅ | ✅ | ✅ |
| WebXR | ✅ | ✅ | ✅ (iOS 17+) |
| File Reading | ✅ | ✅ | ✅ |

## Limitations & Future Work

### v1 Limitations

- **No pickle support**: KITTI `.txt` format only
- **File System API**: Limited to Chrome/Edge (fallback available)
- **Memory limits**: Very large datasets (>100MB point clouds) may be slow
- **No annotation editing**: View-only in v1

### Future Enhancements (v2+)

- Pickle file support (if needed)
- Annotation editing capabilities
- Side-by-side comparison mode
- Video/screenshot export
- Live server mode for real-time Quest viewing
- Jupyter notebook integration
- More dataset formats (Waymo, nuScenes, custom)

## Success Metrics

- ✅ Zero installation required
- ✅ Works with standard KITTI dataset out of the box
- ✅ Loads and visualizes point clouds in < 2 seconds
- ✅ Exported HTML works on Quest 3
- ✅ Adding new dataset support takes < 1 hour
- ✅ Works offline after initial page load

## Open Source Considerations

- **License**: MIT or Apache 2.0 (TBD)
- **Repository**: GitHub (public)
- **Documentation**: Comprehensive README + CONTRIBUTING guide
- **Examples**: Sample dataset loaders for common formats
- **Community**: Welcome contributions, clear contribution guidelines

## Deployment

**GitHub Pages**:
- Repository: `github.com/[username]/parmanu-viz`
- Live URL: `[username].github.io/parmanu-viz`
- Automatic deployment on push to `main` branch

**Requirements**:
- Static HTML/JS/CSS only
- No build step needed
- No server-side code

## Getting Started (For Users)

1. Navigate to `[username].github.io/parmanu-viz`
2. Click "Select Dataset Folder"
3. Choose your KITTI dataset folder
4. Browse and click on any `.bin` file to visualize
5. Use controls to explore (mouse, keyboard, gestures)
6. Click "Export HTML" to save for Quest 3
7. Copy HTML to Quest 3 and open in browser

## Getting Started (For Developers)

1. Fork repository
2. Create `datasets/yourdataset.js`
3. Extend `DatasetLoader` class
4. Implement required methods
5. Test with your dataset
6. Submit pull request

See `CONTRIBUTING.md` for detailed guidelines.

---

**Project Name**: parmanu-viz  
**Version**: 1.0.0 (planned)  
**Status**: Planning Phase  
**License**: TBD (MIT/Apache 2.0)
