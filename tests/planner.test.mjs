import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  context,
  emptyDraft,
  planSuggestions,
  slotOf,
  blockReason,
  available,
  scheduleEntries,
  createsStreak,
  isCamp,
  scenarios,
  exportText,
} from '../app/src/engine.mjs';
const require = createRequire(import.meta.url);
const {
  validateState,
  writeAtomic,
  readState,
  emptyState,
  loadOrMigrate,
} = require('../store.cjs');
const catalog = JSON.parse(
  await fs.readFile(new URL('../app/public/catalog.json', import.meta.url), 'utf8'),
);
const character = (id) => catalog.characters.find((c) => c.id === id);
const setup = (id = '1001', scenario = 'ura') => {
  const c = character(id),
    r = catalog.routes.find((r) => r.characterId === id),
    draft = emptyDraft(c);
  return { c, route: r, draft, ctx: context(catalog, r.id, scenario, draft) };
};
test('国服快照：87 位独立角色、155 奖杯、216 日期，目标及本地图片覆盖完整', async () => {
  assert.equal(catalog.characters.length, 87);
  assert.equal(catalog.races.length, 155);
  assert.deepEqual(
    ['G1', 'G2', 'G3'].map((g) => catalog.races.filter((r) => r.grade === g).length),
    [35, 44, 76],
  );
  assert.equal(
    catalog.races.reduce((s, r) => s + r.periods.length, 0),
    216,
  );
  assert.equal(new Set(catalog.characters.map((c) => c.id)).size, 87);
  assert.equal(catalog.coverage.failedAssets.length, 0);
  assert.equal(catalog.coverage.failedRoutes.length, 0);
  for (const c of catalog.characters) assert.ok(catalog.routes.some((r) => r.characterId === c.id));
  for (const r of catalog.routes) {
    assert.ok(r.goals.length >= 5);
    assert.equal(r.goals[0].slot, 11);
    assert.equal(r.goals[0].kind, 'debut');
  }
  for (const r of catalog.races) {
    await fs.access(new URL('../app/public/' + r.trophy.replace('./', ''), import.meta.url));
    if (r.banner)
      await fs.access(new URL('../app/public/' + r.banner.replace('./', ''), import.meta.url));
  }
});
test('解析保留末项目标，并补回醒目飞鹰的累计胜场期限', () => {
  const s = setup();
  assert.equal(s.ctx.fixed[71].raceId, '1023');
  const f = setup('1046');
  assert.ok(f.ctx.deadlines.some((g) => g.slot === 24 && g.title.includes('Pre-OP')));
  assert.equal(f.ctx.fixed[11].kind, 'debut');
  assert.equal(f.ctx.fixed[24], undefined);
});
test('所有已关联的固定目标都有真实举办日期', () => {
  for (const route of catalog.routes)
    for (const g of route.goals)
      for (const id of g.raceIds) {
        const r = catalog.races.find((r) => r.id === id);
        assert.ok(r, `${route.id}: missing ${id}`);
        assert.ok(
          r.periods.some((p) => slotOf(p) === g.slot),
          `${route.name} ${g.title} -> ${r.name} slot ${g.slot}`,
        );
      }
});
test('粉丝期限不占格；固定比赛不可被普通预约覆盖', () => {
  const s = setup('1006');
  const g = s.ctx.deadlines[0];
  assert.ok(g);
  assert.equal(s.ctx.fixed[g.slot], undefined);
  const r = catalog.races.find((r) => r.periods.some((p) => slotOf(p) === 33));
  assert.equal(blockReason(33, r, setup().ctx), '该回合为固定育成目标');
});
test('六剧本覆盖：青春杯回合后赛事、巅峰目标替换、女神年末赛和凯旋门远征', () => {
  const a = setup('1001', 'aoharu');
  assert.ok(a.ctx.events[23]);
  assert.equal(a.ctx.fixed[23], undefined);
  assert.ok(available(catalog, 23, a.ctx).length);
  const m = setup('1001', 'climax');
  assert.equal(m.ctx.fixed[33], undefined);
  assert.match(m.ctx.deadlines[0].title, /60 成绩/);
  assert.equal(setup('1052', 'climax').ctx.deadlines[0].title, '初级年末：获得 30 成绩点数');
  const gm = setup('1001', 'masters');
  assert.ok(gm.ctx.events[23]);
  assert.equal(gm.ctx.fixed[23], undefined);
  const l = setup('1001', 'larc');
  assert.equal(l.ctx.fixed[33].raceId, '1010');
  assert.equal(l.ctx.fixed[66].raceId, '1201');
  assert.equal(l.ctx.end, 66);
  assert.ok(l.ctx.deadlines.some((g) => g.slot === 53 && g.title.includes('支持者')));
  assert.equal(available(catalog, 36, l.ctx).length, 0);
  assert.equal(available(catalog, 67, l.ctx).length, 0);
});
test('建议预览不修改存档，保留手动选择；确认预约不点亮奖杯', () => {
  const s = setup();
  const first = available(catalog, 24, s.ctx)[0];
  s.draft.entries[24] = { raceId: first.id, origin: 'manual' };
  const snapshot = JSON.stringify(s.draft),
    obtained = ['1001'];
  const p = planSuggestions(catalog, obtained, s.ctx, s.draft);
  assert.equal(JSON.stringify(s.draft), snapshot);
  assert.deepEqual(obtained, ['1001']);
  assert.ok(p.additions.every((a) => a.slot !== 24 && a.raceId !== '1001'));
});
test('仅规划所选未获得目标；默认至少 B 适性；未安排给出原因', () => {
  const s = setup();
  s.draft.targetIds = ['1001'];
  const p = planSuggestions(catalog, [], s.ctx, s.draft);
  assert.equal(p.additions.length, 0);
  assert.equal(p.skipped.length, 1);
  assert.match(p.skipped[0].reason, /适性/);
  const q = planSuggestions(catalog, ['1001'], s.ctx, s.draft);
  assert.equal(q.additions.length + q.covered.length + q.skipped.length, 0);
});
test('全角色 × 六剧本：建议日期合法，不覆盖目标，避暑期，不新增三连战', () => {
  for (const c of catalog.characters)
    for (const sc of scenarios) {
      const s = setup(c.id, sc.id),
        p = planSuggestions(catalog, [], s.ctx, s.draft),
        entries = scheduleEntries(s.ctx, s.draft);
      for (const a of p.additions) {
        const r = catalog.races.find((r) => r.id === a.raceId);
        assert.equal(blockReason(a.slot, r, s.ctx), '');
        assert.equal(entries[a.slot], undefined);
        assert.equal(isCamp(a.slot), false);
        assert.equal(createsStreak(a.slot, entries), false, `${c.name} ${sc.id} ${a.slot}`);
        entries[a.slot] = { raceId: r.id };
      }
      assert.equal(new Set(p.additions.map((a) => a.slot)).size, p.additions.length);
    }
});
test('跨年连续参赛与强制休息正确区分', () => {
  assert.equal(createsStreak(24, { 22: {}, 23: {} }), true);
  assert.equal(createsStreak(24, { 22: { racing: false }, 23: {} }), false);
  const ks = setup('1093');
  assert.equal(ks.ctx.fixed[41].kind, 'rest');
  assert.equal(ks.ctx.fixed[41].raceId, undefined);
  assert.equal(ks.ctx.fixed[65].raceId, '1013');
});
test('大和赤骥目标分支按选择切换，共享奖杯无需分角色', () => {
  const s = setup('1009');
  assert.equal(s.ctx.fixed[33].raceIds.length, 2);
  s.draft.branchChoices[33] = '1010';
  assert.equal(context(catalog, s.route.id, 'ura', s.draft).fixed[33].raceId, '1010');
});
test('跨日期与联动目标分支正确释放原回合；剧情取消赛不会贡献奖杯', () => {
  const fuji = setup('1005');
  assert.equal(fuji.ctx.fixed[32].raceId, '1007');
  assert.equal(fuji.ctx.fixed[45].raceId, '1018');
  assert.equal(fuji.ctx.fixed[33], undefined);
  fuji.draft.branchChoices[33] = '1010';
  const classic = context(catalog, fuji.route.id, 'ura', fuji.draft);
  assert.equal(classic.fixed[33].raceId, '1010');
  assert.equal(classic.fixed[43].raceId, '1015');
  assert.equal(classic.fixed[32], undefined);
  assert.equal(classic.fixed[45], undefined);
  const fine = setup('1022');
  fine.draft.branchChoices[71] = '1016';
  const moved = context(catalog, fine.route.id, 'ura', fine.draft);
  assert.equal(moved.fixed[67].raceId, '1016');
  assert.equal(moved.fixed[71], undefined);
  const tann = setup('1062');
  assert.equal(tann.ctx.fixed[69].kind, 'rest');
  assert.equal(tann.ctx.fixed[69].raceId, undefined);
  for (const r of catalog.routes)
    for (const b of r.branches || [])
      for (const o of b.options) {
        const d = emptyDraft(character(r.characterId));
        d.branchChoices[b.key] = o.id;
        const cx = context(catalog, r.id, 'ura', d);
        for (const g of o.goals) {
          assert.equal(cx.fixed[g.slot].raceId, g.raceIds[0]);
          const rr = catalog.races.find((rr) => rr.id === g.raceIds[0]);
          assert.ok(rr.periods.some((p) => slotOf(p) === g.slot));
        }
      }
});
test('存档校验隔离角色和剧本，拒绝损坏版本、未知赛事、超界日期', () => {
  const s = setup(),
    a = emptyState();
  a.progress = { 1001: ['1001'], 1002: [] };
  a.drafts['1001:100101:ura'] = s.draft;
  assert.deepEqual(validateState(a, catalog).progress, a.progress);
  assert.equal(validateState(a, catalog).drafts['1001:100101:larc'], undefined);
  for (const mutate of [
    (b) => (b.version = 99),
    (b) => (b.progress['1001'] = ['bogus']),
    (b) => (b.drafts['1001:100101:ura'].entries[72] = { raceId: '1001', origin: 'manual' }),
    (b) => (b.drafts['1001:100101:ura'].entries[33] = { raceId: '1010', origin: 'manual' }),
    (b) => (b.drafts['1001:100101:ura'].entries[24] = { raceId: '1010', origin: 'manual' }),
    (b) => (b.drafts['1001:100101:ura'].branchChoices[12] = '1001'),
    (b) => (b.drafts['1001:100101:ura'].aptitudes.turf = 'Q'),
  ]) {
    const b = structuredClone(a);
    mutate(b);
    assert.throws(() => validateState(b, catalog));
  }
});
test('原子存档、上一份自动备份及损坏文件恢复', async () => {
  const dir = await fs.mkdtemp(path.resolve('outputs/app-qa/store-test-')),
    file = path.join(dir, 'collection.json');
  const a = emptyState();
  await writeAtomic(file, a);
  const b = structuredClone(a);
  b.progress['1001'] = ['1001'];
  await writeAtomic(file, b);
  assert.deepEqual((await readState(file, catalog)).state.progress, b.progress);
  await fs.writeFile(file, 'broken');
  const restored = await readState(file, catalog);
  assert.equal(restored.recovered, true);
  assert.deepEqual(restored.state.progress, a.progress);
  await writeAtomic(file, b, catalog);
  assert.deepEqual(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).progress, a.progress);
  assert.deepEqual((await readState(file, catalog)).state.progress, b.progress);
});
test('奖杯使用游戏显示顺序，保留泥地倒序与升格赛事的原位置', () => {
  assert.equal(new Set(catalog.races.map((r) => r.trophyOrder)).size, 155);
  assert.deepEqual(
    catalog.races.slice(24, 30).map((r) => r.id),
    ['1106', '1105', '1104', '1103', '1102', '1101'],
  );
  const g2 = catalog.races.filter((r) => r.grade === 'G2');
  assert.deepEqual(
    g2.slice(0, 7).map((r) => r.id),
    ['2001', '2002', '2003', '2004', '2005', '3018', '2006'],
  );
  assert.ok(g2.findIndex((r) => r.id === '3058') < g2.findIndex((r) => r.id === '2029'));
  const g3 = catalog.races.filter((r) => r.grade === 'G3');
  assert.ok(g3.findIndex((r) => r.id === '4050') < g3.findIndex((r) => r.id === '3030'));
});
test('更名迁移保留进度、原文件及角色选择，已有新版存档优先', async () => {
  const dir = await fs.mkdtemp(path.resolve('outputs/app-qa/migrate-test-'));
  const oldFile = path.join(dir, 'old/collection-v1.json');
  const newFile = path.join(dir, 'new/collection-v1.json');
  const state = emptyState();
  state.selectedCharacter = '1002';
  state.progress['1002'] = ['1001', '1106'];
  await writeAtomic(oldFile, state, catalog);
  const migrated = await loadOrMigrate(newFile, [oldFile], catalog);
  assert.equal(migrated.migratedFrom, oldFile);
  assert.deepEqual(migrated.state, state);
  assert.deepEqual((await readState(oldFile, catalog)).state, state);
  const current = emptyState();
  current.progress['1001'] = ['1002'];
  await writeAtomic(newFile, current, catalog);
  assert.deepEqual((await loadOrMigrate(newFile, [oldFile], catalog)).state, current);
  await fs.writeFile(newFile, 'corrupt');
  await fs.writeFile(newFile + '.bak', 'corrupt');
  await assert.rejects(loadOrMigrate(newFile, [oldFile], catalog));
});
test('文字导出包括完整三年、目标期限、普通预约和回合后活动', () => {
  const s = setup('1001', 'aoharu');
  s.draft.entries[24] = { raceId: available(catalog, 24, s.ctx)[0].id, origin: 'manual' };
  const t = exportText(catalog, s.c, s.ctx, s.draft);
  assert.match(t, /特别周/);
  assert.match(t, /高级 12月后半/);
  assert.match(t, /预约/);
  assert.match(t, /青春杯团队赛/);
});
