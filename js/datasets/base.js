/**
 * Abstract dataset loader (v1: KITTI only).
 */
export class DatasetLoader {
  async loadFrame() {
    throw new Error('Not implemented');
  }

  getName() {
    throw new Error('Not implemented');
  }
}
