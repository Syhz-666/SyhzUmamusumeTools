// Explicit one-off recovery: node scripts/recover-profile.cjs SOURCE DEST [PREVIOUS]
// Keeps every original as a timestamped copy, and unions trophy progress.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readState, writeAtomic, validateState } = require('../store.cjs');
async function recover() {
  const args = process.argv.slice(2);
  if (args.length < 2) throw new Error('请指定来源和目标存档路径');
  const [source, destination, previous] = args.map((p) => path.resolve(p));
  if (source === destination) throw new Error('来源和目标必须不同');
  const catalog = require('../app/public/catalog.json');
  const recovered = (await readState(source, catalog)).state;
  let existing;
  for (const file of [destination, previous].filter(Boolean)) {
    try {
      await fs.access(file);
      existing = (await readState(file, catalog)).state;
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const next = existing
    ? {
        ...recovered,
        ...existing,
        selectedCharacter: recovered.selectedCharacter,
        selectedScenario: recovered.selectedScenario,
        drafts: { ...recovered.drafts, ...existing.drafts },
        routeSelections: { ...recovered.routeSelections, ...existing.routeSelections },
        progress: { ...existing.progress },
      }
    : structuredClone(recovered);
  for (const [character, trophies] of Object.entries(recovered.progress))
    next.progress[character] = [...new Set([...(next.progress[character] || []), ...trophies])];
  const backupDir = path.resolve(__dirname, '../outputs/user-recovery');
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = Date.now();
  for (const [index, file] of [source, destination, previous].filter(Boolean).entries()) {
    try {
      await fs.copyFile(file, path.join(backupDir, `${stamp}-${index}-original.json`));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  await writeAtomic(destination, validateState(next, catalog), catalog);
  const saved = (await readState(destination, catalog)).state;
  console.log(
    JSON.stringify(
      {
        destination,
        backupDir,
        counts: Object.fromEntries(
          Object.entries(saved.progress).map(([id, list]) => [id, list.length]),
        ),
      },
      null,
      2,
    ),
  );
}
recover().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
