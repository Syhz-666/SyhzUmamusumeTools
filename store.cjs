const fs = require('node:fs/promises');
const path = require('node:path');
const { context, blockReason } = require('./app/src/engine.mjs');
const SCENARIOS = new Set(['ura', 'aoharu', 'climax', 'live', 'masters', 'larc']);
const record = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
function validateState(input, catalog) {
  assert(record(input) && input.version === 1, '备份格式或版本不支持');
  assert(JSON.stringify(input).length < 5_000_000, '备份文件过大');
  const chars = new Set(catalog.characters.map((c) => c.id)),
    races = new Set(catalog.races.map((r) => r.id));
  const routeMap = new Map(catalog.routes.map((r) => [r.id, r.characterId]));
  assert(record(input.progress) && record(input.drafts), '缺少奖杯进度或预约方案');
  const state = {
    version: 1,
    progress: {},
    drafts: {},
    selectedCharacter: chars.has(input.selectedCharacter)
      ? input.selectedCharacter
      : catalog.characters[0].id,
    selectedScenario: SCENARIOS.has(input.selectedScenario) ? input.selectedScenario : 'ura',
    routeSelections: {},
  };
  for (const [id, list] of Object.entries(input.progress)) {
    assert(
      chars.has(id) && Array.isArray(list) && list.every((r) => races.has(r)),
      '奖杯进度含未知角色或赛事',
    );
    state.progress[id] = [...new Set(list)];
  }
  assert(Object.keys(input.drafts).length <= 4000, '预约方案数量超出范围');
  for (const [key, d] of Object.entries(input.drafts)) {
    const [char, route, scenario, ...extra] = key.split(':');
    assert(
      !extra.length && chars.has(char) && routeMap.get(route) === char && SCENARIOS.has(scenario),
      '预约方案标识无效',
    );
    assert(
      record(d) &&
        record(d.entries) &&
        record(d.aptitudes) &&
        record(d.options) &&
        record(d.branchChoices) &&
        Array.isArray(d.targetIds),
      '预约方案结构不完整',
    );
    const entries = {};
    for (const [slot, e] of Object.entries(d.entries)) {
      assert(
        /^(?:[0-9]|[1-6][0-9]|7[01])$/.test(slot) &&
          record(e) &&
          races.has(e.raceId) &&
          ['manual', 'suggested'].includes(e.origin),
        '预约记录无效',
      );
      entries[slot] = { raceId: e.raceId, origin: e.origin };
    }
    const aptitudes = {};
    for (const k of ['turf', 'dirt', 'short', 'mile', 'medium', 'long']) {
      assert(
        typeof d.aptitudes[k] === 'string' && /^[SABCDEFG]$/.test(d.aptitudes[k]),
        '适性必须为 S～G',
      );
      aptitudes[k] = d.aptitudes[k];
    }
    assert(
      typeof d.options.avoidCamp === 'boolean' && typeof d.options.avoidStreak === 'boolean',
      '规划选项无效',
    );
    assert(
      d.targetIds.every((id) => races.has(id)),
      '目标奖杯不存在',
    );
    const routeData = catalog.routes.find((r) => r.id === route);
    const allowedBranches = new Map(
      (routeData.branches || []).map((b) => [b.key, b.options.map((o) => o.id)]),
    );
    for (const g of routeData.goals)
      if (g.raceIds.length > 1) allowedBranches.set(String(g.slot), g.raceIds);
    const branchChoices = {};
    for (const [s, id] of Object.entries(d.branchChoices)) {
      assert(allowedBranches.get(s)?.includes(id), '目标分支无效');
      branchChoices[s] = id;
    }
    state.drafts[key] = {
      entries,
      aptitudes,
      options: { avoidCamp: d.options.avoidCamp, avoidStreak: d.options.avoidStreak },
      targetIds: [...new Set(d.targetIds)],
      branchChoices,
    };
    const ctx = context(catalog, route, scenario, state.drafts[key]);
    for (const [s, e] of Object.entries(entries))
      assert(
        !blockReason(
          +s,
          catalog.races.find((r) => r.id === e.raceId),
          ctx,
        ),
        '预约日期与赛事或固定目标冲突',
      );
  }
  if (record(input.routeSelections))
    for (const [c, r] of Object.entries(input.routeSelections)) {
      assert(chars.has(c) && routeMap.get(r) === c, '目标路线无效');
      state.routeSelections[c] = r;
    }
  return state;
}
const emptyState = () => ({
  version: 1,
  progress: {},
  drafts: {},
  selectedCharacter: '1001',
  selectedScenario: 'ura',
  routeSelections: {},
});
async function writeAtomic(file, state, catalog) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  let previous;
  try {
    previous = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (previous !== undefined) {
    let valid = false;
    try {
      const parsed = JSON.parse(previous);
      if (catalog) validateState(parsed, catalog);
      else
        assert(
          record(parsed) &&
            parsed.version === 1 &&
            record(parsed.progress) &&
            record(parsed.drafts),
          '无效存档',
        );
      valid = true;
    } catch {}
    // A corrupt primary must never replace the known-good recovery backup.
    if (valid) await fs.copyFile(file, file + '.bak');
  }
  await fs.rename(temp, file);
}
async function readState(file, catalog) {
  let invalid = false;
  for (const candidate of [file, file + '.bak']) {
    try {
      return {
        state: validateState(JSON.parse(await fs.readFile(candidate, 'utf8')), catalog),
        recovered: candidate !== file,
      };
    } catch (e) {
      if (e.code !== 'ENOENT') invalid = true;
    }
  }
  if (invalid) throw new Error('数据及自动备份无法读取。请从有效 JSON 备份恢复。');
  return { state: emptyState(), recovered: false };
}
async function loadOrMigrate(file, legacyFiles, catalog) {
  // Never replace an existing primary (including a corrupt one) during migration.
  try {
    await fs.access(file);
    return await readState(file, catalog);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  try {
    await fs.access(file + '.bak');
    return await readState(file, catalog);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const legacy of legacyFiles) {
    try {
      await fs.access(legacy);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const result = await readState(legacy, catalog);
    await writeAtomic(file, result.state, catalog);
    return { ...result, migratedFrom: legacy };
  }
  return await readState(file, catalog);
}
module.exports = { validateState, writeAtomic, readState, emptyState, loadOrMigrate };
