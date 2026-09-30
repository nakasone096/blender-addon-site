'use strict';

const APP_VERSION = '1.0.0';
const SET_COUNT = 4;
const TARGET_REPS = 10;
const INCREMENT_KG = 2.5;
const DRAFT_KEY = 'workout-draft-v1';

const MENU = {
  A: ['スクワット', 'ベンチプレス', 'ラットプルダウン/懸垂', 'カール'],
  B: ['レッグプレス', 'ショルダープレス', 'シーテッドロウ', 'プッシュダウン'],
};
const ALL_EXERCISES = [...MENU.A, ...MENU.B];

const state = {
  sessions: [],       // 全記録（日付の古い順）
  day: 'A',
  dayOverridden: false,
  date: todayStr(),
  editingId: null,
  inputs: {},         // { 種目名: [{weight:'', reps:''} x4] }
  chartExercise: MENU.A[0],
  chartMetric: 'top',
};

// ---------- ユーティリティ ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s, withYear = true) {
  const [y, m, d] = s.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return withYear ? `${y}/${m}/${d}（${w}）` : `${m}/${d}`;
}
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function sortSessions(list) {
  return list.sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : a.date < b.date ? -1 : 1));
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

// ---------- 記録ロジック ----------
function validSets(ex) {
  return (ex?.sets || []).filter((s) => s && s.reps != null && s.reps > 0);
}
// 4セットすべて10回以上か
function achievedTarget(sets) {
  if (!sets || sets.length < SET_COUNT) return false;
  return sets.slice(0, SET_COUNT).every((s) => s && s.reps != null && s.reps >= TARGET_REPS);
}
function topWeight(ex) {
  const w = validSets(ex).map((s) => s.weight).filter((x) => x != null);
  return w.length ? Math.max(...w) : null;
}
function volume(ex) {
  return validSets(ex).reduce((sum, s) => sum + (s.weight || 0) * s.reps, 0);
}
function setsText(ex) {
  const sets = validSets(ex);
  if (!sets.length) return '—';
  const ws = sets.map((s) => s.weight);
  if (ws.every((w) => w === ws[0])) {
    return `${ws[0] == null ? '自重' : fmtNum(ws[0]) + 'kg'} × ${sets.map((s) => s.reps).join(', ')}`;
  }
  return sets.map((s) => `${s.weight == null ? '自重' : fmtNum(s.weight)}×${s.reps}`).join(', ');
}

function nextDay() {
  const last = state.sessions[state.sessions.length - 1];
  if (!last) return 'A';
  return last.day === 'A' ? 'B' : 'A';
}

// 指定種目の「前回」の記録（編集中の記録は除外、選択日以前で最新）
function previousRecord(name) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.id === state.editingId) continue;
    if (s.date > state.date) continue;
    const ex = s.exercises.find((e) => e.name === name);
    if (ex && validSets(ex).length) return { session: s, ex };
  }
  return null;
}

function emptyInputs(day) {
  const o = {};
  for (const name of MENU[day]) o[name] = Array.from({ length: SET_COUNT }, () => ({ weight: '', reps: '' }));
  return o;
}

// ---------- 下書き（入力途中の保持） ----------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      day: state.day, dayOverridden: state.dayOverridden, date: state.date,
      editingId: state.editingId, inputs: state.inputs,
    }));
  } catch (_) { /* 保存できない環境では無視 */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* noop */ }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !MENU[d.day] || !d.inputs) return false;
    const hasInput = Object.values(d.inputs).some((sets) => sets.some((s) => s.weight !== '' || s.reps !== ''));
    if (!hasInput && !d.editingId) return false;
    Object.assign(state, {
      day: d.day, dayOverridden: !!d.dayOverridden, date: d.date || todayStr(),
      editingId: d.editingId || null, inputs: { ...emptyInputs(d.day), ...d.inputs },
    });
    return true;
  } catch (_) { return false; }
}

function resetRecordForm() {
  state.editingId = null;
  state.dayOverridden = false;
  state.day = nextDay();
  state.date = todayStr();
  state.inputs = emptyInputs(state.day);
  clearDraft();
}

// ---------- 記録画面 ----------
function renderRecord() {
  const auto = nextDay();
  document.querySelectorAll('.day-btn').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.day === state.day));
  });
  const label = document.getElementById('day-auto-label');
  if (state.editingId) label.textContent = 'メニュー';
  else label.textContent = state.day === auto ? "次のメニュー（自動）" : `自動判定は${auto}日（手動変更中）`;

  document.getElementById('session-date').value = state.date;
  document.getElementById('editing-note').hidden = !state.editingId;
  document.getElementById('save-btn').textContent = state.editingId ? '変更を保存' : `${state.day}日の記録を保存`;

  const list = document.getElementById('exercise-list');
  list.replaceChildren(...MENU[state.day].map(renderExerciseCard));
}

function renderExerciseCard(name) {
  const inputs = state.inputs[name];
  const prev = previousRecord(name);
  const prevSetsForHint = prev ? prev.ex.sets : null;
  const prevAchieved = achievedTarget(prevSetsForHint);
  const prevTop = prev ? topWeight(prev.ex) : null;
  const suggested = prevTop == null ? null : prevAchieved ? prevTop + INCREMENT_KG : prevTop;

  const badgeWrap = el('span', { class: 'badge-wrap' });
  const updateBadge = () => {
    const cur = inputs.map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }));
    badgeWrap.replaceChildren(achievedTarget(cur) ? el('span', { class: 'badge' }, `✓ 次回+${INCREMENT_KG}kg`) : '');
  };

  let prevBox;
  if (prev) {
    prevBox = el('div', { class: 'prev' },
      el('div', {}, '前回 ', el('span', {}, fmtDate(prev.session.date, false)), '： ', el('strong', {}, setsText(prev.ex))),
      prevAchieved ? el('div', { class: 'hint' }, `前回4セット×${TARGET_REPS}回達成 → 今回 +${INCREMENT_KG}kg（${fmtNum(suggested)}kg）`) : null,
    );
  } else {
    prevBox = el('div', { class: 'prev' }, '前回の記録なし');
  }

  const grid = el('div', { class: 'sets' },
    el('span', { class: 'col-h' }, ''), el('span', { class: 'col-h' }, '重量 (kg)'), el('span', { class: 'col-h' }, '回数'));
  const prevSets = prev ? prev.ex.sets : [];
  const weightInputs = [];
  inputs.forEach((set, i) => {
    const p = prevSets[i];
    const wIn = el('input', {
      class: 'num-in', type: 'text', inputmode: 'decimal', enterkeyhint: 'next', autocomplete: 'off',
      'aria-label': `${name} ${i + 1}セット目 重量`,
      placeholder: suggested != null ? fmtNum(suggested) : (p && p.weight != null ? fmtNum(p.weight) : 'kg'),
    });
    wIn.value = set.weight;
    const rIn = el('input', {
      class: 'num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'next', autocomplete: 'off',
      'aria-label': `${name} ${i + 1}セット目 回数`,
      placeholder: p && p.reps != null ? String(p.reps) : '回',
    });
    rIn.value = set.reps;
    const markDone = () => rIn.classList.toggle('done', (toNum(rIn.value) || 0) >= TARGET_REPS);
    markDone();

    wIn.addEventListener('input', () => { set.weight = wIn.value.trim(); updateBadge(); saveDraft(); });
    // 1セット目の重量を入れたら、空欄の残りセットにも同じ重量を入れる
    if (i === 0) {
      wIn.addEventListener('change', () => {
        if (toNum(wIn.value) == null) return;
        inputs.forEach((s, j) => {
          if (j > 0 && s.weight === '') { s.weight = wIn.value.trim(); weightInputs[j].value = s.weight; }
        });
        updateBadge(); saveDraft();
      });
    }
    rIn.addEventListener('input', () => { set.reps = rIn.value.trim(); markDone(); updateBadge(); saveDraft(); });
    weightInputs.push(wIn);
    grid.append(el('span', { class: 'set-no' }, `${i + 1}`), wIn, rIn);
  });

  const fillBtn = suggested != null ? el('button', {
    type: 'button', class: 'fill-btn',
    onclick: () => {
      inputs.forEach((s, j) => { s.weight = fmtNum(suggested); weightInputs[j].value = s.weight; });
      updateBadge(); saveDraft();
    },
  }, `全セットの重量を ${fmtNum(suggested)}kg にする`) : null;

  updateBadge();
  return el('div', { class: 'card ex-card' },
    el('div', { class: 'ex-head' }, el('h3', {}, name), badgeWrap),
    prevBox, grid, fillBtn);
}

async function saveSession() {
  const exercises = [];
  for (const name of MENU[state.day]) {
    const sets = state.inputs[name].map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }));
    const invalid = state.inputs[name].some((s, i) =>
      (s.weight !== '' && sets[i].weight == null) || (s.reps !== '' && sets[i].reps == null));
    if (invalid) { toast(`${name}：数値を正しく入力してください`); return; }
    if (sets.some((s) => s.reps != null && s.reps > 0)) {
      exercises.push({ name, sets: sets.map((s) => (s.reps ? s : { weight: s.weight, reps: null })) });
    }
  }
  if (!exercises.length) { toast('回数が入力されていません'); return; }
  if (!state.date) { toast('日付を入力してください'); return; }

  const now = Date.now();
  const existing = state.editingId && state.sessions.find((s) => s.id === state.editingId);
  const session = {
    id: existing ? existing.id : genId(),
    date: state.date,
    day: state.day,
    exercises,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  try {
    await DB.put(session);
  } catch (e) {
    console.error(e);
    toast('保存に失敗しました');
    return;
  }
  await reloadSessions();
  const achieved = exercises.filter((e) => achievedTarget(e.sets)).map((e) => e.name);
  resetRecordForm();
  renderAll();
  window.scrollTo({ top: 0 });
  toast(achieved.length ? `保存しました。${achieved.join('・')} は次回+${INCREMENT_KG}kg！` : '保存しました');
}

function startEdit(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  state.editingId = id;
  state.day = s.day;
  state.dayOverridden = true;
  state.date = s.date;
  state.inputs = emptyInputs(s.day);
  for (const ex of s.exercises) {
    if (!state.inputs[ex.name]) continue;
    state.inputs[ex.name] = Array.from({ length: SET_COUNT }, (_, i) => {
      const set = ex.sets[i] || {};
      return { weight: set.weight == null ? '' : fmtNum(set.weight), reps: set.reps == null ? '' : String(set.reps) };
    });
  }
  saveDraft();
  renderRecord();
  showView('record');
}

// ---------- 履歴 ----------
function renderHistory() {
  const list = document.getElementById('history-list');
  const items = [...state.sessions].reverse();
  document.getElementById('history-empty').hidden = items.length > 0;
  list.replaceChildren(...items.map((s) => el('div', { class: 'card' },
    el('div', { class: 'hist-head' },
      el('div', {}, el('span', { class: 'hist-date' }, fmtDate(s.date)), el('span', { class: 'day-tag' }, `${s.day}日`)),
      el('div', { class: 'hist-actions' },
        el('button', { type: 'button', class: 'small-btn', onclick: () => startEdit(s.id) }, '編集'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteSession(s) }, '削除'))),
    s.exercises.map((ex) => el('div', { class: 'hist-ex' },
      el('span', { class: 'name' }, ex.name),
      el('span', { class: 'sets-txt' }, setsText(ex), achievedTarget(ex.sets) ? ' ✓' : ''))),
  )));
}

async function deleteSession(s) {
  if (!confirm(`${fmtDate(s.date)} の${s.day}日の記録を削除しますか？`)) return;
  await DB.remove(s.id);
  await reloadSessions();
  if (state.editingId === s.id) resetRecordForm();
  else if (!state.dayOverridden && !state.editingId) state.day = nextDay();
  if (!state.inputs[MENU[state.day][0]]) state.inputs = emptyInputs(state.day);
  renderAll();
  toast('削除しました');
}

// ---------- グラフ ----------
function chartPoints() {
  const name = state.chartExercise;
  const pts = [];
  for (const s of state.sessions) {
    const ex = s.exercises.find((e) => e.name === name);
    if (!ex || !validSets(ex).length) continue;
    const v = state.chartMetric === 'top' ? topWeight(ex) : volume(ex);
    if (v == null) continue;
    pts.push({ date: s.date, value: v, ex });
  }
  return pts;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceScale(min, max, ticks = 5) {
  if (min === max) { min -= min === 0 ? 0 : Math.max(2.5, Math.abs(min) * 0.1); max += Math.max(2.5, Math.abs(max) * 0.1); }
  const range = max - min;
  const rough = range / (ticks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}

let chartGeom = null;
function renderChart() {
  const pts = chartPoints();
  const unit = 'kg';
  const metricLabel = state.chartMetric === 'top' ? '最大重量' : '総挙上量';
  document.getElementById('chart-title').textContent = `${state.chartExercise}：${metricLabel}（${unit}）`;
  document.getElementById('chart-table-metric').textContent = state.chartMetric === 'top' ? '最大' : '総量';
  const summary = document.getElementById('chart-summary');
  if (pts.length) {
    const first = pts[0].value, last = pts[pts.length - 1].value;
    const diff = last - first;
    summary.textContent = `最新 ${fmtNum(last)}${unit}（初回比 ${diff >= 0 ? '+' : ''}${fmtNum(diff)}${unit}）・${pts.length}回`;
  } else summary.textContent = '';

  const canvas = document.getElementById('chart');
  const empty = document.getElementById('chart-empty');
  canvas.parentElement.hidden = !pts.length;
  empty.hidden = !!pts.length;
  document.getElementById('chart-tip').hidden = true;

  // テーブル（新しい順）
  const tbody = document.querySelector('#chart-table tbody');
  tbody.replaceChildren(...[...pts].reverse().map((p) => el('tr', {},
    el('td', {}, fmtDate(p.date, false)),
    el('td', {}, setsText(p.ex), achievedTarget(p.ex.sets) ? ' ✓' : ''),
    el('td', { class: 'num' }, fmtNum(p.value)))));
  if (!pts.length) { chartGeom = null; return; }

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const values = pts.map((p) => p.value);
  const { lo, hi, step } = niceScale(Math.min(...values), Math.max(...values));
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  let labelW = 0;
  for (let v = lo; v <= hi + 1e-9; v += step) labelW = Math.max(labelW, ctx.measureText(fmtNum(v)).width);
  const pad = { l: labelW + 10, r: 12, t: 10, b: 24 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  // 横軸は日付（実時間）
  const t = pts.map((p) => new Date(p.date + 'T00:00:00').getTime());
  const t0 = t[0], t1 = t[t.length - 1];
  const x = (i) => (t1 === t0 ? pad.l + pw / 2 : pad.l + ((t[i] - t0) / (t1 - t0)) * pw);
  const y = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;

  // グリッドと目盛り
  ctx.strokeStyle = cssVar('--grid');
  ctx.fillStyle = cssVar('--text-3');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.fillText(fmtNum(v), pad.l - 6, yy);
  }
  // 日付ラベル（重ならない程度に間引き）
  ctx.textBaseline = 'top';
  const maxLabels = Math.max(2, Math.floor(pw / 48));
  const every = Math.ceil(pts.length / maxLabels);
  let lastRight = -Infinity;
  pts.forEach((p, i) => {
    if (i % every !== 0 && i !== pts.length - 1) return;
    const label = fmtDate(p.date, false);
    const w = ctx.measureText(label).width;
    let cx = Math.min(Math.max(x(i), pad.l + w / 2), W - pad.r - w / 2);
    if (cx - w / 2 < lastRight + 6) return;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, H - pad.b + 7);
    lastRight = cx + w / 2;
  });

  // 線
  const accent = cssVar('--accent');
  const surface = cssVar('--surface');
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
  ctx.stroke();
  // 点（表面色のリングで線と分離）
  const r = pts.length > 40 ? 2.5 : 4;
  pts.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(x(i), y(p.value), r + 2, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
    ctx.beginPath(); ctx.arc(x(i), y(p.value), r, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
  });

  chartGeom = { pts, x, y, pad, W, H, r };
}

function chartHover(clientX) {
  if (!chartGeom) return;
  const canvas = document.getElementById('chart');
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left;
  const { pts, x, y, r } = chartGeom;
  let best = 0;
  pts.forEach((_, i) => { if (Math.abs(x(i) - mx) < Math.abs(x(best) - mx)) best = i; });
  renderChart();
  const ctx = canvas.getContext('2d');
  const px = x(best), py = y(pts[best].value);
  ctx.strokeStyle = cssVar('--text-3');
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(px, chartGeom.pad.t); ctx.lineTo(px, chartGeom.H - chartGeom.pad.b); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(px, py, r + 3, 0, Math.PI * 2); ctx.fillStyle = cssVar('--surface'); ctx.fill();
  ctx.beginPath(); ctx.arc(px, py, r + 1.5, 0, Math.PI * 2); ctx.fillStyle = cssVar('--accent'); ctx.fill();

  const tip = document.getElementById('chart-tip');
  const p = pts[best];
  tip.replaceChildren(
    el('div', { class: 'muted' }, fmtDate(p.date)),
    el('b', {}, `${fmtNum(p.value)}kg`),
    el('div', {}, setsText(p.ex)));
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(px - tw / 2, 0), rect.width - tw)}px`;
  tip.style.top = `${Math.max(py - tip.offsetHeight - 12, 0)}px`;
}

function setupChart() {
  const sel = document.getElementById('chart-exercise');
  for (const day of ['A', 'B']) {
    const g = el('optgroup', { label: `${day}日` });
    MENU[day].forEach((n) => g.append(el('option', { value: n }, n)));
    sel.append(g);
  }
  sel.value = state.chartExercise;
  sel.addEventListener('change', () => { state.chartExercise = sel.value; renderChart(); });
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.chartMetric = b.dataset.metric;
    document.querySelectorAll('.seg-btn').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
    renderChart();
  }));
  const canvas = document.getElementById('chart');
  canvas.addEventListener('pointerdown', (e) => chartHover(e.clientX));
  canvas.addEventListener('pointermove', (e) => chartHover(e.clientX));
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') renderChart(); });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (isActive('chart')) renderChart(); }, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (isActive('chart')) renderChart(); });
}

// ---------- エクスポート / インポート ----------
function exportPayload() {
  return {
    app: 'workout-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: state.sessions,
  };
}
function exportFile() {
  const json = JSON.stringify(exportPayload(), null, 2);
  const name = `workout-log-${todayStr().replace(/-/g, '')}.json`;
  return new File([json], name, { type: 'application/json' });
}
function downloadExport() {
  const file = exportFile();
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${state.sessions.length}件をエクスポートしました`);
}
async function shareExport() {
  const file = exportFile();
  try {
    await navigator.share({ files: [file], title: '筋トレ記録バックアップ' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('共有できませんでした');
  }
}

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
  if (raw.day !== 'A' && raw.day !== 'B') return null;
  if (!Array.isArray(raw.exercises)) return null;
  const exercises = raw.exercises
    .filter((e) => e && typeof e.name === 'string' && Array.isArray(e.sets))
    .map((e) => ({
      name: e.name,
      sets: e.sets.slice(0, SET_COUNT).map((s) => ({
        weight: s && s.weight != null && Number.isFinite(Number(s.weight)) ? Number(s.weight) : null,
        reps: s && s.reps != null && Number.isFinite(Number(s.reps)) ? Number(s.reps) : null,
      })),
    }));
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
    date: raw.date,
    day: raw.day,
    exercises,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function importFromFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    toast('JSONを読み込めませんでした');
    return;
  }
  const rawList = Array.isArray(data) ? data : data && data.sessions;
  if (!Array.isArray(rawList)) { toast('このアプリのバックアップ形式ではありません'); return; }
  const sessions = rawList.map(normalizeSession).filter(Boolean);
  if (!sessions.length) { toast('取り込める記録がありませんでした'); return; }
  const existingIds = new Set(state.sessions.map((s) => s.id));
  const overwrite = sessions.filter((s) => existingIds.has(s.id)).length;
  const msg = `${sessions.length}件の記録をインポートします。` +
    (overwrite ? `\n（うち${overwrite}件は既存の記録を上書き）` : '') + '\nよろしいですか？';
  if (!confirm(msg)) return;
  await DB.putMany(sessions);
  await reloadSessions();
  if (!state.editingId && !state.dayOverridden) {
    state.day = nextDay();
    if (!state.inputs[MENU[state.day][0]]) state.inputs = emptyInputs(state.day);
  }
  renderAll();
  toast(`${sessions.length}件をインポートしました`);
}

function renderSettings() {
  const n = state.sessions.length;
  document.getElementById('data-count').textContent = n
    ? `保存済み：${n}件（${fmtDate(state.sessions[0].date)} 〜 ${fmtDate(state.sessions[n - 1].date)}）`
    : '保存済み：0件';
  document.getElementById('menu-info').replaceChildren(...['A', 'B'].map((d) =>
    el('p', {}, el('strong', {}, `${d}日：`), MENU[d].join('、'))),
  el('p', { class: 'muted' }, `各種目${SET_COUNT}セット。全セット${TARGET_REPS}回達成で次回+${INCREMENT_KG}kg。`));
  document.getElementById('app-version').textContent = `筋トレ記録 v${APP_VERSION}`;
}

// ---------- 画面切り替え ----------
const TITLES = { record: '記録', chart: 'グラフ', history: '履歴', settings: 'データ' };
function isActive(view) {
  return document.getElementById(`view-${view}`).classList.contains('active');
}
function showView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.getElementById('header-title').textContent = TITLES[view];
  if (view === 'chart') renderChart();
  window.scrollTo({ top: 0 });
}

function renderAll() {
  renderRecord();
  renderHistory();
  renderSettings();
  if (isActive('chart')) renderChart();
}

async function reloadSessions() {
  state.sessions = sortSessions(await DB.getAll());
}

function setupRecordControls() {
  document.querySelectorAll('.day-btn').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.day === state.day) return;
    const hasInput = Object.values(state.inputs).some((sets) => sets.some((s) => s.weight !== '' || s.reps !== ''));
    if (hasInput && !confirm('入力中の内容は破棄されます。切り替えますか？')) return;
    state.day = b.dataset.day;
    state.dayOverridden = state.day !== nextDay();
    state.inputs = emptyInputs(state.day);
    saveDraft();
    renderRecord();
  }));
  document.getElementById('session-date').addEventListener('change', (e) => {
    state.date = e.target.value || todayStr();
    saveDraft();
    renderRecord();
  });
  document.getElementById('cancel-edit').addEventListener('click', () => {
    resetRecordForm();
    renderRecord();
  });
  document.getElementById('save-btn').addEventListener('click', saveSession);
}

function setupSettings() {
  document.getElementById('export-btn').addEventListener('click', downloadExport);
  const shareBtn = document.getElementById('share-btn');
  try {
    const probe = new File(['{}'], 'x.json', { type: 'application/json' });
    shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch (_) { shareBtn.hidden = true; }
  shareBtn.addEventListener('click', shareExport);
  const fileIn = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (f) await importFromFile(f);
  });
}

async function init() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  setupRecordControls();
  setupChart();
  setupSettings();

  try {
    await reloadSessions();
  } catch (e) {
    console.error(e);
    toast('データベースを開けませんでした');
  }
  if (!loadDraft()) resetRecordForm();
  // 下書きの編集対象が消えていたら新規扱いに戻す
  if (state.editingId && !state.sessions.some((s) => s.id === state.editingId)) resetRecordForm();
  // 手動変更していない下書きは自動判定に追従
  if (!state.dayOverridden && !state.editingId && state.day !== nextDay()) {
    state.day = nextDay();
    state.inputs = emptyInputs(state.day);
  }
  renderAll();

  // ブラウザによるデータ自動削除を避ける
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW登録失敗', e));
  }
}

init();
