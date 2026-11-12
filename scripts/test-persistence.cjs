// A real Electron restart test using disposable, explicitly isolated data.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { emptyState, writeAtomic, readState } = require('../store.cjs');
const catalog = require('../app/public/catalog.json');
const root = path.resolve(__dirname, '..');
const packaged = process.argv[2];
async function run(executable, args, qaRoot, count) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, SYHZ_QA_DIR: qaRoot, SYHZ_EXPECT_TROPHIES: String(count) },
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Persistence test timed out'));
    }, 60000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (output.trim()) console.log(output.trim());
      if (code !== 0) reject(new Error(`Electron exited ${code}`));
      else resolve();
    });
  });
}
async function testPersistence() {
  const qaParent = path.join(root, 'outputs', 'app-qa');
  await fs.mkdir(qaParent, { recursive: true });
  const qaRoot = await fs.mkdtemp(path.join(qaParent, 'restart-test-'));
  const file = path.join(qaRoot, 'profile/collection-v1.json');
  const state = emptyState();
  state.selectedCharacter = '1002';
  state.selectedScenario = 'larc';
  state.progress['1002'] = catalog.races.slice(3, 39).map((r) => r.id);
  await writeAtomic(file, state, catalog);
  const executable = packaged ? path.resolve(packaged) : require('electron');
  const prefix = packaged ? [] : ['.'];
  await run(executable, [...prefix, '--smoke-test', '--persistence-exercise'], qaRoot, 36);
  const afterClose = (await readState(file, catalog)).state;
  if (afterClose.progress['1002'].length !== 37)
    throw new Error('Last click was not saved before exit');
  console.log('First close: 37 trophies persisted');
  await run(executable, [...prefix, '--smoke-test'], qaRoot, 37);
  console.log('Restart: UI restored 37 trophies without importing. Profile:', qaRoot);
}
testPersistence().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
