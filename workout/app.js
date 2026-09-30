'use strict';

const APP_VERSION = '2.1.0';
const SET_COUNT = 4;
const TARGET_REPS = 10;
const INCREMENT_KG = 2.5;
const DRAFT_KEY = 'workout-draft-v2';

// 部位（'other' は該当種目があるときだけ表示）
const PARTS = [
  { id: 'chest', name: '胸' },
  { id: 'shoulder', name: '肩' },
  { id: 'arm', name: '腕' },
  { id: 'back', name: '背中' },
  { id: 'leg', name: '足' },
  { id: 'other', name: 'その他' },
];
const PART_NAME = Object.fromEntries(PARTS.map((p) => [p.id, p.name]));

// 初期の種目。id は固定（旧バージョンの記録を名前で引き継ぐため）
const DEFAULT_EXERCISES = [
  ['ex-bench', 'ベンチプレス', 'chest'],
  ['ex-db-bench', 'ダンベルベンチプレス', 'chest'],
  ['ex-incline-bench', 'インクラインベンチプレス', 'chest'],
  ['ex-pec-fly', 'ペックフライ', 'chest'],
  ['ex-dips', 'ディップス', 'chest'],
  ['ex-shoulder-press', 'ショルダープレス', 'shoulder'],
  ['ex-side-raise', 'サイドレイズ', 'shoulder'],
  ['ex-rear-raise', 'リアレイズ', 'shoulder'],
  ['ex-front-raise', 'フロントレイズ', 'shoulder'],
  ['ex-curl', 'カール', 'arm'],
  ['ex-hammer-curl', 'ハンマーカール', 'arm'],
  ['ex-pushdown', 'プッシュダウン', 'arm'],
  ['ex-french-press', 'フレンチプレス', 'arm'],
  ['ex-lat-pulldown', 'ラットプルダウン/懸垂', 'back'],
  ['ex-seated-row', 'シーテッドロウ', 'back'],
  ['ex-bent-row', 'ベントオーバーロウ', 'back'],
  ['ex-deadlift', 'デッドリフト', 'back'],
  ['ex-squat', 'スクワット', 'leg'],
  ['ex-leg-press', 'レッグプレス', 'leg'],
  ['ex-leg-extension', 'レッグエクステンション', 'leg'],
  ['ex-leg-curl', 'レッグカール', 'leg'],
  ['ex-calf-raise', 'カーフレイズ', 'leg'],
];
const DEFAULT_TEMPLATES = {
  A: ['ex-squat', 'ex-bench', 'ex-lat-pulldown', 'ex-curl'],
  B: ['ex-leg-press', 'ex-shoulder-press', 'ex-seated-row', 'ex-pushdown'],
};
const DAY_LABEL = { A: 'A日', B: 'B日', F: 'フリー' };

const state = {
  sessions: [],       // 全記録（日付の古い順）
  exercises: [],      // 種目マスタ
  templates: { A: [], B: [] },
  day: 'A',
  dayOverridden: false,
  date: todayStr(),
  editingId: null,
  order: [],          // 記録画面に並べる種目 id
  inputs: {},         // { 種目id: [{weight:'', reps:''} x4] }
  chartExercise: null,
  chartMetric: 'top',
  pickerPart: 'chest',
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
function genId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

// ---------- 種目マスタ ----------
function exById(id) {
  return state.exercises.find((e) => e.id === id) || null;
}
function exName(id, fallback) {
  return exById(id)?.name || fallback || '（不明な種目）';
}
function activeExercises(part) {
  return state.exercises
    .filter((e) => !e.archived && (!part || e.part === part))
    .sort((a, b) => a.order - b.order);
}
function visibleParts() {
  return PARTS.filter((p) => p.id !== 'other' || activeExercises('other').length);
}
function hasHistory(id) {
  return state.sessions.some((s) => s.exercises.some((e) => e.exerciseId === id && validSets(e).length));
}
function templateIds(day) {
  return (state.templates[day] || []).filter((id) => exById(id) && !exById(id).archived);
}

// 種目 id を持たない記録（旧形式など）に、名前で種目を割り当てる。
// 見つからない名前は「その他」の種目として新しく作り、作った種目を返す。
function resolveSessionExercises(sessions, exercises) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const byName = new Map(exercises.map((e) => [e.name, e]));
  let maxOrder = exercises.reduce((m, e) => Math.max(m, e.order || 0), 0);
  const added = [];
  for (const s of sessions) {
    for (const ex of s.exercises) {
      if (ex.exerciseId && byId.has(ex.exerciseId)) continue;
      let found = byName.get(ex.name);
      if (!found) {
        found = { id: genId('ex-'), name: ex.name || '不明な種目', part: 'other', order: ++maxOrder, archived: false };
        byId.set(found.id, found);
        byName.set(found.name, found);
        added.push(found);
      }
      ex.exerciseId = found.id;
      if (!ex.name) ex.name = found.name;
    }
  }
  return added;
}

async function ensureCatalog() {
  await DB.run(['sessions', 'exercises', 'meta'], 'readwrite', async (s) => {
    const config = await DB.req(s.meta.get('config'));
    if (config) return;
    // 初回起動 or v1 からの移行
    const exercises = DEFAULT_EXERCISES.map(([id, name, part], i) => ({ id, name, part, order: i, archived: false }));
    const sessions = await DB.req(s.sessions.getAll());
    const added = resolveSessionExercises(sessions, exercises);
    [...exercises, ...added].forEach((e) => s.exercises.put(e));
    sessions.forEach((x) => s.sessions.put(x));
    s.meta.put({ key: 'config', templates: DEFAULT_TEMPLATES });
  });
}

async function saveTemplates() {
  await DB.put('meta', { key: 'config', templates: state.templates });
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

// 最後の A日/B日 の反対。フリーの日は判定に使わない
function nextDay() {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const d = state.sessions[i].day;
    if (d === 'A') return 'B';
    if (d === 'B') return 'A';
  }
  return 'A';
}

// 指定種目の「前回」の記録（編集中の記録は除外、選択日以前で最新）
function previousRecord(exId) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.id === state.editingId) continue;
    if (s.date > state.date) continue;
    const ex = s.exercises.find((e) => e.exerciseId === exId);
    if (ex && validSets(ex).length) return { session: s, ex };
  }
  return null;
}

function emptySets() {
  return Array.from({ length: SET_COUNT }, () => ({ weight: '', reps: '' }));
}
function hasAnyInput() {
  return state.order.some((id) => (state.inputs[id] || []).some((s) => s.weight !== '' || s.reps !== ''));
}
function applyDay(day) {
  state.day = day;
  state.order = day === 'F' ? [] : templateIds(day);
  state.inputs = {};
  state.order.forEach((id) => { state.inputs[id] = emptySets(); });
}
function removeFromSession(exId) {
  state.order = state.order.filter((id) => id !== exId);
  delete state.inputs[exId];
  saveDraft();
}

// ---------- 下書き（入力途中の保持） ----------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      day: state.day, dayOverridden: state.dayOverridden, date: state.date,
      editingId: state.editingId, order: state.order, inputs: state.inputs,
    }));
  } catch (_) { /* 保存できない環境では無視 */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* noop */ }
}
function loadDraft() {
  try {
    localStorage.removeItem('workout-draft-v1');
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !DAY_LABEL[d.day] || !Array.isArray(d.order) || !d.inputs) return false;
    const order = d.order.filter((id) => exById(id));
    Object.assign(state, {
      day: d.day, dayOverridden: !!d.dayOverridden, date: d.date || todayStr(),
      editingId: d.editingId || null, order, inputs: {},
    });
    order.forEach((id) => { state.inputs[id] = Array.isArray(d.inputs[id]) ? d.inputs[id] : emptySets(); });
    return true;
  } catch (_) { return false; }
}

function resetRecordForm() {
  state.editingId = null;
  state.dayOverridden = false;
  state.date = todayStr();
  applyDay(nextDay());
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
  else label.textContent = state.day === auto ? '次のメニュー（自動）' : `自動判定は${auto}日（手動変更中）`;

  document.getElementById('session-date').value = state.date;
  document.getElementById('editing-note').hidden = !state.editingId;
  document.getElementById('save-btn').textContent = state.editingId ? '変更を保存' : `${DAY_LABEL[state.day]}の記録を保存`;
  document.getElementById('record-empty').hidden = state.order.length > 0;

  const list = document.getElementById('exercise-list');
  list.replaceChildren(...state.order.filter((id) => exById(id)).map(renderExerciseCard));
}

function renderExerciseCard(exId) {
  const ex = exById(exId);
  const inputs = state.inputs[exId];
  const prev = previousRecord(exId);
  const prevAchieved = prev ? achievedTarget(prev.ex.sets) : false;
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
      'aria-label': `${ex.name} ${i + 1}セット目 重量`,
      placeholder: suggested != null ? fmtNum(suggested) : (p && p.weight != null ? fmtNum(p.weight) : 'kg'),
    });
    wIn.value = set.weight;
    const rIn = el('input', {
      class: 'num-in', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'next', autocomplete: 'off',
      'aria-label': `${ex.name} ${i + 1}セット目 回数`,
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

  const removeBtn = el('button', {
    type: 'button', class: 'icon-btn', 'aria-label': `${ex.name} を今回の記録から外す`,
    onclick: () => {
      const filled = inputs.some((s) => s.weight !== '' || s.reps !== '');
      if (filled && !confirm(`${ex.name} の入力を消して外しますか？`)) return;
      removeFromSession(exId);
      renderRecord();
    },
  }, '✕');

  updateBadge();
  return el('div', { class: 'card ex-card' },
    el('div', { class: 'ex-head' },
      el('div', { class: 'ex-title' }, el('h3', {}, ex.name), el('span', { class: 'part-tag' }, PART_NAME[ex.part])),
      el('div', { class: 'ex-tools' }, badgeWrap, removeBtn)),
    prevBox, grid, fillBtn);
}

function addToSession(exId) {
  if (state.order.includes(exId)) return;
  state.order.push(exId);
  state.inputs[exId] = emptySets();
  saveDraft();
  renderRecord();
  // 追加したカードまでスクロール
  const cards = document.querySelectorAll('#exercise-list .ex-card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveSession() {
  const exercises = [];
  for (const id of state.order) {
    const name = exName(id);
    const sets = state.inputs[id].map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }));
    const invalid = state.inputs[id].some((s, i) =>
      (s.weight !== '' && sets[i].weight == null) || (s.reps !== '' && sets[i].reps == null));
    if (invalid) { toast(`${name}：数値を正しく入力してください`); return; }
    if (sets.some((s) => s.reps != null && s.reps > 0)) {
      exercises.push({ exerciseId: id, name, sets: sets.map((s) => (s.reps ? s : { weight: s.weight, reps: null })) });
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
    await DB.put('sessions', session);
  } catch (e) {
    console.error(e);
    toast('保存に失敗しました');
    return;
  }
  await reloadData();
  const achieved = exercises.filter((e) => achievedTarget(e.sets)).map((e) => e.name);
  resetRecordForm();
  renderAll();
  window.scrollTo({ top: 0 });
  toast(achieved.length ? `保存しました。${achieved.join('・')} は次回+${INCREMENT_KG}kg！` : '保存しました');
}

function startEdit(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  if (hasAnyInput() && !state.editingId && !confirm('入力中の内容は破棄されます。この記録を編集しますか？')) return;
  state.editingId = id;
  state.day = s.day;
  state.dayOverridden = true;
  state.date = s.date;
  state.order = [];
  state.inputs = {};
  for (const ex of s.exercises) {
    if (!exById(ex.exerciseId) || state.order.includes(ex.exerciseId)) continue;
    state.order.push(ex.exerciseId);
    state.inputs[ex.exerciseId] = Array.from({ length: SET_COUNT }, (_, i) => {
      const set = ex.sets[i] || {};
      return { weight: set.weight == null ? '' : fmtNum(set.weight), reps: set.reps == null ? '' : String(set.reps) };
    });
  }
  saveDraft();
  renderRecord();
  showView('record');
}

// ---------- 種目の選択シート ----------
const picker = { onPick: null, excluded: new Set() };

function openPicker({ title, excluded, onPick }) {
  picker.onPick = onPick;
  picker.excluded = excluded;
  document.getElementById('picker-title').textContent = title;
  if (!visibleParts().some((p) => p.id === state.pickerPart)) state.pickerPart = PARTS[0].id;
  renderPicker();
  document.getElementById('picker-dialog').showModal();
}

function renderPicker() {
  const parts = document.getElementById('picker-parts');
  parts.replaceChildren(...visibleParts().map((p) => el('button', {
    type: 'button', class: 'chip', role: 'tab', 'aria-selected': String(p.id === state.pickerPart),
    onclick: () => { state.pickerPart = p.id; renderPicker(); },
  }, p.name)));
  const list = document.getElementById('picker-list');
  const items = activeExercises(state.pickerPart);
  list.replaceChildren(...(items.length ? items.map((e) => {
    const used = picker.excluded.has(e.id);
    return el('button', {
      type: 'button', class: 'pick-item', disabled: used,
      onclick: () => pick(e.id),
    }, e.name, used ? el('span', { class: 'muted' }, '追加済み') : null);
  }) : [el('p', { class: 'muted small' }, 'この部位の種目はまだありません')]));
  document.getElementById('picker-new').textContent = `＋ ${PART_NAME[state.pickerPart]}の種目を新しく作る`;
}

function pick(exId) {
  document.getElementById('picker-dialog').close();
  const fn = picker.onPick;
  picker.onPick = null;
  if (fn) fn(exId);
}

// ---------- 種目の作成・編集ダイアログ ----------
const exDialog = { resolve: null, editing: null, part: 'chest' };

function openExerciseDialog({ exercise = null, part = 'chest' } = {}) {
  exDialog.editing = exercise;
  exDialog.part = exercise ? exercise.part : part;
  document.getElementById('exercise-dialog-title').textContent = exercise ? '種目を編集' : '種目を追加';
  const nameIn = document.getElementById('exercise-name');
  nameIn.value = exercise ? exercise.name : '';
  document.getElementById('exercise-error').hidden = true;
  renderExercisePartChips();
  document.getElementById('exercise-dialog').showModal();
  if (!exercise) nameIn.focus();
  return new Promise((resolve) => { exDialog.resolve = resolve; });
}

function renderExercisePartChips() {
  const wrap = document.getElementById('exercise-part');
  wrap.replaceChildren(...PARTS.filter((p) => p.id !== 'other' || exDialog.part === 'other').map((p) => el('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(p.id === exDialog.part),
    onclick: () => { exDialog.part = p.id; renderExercisePartChips(); },
  }, p.name)));
}

async function submitExerciseDialog(ev) {
  ev.preventDefault();
  const name = document.getElementById('exercise-name').value.trim().replace(/\s+/g, ' ');
  const err = document.getElementById('exercise-error');
  const showErr = (m) => { err.textContent = m; err.hidden = false; };
  if (!name) return showErr('種目名を入力してください');
  const dup = state.exercises.find((e) => e.name === name && e.id !== exDialog.editing?.id);
  if (dup && !dup.archived) return showErr(`「${name}」はすでに${PART_NAME[dup.part]}にあります`);

  let saved;
  if (exDialog.editing) {
    saved = { ...exDialog.editing, name, part: exDialog.part };
  } else if (dup) {
    // 削除済みの同名種目は復活させる（過去の記録とつながる）
    saved = { ...dup, part: exDialog.part, archived: false };
  } else {
    const maxOrder = state.exercises.reduce((m, e) => Math.max(m, e.order || 0), 0);
    saved = { id: genId('ex-'), name, part: exDialog.part, order: maxOrder + 1, archived: false };
  }
  await DB.put('exercises', saved);
  await reloadData();
  const resolve = exDialog.resolve;
  exDialog.resolve = null;
  document.getElementById('exercise-dialog').close();
  renderAll();
  toast(exDialog.editing ? '変更しました' : `「${name}」を${PART_NAME[saved.part]}に追加しました`);
  resolve?.(saved);
}

function setupDialogs() {
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    // 背景タップで閉じる
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  });
  document.getElementById('exercise-dialog').addEventListener('close', () => {
    const resolve = exDialog.resolve;
    exDialog.resolve = null;
    resolve?.(null);
  });
  document.getElementById('exercise-form').addEventListener('submit', submitExerciseDialog);
  document.getElementById('picker-new').addEventListener('click', async () => {
    const onPick = picker.onPick;
    picker.onPick = null;
    document.getElementById('picker-dialog').close();
    const created = await openExerciseDialog({ part: state.pickerPart });
    if (created && onPick) {
      state.pickerPart = created.part;
      onPick(created.id);
    }
  });
}

// ---------- 種目・メニュー画面 ----------
function renderMenu() {
  const tpl = document.getElementById('template-cards');
  tpl.replaceChildren(...['A', 'B'].map((day) => {
    const ids = templateIds(day);
    const setTemplate = async (arr) => {
      state.templates[day] = arr;
      await saveTemplates();
      afterTemplateChange(day);
    };
    const move = (i, d) => {
      const arr = [...ids];
      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
      return setTemplate(arr);
    };
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, `${day}日のメニュー`),
        el('button', {
          type: 'button', class: 'text-btn',
          onclick: () => openPicker({
            title: `${day}日に種目を追加`, excluded: new Set(ids),
            onPick: async (id) => {
              await setTemplate([...templateIds(day), id]);
              toast(`${day}日に「${exName(id)}」を追加しました`);
            },
          }),
        }, '＋ 追加')),
      ids.length ? el('ul', { class: 'row-list' }, ids.map((id, i) => el('li', { class: 'row' },
        el('span', { class: 'row-name' }, exName(id), el('span', { class: 'part-tag' }, PART_NAME[exById(id).part])),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '上へ', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '下へ', disabled: i === ids.length - 1, onclick: () => move(i, 1) }, '↓'),
        el('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `${exName(id)} を${day}日から外す`,
          onclick: () => setTemplate(ids.filter((x) => x !== id)),
        }, '✕'))))
        : el('p', { class: 'muted small row-empty' }, '種目がありません'));
  }));

  const cat = document.getElementById('catalog-cards');
  cat.replaceChildren(...visibleParts().map((p) => {
    const items = activeExercises(p.id);
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, p.name, el('span', { class: 'muted small' }, `　${items.length}種目`)),
        el('button', { type: 'button', class: 'text-btn', onclick: () => openExerciseDialog({ part: p.id }) }, '＋ 追加')),
      items.length ? el('ul', { class: 'row-list' }, items.map((e) => el('li', { class: 'row' },
        el('span', { class: 'row-name' }, e.name),
        el('button', { type: 'button', class: 'small-btn', onclick: () => openExerciseDialog({ exercise: e }) }, '編集'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteExercise(e) }, '削除'))))
        : el('p', { class: 'muted small row-empty' }, '種目がありません'));
  }));
}

// テンプレートを変えたら、未入力の記録画面にも反映する
function afterTemplateChange(day) {
  if (!state.editingId && state.day === day && !hasAnyInput()) {
    applyDay(day);
    saveDraft();
  }
  renderAll();
}

async function deleteExercise(e) {
  const used = hasHistory(e.id);
  const msg = used
    ? `「${e.name}」を一覧から削除しますか？\n過去の記録とグラフは残ります。`
    : `「${e.name}」を削除しますか？`;
  if (!confirm(msg)) return;
  if (used) await DB.put('exercises', { ...e, archived: true });
  else await DB.remove('exercises', e.id);
  let changed = false;
  for (const day of ['A', 'B']) {
    if (state.templates[day].includes(e.id)) {
      state.templates[day] = state.templates[day].filter((x) => x !== e.id);
      changed = true;
    }
  }
  if (changed) await saveTemplates();
  await reloadData();
  // 記録画面からも外す（過去の記録を編集中なら、記録のある種目は残す）
  if (state.order.includes(e.id) && (!used || !state.editingId)) removeFromSession(e.id);
  renderAll();
  toast('削除しました');
}

// ---------- 履歴 ----------
function renderHistory() {
  const list = document.getElementById('history-list');
  const items = [...state.sessions].reverse();
  document.getElementById('history-empty').hidden = items.length > 0;
  list.replaceChildren(...items.map((s) => el('div', { class: 'card' },
    el('div', { class: 'hist-head' },
      el('div', {}, el('span', { class: 'hist-date' }, fmtDate(s.date)), el('span', { class: 'day-tag' }, DAY_LABEL[s.day] || s.day)),
      el('div', { class: 'hist-actions' },
        el('button', { type: 'button', class: 'small-btn', onclick: () => copyText(sessionText(s)) }, 'コピー'),
        el('button', { type: 'button', class: 'small-btn', onclick: () => startEdit(s.id) }, '編集'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteSession(s) }, '削除'))),
    s.exercises.map((ex) => el('div', { class: 'hist-ex' },
      el('span', { class: 'name' }, exName(ex.exerciseId, ex.name)),
      el('span', { class: 'sets-txt' }, setsText(ex), achievedTarget(ex.sets) ? ' ✓' : ''))),
  )));
}

async function deleteSession(s) {
  if (!confirm(`${fmtDate(s.date)} の${DAY_LABEL[s.day] || ''}の記録を削除しますか？`)) return;
  await DB.remove('sessions', s.id);
  await reloadData();
  if (state.editingId === s.id) resetRecordForm();
  else if (!state.dayOverridden && !state.editingId && !hasAnyInput()) applyDay(nextDay());
  renderAll();
  toast('削除しました');
}

// ---------- グラフ ----------
function chartPoints() {
  const id = state.chartExercise;
  const pts = [];
  for (const s of state.sessions) {
    const ex = s.exercises.find((e) => e.exerciseId === id);
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

// 種目セレクトを部位ごとに作り直す（記録がある種目は削除済みでも選べる）
function renderChartSelect() {
  const sel = document.getElementById('chart-exercise');
  const withData = new Set();
  state.sessions.forEach((s) => s.exercises.forEach((e) => { if (validSets(e).length) withData.add(e.exerciseId); }));
  const groups = PARTS.map((p) => {
    const items = state.exercises
      .filter((e) => e.part === p.id && (!e.archived || withData.has(e.id)))
      .sort((a, b) => (withData.has(b.id) - withData.has(a.id)) || a.order - b.order);
    if (!items.length) return null;
    return el('optgroup', { label: p.name }, items.map((e) => el('option', { value: e.id },
      e.name + (e.archived ? '（削除済み）' : '') + (withData.has(e.id) ? '' : '（記録なし）'))));
  }).filter(Boolean);
  sel.replaceChildren(...groups);
  if (!exById(state.chartExercise)) {
    const latest = [...state.sessions].reverse().flatMap((s) => s.exercises).find((e) => validSets(e).length);
    state.chartExercise = latest?.exerciseId || activeExercises()[0]?.id || null;
  }
  sel.value = state.chartExercise;
}

let chartGeom = null;
function renderChart() {
  const pts = chartPoints();
  const unit = 'kg';
  const metricLabel = state.chartMetric === 'top' ? '最大重量' : '総挙上量';
  document.getElementById('chart-title').textContent = `${exName(state.chartExercise, '')}：${metricLabel}（${unit}）`;
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
    const cx = Math.min(Math.max(x(i), pad.l + w / 2), W - pad.r - w / 2);
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
  sel.addEventListener('change', () => { state.chartExercise = sel.value; renderChart(); });
  document.querySelectorAll('#view-chart .seg-btn').forEach((b) => b.addEventListener('click', () => {
    state.chartMetric = b.dataset.metric;
    document.querySelectorAll('#view-chart .seg-btn').forEach((x) => {
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
    version: 2,
    exportedAt: new Date().toISOString(),
    exercises: state.exercises,
    templates: state.templates,
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
  if (!DAY_LABEL[raw.day]) return null;
  if (!Array.isArray(raw.exercises)) return null;
  const exercises = raw.exercises
    .filter((e) => e && (typeof e.name === 'string' || typeof e.exerciseId === 'string') && Array.isArray(e.sets))
    .map((e) => ({
      exerciseId: typeof e.exerciseId === 'string' ? e.exerciseId : null,
      name: typeof e.name === 'string' ? e.name : '',
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

function normalizeExercise(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    part: PART_NAME[raw.part] ? raw.part : 'other',
    order: Number(raw.order) || 0,
    archived: !!raw.archived,
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
  const importedExercises = (Array.isArray(data.exercises) ? data.exercises : []).map(normalizeExercise).filter(Boolean);
  const tpl = data.templates;
  const importedTemplates = tpl && ['A', 'B'].every((d) => Array.isArray(tpl[d]))
    ? { A: tpl.A.filter((x) => typeof x === 'string'), B: tpl.B.filter((x) => typeof x === 'string') }
    : null;
  if (!sessions.length && !importedExercises.length) { toast('取り込める記録がありませんでした'); return; }

  // 取り込み後の種目一覧（既存 + ファイル）で、種目 id の無い記録を名前で解決
  const merged = new Map(state.exercises.map((e) => [e.id, e]));
  importedExercises.forEach((e) => merged.set(e.id, e));
  const added = resolveSessionExercises(sessions, [...merged.values()]);

  const existingIds = new Set(state.sessions.map((s) => s.id));
  const overwrite = sessions.filter((s) => existingIds.has(s.id)).length;
  const msg = `${sessions.length}件の記録` + (importedExercises.length ? `と${importedExercises.length}件の種目` : '') +
    'をインポートします。' +
    (overwrite ? `\n（うち${overwrite}件は既存の記録を上書き）` : '') +
    (importedTemplates ? '\nA日/B日のメニューもファイルの内容に置き換わります。' : '') +
    '\nよろしいですか？';
  if (!confirm(msg)) return;

  await DB.run(['sessions', 'exercises', 'meta'], 'readwrite', (s) => {
    [...importedExercises, ...added].forEach((e) => s.exercises.put(e));
    sessions.forEach((x) => s.sessions.put(x));
    if (importedTemplates) s.meta.put({ key: 'config', templates: importedTemplates });
  });
  await reloadData();
  if (!state.editingId && !hasAnyInput()) {
    state.dayOverridden = false;
    applyDay(nextDay());
  }
  renderAll();
  toast(`${sessions.length}件をインポートしました`);
}

// ---------- テキストでコピー ----------
function sessionText(s) {
  const lines = [`【${fmtDate(s.date)} ${DAY_LABEL[s.day] || ''}】`];
  for (const ex of s.exercises) {
    if (!validSets(ex).length) continue;
    lines.push(`${exName(ex.exerciseId, ex.name)}：${setsText(ex)}${achievedTarget(ex.sets) ? ` ✓（次回+${INCREMENT_KG}kg）` : ''}`);
  }
  return lines.join('\n');
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const textRange = { value: 'last' };
function rangeSessions(range) {
  if (range === 'last') return state.sessions.slice(-1);
  if (range === 'all') return state.sessions;
  const from = daysAgoStr(Number(range) - 1);
  return state.sessions.filter((s) => s.date >= from);
}

function rangeText(range) {
  const list = rangeSessions(range);
  if (!list.length) return '';
  if (list.length === 1) return sessionText(list[0]);
  const head = `筋トレ記録 ${fmtDate(list[0].date, false)}〜${fmtDate(list[list.length - 1].date, false)}（${list.length}回）`;
  return [head, ...list.map(sessionText)].join('\n\n');
}

function renderTextPreview() {
  const text = rangeText(textRange.value);
  const area = document.getElementById('text-preview');
  area.value = text || 'この期間の記録はありません';
  document.getElementById('copy-text-btn').disabled = !text;
  document.getElementById('share-text-btn').disabled = !text;
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // clipboard API が使えない環境向け
    const ta = el('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) { toast('コピーできませんでした'); return; }
  }
  toast('コピーしました');
}

function setupTextCopy() {
  document.querySelectorAll('#text-range .seg-btn').forEach((b) => b.addEventListener('click', () => {
    textRange.value = b.dataset.range;
    document.querySelectorAll('#text-range .seg-btn').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-checked', String(x === b));
    });
    renderTextPreview();
  }));
  document.getElementById('copy-text-btn').addEventListener('click', () => copyText(rangeText(textRange.value)));
  const shareBtn = document.getElementById('share-text-btn');
  shareBtn.hidden = !navigator.share;
  shareBtn.addEventListener('click', async () => {
    try {
      await navigator.share({ text: rangeText(textRange.value) });
    } catch (e) {
      if (e.name !== 'AbortError') toast('共有できませんでした');
    }
  });
}

function renderSettings() {
  renderTextPreview();
  const n = state.sessions.length;
  const exCount = `種目${activeExercises().length}件`;
  document.getElementById('data-count').textContent = n
    ? `保存済み：${n}件（${fmtDate(state.sessions[0].date)} 〜 ${fmtDate(state.sessions[n - 1].date)}）・${exCount}`
    : `保存済み：0件・${exCount}`;
  document.getElementById('app-version').textContent = `筋トレ記録 v${APP_VERSION}`;
}

// ---------- 画面切り替え ----------
const TITLES = { record: '記録', chart: 'グラフ', history: '履歴', menu: '種目・メニュー', settings: 'データ' };
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
  renderMenu();
  renderSettings();
  renderChartSelect();
  if (isActive('chart')) renderChart();
}

async function reloadData() {
  const [sessions, exercises, config] = await Promise.all([
    DB.getAll('sessions'), DB.getAll('exercises'), DB.get('meta', 'config'),
  ]);
  state.sessions = sortSessions(sessions);
  state.exercises = exercises;
  state.templates = { A: [], B: [], ...(config?.templates || DEFAULT_TEMPLATES) };
}

function setupRecordControls() {
  document.querySelectorAll('.day-btn').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.day === state.day) return;
    if (hasAnyInput() && !confirm('入力中の内容は破棄されます。切り替えますか？')) return;
    applyDay(b.dataset.day);
    state.dayOverridden = state.day !== nextDay();
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
  document.getElementById('add-exercise-btn').addEventListener('click', () => openPicker({
    title: '今回の種目を追加', excluded: new Set(state.order), onPick: addToSession,
  }));
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
  setupTextCopy();
  setupDialogs();

  try {
    await ensureCatalog();
    await reloadData();
  } catch (e) {
    console.error(e);
    toast('データベースを開けませんでした');
  }
  if (!loadDraft()) resetRecordForm();
  // 下書きの編集対象が消えていたら新規扱いに戻す
  if (state.editingId && !state.sessions.some((s) => s.id === state.editingId)) resetRecordForm();
  // 手動変更していない未入力の下書きは自動判定に追従
  if (!state.dayOverridden && !state.editingId && state.day !== nextDay() && !hasAnyInput()) applyDay(nextDay());
  renderAll();

  // ブラウザによるデータ自動削除を避ける
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    // 新しいバージョンが入ったら読み込み直す（入力中の内容は下書きに残っている）
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // ホーム画面アプリは開きっぱなしになりやすいので、前面に戻るたびに更新を確認
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((e) => console.warn('SW登録失敗', e));
  }
}

init();
