const fs = require('node:fs/promises');
const { validateState, loadOrMigrate, writeAtomic } = require('./store.cjs');

// One authoritative, validated snapshot per application session. The window is
// never given an empty fallback when reading an existing collection fails.
class PersistentCollection {
  constructor(file, catalog, legacyFiles = []) {
    this.file = file;
    this.catalog = catalog;
    this.legacyFiles = legacyFiles;
    this.queue = Promise.resolve();
    this.initializing = null;
    this.result = null;
    this.lastError = null;
  }

  async initialize() {
    if (!this.initializing) {
      this.initializing = loadOrMigrate(this.file, this.legacyFiles, this.catalog)
        .then(async (result) => {
          // Heal a missing/corrupt primary automatically from its valid backup.
          if (result.recovered) await writeAtomic(this.file, result.state, this.catalog);
          this.result = result;
          return result;
        })
        .catch((error) => {
          this.initializing = null;
          throw error;
        });
    }
    return this.initializing;
  }

  async load() {
    await this.queue;
    await this.initialize();
    return structuredClone(this.result);
  }

  save(input) {
    const state = validateState(input, this.catalog);
    const operation = this.queue.then(async () => {
      await this.initialize();
      await writeAtomic(this.file, state, this.catalog);
      this.result = { state };
      this.lastError = null;
      return { ok: true };
    });
    this.queue = operation.catch((error) => {
      this.lastError = error;
    });
    return operation;
  }

  restore(input) {
    const state = validateState(input, this.catalog);
    const operation = this.queue.then(async () => {
      if (!this.result) {
        try {
          await fs.copyFile(this.file, this.file + '.before-restore-' + Date.now());
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      await writeAtomic(this.file, state, this.catalog);
      this.result = { state };
      this.initializing = Promise.resolve(this.result);
      this.lastError = null;
      return { ok: true };
    });
    this.queue = operation.catch((error) => {
      this.lastError = error;
    });
    return operation;
  }

  async flush() {
    await this.queue;
    if (this.lastError) throw this.lastError;
  }
}
module.exports = { PersistentCollection };
