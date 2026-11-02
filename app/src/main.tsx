import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import type { Catalog, State, Draft, Race } from './types';
import {
  scenarios,
  years,
  dateLabel,
  slotOf,
  isCamp,
  emptyDraft,
  context,
  blockReason,
  available,
  scheduleEntries,
  suited,
  aptitude,
  planSuggestions,
  warnings,
  exportText,
} from './engine.mjs';
import type { Preview } from './engine.mjs';
import './style.css';

type Modal =
  | { type: 'race'; id: string }
  | { type: 'slot'; slot: number }
  | { type: 'goal'; slot: number }
  | { type: 'preview'; preview: Preview }
  | { type: 'settings' }
  | { type: 'sources' }
  | { type: 'import'; state: State }
  | { type: 'clear' }
  | null;
const Grade = ({ value }: { value: string }) => (
  <span className={`grade ${value.toLowerCase()}`}>
    {value.replace('1', 'Ⅰ').replace('2', 'Ⅱ').replace('3', 'Ⅲ')}
  </span>
);
const metadata = (r: Race) => `${r.venue} · ${r.surface} ${r.distance}m · ${r.direction}回转`;
function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [state, setState] = useState<State | null>(null),
    [fatal, setFatal] = useState('');
  const [view, setView] = useState<'trophies' | 'schedule'>('trophies'),
    [grade, setGrade] = useState('G1'),
    [year, setYear] = useState(0);
  const [query, setQuery] = useState(''),
    [raceQuery, setRaceQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [suitableOnly, setSuitableOnly] = useState(false);
  const [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState(''),
    [saveStatus, setSaveStatus] = useState('已保存'),
    [dataPath, setDataPath] = useState(''),
    [isTestProfile, setIsTestProfile] = useState(false),
    [focusRoom, setFocusRoom] = useState(false);
  const [undo, setUndo] = useState<{ character: string; ids: string[] } | null>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const saveRevision = useRef(0);
  useEffect(() => {
    Promise.all([
      fetch('./catalog.json').then((r) => {
        if (!r.ok) throw new Error('赛事数据加载失败');
        return r.json() as Promise<Catalog>;
      }),
      window.desktop.load(),
    ])
      .then(([c, r]) => {
        setCatalog(c);
        setState(r.state);
        setDataPath(r.dataPath);
        setIsTestProfile(!!r.isTestProfile);
        if (r.isTestProfile) document.title = 'SyhzUmamusumeTools [测试存档]';
        if (r.migratedFrom) setNotice('已迁移旧版存档，原文件保留');
        if (r.error) setNotice(r.error);
        if (r.recovered) setNotice('已从自动备份恢复数据');
      })
      .catch((e) => setFatal(String(e)));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    setModal(null);
    setRaceQuery('');
    setUndo(null);
  }, [state?.selectedCharacter, state?.selectedScenario, state?.routeSelections]);
  if (fatal) return <div className="fatal">应用加载失败：{fatal}</div>;
  if (!catalog || !state)
    return (
      <div className="loading">
        <span>✦</span>正在打开奖杯陈列室…
      </div>
    );
  const c =
    catalog.characters.find((c) => c.id === state.selectedCharacter) || catalog.characters[0];
  const routes = catalog.routes.filter((r) => r.characterId === c.id),
    routeId = state.routeSelections[c.id] || routes[0]?.id;
  const scenario = state.selectedScenario,
    key = `${c.id}:${routeId}:${scenario}`;
  const draft = state.drafts[key] || emptyDraft(c),
    obtained = state.progress[c.id] || [];
  const ctx = context(catalog, routeId, scenario, draft),
    entries = scheduleEntries(ctx, draft),
    warn = warnings(ctx, draft);
  const race = (id: string | undefined) => catalog.races.find((r) => r.id === id);
  const commit = (next: State) => {
    const revision = ++saveRevision.current;
    setState(next);
    setSaveStatus('保存中…');
    window.desktop
      .save(next)
      .then(() => {
        if (revision === saveRevision.current) setSaveStatus('已保存');
      })
      .catch((e) => {
        if (revision !== saveRevision.current) return;
        setSaveStatus('保存失败');
        setNotice(String(e));
      });
  };
  const updateDraft = (next: Draft) =>
    commit({ ...state, drafts: { ...state.drafts, [key]: next } });
  const changeBranch = (branchKey: string, value: string) => {
    const next = {
      ...draft,
      branchChoices: { ...draft.branchChoices, [branchKey]: value },
      entries: { ...draft.entries },
    };
    const nextCtx = context(catalog, routeId, scenario, next);
    let removed = 0;
    for (const [s, e] of Object.entries(next.entries)) {
      const r = race(e.raceId);
      if (r && blockReason(+s, r, nextCtx)) {
        delete next.entries[s];
        removed++;
      }
    }
    updateDraft(next);
    setNotice(`目标分支已更新${removed ? `，已移除 ${removed} 场冲突预约` : ''}`);
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setNotice(String(e));
    }
  };
  const toggle = (id: string) => {
    setUndo({ character: c.id, ids: obtained });
    const on = !obtained.includes(id);
    commit({
      ...state,
      progress: {
        ...state.progress,
        [c.id]: on ? [...obtained, id] : obtained.filter((x) => x !== id),
      },
    });
    setNotice(`${c.name} · ${race(id)?.name}：${on ? '已点亮' : '已取消点亮'}`);
  };
  const target = (id: string) =>
    updateDraft({
      ...draft,
      targetIds: draft.targetIds.includes(id)
        ? draft.targetIds.filter((x) => x !== id)
        : [...draft.targetIds, id],
    });
  const reserve = (slot: number, id: string) => {
    const r = race(id);
    if (!r) return;
    const reason = blockReason(slot, r, ctx);
    if (reason) {
      setNotice(reason);
      return;
    }
    updateDraft({
      ...draft,
      entries: { ...draft.entries, [slot]: { raceId: id, origin: 'manual' } },
    });
    setModal(null);
    setView('schedule');
    setYear(Math.floor(slot / 24));
    setNotice(`${dateLabel(slot)} 已预约 ${r.name}`);
  };
  const cancel = (slot: number) => {
    const next = { ...draft.entries };
    delete next[slot];
    updateDraft({ ...draft, entries: next });
    setModal(null);
    setNotice('已取消该回合预约');
  };
  const generate = () =>
    setModal({ type: 'preview', preview: planSuggestions(catalog, obtained, ctx, draft) });
  const shown = catalog.races.filter(
    (r) =>
      r.grade === grade &&
      (!raceQuery || `${r.name}${r.jp}${r.alias}`.includes(raceQuery)) &&
      (filter === 'all' ||
        (filter === 'obtained' ? obtained.includes(r.id) : !obtained.includes(r.id))) &&
      (!suitableOnly || suited(r, draft)),
  );
  const manualCount = Object.keys(draft.entries).length;
  const exportPng = async () => {
    const node = document.querySelector<HTMLElement>('.export-sheet');
    if (!node) return;
    setNotice('正在生成三年赛程图片…');
    const png = await toPng(node, { pixelRatio: 2, backgroundColor: '#f2f7ec', cacheBust: false });
    if (await window.desktop.exportFile({ type: 'png', data: png }))
      setNotice('三年赛程图片已导出');
  };
  const sourceLink = (title: string, url: string) => (
    <button className="source-link" onClick={() => act(() => window.desktop.openSource(url))}>
      {title} ↗
    </button>
  );
  const renderCalendar = (y: number, exporting = false) => (
    <div className={`calendar ${exporting ? 'export-calendar' : ''}`}>
      {Array.from({ length: 24 }, (_, i) => {
        const slot = y * 24 + i,
          e = entries[slot],
          r = race(e?.raceId),
          goal = ctx.fixed[slot],
          ended = slot > ctx.end;
        const blocked =
          !!goal ||
          ended ||
          slot < 11 ||
          (scenario === 'larc' && slot >= 24 && slot % 24 >= 12 && slot % 24 <= 18);
        const count = available(catalog, slot, ctx).length,
          deadline = ctx.deadlines.filter((g) => g.slot === slot);
        return (
          <button
            key={slot}
            className={`calendar-cell ${goal ? 'fixed' : ''} ${e?.origin === 'manual' || e?.origin === 'suggested' ? 'reserved' : ''} ${blocked && !goal ? 'disabled' : ''} ${isCamp(slot) ? 'camp' : ''}`}
            disabled={exporting || (blocked && !goal)}
            onClick={() => setModal({ type: goal ? 'goal' : 'slot', slot })}
            title={goal?.title || `${dateLabel(slot)} · ${count} 场可选赛事`}
          >
            <span className="cell-date">
              <b>{Math.floor(i / 2) + 1}月</b> {i % 2 ? '后半' : '前半'}
              {isCamp(slot) && <em>夏</em>}
            </span>
            {e ? (
              <>
                <span className={`reservation-tag ${goal ? 'goal-tag' : ''}`}>
                  {goal ? (goal.kind === 'rest' ? '固定休息' : '育成目标') : '预约中'}
                </span>
                {r?.banner ? (
                  <>
                    <img className="race-banner" src={r.banner} alt="" />
                    <span className="banner-caption">{r.name}</span>
                  </>
                ) : (
                  <span className="calendar-race-name">
                    {r?.name || goal?.title.replace(/ 中.*/, '')}
                  </span>
                )}
                {r && (
                  <span className="cell-track">
                    {r.surface} {r.distance}m <Grade value={r.grade} />
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="cell-plus">
                  {ended ? '—' : slot < 11 ? '·' : blocked ? '✈' : '＋'}
                </span>
                <span className="cell-hint">
                  {ended
                    ? '剧本结束'
                    : slot < 11
                      ? '出道前'
                      : blocked
                        ? '海外远征'
                        : count
                          ? `${count} 场可预约`
                          : '无重赏赛事'}
                </span>
              </>
            )}
            {!!deadline.length && (
              <span className="deadline-dot" title={deadline.map((g) => g.title).join('、')}>
                达成期限
              </span>
            )}
            {!!ctx.events[slot]?.length && (
              <span className="event-dot" title={ctx.events[slot].join('、')}>
                回合后活动
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      <header className="topbar">
        <div className="brand-mark">✦</div>
        <div className="brand">
          <b>SyhzUmamusumeTools</b>
          <small>优俊少女 · 奖杯与赛事预约</small>
        </div>
        <div className="header-divider" />
        <span className={`edition ${isTestProfile ? 'test-profile' : ''}`}>
          {isTestProfile ? '测试存档 · 与正式进度隔离' : '国服 · 本地收藏与预约'}
        </span>
        <div className="top-actions">
          <span className={`save-state ${saveStatus === '保存失败' ? 'error' : ''}`}>
            ● {saveStatus}
          </span>
          <button onClick={() => setModal({ type: 'settings' })}>数据与备份</button>
          <button
            className="circle"
            aria-label="数据说明"
            onClick={() => setModal({ type: 'sources' })}
          >
            ?
          </button>
        </div>
      </header>
      <div
        className={`workspace ${view === 'trophies' ? 'trophy-workspace' : ''} ${view === 'trophies' && focusRoom ? 'focus-room' : ''}`}
      >
        <aside className="characters panel">
          <div className="sidebar-heading">
            <b>育成马娘</b>
            <span>{catalog.characters.length} 名</span>
          </div>
          <div className="search-wrap">
            <span>⌕</span>
            <input
              aria-label="搜索马娘"
              placeholder="搜索名字 / 别名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="character-list">
            {catalog.characters
              .filter((ch) => `${ch.name}${ch.alias}`.toLowerCase().includes(query.toLowerCase()))
              .map((ch) => {
                const n = (state.progress[ch.id] || []).length;
                return (
                  <button
                    key={ch.id}
                    className={`character-option ${c.id === ch.id ? 'selected' : ''}`}
                    onClick={() => commit({ ...state, selectedCharacter: ch.id })}
                  >
                    <img src={ch.portrait} alt="" />
                    <span>
                      <b>{ch.name}</b>
                      <small>奖杯 {n} / 155</small>
                    </span>
                    {c.id === ch.id && <i>›</i>}
                  </button>
                );
              })}
            {!catalog.characters.some((ch) =>
              `${ch.name}${ch.alias}`.toLowerCase().includes(query.toLowerCase()),
            ) && <p className="empty">没有匹配的马娘</p>}
          </div>
          <div className="sidebar-bottom">
            角色进度独立保存
            <br />
            <small>资料快照 {catalog.asOf}</small>
          </div>
        </aside>
        <main className="main-column">
          <div className="character-hero">
            <div className="hero-lines" />
            <img src={c.portrait} alt={c.name} />
            <div>
              <span className="eyebrow">MY TROPHY COLLECTION</span>
              <h1>{c.name}</h1>
              <span className="hero-caption">每一座奖杯，都记录一次胜利。</span>
            </div>
            <div className="hero-count">
              <strong>
                {obtained.length}
                <small> / 155</small>
              </strong>
              <span>已获得奖杯</span>
            </div>
          </div>
          <nav className="main-tabs">
            <button
              className={view === 'trophies' ? 'active' : ''}
              onClick={() => setView('trophies')}
            >
              <span>♜</span> 奖杯陈列室
            </button>
            <button
              className={view === 'schedule' ? 'active' : ''}
              onClick={() => setView('schedule')}
            >
              <span>▦</span> 赛事预约 <small>{manualCount}</small>
            </button>
          </nav>
          {view === 'trophies' ? (
            <section className="game-panel trophy-panel">
              <div className="game-title">
                <span>{focusRoom ? `${c.name} · 奖杯陈列室` : '奖杯陈列室'}</span>
                <button className="room-expand" onClick={() => setFocusRoom(!focusRoom)}>
                  {focusRoom ? '收起陈列室' : '展开陈列室'}
                </button>
              </div>
              <div className="grade-tabs">
                {['G1', 'G2', 'G3'].map((g) => (
                  <button
                    key={g}
                    className={grade === g ? 'active' : ''}
                    onClick={() => setGrade(g)}
                  >
                    <Grade value={g} />
                    <span>
                      {catalog.races.filter((r) => r.grade === g && obtained.includes(r.id)).length}
                      <i> / {catalog.races.filter((r) => r.grade === g).length}</i>
                    </span>
                  </button>
                ))}
              </div>
              <div className="trophy-filters">
                <input
                  placeholder="搜索赛事名称…"
                  aria-label="搜索赛事"
                  value={raceQuery}
                  onChange={(e) => setRaceQuery(e.target.value)}
                />
                <select
                  aria-label="奖杯获取状态"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部奖杯</option>
                  <option value="missing">未获得</option>
                  <option value="obtained">已获得</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={suitableOnly}
                    onChange={(e) => setSuitableOnly(e.target.checked)}
                  />
                  适性 B 以上
                </label>
              </div>
              <div className="shelf-scroll">
                <div className="trophy-shelves">
                  {shown.map((r) => (
                    <div
                      className={`trophy-item ${obtained.includes(r.id) ? 'lit' : 'unlit'} ${draft.targetIds.includes(r.id) ? 'targeted' : ''}`}
                      key={r.id}
                    >
                      <div className="spotlight" />
                      <button
                        className="cup-touch"
                        aria-label={`${obtained.includes(r.id) ? '取消点亮' : '点亮'} ${r.name}`}
                        aria-pressed={obtained.includes(r.id)}
                        onClick={() => toggle(r.id)}
                      >
                        <img src={r.trophy} alt={r.name} />
                        <span className="obtained-mark">
                          {obtained.includes(r.id) ? '✓ GET' : '未获得'}
                        </span>
                      </button>
                      <div className="trophy-plaque">
                        <b>{r.name}</b>
                        <small>
                          {r.surface} {r.distance}m
                        </small>
                      </div>
                      <div className="shelf-tools">
                        <button
                          className={draft.targetIds.includes(r.id) ? 'chosen' : ''}
                          disabled={obtained.includes(r.id)}
                          onClick={() => target(r.id)}
                          title="选为补杯目标"
                        >
                          {draft.targetIds.includes(r.id) ? '✓ 已选' : '＋ 目标'}
                        </button>
                        <button onClick={() => setModal({ type: 'race', id: r.id })}>
                          详情 / 预约 ›
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {!shown.length && (
                  <div className="shelf-empty">
                    没有符合条件的奖杯
                    <br />
                    <small>试试切换等级或筛选条件</small>
                  </div>
                )}
              </div>
              <div className="panel-footer">
                <span>
                  显示 {shown.length} 座 · 已选{' '}
                  {draft.targetIds.filter((id) => !obtained.includes(id)).length} 座
                  {draft.targetIds.length > 0 && (
                    <button
                      className="clear-targets"
                      onClick={() => updateDraft({ ...draft, targetIds: [] })}
                    >
                      清空目标
                    </button>
                  )}
                </span>
                <button className="primary" onClick={generate}>
                  生成补杯建议 ›
                </button>
              </div>
            </section>
          ) : (
            <section className="game-panel schedule-panel">
              <div className="game-title">
                <span>赛事预约</span>
                <small>
                  {scenarios.find((s) => s.id === scenario)?.name} · {manualCount} 场预约
                </small>
              </div>
              <div className="year-tabs">
                {years.map((name, i) => (
                  <button
                    key={name}
                    className={year === i ? 'active' : ''}
                    onClick={() => setYear(i)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="calendar-container" ref={scheduleRef}>
                {renderCalendar(year)}
              </div>
              <div className="calendar-legend">
                <span>
                  <i className="pink-dot" />
                  预约中
                </span>
                <span>
                  <i className="orange-dot" />
                  固定目标
                </span>
                <span>
                  <i className="green-dot" />
                  期限 / 回合后事件
                </span>
                <span>＋ 选择赛事</span>
              </div>
              <div className="panel-footer">
                <button onClick={() => setModal({ type: 'clear' })} disabled={!manualCount}>
                  清空本方案预约
                </button>
                <button className="primary" onClick={generate}>
                  生成补杯建议 ›
                </button>
              </div>
            </section>
          )}
          <p className="page-footnote">预约是育成计划；获得奖杯后，请在陈列室手动点亮。</p>
        </main>
        <aside className="assistant-column">
          <section className="panel planning-settings">
            <div className="section-label">
              <span>▤</span> 当前育成方案
            </div>
            <label className="field-label">
              育成剧本
              <select
                value={scenario}
                onChange={(e) => commit({ ...state, selectedScenario: e.target.value })}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              育成目标路线
              <select
                value={routeId}
                onChange={(e) =>
                  commit({
                    ...state,
                    routeSelections: { ...state.routeSelections, [c.id]: e.target.value },
                  })
                }
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">衣装只用于匹配育成目标，奖杯进度按马娘共享。</p>
            <div className="branch-settings">
              {ctx.branches.map((b) => (
                <label className="field-label" key={b.key}>
                  {b.label}
                  <select
                    value={draft.branchChoices[b.key] || b.defaultChoice}
                    onChange={(e) => changeBranch(b.key, e.target.value)}
                  >
                    {b.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <small>{b.note}</small>
                </label>
              ))}
            </div>
            <div className="subheading">
              本次育成适性 <span>可按继承结果修改</span>
            </div>
            <div className="aptitudes">
              {[
                ['turf', '草地'],
                ['dirt', '泥地'],
                ['short', '短距离'],
                ['mile', '英里'],
                ['medium', '中距离'],
                ['long', '长距离'],
              ].map(([k, n]) => (
                <label key={k}>
                  {n}
                  <select
                    aria-label={`${n}适性`}
                    value={draft.aptitudes[k]}
                    className={`apt apt-${draft.aptitudes[k]}`}
                    onChange={(e) =>
                      updateDraft({
                        ...draft,
                        aptitudes: { ...draft.aptitudes, [k]: e.target.value },
                      })
                    }
                  >
                    {'SABCDEFG'.split('').map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="planning-options">
              <label>
                <input
                  type="checkbox"
                  checked={draft.options.avoidCamp}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      options: { ...draft.options, avoidCamp: e.target.checked },
                    })
                  }
                />
                建议避开暑期集训
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.options.avoidStreak}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      options: { ...draft.options, avoidStreak: e.target.checked },
                    })
                  }
                />
                建议避免连续 3 回合参赛
              </label>
            </div>
            <button className="primary full" onClick={generate}>
              ✦ 预览补杯建议
            </button>
            <p className="muted">
              优先安排所选未获得奖杯；未选目标时，尝试全部适性 B 以上的未获得奖杯。
            </p>
          </section>
          <section className="panel goal-panel">
            <div className="section-label">◷ 育成备忘</div>
            <div className="goal-list">
              {ctx.deadlines.map((g, i) => (
                <div className="memo" key={`d${i}`}>
                  <small>{dateLabel(g.slot)} · 达成期限</small>
                  <b>{g.title}</b>
                </div>
              ))}
              {Object.entries(ctx.events)
                .filter(([s]) => Math.floor(+s / 24) === year)
                .map(([s, ev]) => (
                  <div className="memo" key={s}>
                    <small>{dateLabel(+s)}</small>
                    <span>{ev.join(' / ')}</span>
                  </div>
                ))}
              {Object.values(ctx.fixed)
                .filter((g) => g.raceIds.length > 1)
                .map((g) => (
                  <label className="field-label" key={g.slot}>
                    {dateLabel(g.slot)} · 目标分支
                    <select
                      value={g.raceId}
                      onChange={(e) => changeBranch(String(g.slot), e.target.value)}
                    >
                      {g.raceIds.map((id) => (
                        <option key={id} value={id}>
                          {race(id)?.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {!!warn.length && (
                <div className="warning-box">
                  {warn.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
                </div>
              )}
              {!ctx.deadlines.length && !Object.keys(ctx.events).length && (
                <p className="muted">
                  固定育成目标以橙色标记，普通预约不能覆盖。目标前的粉丝数请自行核对。
                </p>
              )}
            </div>
          </section>
          <section className="panel export-panel">
            <div className="section-label">↗ 带上你的赛程</div>
            <div className="export-buttons">
              <button
                onClick={() =>
                  act(async () => {
                    if (
                      await window.desktop.exportFile({
                        type: 'txt',
                        data: exportText(catalog, c, ctx, draft),
                      })
                    )
                      setNotice('文字赛程已导出');
                  })
                }
              >
                导出文字
              </button>
              <button onClick={() => act(exportPng)}>导出图片</button>
            </div>
            <p className="muted">导出完整三年赛程，在游戏的赛事预约中照表设置。</p>
          </section>
        </aside>
      </div>
      <div className="export-offscreen" aria-hidden="true">
        <div className="export-sheet">
          <h1>{c.name} · 赛事预约</h1>
          <p>
            {scenarios.find((s) => s.id === scenario)?.name} / {ctx.route?.name} · 数据{' '}
            {catalog.asOf}
          </p>
          {years.map((n, y) => (
            <section key={n}>
              <h2>{n}</h2>
              {renderCalendar(y, true)}
            </section>
          ))}
          <div className="export-notes">
            <h3>达成期限与回合后事件</h3>
            {ctx.deadlines.map((g, i) => (
              <p key={i}>
                {dateLabel(g.slot)}：{g.title}
              </p>
            ))}
            {Object.entries(ctx.events).map(([s, e]) => (
              <p key={s}>
                {dateLabel(+s)}：{e.join(' / ')}
              </p>
            ))}
            <p>
              固定目标以橙色标记，预约以粉色标记。预约不会点亮奖杯。参赛粉丝数与目标完成条件请在游戏内核对。
            </p>
            {warn.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </div>
      </div>
      {notice && (
        <div role="status" className="toast">
          <span>{notice}</span>
          {undo && (
            <button
              onClick={() => {
                commit({ ...state, progress: { ...state.progress, [undo.character]: undo.ids } });
                setUndo(null);
                setNotice('已撤销奖杯标记');
              }}
            >
              撤销
            </button>
          )}
          <button
            aria-label="关闭提示"
            onClick={() => {
              setNotice('');
              setUndo(null);
            }}
          >
            ×
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="操作详情"
            className={`modal modal-${modal.type}`}
          >
            <div className="modal-title">
              {
                (
                  {
                    race: '赛事详情',
                    slot: '选择预约赛事',
                    goal: '育成目标',
                    preview: '补杯建议预览',
                    settings: '数据与备份',
                    sources: '资料与使用说明',
                    import: '恢复备份',
                    clear: '清空当前方案',
                  } as Record<string, string>
                )[modal.type]
              }
              <button aria-label="关闭对话框" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {modal.type === 'race' &&
                (() => {
                  const r = race(modal.id)!;
                  return (
                    <>
                      <div className="race-detail-hero">
                        <img src={r.trophy} alt="" />
                        <div>
                          <Grade value={r.grade} />
                          <h2>{r.name}</h2>
                          <p>{metadata(r)}</p>
                          <small>{r.jp}</small>
                        </div>
                      </div>
                      <div className="detail-metrics">
                        <span>
                          参赛粉丝数<b>{r.fans.toLocaleString()} 人</b>
                        </span>
                        <span>
                          冠军粉丝数<b>+{r.winner_fans.toLocaleString()} 人</b>
                        </span>
                        <span>
                          本次适性<b>{aptitude(r, draft).join(' / ')}</b>
                        </span>
                      </div>
                      <div className="detail-actions">
                        <button onClick={() => toggle(r.id)}>
                          {obtained.includes(r.id) ? '✓ 已获得 · 取消点亮' : '点亮这座奖杯'}
                        </button>
                        <button
                          className="primary"
                          disabled={obtained.includes(r.id)}
                          onClick={() => target(r.id)}
                        >
                          {draft.targetIds.includes(r.id) ? '✓ 已选为目标' : '加入补杯目标'}
                        </button>
                      </div>
                      <h3>可预约日期</h3>
                      <div className="occurrences">
                        {r.periods.map((p) => {
                          const s = slotOf(p),
                            reason = blockReason(s, r, ctx);
                          return (
                            <div key={s}>
                              <div>
                                <b>{dateLabel(s)}</b>
                                <small>
                                  {reason ||
                                    (draft.entries[s] ? '当前回合已有预约，将替换' : '可以预约')}
                                </small>
                              </div>
                              <button
                                className="primary"
                                disabled={!!reason}
                                onClick={() => reserve(s, r.id)}
                              >
                                {reason ? '不可预约' : draft.entries[s] ? '替换预约' : '预约'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <p className="muted">
                        粉丝数仅供对照。预约后仍需在游戏中满足参赛条件并赢得比赛。
                      </p>
                      {sourceLink('查看赛事资料', r.source)}
                      {!!catalog.variants.filter((v) => v.name === r.name).length && (
                        <details>
                          <summary>改场资料（奖杯合并统计）</summary>
                          {catalog.variants
                            .filter((v) => v.name === r.name)
                            .map((v) => (
                              <p key={v.id} className="muted">
                                {v.venue} · {v.surface} {v.distance}m · {v.direction}回转
                              </p>
                            ))}
                          <p className="muted">
                            特定育成目标或历史举办地可能改变赛道，实际场地以游戏内为准。
                          </p>
                        </details>
                      )}
                    </>
                  );
                })()}
              {modal.type === 'slot' && (
                <>
                  <div className="slot-heading">
                    <b>{dateLabel(modal.slot)}</b>
                    <span>{isCamp(modal.slot) ? '暑期集训期间' : ''}</span>
                  </div>
                  {draft.entries[modal.slot] && (
                    <div className="current-reservation">
                      当前预约：{race(draft.entries[modal.slot].raceId)?.name}
                      <button onClick={() => cancel(modal.slot)}>取消预约</button>
                    </div>
                  )}
                  <div className="race-options">
                    {available(catalog, modal.slot, ctx).map((r) => (
                      <button
                        className="race-option"
                        key={r.id}
                        onClick={() => reserve(modal.slot, r.id)}
                      >
                        <Grade value={r.grade} />
                        <img src={r.trophy} alt="" />
                        <span>
                          <b>{r.name}</b>
                          <small>
                            {metadata(r)} · 门槛 {r.fans.toLocaleString()} 粉丝
                          </small>
                        </span>
                        <em className={suited(r, draft) ? 'suitable' : 'poor'}>
                          {aptitude(r, draft).join('/')}
                        </em>
                        <i>{draft.entries[modal.slot] ? '替换' : '预约'} ›</i>
                      </button>
                    ))}
                    {!available(catalog, modal.slot, ctx).length && (
                      <p className="empty">本回合没有可预约的 G1～G3 赛事。</p>
                    )}
                  </div>
                </>
              )}
              {modal.type === 'goal' &&
                (() => {
                  const g = ctx.fixed[modal.slot],
                    r = race(g.raceId);
                  return (
                    <>
                      <div className="slot-heading">
                        <b>{dateLabel(modal.slot)}</b>
                        <span>{g.kind === 'rest' ? '剧情固定回合' : '固定育成目标'}</span>
                      </div>
                      <h2 style={{ marginTop: 20 }}>{g.title}</h2>
                      {r && (
                        <div className="race-detail-hero">
                          <img src={r.trophy} alt="" />
                          <div>
                            <Grade value={r.grade} />
                            <h3>{r.name}</h3>
                            <p>{metadata(r)}</p>
                          </div>
                        </div>
                      )}
                      <p style={{ marginTop: 16 }}>
                        {g.condition || '请按游戏中的目标条件完成本回合。'}
                      </p>
                      <p className="muted">
                        固定目标不能取消或用普通预约替换。若有分支，可在右侧当前育成方案中选择。比赛获胜后仍需手动点亮奖杯。
                      </p>
                      {r && (
                        <button
                          className="primary full"
                          style={{ marginTop: 16 }}
                          onClick={() => toggle(r.id)}
                        >
                          {obtained.includes(r.id)
                            ? '✓ 已获得 · 取消点亮'
                            : '我已赢得比赛 · 点亮奖杯'}
                        </button>
                      )}
                    </>
                  );
                })()}
              {modal.type === 'preview' && (
                <>
                  <div className="preview-summary">
                    <b>{modal.preview.additions.length}</b>
                    <span>场新增预约</span>
                    <small>
                      {modal.preview.covered.length} 座目标已在赛程中 ·{' '}
                      {modal.preview.skipped.length} 座暂未安排
                    </small>
                  </div>
                  <p className="muted">
                    保留已有预约和固定目标。确认后只添加下列赛事，奖杯获取状态不会改变。
                  </p>
                  <div className="preview-list">
                    {modal.preview.additions.map((a) => (
                      <div key={a.slot}>
                        <small>{dateLabel(a.slot)}</small>
                        <Grade value={race(a.raceId)!.grade} />
                        <b>{race(a.raceId)?.name}</b>
                      </div>
                    ))}
                    {!modal.preview.additions.length && (
                      <p className="empty">没有可新增的赛事，请查看下面的原因或调整规划选项。</p>
                    )}
                  </div>
                  {!!modal.preview.covered.length && (
                    <details>
                      <summary>已在赛程中的目标（{modal.preview.covered.length}）</summary>
                      <p>{modal.preview.covered.map((id) => race(id)?.name).join('、')}</p>
                    </details>
                  )}
                  {!!modal.preview.skipped.length && (
                    <details open>
                      <summary>未安排原因（{modal.preview.skipped.length}）</summary>
                      <div className="skipped-list">
                        {modal.preview.skipped.map((s) => (
                          <div key={s.raceId}>
                            <b>{race(s.raceId)?.name}</b>
                            <small>{s.reason}</small>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="dialog-actions">
                    <button onClick={() => setModal(null)}>返回调整</button>
                    <button
                      className="primary"
                      disabled={!modal.preview.additions.length}
                      onClick={() => {
                        const next = { ...draft.entries };
                        modal.preview.additions.forEach((a) => {
                          next[a.slot] = { raceId: a.raceId, origin: 'suggested' };
                        });
                        updateDraft({ ...draft, entries: next });
                        setModal(null);
                        setView('schedule');
                        if (modal.preview.additions[0])
                          setYear(Math.floor(modal.preview.additions[0].slot / 24));
                        setNotice('补杯建议已加入当前预约方案');
                      }}
                    >
                      确认添加 {modal.preview.additions.length} 场
                    </button>
                  </div>
                </>
              )}
              {modal.type === 'settings' && (
                <>
                  <div className="settings-info">
                    <b>本地保存，离线可用</b>
                    <p>
                      每位马娘的奖杯进度独立保存；不同剧本与目标路线的赛程分别保存。数据写入时自动保留上一份备份。
                    </p>
                    <small className="data-path">{dataPath}</small>
                  </div>
                  <div className="backup-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        act(async () => {
                          if (await window.desktop.exportBackup(state))
                            setNotice('JSON 备份已导出');
                        })
                      }
                    >
                      导出全部数据备份
                    </button>
                    <button
                      onClick={() =>
                        act(async () => {
                          const next = await window.desktop.importBackup();
                          if (next) setModal({ type: 'import', state: next });
                        })
                      }
                    >
                      从 JSON 恢复
                    </button>
                  </div>
                  <p className="muted">恢复前会显示备份概况，确认后替换本地收藏和预约数据。</p>
                </>
              )}
              {modal.type === 'import' && (
                <>
                  <h2>确认恢复这份备份？</h2>
                  <p>
                    包含 {Object.keys(modal.state.progress).length} 位马娘的奖杯进度、
                    {Object.keys(modal.state.drafts).length} 份预约方案。
                  </p>
                  <p>当前数据将被替换，上一份数据会保存在自动备份中。</p>
                  <div className="dialog-actions">
                    <button onClick={() => setModal(null)}>取消</button>
                    <button
                      className="primary"
                      onClick={() =>
                        act(async () => {
                          await window.desktop.restore(modal.state);
                          setState(modal.state);
                          setSaveStatus('已保存');
                          setModal(null);
                          setNotice('备份已恢复');
                        })
                      }
                    >
                      确认恢复
                    </button>
                  </div>
                </>
              )}
              {modal.type === 'clear' && (
                <>
                  <p>
                    清空「{c.name} / {scenarios.find((s) => s.id === scenario)?.name} /{' '}
                    {ctx.route?.name}」的 {manualCount} 场普通预约？
                  </p>
                  <p>固定育成目标与奖杯进度会保留。</p>
                  <div className="dialog-actions">
                    <button onClick={() => setModal(null)}>取消</button>
                    <button
                      className="danger"
                      onClick={() => {
                        updateDraft({ ...draft, entries: {} });
                        setModal(null);
                        setNotice('当前方案预约已清空');
                      }}
                    >
                      清空预约
                    </button>
                  </div>
                </>
              )}
              {modal.type === 'sources' && (
                <>
                  <h2>
                    SyhzUmamusumeTools <small>v1.0.1</small>
                  </h2>
                  <p>
                    国服资料快照：{catalog.asOf}。收录 {catalog.characters.length} 位可养成角色、
                    {catalog.races.length} 种 G1～G3 奖杯、
                    {catalog.races.reduce((n, r) => n + r.periods.length, 0)} 个赛事日期与{' '}
                    {catalog.routes.length} 条目标路线。
                  </p>
                  <ol>
                    <li>选择马娘，在陈列室手动点亮已获得奖杯。</li>
                    <li>选择剧本与育成目标路线，按继承结果修改本次适性。</li>
                    <li>选择缺失奖杯，预览建议，或直接点击日历回合手动预约。</li>
                    <li>导出赛程，在游戏内的赛事预约中手动设置。</li>
                  </ol>
                  <p>
                    粉丝数、累计胜绩是达成期限；团队赛、演出和年末特别赛以回合后事件显示。它们不会被当作普通回合的固定比赛。
                  </p>
                  <p>
                    应用不会读取游戏、操作游戏或自动判断比赛胜负。资料与游戏出现差异时，以游戏内信息为准。
                  </p>
                  <h3>公开资料来源</h3>
                  <div className="sources">
                    {catalog.sources.map((s, i) => (
                      <React.Fragment key={i}>{sourceLink(s.title, s.url)}</React.Fragment>
                    ))}
                    {sourceLink(
                      '凯旋门剧本官方说明',
                      'https://umamusume.jp/contents/game/scenario/projectlarc/',
                    )}
                  </div>
                  <p className="muted">
                    角色、奖杯及赛事图像归各权利方所有，本工具为非官方本地辅助工具。资源链接与整理脚本随源码提供。
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
