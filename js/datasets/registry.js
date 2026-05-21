/**
 * Dataset registry — add loaders without editing app.js core logic.
 *
 * Register from each js/datasets/<name>.js:
 *   DatasetRegistry.register('kitti', { name, Loader, createExplorer, fileHint });
 */
/** Use var so DatasetRegistry is global across classic script files (file:// safe). */
var DatasetRegistry = {
  _entries: {},

  register(id, entry) {
    if (!id || !entry || !entry.Loader || !entry.createExplorer) {
      throw new Error('DatasetRegistry.register: id, Loader, and createExplorer required');
    }
    if (this._entries[id]) {
      return;
    }
    this._entries[id] = {
      id: id,
      name: entry.name || id,
      fileHint: entry.fileHint || '',
      Loader: entry.Loader,
      createExplorer: entry.createExplorer,
    };
  },

  list() {
    return Object.keys(this._entries).map((id) => ({
      id: id,
      name: this._entries[id].name,
    }));
  },

  get(id) {
    const e = this._entries[id];
    if (!e) throw new Error('Unknown dataset: ' + id);
    return e;
  },

  createLoader(id) {
    const e = this.get(id);
    return new e.Loader();
  },

  createExplorer(id, options) {
    return this.get(id).createExplorer(options);
  },

  fillSelect(selectEl, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const list = this.list();
    const defaultId = selectedId || 'kitti';

    if (list.length === 0) {
      const opt = document.createElement('option');
      opt.value = defaultId;
      opt.textContent = 'KITTI Object';
      selectEl.appendChild(opt);
      selectEl.value = defaultId;
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const opt = document.createElement('option');
      opt.value = list[i].id;
      opt.textContent = list[i].name;
      if (list[i].id === defaultId) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    }
    if (this._entries[defaultId]) {
      selectEl.value = defaultId;
    } else {
      selectEl.value = list[0].id;
    }
  },
};

window.DatasetRegistry = DatasetRegistry;
