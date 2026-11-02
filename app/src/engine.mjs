export const scenarios = [
  { id: 'ura', name: 'URA', subtitle: '新设！URA巅峰赛' },
  { id: 'aoharu', name: '青春杯', subtitle: '青春杯～闪耀的团队羁绊～' },
  { id: 'climax', name: '巅峰杯', subtitle: 'Make a new track!!' },
  { id: 'live', name: '闪耀舞台', subtitle: '我们的闪耀舞台' },
  { id: 'masters', name: '荣耀女神杯', subtitle: '继承者们' },
  { id: 'larc', name: '凯旋门计划', subtitle: 'Reach for the stars' },
];
export const years = ['初级', '经典级', '高级'];
export const slotOf = (p) => (p.year - 1) * 24 + (p.month - 1) * 2 + (p.half === '前半' ? 0 : 1);
export const dateLabel = (s) =>
  `${years[Math.floor(s / 24)]} ${Math.floor((s % 24) / 2) + 1}月${s % 2 ? '后半' : '前半'}`;
export const isCamp = (s) => s >= 24 && s % 24 >= 12 && s % 24 <= 15;
export const defaultAptitudes = (c) => ({
  turf: c.turf,
  dirt: c.dirt,
  short: c.distances[0],
  mile: c.distances[1],
  medium: c.distances[2],
  long: c.distances[3],
});
export const emptyDraft = (c) => ({
  entries: {},
  aptitudes: defaultAptitudes(c),
  options: { avoidCamp: true, avoidStreak: true },
  targetIds: [],
  branchChoices: {},
});
export function aptitude(r, draft) {
  const a = draft.aptitudes;
  const distanceKey =
    r.distance <= 1400
      ? 'short'
      : r.distance <= 1800
        ? 'mile'
        : r.distance <= 2400
          ? 'medium'
          : 'long';
  return [a[r.surface === '泥地' ? 'dirt' : 'turf'], a[distanceKey]];
}
export const suited = (r, d) => aptitude(r, d).every((a) => 'SAB'.includes(a));
export function context(catalog, routeId, scenario, draft) {
  const route = catalog.routes.find((r) => r.id === routeId);
  const fixed = {},
    deadlines = [],
    events = {};
  let goals = route?.goals || [];
  const branches = ['climax', 'larc'].includes(scenario) ? [] : route?.branches || [];
  for (const b of branches) {
    const selected =
      b.options.find((o) => o.id === draft.branchChoices[b.key]) ||
      b.options.find((o) => o.id === b.defaultChoice);
    goals = [...goals.filter((g) => !b.removeSlots.includes(g.slot)), ...selected.goals];
  }
  const addEvent = (s, title) => {
    events[s] = [...(events[s] || []), title];
  };
  if (scenario !== 'larc' && scenario !== 'climax')
    for (const g of goals) {
      if (g.kind === 'deadline') deadlines.push(g);
      else {
        const choice = draft.branchChoices[g.slot];
        fixed[g.slot] = { ...g, raceId: g.raceIds.includes(choice) ? choice : g.raceIds[0] };
      }
    }
  if (scenario === 'climax') {
    fixed[11] = { title: '参加 初级新人战', kind: 'debut', raceIds: [], slot: 11 };
    const base = catalog.characters.find((c) => c.id === route?.characterId);
    const reduced =
      base &&
      (!'SA'.includes(base.turf) || base.distances.slice(1).every((a) => !'SA'.includes(a)));
    deadlines.push(
      { slot: 23, title: `初级年末：获得 ${reduced ? 30 : 60} 成绩点数`, kind: 'deadline' },
      { slot: 47, title: `经典年末：获得 ${reduced ? 200 : 300} 成绩点数`, kind: 'deadline' },
      { slot: 71, title: '高级年末：获得 300 成绩点数', kind: 'deadline' },
    );
    addEvent(71, '年末后：巅峰杯决赛（3 场）');
  }
  if (scenario === 'larc') {
    fixed[11] = { slot: 11, title: '参加 初级新人战', kind: 'debut', raceIds: [] };
    const find = (n) => catalog.races.find((r) => r.name.includes(n));
    for (const [s, n, condition] of [
      [33, '全国德比', '中进入前3'],
      [40, '尼尔', '出赛'],
      [42, '凯旋门', '出赛'],
      [59, '宝冢', '中进入前3'],
      [64, '福伊', '出赛'],
      [66, '凯旋门', '中进入前5'],
    ]) {
      const r = find(n);
      fixed[s] = {
        slot: s,
        title: `${r?.name || n} ${condition}`,
        kind: 'race',
        raceIds: r ? [r.id] : [],
        raceId: r?.id,
      };
    }
    for (const s of [23, 35, 53, 59]) addEvent(s, '回合后：代表交流赛');
    deadlines.push(
      { slot: 23, title: '支持者点数达到 7,000 pt', kind: 'deadline' },
      { slot: 53, title: '支持者点数达到 42,000 pt', kind: 'deadline' },
    );
  }
  if (scenario === 'aoharu')
    for (const s of [23, 35, 47, 59, 71]) addEvent(s, '回合后：青春杯团队赛');
  if (scenario === 'masters')
    ['成长赛', 'WBC', 'SUPER WBC'].forEach((n, i) => addEvent(i * 24 + 23, `回合后：${n}`));
  if (scenario === 'live')
    for (const s of [23, 35, 47, 59, 71]) addEvent(s, '回合后：闪耀舞台演出');
  return {
    fixed,
    deadlines,
    events,
    branches,
    scenario,
    route,
    coverage: !!route,
    end: scenario === 'larc' ? 66 : 71,
  };
}
export function blockReason(slot, race, ctx) {
  if (slot > ctx.end) return '剧本已结束';
  if (slot < 11) return '出道前不可预约';
  if (ctx.fixed[slot]) return '该回合为固定育成目标';
  if (ctx.scenario === 'larc' && slot >= 24 && slot % 24 >= 12 && slot % 24 <= 18)
    return '海外远征期间';
  if (race.scope !== '常规赛程' && ctx.scenario !== 'larc') return '仅凯旋门计划开放';
  if (!race.periods.some((p) => slotOf(p) === slot)) return '该回合未举办此赛事';
  return '';
}
export function available(catalog, slot, ctx) {
  return catalog.races.filter((r) => !blockReason(slot, r, ctx));
}
export function scheduleEntries(ctx, draft) {
  const entries = { ...draft.entries };
  for (const [s, g] of Object.entries(ctx.fixed))
    entries[s] = { raceId: g.raceId, origin: 'goal', title: g.title, racing: g.kind !== 'rest' };
  return entries;
}
export function createsStreak(slot, entries) {
  const used = new Set(
    Object.entries(entries)
      .filter(([, e]) => e.racing !== false)
      .map(([s]) => +s),
  );
  used.add(slot);
  for (let start = slot - 2; start <= slot; start++)
    if ([start, start + 1, start + 2].every((s) => used.has(s))) return true;
  return false;
}
export function planSuggestions(catalog, obtained, ctx, draft) {
  const selected = draft.targetIds.length ? new Set(draft.targetIds) : null;
  const targets = catalog.races.filter(
    (r) => !obtained.includes(r.id) && (!selected || selected.has(r.id)),
  );
  const entries = scheduleEntries(ctx, draft),
    scheduled = new Set(Object.values(entries).map((e) => e.raceId));
  const additions = [],
    skipped = [],
    covered = [];
  const potential = (r) =>
    r.periods.map(slotOf).filter((s) => !blockReason(s, r, ctx) && !entries[s]);
  targets.sort(
    (a, b) =>
      potential(a).length - potential(b).length ||
      a.grade.localeCompare(b.grade) ||
      Math.max(...aptitude(a, draft).map((x) => 'SABCDEFG'.indexOf(x))) -
        Math.max(...aptitude(b, draft).map((x) => 'SABCDEFG'.indexOf(x))) ||
      Math.min(...a.periods.map(slotOf)) - Math.min(...b.periods.map(slotOf)) ||
      a.id.localeCompare(b.id),
  );
  for (const r of targets) {
    if (scheduled.has(r.id)) {
      covered.push(r.id);
      continue;
    }
    if (!suited(r, draft)) {
      skipped.push({ raceId: r.id, reason: `适性低于 B（${aptitude(r, draft).join(' / ')}）` });
      continue;
    }
    const candidates = potential(r).sort((a, b) => a - b);
    if (!candidates.length) {
      const reasons = [
        ...new Set(
          r.periods.map((p) => {
            const s = slotOf(p);
            return blockReason(s, r, ctx) || (entries[s] ? '回合已有预约' : '无可用日期');
          }),
        ),
      ];
      skipped.push({ raceId: r.id, reason: reasons.join('、') });
      continue;
    }
    const campOk = candidates.filter((s) => !draft.options.avoidCamp || !isCamp(s));
    const valid = campOk.filter((s) => !draft.options.avoidStreak || !createsStreak(s, entries));
    if (!valid.length) {
      skipped.push({
        raceId: r.id,
        reason: campOk.length ? '会形成连续 3 回合参赛' : '避开暑期集训',
      });
      continue;
    }
    const slot = valid[0];
    entries[slot] = { raceId: r.id, origin: 'suggested' };
    scheduled.add(r.id);
    additions.push({ slot, raceId: r.id });
  }
  return { additions: additions.sort((a, b) => a.slot - b.slot), skipped, covered };
}
export function warnings(ctx, draft) {
  const entries = scheduleEntries(ctx, draft),
    result = [];
  for (const [key, e] of Object.entries(draft.entries)) {
    const s = +key;
    if (isCamp(s)) result.push(`${dateLabel(s)}：预约占用暑期集训`);
    if (createsStreak(s, entries)) result.push(`${dateLabel(s)}：存在连续 3 回合参赛`);
  }
  return [...new Set(result)];
}
export function exportText(catalog, character, ctx, draft) {
  const lines = [
    `SyhzUmamusumeTools · ${character.name}`,
    `${scenarios.find((s) => s.id === ctx.scenario)?.name} / ${ctx.route?.name || '共通目标'}`,
    `数据快照：${catalog.asOf}`,
    '预约仅表示计划，比赛获胜后请手动点亮奖杯。',
    '',
  ];
  const entries = scheduleEntries(ctx, draft);
  for (let s = 0; s <= ctx.end; s++) {
    const e = entries[s],
      d = ctx.deadlines.filter((g) => g.slot === s);
    if (e)
      lines.push(
        `${dateLabel(s)}  ${e.origin === 'goal' ? '[育成目标]' : '[预约]'} ${e.title || catalog.races.find((r) => r.id === e.raceId)?.name}`,
      );
    d.forEach((g) => lines.push(`${dateLabel(s)}  [达成期限] ${g.title}`));
    ctx.events[s]?.forEach((t) => lines.push(`${dateLabel(s)}  [${t}]`));
  }
  lines.push('', '参赛粉丝数门槛、胜利条件与实际育成事件请在游戏中确认。', ...warnings(ctx, draft));
  return lines.join('\n');
}
