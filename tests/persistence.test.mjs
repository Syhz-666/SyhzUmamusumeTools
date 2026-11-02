import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PersistentCollection } = require('../persistence.cjs');
const { emptyState, writeAtomic, readState } = require('../store.cjs');
const catalog = require('../app/public/catalog.json');
async function fixture() {
  const directory = await fs.mkdtemp(path.resolve('outputs/app-qa/session-test-'));
  const file = path.join(directory, 'collection-v1.json');
  const state = emptyState();
  state.selectedCharacter = '1002';
  state.selectedScenario = 'larc';
  state.progress['1002'] = catalog.races.slice(3, 39).map((r) => r.id);
  await writeAtomic(file, state, catalog);
  return { file, state };
}
test('默认加载36项收藏，连续保存后新进程会话直接恢复，无需导入', async () => {
  const { file, state } = await fixture();
  const first = new PersistentCollection(file, catalog);
  assert.equal((await first.load()).state.progress['1002'].length, 36);
  const a = structuredClone(state);
  a.progress['1002'].push(catalog.races[0].id);
  const b = structuredClone(a);
  b.progress['1002'].push(catalog.races[1].id);
  await Promise.all([first.save(a), first.save(b)]);
  await first.flush();
  const second = new PersistentCollection(file, catalog);
  assert.deepEqual((await second.load()).state, b);
  assert.equal((await second.load()).state.progress['1002'].length, 38);
});
test('主存档损坏时自动恢复有效备份并修复主文件', async () => {
  const { file, state } = await fixture();
  const newer = structuredClone(state);
  newer.selectedScenario = 'ura';
  await writeAtomic(file, newer, catalog);
  await fs.writeFile(file, 'broken');
  const collection = new PersistentCollection(file, catalog);
  const result = await collection.load();
  assert.equal(result.recovered, true);
  assert.deepEqual(result.state, state);
  assert.equal((await readState(file, catalog)).recovered, false);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), state);
});
test('两份存档损坏时加载与普通保存均拒绝，不能返回空收藏覆盖原文件', async () => {
  const { file } = await fixture();
  await fs.writeFile(file, 'broken-primary');
  await fs.writeFile(file + '.bak', 'broken-backup');
  const collection = new PersistentCollection(file, catalog);
  await assert.rejects(collection.load());
  await assert.rejects(collection.save(emptyState()));
  await assert.rejects(collection.flush());
  assert.equal(await fs.readFile(file, 'utf8'), 'broken-primary');
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), 'broken-backup');
});
test('退出握手等待渲染进程中的最后一次保存完成，并传播失败', async () => {
  const listeners = {},
    sent = [];
  let bridge, resolveSave, rejectSave;
  const ipcRenderer = {
    on: (channel, callback) => {
      listeners[channel] = callback;
    },
    send: (...args) => sent.push(args),
    invoke: (channel, value) => {
      if (channel === 'state:load') return Promise.resolve(JSON.stringify({ state: emptyState() }));
      assert.equal(typeof value, 'string');
      return new Promise((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
    },
  };
  vm.runInNewContext(await fs.readFile('preload.cjs', 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_name, api) => {
            bridge = api;
          },
        },
      };
    },
  });
  assert.equal((await bridge.load()).state.version, 1);
  const saving = bridge.save(emptyState());
  const closing = listeners['state:flush-request']();
  await Promise.resolve();
  assert.equal(sent.length, 0);
  resolveSave({ ok: true });
  await saving;
  await closing;
  assert.equal(sent[0][0], 'state:flush-ready');
  assert.equal(sent[0][1].error, '');
  const failure = bridge.save(emptyState());
  rejectSave(new Error('disk full'));
  await assert.rejects(failure);
  await listeners['state:flush-request']();
  assert.match(sent[1][1].error, /disk full/);
});
