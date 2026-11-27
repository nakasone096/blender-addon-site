'use strict';

const APP_VERSION = '3.11.0';
// 目標のセット数・回数の初期値（種目ごとに変えられる）
const SET_COUNT = 4;
const TARGET_REPS = 10;
const MAX_SETS = 6;
const SET_OPTIONS = [2, 3, 4, 5];
const REP_OPTIONS = [3, 5, 8, 10, 12];
// BIG3 の重いセット：[元の種目, 重いセットの種目, 名前, 増やす重さ]
const HEAVY_LIFTS = [
  ['ex-bench', 'ex-bench-heavy', 'ベンチプレス（重いセット）', 2.5],
  ['ex-squat', 'ex-squat-heavy', 'スクワット（重いセット）', 5],
  ['ex-deadlift', 'ex-deadlift-heavy', 'デッドリフト（重いセット）', 5],
];
const HEAVY_TARGET = { sets: 3, reps: 5 };
const BAR_KG = 20;
const BACKOFF_TARGET = { sets: 2, reps: 10 };
// 達成したときに増やす重さ（種目ごとに選べる）。初期値は部位で決める
const INCREMENT_OPTIONS = [1, 2, 2.5, 5];
const DEFAULT_INCREMENT = { chest: 5, back: 5, leg: 5, shoulder: 2.5, arm: 2.5, other: 2.5 };
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
  ['ex-bench-light', 'ベンチプレス（軽め）', 'chest', { sets: 3, reps: 5, increment: 2.5 }],
  ['ex-crunch', '腹筋（クランチ）', 'other', { sets: 3, reps: 12 }],
];
// 初期メニュー（5分割・3種目＋1）。同じ筋肉が連続しない順番。
// その日の部位3種目に、頻度の補強や弱点の補強として別の部位を1種目（最後）足す。
// BIG3 の重いセットは ensureHeavySetup が元の種目の前に入れる
const DEFAULT_SPLIT = [
  ['m-chest', '胸の日', ['ex-bench', 'ex-incline-bench', 'ex-pec-fly', 'ex-crunch']],
  ['m-back', '背中の日', ['ex-deadlift', 'ex-lat-pulldown', 'ex-seated-row', 'ex-rear-raise']],
  ['m-leg', '足の日', ['ex-squat', 'ex-leg-press', 'ex-leg-curl', 'ex-crunch']],
  ['m-shoulder', '肩の日', ['ex-shoulder-press', 'ex-side-raise', 'ex-rear-raise', 'ex-bench-light']],
  ['m-arm', '腕の日', ['ex-curl', 'ex-pushdown', 'ex-hammer-curl', 'ex-calf-raise']],
];
const FREE_DAY = 'F';
// 旧バージョン（A日/B日）の記録の表示名
const LEGACY_DAY_LABEL = { A: 'A日', B: 'B日' };

const state = {
  sessions: [],       // 全記録（日付の古い順）
  exercises: [],      // 種目マスタ
  menus: [],          // [{ id, name, exerciseIds }]。並び順が自動判定の順番
  day: FREE_DAY,      // メニュー id または FREE_DAY
  dayOverridden: false,
  date: todayStr(),
  editingId: null,
  order: [],          // 記録画面に並べる種目 id
  inputs: {},         // { 種目id: [{weight:'', reps:''} x4] }
  warmup: {},         // { 種目id: [チェック済みの段階番号] }（記録には残さない）
  done: {},           // { 種目id: [完了にしたセット番号] }（記録には残さない）
  timer: null,        // 休憩タイマー { endAt, total, label }
  sessionStart: null, // 最初にセットを完了にした時刻
  memos: {},          // { 種目id: メモ }
  cardio: emptyCardio(), // 有酸素の入力（文字列のまま持つ）
  chartExercise: null,
  chartMetric: 'top',
  big3: null,         // { squat, bench, deadlift: 種目id, goal: kg }
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
function targetFor(exId) {
  const e = exById(exId);
  return { sets: e?.sets || SET_COUNT, reps: e?.reps || TARGET_REPS };
}
function targetText(exId) {
  const t = targetFor(exId);
  return `${t.sets}×${t.reps}`;
}
function incrementFor(exId) {
  const e = exById(exId);
  return e?.increment || DEFAULT_INCREMENT[e?.part] || 2.5;
}
function hasHistory(id) {
  return state.sessions.some((s) => s.exercises.some((e) => e.exerciseId === id && validSets(e).length));
}
function menuById(id) {
  return state.menus.find((m) => m.id === id) || null;
}
function menuExerciseIds(id) {
  return (menuById(id)?.exerciseIds || []).filter((x) => exById(x) && !exById(x).archived);
}
function dayLabel(day, fallback) {
  if (day === FREE_DAY) return 'フリー';
  return menuById(day)?.name || fallback || LEGACY_DAY_LABEL[day] || '';
}
function sessionDayLabel(s) {
  return dayLabel(s.day, s.dayName);
}
function defaultMenus(exercises) {
  const active = new Set(exercises.filter((e) => !e.archived).map((e) => e.id));
  return DEFAULT_SPLIT.map(([id, name, ids]) => ({ id, name, exerciseIds: ids.filter((x) => active.has(x)) }));
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
    if (config && Array.isArray(config.menus)) return;
    let exercises;
    if (config) {
      // v2（A日/B日）からの移行：部位別の5分割メニューに置き換える
      exercises = await DB.req(s.exercises.getAll());
    } else {
      // 初回起動 or v1 からの移行
      exercises = DEFAULT_EXERCISES.map(([id, name, part, extra], i) => ({ id, name, part, order: i, archived: false, ...extra }));
      const sessions = await DB.req(s.sessions.getAll());
      const added = resolveSessionExercises(sessions, exercises);
      exercises.push(...added);
      exercises.forEach((e) => s.exercises.put(e));
      sessions.forEach((x) => s.sessions.put(x));
    }
    s.meta.put({ key: 'config', menus: defaultMenus(exercises) });
  });
}

// BIG3 に重いセットの種目を作り、メニューの先頭に「重いセット → いつものセット」の順で並べる（一度だけ）
async function ensureHeavySetup() {
  await DB.run(['exercises', 'meta'], 'readwrite', async (s) => {
    if (await DB.req(s.meta.get('heavy-setup'))) return;
    const exercises = await DB.req(s.exercises.getAll());
    const config = await DB.req(s.meta.get('config'));
    const byId = new Map(exercises.map((e) => [e.id, e]));
    let maxOrder = exercises.reduce((m, e) => Math.max(m, e.order || 0), 0);
    const menus = (config?.menus || []).map((m) => ({ ...m, exerciseIds: [...m.exerciseIds] }));
    for (const [mainId, heavyId, name, increment] of HEAVY_LIFTS) {
      const main = byId.get(mainId);
      if (!main || main.archived) continue;
      if (!byId.has(heavyId)) {
        s.exercises.put({ id: heavyId, name, part: main.part, increment, ...HEAVY_TARGET, heavyOf: mainId, order: maxOrder + 1, archived: false });
        maxOrder++;
      }
      s.exercises.put({ ...main, ...BACKOFF_TARGET });
      for (const m of menus) {
        if (!m.exerciseIds.includes(mainId)) continue;
        m.exerciseIds = [heavyId, mainId, ...m.exerciseIds.filter((x) => x !== mainId && x !== heavyId)];
      }
    }
    if (config) s.meta.put({ ...config, menus });
    s.meta.put({ key: 'heavy-setup', done: true });
  });
}

const DEFAULT_SUPERSETS = [['m-arm', 'ex-curl', 'ex-pushdown']];
async function ensureSupersetSetup() {
  await DB.run(['meta'], 'readwrite', async (s) => {
    if (await DB.req(s.meta.get('superset-setup'))) return;
    const config = await DB.req(s.meta.get('config'));
    if (config) {
      const menus = config.menus.map((m) => {
        const add = DEFAULT_SUPERSETS.filter(([menuId, a, b]) => menuId === m.id && m.exerciseIds.includes(a) && m.exerciseIds.includes(b));
        if (!add.length) return m;
        let ids = [...m.exerciseIds];
        // ペアの2種目を隣に並べる
        for (const [, a, b] of add) {
          ids = ids.filter((x) => x !== b);
          ids.splice(ids.indexOf(a) + 1, 0, b);
        }
        return cleanPairs({ ...m, exerciseIds: ids, supersets: [...(m.supersets || []), ...add.map(([, a, b]) => [a, b])] });
      });
      s.meta.put({ ...config, menus });
    }
    s.meta.put({ key: 'superset-setup', done: true });
  });
}

async function saveMenus() {
  await DB.put('meta', { key: 'config', menus: state.menus });
}

// ---------- 記録ロジック ----------
function validSets(ex) {
  return (ex?.sets || []).filter((s) => s && s.reps != null && s.reps > 0);
}
// 記録したときの目標（この機能より前の記録は 4×10）
function recTarget(ex) {
  return ex?.target || { sets: SET_COUNT, reps: TARGET_REPS };
}
// 目標のセット数すべてを、同じ重さで目標の回数以上できたか
function achievedTarget(sets, t) {
  if (!sets || sets.length < t.sets) return false;
  const target = sets.slice(0, t.sets);
  if (!target.every((s) => s && s.reps != null && s.reps >= t.reps)) return false;
  return target.every((s) => s.weight === target[0].weight);
}
// 次回の目安にする重さ：一番多くのセットで使った重さ（同数なら重い方）
function workingWeight(ex) {
  const counts = new Map();
  for (const s of validSets(ex)) {
    if (s.weight != null) counts.set(s.weight, (counts.get(s.weight) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && w > best)) { best = w; bestCount = c; }
  }
  return best;
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

// 一番長くやっていないメニュー（まだ一度もやっていないものがあれば、並び順で先のもの）。
// 順番どおりに続ければメニューの並び順に回る。フリーの日は判定に使わない
function nextDay() {
  if (!state.menus.length) return FREE_DAY;
  const lastIndex = {};
  state.sessions.forEach((s, i) => { lastIndex[s.day] = i; });
  let best = state.menus[0];
  let bestIndex = Infinity;
  for (const m of state.menus) {
    const idx = lastIndex[m.id] ?? -1;
    if (idx < bestIndex) { best = m; bestIndex = idx; }
  }
  return best.id;
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

// 新しく並べる種目の入力欄。重さは提案の重さを実際の値として入れ、回数は空欄にする（入れ忘れ防止）
function emptySets(exId) {
  const w = exById(exId) ? suggestionFor(exId).suggested : null;
  return Array.from({ length: targetFor(exId).sets }, () => ({ weight: w == null ? '' : fmtNum(w), reps: '' }));
}
// 自分で入れたもの（回数・メモ・有酸素）があるか。重さは自動で入るので数えない
function hasAnyInput() {
  return state.order.some((id) => (state.inputs[id] || []).some((s) => s.reps !== '') || (state.memos[id] || '').trim())
    || CARDIO_FIELDS.some(([k]) => (state.cardio[k] || '') !== '');
}
function applyDay(day) {
  state.day = day;
  state.order = day === FREE_DAY ? [] : menuExerciseIds(day);
  state.inputs = {};
  state.order.forEach((id) => { state.inputs[id] = emptySets(id); });
  state.warmup = {};
  state.done = {};
  state.memos = {};
  state.cardio = emptyCardio();
}
function removeFromSession(exId) {
  state.order = state.order.filter((id) => id !== exId);
  delete state.inputs[exId];
  delete state.memos[exId];
  saveDraft();
}

// ---------- 下書き（入力途中の保持） ----------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      day: state.day, dayOverridden: state.dayOverridden, date: state.date,
      editingId: state.editingId, order: state.order, inputs: state.inputs, warmup: state.warmup,
      done: state.done, timer: state.timer, sessionStart: state.sessionStart, memos: state.memos, cardio: state.cardio,
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
    if (!d || typeof d.day !== 'string' || !Array.isArray(d.order) || !d.inputs) return false;
    // 消えたメニューの下書きは使わない（過去の記録の編集中は除く）
    if (d.day !== FREE_DAY && !menuById(d.day) && !d.editingId) return false;
    const order = d.order.filter((id) => exById(id));
    Object.assign(state, {
      day: d.day, dayOverridden: !!d.dayOverridden, date: d.date || todayStr(),
      editingId: d.editingId || null, order, inputs: {},
      warmup: d.warmup && typeof d.warmup === 'object' ? d.warmup : {},
      done: d.done && typeof d.done === 'object' ? d.done : {},
      memos: d.memos && typeof d.memos === 'object' ? d.memos : {},
      cardio: { ...emptyCardio(), ...(d.cardio && typeof d.cardio === 'object' ? d.cardio : {}) },
      timer: d.timer && d.timer.endAt > Date.now() ? d.timer : null,
      sessionStart: Number(d.sessionStart) || null,
    });
    order.forEach((id) => { state.inputs[id] = Array.isArray(d.inputs[id]) ? d.inputs[id] : emptySets(id); });
    return true;
  } catch (_) { return false; }
}

function resetRecordForm() {
  state.editingId = null;
  state.timer = null;
  state.sessionStart = null;
  state.dayOverridden = false;
  state.date = todayStr();
  applyDay(nextDay());
  clearDraft();
}

// ---------- 部位ごとの最終実施日 ----------
const RECOVERY_PARTS = ['chest', 'back', 'leg', 'shoulder', 'arm'];
const LONG_GAP_DAYS = 7;
// 軽めの種目（フォーム練習）は、その部位をやったことに数えない
function isLight(e) {
  return !!e && (e.id.endsWith('-light') || e.name.includes('軽め'));
}
function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
}
function lastDoneByPart() {
  const last = {};
  for (const s of state.sessions) {
    for (const ex of s.exercises) {
      const e = exById(ex.exerciseId);
      if (!e || isLight(e) || !RECOVERY_PARTS.includes(e.part) || !validSets(ex).length) continue;
      if (!last[e.part] || s.date > last[e.part]) last[e.part] = s.date;
    }
  }
  return last;
}
function renderRecovery() {
  const last = lastDoneByPart();
  const today = todayStr();
  document.getElementById('recovery').replaceChildren(...RECOVERY_PARTS.map((part) => {
    const date = last[part];
    const days = date ? Math.max(0, daysBetween(date, today)) : null;
    const when = days == null ? '記録なし' : days === 0 ? '今日' : days === 1 ? '昨日' : `${days}日前`;
    const status = days == null ? 'long' : days <= 1 ? 'resting' : days >= LONG_GAP_DAYS ? 'long' : 'ok';
    const note = status === 'resting' ? '回復中' : status === 'long' ? (days == null ? '—' : `${days}日空き`) : 'OK';
    return el('div', { class: `rec-item ${status}`, title: date ? `最終実施日 ${fmtDate(date)}` : 'まだ記録がありません' },
      el('div', { class: 'rec-part' }, PART_NAME[part]),
      el('div', { class: 'rec-when' }, when),
      el('div', { class: 'rec-note' }, note));
  }));
}

// ---------- 有酸素 ----------
const CARDIO_FIELDS = [
  ['minutes', '時間', '分', 'numeric'],
  ['avgHr', '平均心拍', 'bpm', 'numeric'],
  ['incline', '傾斜', '%', 'decimal'],
  ['speed', '速度', 'km/h', 'decimal'],
];
function emptyCardio() {
  return { minutes: '', avgHr: '', incline: '', speed: '' };
}
function cardioText(c) {
  if (!c) return '';
  const parts = [];
  if (c.minutes != null) parts.push(`${fmtNum(c.minutes)}分`);
  if (c.avgHr != null) parts.push(`平均心拍${fmtNum(c.avgHr)}`);
  if (c.incline != null) parts.push(`傾斜${fmtNum(c.incline)}%`);
  if (c.speed != null) parts.push(`時速${fmtNum(c.speed)}km`);
  return parts.join('・');
}
// 入力から保存用の値を作る。何もなければ null、数値でないものがあれば false
function cardioFromInput() {
  const out = {};
  for (const [k] of CARDIO_FIELDS) {
    const raw = (state.cardio[k] || '').trim();
    if (raw === '') continue;
    const n = toNum(raw);
    if (n == null) return false;
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}
function lastCardio() {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.id !== state.editingId && s.cardio) return s.cardio;
  }
  return null;
}
function renderCardio() {
  const prev = lastCardio();
  document.getElementById('cardio-prev').textContent = prev ? `前回：${cardioText(prev)}` : '';
  for (const [k] of CARDIO_FIELDS) {
    const input = document.getElementById(`cardio-${k}`);
    input.value = state.cardio[k] || '';
    input.placeholder = prev && prev[k] != null ? fmtNum(prev[k]) : '';
  }
}
function setupCardio() {
  for (const [k] of CARDIO_FIELDS) {
    document.getElementById(`cardio-${k}`).addEventListener('input', (e) => {
      state.cardio[k] = e.target.value.trim();
      saveDraft();
    });
  }
}

// ---------- 記録画面 ----------
function renderRecord() {
  renderRecovery();
  renderCardio();
  const auto = nextDay();
  renderDaySwitch();
  const label = document.getElementById('day-auto-label');
  if (state.editingId) label.textContent = 'メニュー';
  else label.textContent = state.day === auto ? '次のメニュー（自動）' : `自動判定は${dayLabel(auto)}（手動変更中）`;

  document.getElementById('session-date').value = state.date;
  document.getElementById('editing-note').hidden = !state.editingId;
  document.getElementById('save-btn').textContent = state.editingId ? '変更を保存' : `${dayLabel(state.day)}の記録を保存`;
  document.getElementById('record-empty').hidden = state.order.length > 0;

  const list = document.getElementById('exercise-list');
  // スーパーセットのペアは1枚のカードにまとめる
  const pairs = activePairs();
  const pairFirst = new Map(pairs.map(([a, b]) => [a, b]));
  const pairSecond = new Set(pairs.map(([, b]) => b));
  list.replaceChildren(...state.order.filter((id) => exById(id) && !pairSecond.has(id))
    .map((id) => (pairFirst.has(id) ? renderSupersetCard(id, pairFirst.get(id)) : renderExerciseCard(id))));
}

function renderDaySwitch() {
  const days = [...state.menus.map((m) => ({ id: m.id, name: m.name })), { id: FREE_DAY, name: 'フリー' }];
  // 消えたメニュー・A日/B日 の記録を編集中なら、その日も選択肢に出す
  if (!days.some((d) => d.id === state.day)) {
    const s = state.sessions.find((x) => x.id === state.editingId);
    days.unshift({ id: state.day, name: s ? sessionDayLabel(s) : dayLabel(state.day) });
  }
  const wrap = document.getElementById('day-switch');
  wrap.replaceChildren(...days.map((d) => el('button', {
    type: 'button', class: 'day-btn', role: 'radio', 'aria-checked': String(d.id === state.day),
    onclick: () => selectDay(d.id),
  }, d.name)));
}

function selectDay(day) {
  if (day === state.day) return;
  if (hasAnyInput() && !confirm('入力中の内容は破棄されます。切り替えますか？')) return;
  applyDay(day);
  state.dayOverridden = state.day !== nextDay();
  saveDraft();
  renderRecord();
}

// ---------- ウォーミングアップ（BIG3 の重いセット） ----------
// ---------- インターバルタイマー ----------
const REST_OPTIONS = [60, 75, 90, 120, 150, 180, 240];
const HEAVY_REST = 180;
const COMPOUND_REST = 150;
const ISOLATION_REST = 75;
// 名前で多関節種目を見分ける（フレンチプレスは名前に「プレス」があるが単関節）
const COMPOUND_WORDS = ['プレス', 'ロウ', 'プルダウン', 'スクワット', 'デッド', 'ディップス', '懸垂'];
const ISOLATION_WORDS = ['フレンチプレス'];

function defaultRest(e) {
  if (!e) return ISOLATION_REST;
  if (e.heavyOf) return HEAVY_REST;
  if (ISOLATION_WORDS.some((w) => e.name.includes(w))) return ISOLATION_REST;
  return COMPOUND_WORDS.some((w) => e.name.includes(w)) ? COMPOUND_REST : ISOLATION_REST;
}
function restFor(exId) {
  const e = exById(exId);
  return e?.restSec || defaultRest(e);
}
function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const rest = { tick: null, doneTimer: null, wakeLock: null, audio: null };

// 音は操作（タップ）のときに準備しておかないと鳴らせない
function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!rest.audio) rest.audio = new Ctx();
    if (rest.audio.state === 'suspended') rest.audio.resume();
  } catch (_) { /* 音が使えない環境では無視 */ }
}
function beep() {
  const ctx = rest.audio;
  if (!ctx) return;
  try {
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.25;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch (_) { /* noop */ }
}

// タイマー中は画面が消えないようにする（対応していない端末では何もしない）
async function holdWakeLock() {
  if (rest.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    rest.wakeLock = await navigator.wakeLock.request('screen');
    rest.wakeLock.addEventListener('release', () => { rest.wakeLock = null; });
  } catch (_) { rest.wakeLock = null; }
}
function releaseWakeLock() {
  if (rest.wakeLock) rest.wakeLock.release().catch(() => {});
  rest.wakeLock = null;
}

function startRest(exId, setNo, pair = null) {
  primeAudio();
  const ids = pair || [exId];
  const total = Math.max(...ids.map(restFor));
  const sets = Math.max(...ids.map((id) => targetFor(id).sets));
  if (!state.sessionStart) state.sessionStart = Date.now();
  state.timer = { endAt: Date.now() + total * 1000, total, label: `${ids.map((id) => exName(id)).join(' × ')}\n${setNo}/${sets}セット完了` };
  saveDraft();
  holdWakeLock();
  runRest();
}

function extendRest(sec) {
  if (!state.timer) return;
  state.timer.endAt += sec * 1000;
  state.timer.total += sec;
  saveDraft();
  renderRest();
}

function stopRest() {
  state.timer = null;
  clearInterval(rest.tick);
  rest.tick = null;
  releaseWakeLock();
  saveDraft();
  renderRest();
}

function runRest() {
  clearInterval(rest.tick);
  clearTimeout(rest.doneTimer);
  rest.tick = setInterval(renderRest, 250);
  renderRest();
}

function finishRest() {
  const late = Date.now() - state.timer.endAt;
  clearInterval(rest.tick);
  rest.tick = null;
  state.timer = null;
  saveDraft();
  releaseWakeLock();
  // 画面を見ているときだけ知らせる（裏にいた間に終わった分は、戻ったときに表示だけする）
  if (document.visibilityState === 'visible' && late < 3000) {
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  const box = document.getElementById('rest-timer');
  box.hidden = false;
  box.classList.add('done');
  document.getElementById('rt-label').textContent = '次のセットへ';
  document.getElementById('rt-time').textContent = '休憩終了';
  document.getElementById('rt-fill').style.width = '100%';
  document.getElementById('rt-add').hidden = true;
  document.getElementById('rt-skip').textContent = '閉じる';
  rest.doneTimer = setTimeout(() => renderRest(), 6000);
}

function renderRest() {
  const box = document.getElementById('rest-timer');
  const t = state.timer;
  if (!t) {
    box.hidden = true;
    box.classList.remove('done');
    return;
  }
  const left = (t.endAt - Date.now()) / 1000;
  if (left <= 0) { finishRest(); return; }
  box.hidden = false;
  box.classList.remove('done');
  document.getElementById('rt-label').textContent = t.label;
  document.getElementById('rt-time').textContent = fmtClock(left);
  document.getElementById('rt-fill').style.width = `${Math.min(100, ((t.total - left) / t.total) * 100)}%`;
  document.getElementById('rt-add').hidden = false;
  document.getElementById('rt-skip').textContent = 'スキップ';
  const elapsed = state.sessionStart ? Math.floor((Date.now() - state.sessionStart) / 60000) : null;
  document.getElementById('rt-elapsed').textContent = elapsed != null ? `開始から${elapsed}分` : '';
}

function setupRest() {
  document.getElementById('rt-add').addEventListener('click', () => extendRest(30));
  document.getElementById('rt-skip').addEventListener('click', () => {
    clearTimeout(rest.doneTimer);
    stopRest();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.timer) { holdWakeLock(); runRest(); }
  });
  // 再読み込みのあとは音の準備が消えるので、休憩中に画面をタップしたら準備し直す
  document.addEventListener('pointerdown', () => { if (state.timer) primeAudio(); });
  if (state.timer) { holdWakeLock(); runRest(); }
}

// ---------- 重いセットの推奨重量（推定1RM × 回数ごとの割合） ----------
const HEAVY_PCT = [[1, 0.95], [3, 0.87], [5, 0.80]];
// 1〜5回の割合。表の間は直線で補う（それ以外の回数は対象外）
function heavyPercent(reps) {
  for (let i = 0; i < HEAVY_PCT.length - 1; i++) {
    const [r0, p0] = HEAVY_PCT[i];
    const [r1, p1] = HEAVY_PCT[i + 1];
    if (reps >= r0 && reps <= r1) return p0 + ((p1 - p0) * (reps - r0)) / (r1 - r0);
  }
  return null;
}
// BIG3 の推定1RM（元の種目と重いセットの記録から）から、目標回数の推奨重量を出す
function heavyGuide(mainId, reps) {
  const pct = heavyPercent(reps);
  if (pct == null) return null;
  const e1rmBest = personalBests(liftIds(mainId), state.editingId).e1rm;
  if (e1rmBest == null) return null;
  return { e1rm: e1rmBest, pct, weight: roundTo(e1rmBest * pct, 2.5) };
}

function roundTo(x, step) {
  return Math.round(x / step) * step;
}
// その日の重さから、ウォーミングアップの段階を作る（軽い順、本番の重さ未満だけ）
function warmupSteps(ex, working) {
  const first = ex.heavyOf === 'ex-deadlift'
    ? { weight: Math.max(40, roundTo((working || 0) * 0.4, 2.5)), reps: 8 }
    : { weight: BAR_KG, reps: 10, bar: true };
  if (working == null) return [first];
  const steps = [];
  for (const st of [first, { weight: roundTo(working * 0.65, 2.5), reps: 5 }, { weight: roundTo(working * 0.85, 2.5), reps: 3 }]) {
    const last = steps[steps.length - 1];
    if (st.weight < working && (!last || st.weight > last.weight)) steps.push(st);
  }
  return steps.length ? steps : [first];
}

function renderWarmup(ex, inputs, suggested) {
  const box = el('div', { class: 'warmup' });
  const update = () => {
    const working = toNum(inputs[0]?.weight) ?? suggested;
    const steps = warmupSteps(ex, working);
    const done = new Set(state.warmup[ex.id] || []);
    // null は replaceChildren に渡すと文字として表示されるので除く
    box.replaceChildren(...[
      el('div', { class: 'warmup-head' }, 'ウォーミングアップ', el('span', { class: 'muted small' }, '（記録には残りません）')),
      ...steps.map((st, i) => el('button', {
        type: 'button', class: 'wu-item', role: 'checkbox', 'aria-checked': String(done.has(i)),
        onclick: () => {
          done.has(i) ? done.delete(i) : done.add(i);
          state.warmup[ex.id] = [...done];
          saveDraft();
          update();
        },
      }, el('span', { class: 'wu-box', 'aria-hidden': 'true' }, done.has(i) ? '✓' : ''),
      el('span', { class: 'wu-text' }, `${st.bar ? 'バー（20kg）' : `${fmtNum(st.weight)}kg`} × ${st.reps}回`))),
      working == null ? el('p', { class: 'muted small wu-note' }, '1セット目の重さを入れると、残りの段階が出ます') : null,
    ].filter(Boolean));
  };
  update();
  return { box, update };
}

// 種目の次の重さの提案（前回の結果・組み直し・推定1RMの目安から）
function suggestionFor(exId) {
  const ex = exById(exId);
  const prev = previousRecord(exId);
  const target = targetFor(exId);
  const prevAchieved = prev ? achievedTarget(prev.ex.sets, recTarget(prev.ex)) : false;
  const prevBase = prev ? workingWeight(prev.ex) : null;
  const inc = incrementFor(exId);
  // 重いセットで2回続けて届かなかったら、10%下げて組み直す
  const stalled = !prevAchieved && ex.heavyOf ? stalledWeight(exId) : null;
  const reset = stalled != null ? Math.max(inc, Math.round((stalled * 0.9) / inc) * inc) : null;
  // 重いセットの記録がまだなければ、推定1RMからの推奨重量を使う
  const guide = ex.heavyOf ? heavyGuide(ex.heavyOf, target.reps) : null;
  const suggested = prevBase == null ? (guide ? guide.weight : null) : prevAchieved ? prevBase + inc : reset != null ? reset : prevBase;
  return { prev, target, prevAchieved, inc, reset, guide, suggested };
}

// 種目カードの部品（入力欄・前回・メモなど）を作る。tag はスーパーセットの A / B
function buildExercise(exId, tag = '') {
  const ex = exById(exId);
  const inputs = state.inputs[exId];
  const { prev, target, prevAchieved, inc, reset, guide, suggested } = suggestionFor(exId);
  const guideLine = guide ? el('div', { class: 'guide' },
    `目安：推定1RM ${fmtNum(guide.e1rm)}kg × ${fmtNum(Math.round(guide.pct * 1000) / 10)}% → ${target.reps}回なら ${fmtNum(guide.weight)}kg`) : null;

  const badgeWrap = el('span', { class: 'badge-wrap' });
  const updateBadge = () => {
    const cur = inputs.map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }));
    badgeWrap.replaceChildren(achievedTarget(cur, target) ? el('span', { class: 'badge' }, `✓ 次回+${fmtNum(inc)}kg`) : '');
  };

  let prevBox;
  if (prev) {
    prevBox = el('div', { class: 'prev' },
      el('div', {}, '前回 ', el('span', {}, fmtDate(prev.session.date, false)), '： ', el('strong', {}, setsText(prev.ex))),
      prevAchieved ? el('div', { class: 'hint' }, `前回 同じ重さで${target.sets}セット×${target.reps}回達成 → 今回 +${fmtNum(inc)}kg（${fmtNum(suggested)}kg）`) : null,
      reset != null ? el('div', { class: 'hint warn' }, `2回続けて${target.sets}×${target.reps}に届かなかったので、10%下げて組み直し（${fmtNum(reset)}kg）`) : null,
      guideLine,
      prev.ex.memo ? el('div', { class: 'prev-memo' }, `前回のメモ：${prev.ex.memo}`) : null,
    );
  } else {
    prevBox = el('div', { class: 'prev' }, '前回の記録なし', guideLine);
  }

  // BIG3 の重いセットには、ウォーミングアップのチェックリストを出す（過去の記録の編集中は出さない）
  const warmup = ex.heavyOf && !state.editingId ? renderWarmup(ex, inputs, suggested) : null;

  const withDone = !state.editingId;
  const prevSets = prev ? prev.ex.sets : [];
  const weightInputs = [];
  const rows = inputs.map((set, i) => {
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
    const markDone = () => rIn.classList.toggle('done', (toNum(rIn.value) || 0) >= target.reps);
    markDone();

    wIn.addEventListener('input', () => {
      set.weight = wIn.value.trim();
      updateBadge();
      if (i === 0) warmup?.update();
      saveDraft();
    });
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
    let doneBtn = null;
    if (withDone) {
      const isDone = () => (state.done[exId] || []).includes(i);
      doneBtn = el('button', {
        type: 'button', class: 'set-done', 'aria-pressed': String(isDone()),
        'aria-label': `${ex.name} ${i + 1}セット目を完了にする`,
      }, '✓');
      doneBtn.addEventListener('click', () => {
        const list = new Set(state.done[exId] || []);
        if (list.has(i)) {
          list.delete(i);
          state.done[exId] = [...list];
        } else {
          if (toNum(rIn.value) == null) { toast('回数を入れてから完了にしてください'); rIn.focus(); return; }
          list.add(i);
          state.done[exId] = [...list];
          onSetDone(exId, i);
        }
        doneBtn.setAttribute('aria-pressed', String(list.has(i)));
        saveDraft();
      });
    }
    return { no: i + 1, wIn, rIn, doneBtn };
  });

  const fillBtn = suggested != null ? el('button', {
    type: 'button', class: 'fill-btn',
    onclick: () => {
      inputs.forEach((s, j) => { s.weight = fmtNum(suggested); weightInputs[j].value = s.weight; });
      updateBadge(); warmup?.update(); saveDraft();
    },
  }, `${tag ? `${tag}：` : ''}全セットの重量を ${fmtNum(suggested)}kg にする`) : null;

  const removeBtn = el('button', {
    type: 'button', class: 'icon-btn', 'aria-label': `${ex.name} を今回の記録から外す`,
    onclick: () => {
      const filled = inputs.some((s) => s.reps !== '');
      if (filled && !confirm(`${ex.name} の入力を消して外しますか？`)) return;
      removeFromSession(exId);
      renderRecord();
    },
  }, '✕');

  updateBadge();
  const title = el('div', { class: 'ex-title' },
    tag ? el('span', { class: 'ss-tag' }, tag) : null,
    el('h3', {}, ex.name), el('span', { class: 'part-tag' }, PART_NAME[ex.part]),
    el('span', { class: 'target-tag' }, `目標 ${target.sets}×${target.reps}`));
  return { ex, withDone, title, badgeWrap, removeBtn, prevBox, warmup, rows, fillBtn, memo: renderMemo(ex, tag) };
}

function setsGrid(withDone) {
  return el('div', { class: withDone ? 'sets with-done' : 'sets' },
    el('span', { class: 'col-h' }, ''), el('span', { class: 'col-h' }, '重量 (kg)'), el('span', { class: 'col-h' }, '回数'),
    withDone ? el('span', { class: 'col-h' }, '完了') : null);
}

function renderExerciseCard(exId) {
  const p = buildExercise(exId);
  const grid = setsGrid(p.withDone);
  for (const r of p.rows) grid.append(...[el('span', { class: 'set-no' }, `${r.no}`), r.wIn, r.rIn, r.doneBtn].filter(Boolean));
  return el('div', { class: 'card ex-card' },
    el('div', { class: 'ex-head' }, p.title, el('div', { class: 'ex-tools' }, p.badgeWrap, p.removeBtn)),
    p.prevBox, p.warmup?.box, grid, p.fillBtn, p.memo);
}

// スーパーセット：2種目を1枚のカードにまとめ、セットを交互に並べる
function renderSupersetCard(aId, bId) {
  const parts = [buildExercise(aId, 'A'), buildExercise(bId, 'B')];
  const grid = setsGrid(parts[0].withDone);
  const n = Math.max(...parts.map((p) => p.rows.length));
  for (let i = 0; i < n; i++) {
    parts.forEach((p, k) => {
      const r = p.rows[i];
      if (!r) return;
      grid.append(...[el('span', { class: `set-no ss-no ss-${k ? 'b' : 'a'}` }, `${r.no}${k ? 'B' : 'A'}`), r.wIn, r.rIn, r.doneBtn].filter(Boolean));
    });
  }
  return el('div', { class: 'card ex-card ss-card' },
    el('div', { class: 'ss-head' }, '⛓ スーパーセット', el('span', { class: 'muted small' }, '（AとBを交互に。両方終えたら休憩）')),
    parts.map((p) => el('div', { class: 'ss-ex' },
      el('div', { class: 'ex-head' }, p.title, el('div', { class: 'ex-tools' }, p.badgeWrap, p.removeBtn)),
      p.prevBox)),
    grid,
    parts.map((p) => p.fillBtn),
    parts.map((p) => p.memo));
}

// スーパーセットのペア（今のメニューで、両方とも今回の記録に入っているもの）
function activePairs() {
  const menu = menuById(state.day);
  if (!menu || !Array.isArray(menu.supersets)) return [];
  return menu.supersets.filter(([a, b]) => state.order.includes(a) && state.order.includes(b));
}
function partnerOf(exId) {
  const pair = activePairs().find((p) => p.includes(exId));
  return pair ? { pair, partner: pair[0] === exId ? pair[1] : pair[0] } : null;
}

// セットを完了にしたとき。スーパーセットは、同じセットの A と B が両方終わったら休憩を始める
function onSetDone(exId, i) {
  const ss = partnerOf(exId);
  if (!ss) { startRest(exId, i + 1); return; }
  const partnerSets = (state.inputs[ss.partner] || []).length;
  const partnerDone = i >= partnerSets || (state.done[ss.partner] || []).includes(i);
  if (partnerDone) startRest(exId, i + 1, ss.pair);
}

// 直近2回が同じ重さで、どちらも目標に届いていなければ、その重さ
function stalledWeight(exId) {
  const recs = [];
  for (let i = state.sessions.length - 1; i >= 0 && recs.length < 2; i--) {
    const s = state.sessions[i];
    if (s.id === state.editingId || s.date > state.date) continue;
    const ex = s.exercises.find((e) => e.exerciseId === exId);
    if (ex && validSets(ex).length) recs.push(ex);
  }
  if (recs.length < 2 || recs.some((ex) => achievedTarget(ex.sets, recTarget(ex)))) return null;
  const w = workingWeight(recs[0]);
  return w != null && w === workingWeight(recs[1]) ? w : null;
}

// 種目ごとのメモ（その日の状況を残す。書いてあれば最初から開いておく）
function renderMemo(ex, tag = '') {
  const wrap = el('div', { class: 'memo' });
  const text = state.memos[ex.id] || '';
  const area = el('textarea', {
    class: 'memo-in', rows: '2', maxlength: '500', 'aria-label': `${ex.name} のメモ`,
    placeholder: '気づいたこと（例：85kgは最後まで上げきれない。55kgならきれいに上がる）',
  });
  area.value = text;
  area.addEventListener('input', () => {
    state.memos[ex.id] = area.value;
    saveDraft();
  });
  const open = () => {
    wrap.replaceChildren(area);
    area.focus();
  };
  if (text) wrap.append(area);
  else wrap.append(el('button', { type: 'button', class: 'memo-btn', onclick: open }, tag ? `＋ ${tag}（${ex.name}）のメモ` : '＋ メモ'));
  return wrap;
}

function addToSession(exId) {
  if (state.order.includes(exId)) return;
  state.order.push(exId);
  state.inputs[exId] = emptySets(exId);
  saveDraft();
  renderRecord();
  // 追加したカードまでスクロール
  const cards = document.querySelectorAll('#exercise-list .ex-card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 回数が空のセット（メモだけ書いた種目は、意図して記録していないので除く）
function missingSets() {
  const lines = [];
  let count = 0;
  for (const id of state.order) {
    const inputs = state.inputs[id] || [];
    const blank = inputs.map((s, i) => (toNum(s.reps) == null ? i + 1 : null)).filter(Boolean);
    if (!blank.length) continue;
    const anyReps = blank.length < inputs.length;
    if (!anyReps && (state.memos[id] || '').trim()) continue;
    count += blank.length;
    lines.push(anyReps ? `${exName(id)}：${blank.join('・')}セット目` : `${exName(id)}：未入力（${inputs.length}セット）`);
  }
  return { count, lines };
}

function confirmMissing(missing) {
  const dlg = document.getElementById('missing-dialog');
  document.getElementById('missing-title').textContent = `未記録のセットが${missing.count}件あります`;
  document.getElementById('missing-list').replaceChildren(...missing.lines.map((t) => el('li', {}, t)));
  return new Promise((resolve) => {
    let answer = false;
    const back = document.getElementById('missing-back');
    const go = document.getElementById('missing-save');
    const onBack = () => { answer = false; dlg.close(); };
    const onGo = () => { answer = true; dlg.close(); };
    back.addEventListener('click', onBack);
    go.addEventListener('click', onGo);
    dlg.addEventListener('close', () => {
      back.removeEventListener('click', onBack);
      go.removeEventListener('click', onGo);
      resolve(answer);
    }, { once: true });
    dlg.showModal();
  });
}

async function saveSession() {
  const exercises = [];
  for (const id of state.order) {
    const name = exName(id);
    const sets = state.inputs[id].map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }));
    const invalid = state.inputs[id].some((s, i) =>
      (s.weight !== '' && sets[i].weight == null) || (s.reps !== '' && sets[i].reps == null));
    if (invalid) { toast(`${name}：数値を正しく入力してください`); return; }
    const memo = (state.memos[id] || '').trim();
    if (sets.some((s) => s.reps != null && s.reps > 0) || memo) {
      exercises.push({
        exerciseId: id, name, target: targetFor(id), sets: sets.map((s) => (s.reps ? s : { weight: s.weight, reps: null })),
        ...(memo ? { memo } : {}),
      });
    }
  }
  const cardio = cardioFromInput();
  if (cardio === false) { toast('有酸素：数値を正しく入力してください'); return; }
  if (!exercises.length && !cardio) { toast('回数・メモ・有酸素のどれかを入力してください'); return; }
  if (!state.date) { toast('日付を入力してください'); return; }
  // 有酸素だけの日は、筋トレの未記録を確認しない
  const missing = exercises.length ? missingSets() : { count: 0 };
  if (missing.count && !(await confirmMissing(missing))) return;

  const now = Date.now();
  const existing = state.editingId && state.sessions.find((s) => s.id === state.editingId);
  const session = {
    id: existing ? existing.id : genId(),
    date: state.date,
    day: state.day,
    dayName: existing && state.day === existing.day ? (existing.dayName || sessionDayLabel(existing)) : dayLabel(state.day),
    exercises,
    ...(cardio ? { cardio } : {}),
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
  const achieved = exercises.filter((e) => achievedTarget(e.sets, e.target)).map((e) => `${e.name} +${fmtNum(incrementFor(e.exerciseId))}kg`);
  const prs = sessionPRs(session);
  resetRecordForm();
  stopRest();
  renderAll();
  window.scrollTo({ top: 0 });
  toast(achieved.length ? `保存しました。次回アップ：${achieved.join('・')}` : '保存しました');
  if (prs.length) showPRDialog(prs);
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
  state.memos = {};
  state.cardio = emptyCardio();
  for (const [k] of CARDIO_FIELDS) if (s.cardio && s.cardio[k] != null) state.cardio[k] = fmtNum(s.cardio[k]);
  for (const ex of s.exercises) {
    if (!exById(ex.exerciseId) || state.order.includes(ex.exerciseId)) continue;
    state.order.push(ex.exerciseId);
    if (ex.memo) state.memos[ex.exerciseId] = ex.memo;
    state.inputs[ex.exerciseId] = Array.from({ length: Math.max(targetFor(ex.exerciseId).sets, ex.sets.length) }, (_, i) => {
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
const exDialog = { resolve: null, editing: null, part: 'chest', increment: null, sets: SET_COUNT, reps: TARGET_REPS };

function openExerciseDialog({ exercise = null, part = 'chest' } = {}) {
  exDialog.editing = exercise;
  exDialog.part = exercise ? exercise.part : part;
  // null のあいだは部位の初期値に従う
  exDialog.increment = exercise?.increment || null;
  exDialog.sets = exercise?.sets || SET_COUNT;
  exDialog.reps = exercise?.reps || TARGET_REPS;
  // null のあいだは種目の種類から決まる初期値に従う
  exDialog.rest = exercise?.restSec || null;
  document.getElementById('exercise-dialog-title').textContent = exercise ? '種目を編集' : '種目を追加';
  const nameIn = document.getElementById('exercise-name');
  nameIn.value = exercise ? exercise.name : '';
  document.getElementById('exercise-error').hidden = true;
  renderExercisePartChips();
  renderTargetChips();
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
  renderIncrementChips();
}

function dialogIncrement() {
  return exDialog.increment || DEFAULT_INCREMENT[exDialog.part] || 2.5;
}

function renderTargetChips() {
  const chips = (id, options, key, unit) => document.getElementById(id).replaceChildren(...options.map((n) => el('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(n === exDialog[key]),
    onclick: () => { exDialog[key] = n; renderTargetChips(); },
  }, `${n}${unit}`)));
  chips('exercise-sets', SET_OPTIONS, 'sets', 'セット');
  chips('exercise-reps', REP_OPTIONS, 'reps', '回');
  document.getElementById('exercise-increment-label').textContent = `${exDialog.sets}セット×${exDialog.reps}回できたら増やす重さ`;
  const restNow = dialogRest();
  document.getElementById('exercise-rest').replaceChildren(...REST_OPTIONS.map((n) => el('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(n === restNow),
    onclick: () => { exDialog.rest = n; renderTargetChips(); },
  }, `${n}秒`)));
}

function dialogRest() {
  if (exDialog.rest) return exDialog.rest;
  const name = document.getElementById('exercise-name').value.trim();
  return defaultRest({ ...(exDialog.editing || {}), name });
}

function renderIncrementChips() {
  const wrap = document.getElementById('exercise-increment');
  const current = dialogIncrement();
  wrap.replaceChildren(...INCREMENT_OPTIONS.map((n) => el('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(n === current),
    onclick: () => { exDialog.increment = n; renderIncrementChips(); },
  }, `${fmtNum(n)}kg`)));
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
    saved = { ...exDialog.editing, name, part: exDialog.part, increment: dialogIncrement(), sets: exDialog.sets, reps: exDialog.reps, restSec: dialogRest() };
  } else if (dup) {
    // 削除済みの同名種目は復活させる（過去の記録とつながる）
    saved = { ...dup, part: exDialog.part, increment: dialogIncrement(), sets: exDialog.sets, reps: exDialog.reps, restSec: dialogRest(), archived: false };
  } else {
    const maxOrder = state.exercises.reduce((m, e) => Math.max(m, e.order || 0), 0);
    saved = { id: genId('ex-'), name, part: exDialog.part, increment: dialogIncrement(), sets: exDialog.sets, reps: exDialog.reps, restSec: dialogRest(), order: maxOrder + 1, archived: false };
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
// スーパーセットのペアを整える（両方がメニューにあり、隣り合っているものだけ残し、並び順に揃える）
function cleanPairs(menu) {
  if (!Array.isArray(menu.supersets)) return menu;
  const ids = menu.exerciseIds;
  const used = new Set();
  const supersets = [];
  for (const [a, b] of menu.supersets) {
    const ia = ids.indexOf(a);
    const ib = ids.indexOf(b);
    if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1 || used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b);
    supersets.push(ia < ib ? [a, b] : [b, a]);
  }
  return { ...menu, supersets };
}
function isPaired(menu, a, b) {
  return (menu.supersets || []).some((p) => p.includes(a) && p.includes(b));
}
function togglePair(menu, a, b) {
  const rest = (menu.supersets || []).filter((p) => !p.includes(a) && !p.includes(b));
  return updateMenu(menu.id, { supersets: isPaired(menu, a, b) ? rest : [...rest, [a, b]] });
}

async function setMenus(menus, changedId) {
  menus = menus.map(cleanPairs);
  state.menus = menus;
  await saveMenus();
  afterMenuChange(changedId);
}
function updateMenu(id, patch) {
  return setMenus(state.menus.map((m) => (m.id === id ? { ...m, ...patch } : m)), id);
}

async function addMenu() {
  const name = (prompt('新しいメニューの名前（例：胸の日）') || '').trim();
  if (!name) return;
  const menu = { id: genId('m-'), name, exerciseIds: [] };
  await setMenus([...state.menus, menu], menu.id);
  toast(`「${name}」を追加しました。種目を追加してください`);
}

async function renameMenu(m) {
  const name = (prompt('メニューの名前', m.name) || '').trim();
  if (!name || name === m.name) return;
  await updateMenu(m.id, { name });
}

async function deleteMenu(m) {
  if (!confirm(`メニュー「${m.name}」を削除しますか？\n過去の記録は残ります。`)) return;
  await setMenus(state.menus.filter((x) => x.id !== m.id), m.id);
  toast('削除しました');
}

function moveMenu(i, d) {
  const arr = [...state.menus];
  [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
  return setMenus(arr, null);
}

function renderMenu() {
  const tpl = document.getElementById('template-cards');
  const cards = state.menus.map((m, mi) => {
    const ids = menuExerciseIds(m.id);
    const move = (i, d) => {
      const arr = [...ids];
      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
      return updateMenu(m.id, { exerciseIds: arr });
    };
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, m.name, el('span', { class: 'muted small' }, `　${ids.length}種目`)),
        el('button', {
          type: 'button', class: 'text-btn',
          onclick: () => openPicker({
            title: `${m.name}に種目を追加`, excluded: new Set(ids),
            onPick: async (id) => {
              await updateMenu(m.id, { exerciseIds: [...menuExerciseIds(m.id), id] });
              toast(`${m.name}に「${exName(id)}」を追加しました`);
            },
          }),
        }, '＋ 種目')),
      ids.length ? el('ul', { class: 'row-list' }, ids.map((id, i) => el('li', {
        class: `row${(m.supersets || []).some((pp) => pp.includes(id)) ? ' paired' : ''}`,
      },
        el('span', { class: 'row-name' }, exName(id), el('span', { class: 'part-tag' }, PART_NAME[exById(id).part])),
        i < ids.length - 1 ? el('button', {
          type: 'button', class: 'icon-btn pair-btn', 'aria-pressed': String(isPaired(m, id, ids[i + 1])),
          'aria-label': `${exName(id)} と ${exName(ids[i + 1])} をスーパーセットにする`,
          title: 'すぐ下の種目とスーパーセット',
          onclick: () => togglePair(m, id, ids[i + 1]),
        }, '⛓') : el('span', { class: 'pair-spacer' }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '上へ', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '下へ', disabled: i === ids.length - 1, onclick: () => move(i, 1) }, '↓'),
        el('button', {
          type: 'button', class: 'icon-btn', 'aria-label': `${exName(id)} を${m.name}から外す`,
          onclick: () => updateMenu(m.id, { exerciseIds: ids.filter((x) => x !== id) }),
        }, '✕'))))
        : el('p', { class: 'muted small row-empty' }, '種目がありません'),
      el('div', { class: 'menu-actions' },
        el('button', { type: 'button', class: 'small-btn', onclick: () => renameMenu(m) }, '名前を変更'),
        el('button', { type: 'button', class: 'small-btn', 'aria-label': `${m.name}の順番を上へ`, disabled: mi === 0, onclick: () => moveMenu(mi, -1) }, '↑'),
        el('button', { type: 'button', class: 'small-btn', 'aria-label': `${m.name}の順番を下へ`, disabled: mi === state.menus.length - 1, onclick: () => moveMenu(mi, 1) }, '↓'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteMenu(m) }, '削除')));
  });
  tpl.replaceChildren(
    el('p', { class: 'muted small menu-note' }, '次のメニューは「一番長くやっていないもの」を自動で選びます（順番どおりに続ければ、この並び順に回ります）。'),
    ...cards,
    el('button', { type: 'button', class: 'add-btn', onclick: addMenu }, '＋ メニューを追加'));

  const cat = document.getElementById('catalog-cards');
  cat.replaceChildren(...visibleParts().map((p) => {
    const items = activeExercises(p.id);
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, p.name, el('span', { class: 'muted small' }, `　${items.length}種目`)),
        el('button', { type: 'button', class: 'text-btn', onclick: () => openExerciseDialog({ part: p.id }) }, '＋ 追加')),
      items.length ? el('ul', { class: 'row-list' }, items.map((e) => el('li', { class: 'row' },
        el('span', { class: 'row-name' }, e.name, el('span', { class: 'muted small' }, `${targetText(e.id)}・+${fmtNum(incrementFor(e.id))}kg・休憩${restFor(e.id)}秒`)),
        el('button', { type: 'button', class: 'small-btn', onclick: () => openExerciseDialog({ exercise: e }) }, '編集'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteExercise(e) }, '削除'))))
        : el('p', { class: 'muted small row-empty' }, '種目がありません'));
  }));
}

// メニューを変えたら、未入力の記録画面にも反映する
function afterMenuChange(menuId) {
  if (!state.editingId && !hasAnyInput()) {
    if (!menuById(state.day) && state.day !== FREE_DAY) {
      state.dayOverridden = false;
      applyDay(nextDay());
    } else if (state.day === menuId) {
      applyDay(menuId);
    }
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
  if (state.menus.some((m) => m.exerciseIds.includes(e.id))) {
    state.menus = state.menus.map((m) => ({ ...m, exerciseIds: m.exerciseIds.filter((x) => x !== e.id) }));
    await saveMenus();
  }
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
      el('div', {}, el('span', { class: 'hist-date' }, fmtDate(s.date)), el('span', { class: 'day-tag' }, sessionDayLabel(s))),
      el('div', { class: 'hist-actions' },
        el('button', { type: 'button', class: 'small-btn', onclick: () => copyText(sessionText(s)) }, 'コピー'),
        el('button', { type: 'button', class: 'small-btn', onclick: () => startEdit(s.id) }, '編集'),
        el('button', { type: 'button', class: 'small-btn danger', onclick: () => deleteSession(s) }, '削除'))),
    s.exercises.flatMap((ex) => [el('div', { class: 'hist-ex' },
      el('span', { class: 'name' }, exName(ex.exerciseId, ex.name)),
      el('span', { class: 'sets-txt' }, setsText(ex), achievedTarget(ex.sets, recTarget(ex)) ? ' ✓' : '')),
    ex.memo ? el('div', { class: 'hist-memo' }, `📝 ${ex.memo}`) : null]),
    s.cardio ? el('div', { class: 'hist-ex' }, el('span', { class: 'name' }, '🏃 有酸素'), el('span', { class: 'sets-txt' }, cardioText(s.cardio))) : null,
  )));
}

async function deleteSession(s) {
  if (!confirm(`${fmtDate(s.date)} の${sessionDayLabel(s)}の記録を削除しますか？`)) return;
  await DB.remove('sessions', s.id);
  await reloadData();
  if (state.editingId === s.id) resetRecordForm();
  else if (!state.dayOverridden && !state.editingId && !hasAnyInput()) applyDay(nextDay());
  renderAll();
  toast('削除しました');
}

// ---------- 自己ベスト ----------
const E1RM_MAX_REPS = 12; // 13回以上のセットは推定の誤差が大きいので、推定MAXに使わない
const BIG3_LIFTS = [
  ['squat', 'スクワット'],
  ['bench', 'ベンチプレス'],
  ['deadlift', 'デッドリフト'],
];
const DEFAULT_BIG3 = { squat: 'ex-squat', bench: 'ex-bench', deadlift: 'ex-deadlift', goal: 300 };

function roundHalf(x) {
  return Math.round(x * 2) / 2;
}
// 推定MAX（Epley式）：重さ ×（1 + 回数 / 30）。1回ならその重さ
function e1rm(weight, reps) {
  return reps === 1 ? weight : roundHalf(weight * (1 + reps / 30));
}
function bestE1RM(ex) {
  let best = null;
  for (const s of validSets(ex)) {
    if (!s.weight || s.reps > E1RM_MAX_REPS) continue;
    const v = e1rm(s.weight, s.reps);
    if (best == null || v > best) best = v;
  }
  return best;
}

// 種目の自己ベスト（excludeId の記録は含めない）。exIds に複数渡すとまとめて計算する
function personalBests(exIds, excludeId) {
  const ids = new Set([].concat(exIds));
  const pb = { weight: null, weightDate: null, e1rm: null, e1rmDate: null, repsAt: new Map() };
  for (const s of state.sessions) {
    if (s.id === excludeId) continue;
    for (const ex of s.exercises) {
      if (!ids.has(ex.exerciseId)) continue;
      for (const set of validSets(ex)) {
        if (set.weight == null) continue;
        if (pb.weight == null || set.weight > pb.weight) { pb.weight = set.weight; pb.weightDate = s.date; }
        if (set.reps > (pb.repsAt.get(set.weight) || 0)) pb.repsAt.set(set.weight, set.reps);
        if (set.weight > 0 && set.reps <= E1RM_MAX_REPS) {
          const v = e1rm(set.weight, set.reps);
          if (pb.e1rm == null || v > pb.e1rm) { pb.e1rm = v; pb.e1rmDate = s.date; }
        }
      }
    }
  }
  return pb;
}

// BIG3 の種目と、その重いセットの種目
function liftIds(exId) {
  return [exId, ...state.exercises.filter((e) => e.heavyOf === exId).map((e) => e.id)];
}

// 保存した記録で更新した自己ベスト。初めての種目は対象外
function sessionPRs(session) {
  const result = [];
  for (const ex of session.exercises) {
    const before = personalBests(ex.exerciseId, session.id);
    if (before.weight == null) continue;
    const items = [];
    const top = topWeight(ex);
    if (top != null && top > before.weight) items.push(`最高重量 ${fmtNum(top)}kg（+${fmtNum(top - before.weight)}kg）`);
    const best = bestE1RM(ex);
    if (best != null && before.e1rm != null && best > before.e1rm) items.push(`推定MAX ${fmtNum(best)}kg（+${fmtNum(best - before.e1rm)}kg）`);
    if (!items.length) {
      // 同じ重さでの回数の更新（一番重いもの）
      let rep = null;
      for (const set of validSets(ex)) {
        if (set.weight == null) continue;
        const prev = before.repsAt.get(set.weight);
        if (prev != null && set.reps > prev && (!rep || set.weight > rep.weight)) rep = { weight: set.weight, reps: set.reps, prev };
      }
      if (rep) items.push(`${fmtNum(rep.weight)}kg × ${rep.reps}回（前は${rep.prev}回）`);
    }
    if (items.length) result.push({ name: exName(ex.exerciseId, ex.name), items });
  }
  return result;
}

function showPRDialog(prs) {
  document.getElementById('pr-list').replaceChildren(...prs.map((p) => el('div', { class: 'pr-item' },
    el('div', { class: 'pr-name' }, p.name),
    p.items.map((t) => el('div', { class: 'pr-line' }, t)))));
  document.getElementById('pr-dialog').showModal();
}

function big3Stats() {
  return BIG3_LIFTS.map(([key, label]) => {
    const exId = state.big3[key];
    const pb = exId && exById(exId) ? personalBests(liftIds(exId), null) : null;
    return { key, label, exId, name: exId && exById(exId) ? exName(exId) : null, e1rm: pb?.e1rm ?? null, weight: pb?.weight ?? null };
  });
}

function renderBig3() {
  const stats = big3Stats();
  const total = stats.reduce((t, s) => t + (s.e1rm || 0), 0);
  const goal = state.big3.goal || 0;
  const pct = goal ? Math.min(100, (total / goal) * 100) : 0;
  const missing = stats.filter((s) => s.e1rm == null).map((s) => s.label);
  // null は replaceChildren に渡すと文字として表示されるので除く
  document.getElementById('big3-body').replaceChildren(...[
    ...stats.map((s) => el('div', { class: 'big3-row' },
      el('div', {},
        el('div', { class: 'big3-label' }, s.label),
        el('div', { class: 'muted small' }, s.name ? (s.name !== s.label ? s.name : '') : '種目が未設定')),
      el('div', { class: 'big3-val' },
        el('div', { class: 'big3-num' }, s.e1rm != null ? `${fmtNum(s.e1rm)}kg` : '—'),
        el('div', { class: 'muted small' }, s.weight != null ? `最高 ${fmtNum(s.weight)}kg` : '記録なし')))),
    el('div', { class: 'big3-total' },
      el('span', {}, '合計（推定MAX）'),
      el('span', { class: 'big3-num' }, `${fmtNum(total)}kg`)),
    goal ? el('div', {
      class: 'meter', role: 'progressbar', 'aria-label': 'BIG3の目標までの進み具合',
      'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(total),
    }, el('div', { class: 'meter-fill', style: `width:${pct}%` })) : null,
    el('div', { class: 'big3-goal small' },
      goal ? (total >= goal ? `🎉 目標 ${fmtNum(goal)}kg 達成！` : `目標 ${fmtNum(goal)}kg まで あと ${fmtNum(goal - total)}kg`) : '目標は未設定です'),
    missing.length ? el('p', { class: 'muted small big3-note' }, `${missing.join('・')}はまだ記録がありません（${E1RM_MAX_REPS}回以下のセットから計算します）`) : null,
  ].filter(Boolean));
}

function renderPRTable() {
  const tbody = document.querySelector('#pr-table tbody');
  const rows = [];
  for (const p of PARTS) {
    const items = state.exercises
      .filter((e) => e.part === p.id)
      .map((e) => ({ e, pb: personalBests(e.id, null) }))
      .filter((x) => x.pb.weight != null)
      .sort((a, b) => a.e.order - b.e.order);
    if (!items.length) continue;
    rows.push(el('tr', { class: 'group-row' }, el('td', { colspan: '3' }, p.name)));
    for (const { e, pb } of items) {
      rows.push(el('tr', {
        class: 'pr-row', tabindex: '0',
        onclick: () => {
          state.chartExercise = e.id;
          document.getElementById('chart-exercise').value = e.id;
          renderChart();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      el('td', {}, e.name),
      el('td', { class: 'num' }, `${fmtNum(pb.weight)}kg`, el('div', { class: 'muted small' }, fmtDate(pb.weightDate, false))),
      el('td', { class: 'num' }, pb.e1rm != null ? `${fmtNum(pb.e1rm)}kg` : '—', pb.e1rm != null ? el('div', { class: 'muted small' }, fmtDate(pb.e1rmDate, false)) : null)));
    }
  }
  document.getElementById('pr-empty').hidden = rows.length > 0;
  tbody.replaceChildren(...rows);
}

function renderStats() {
  renderBig3();
  renderPRTable();
}

async function saveBig3(big3) {
  state.big3 = big3;
  await DB.put('meta', { key: 'big3', ...big3 });
}

function openBig3Dialog() {
  const withData = new Set();
  state.sessions.forEach((s) => s.exercises.forEach((e) => withData.add(e.exerciseId)));
  for (const [key] of BIG3_LIFTS) {
    const sel = document.getElementById(`big3-${key}`);
    const groups = PARTS.map((p) => {
      const items = state.exercises
        .filter((e) => e.part === p.id && (!e.archived || withData.has(e.id)))
        .sort((a, b) => a.order - b.order);
      return items.length ? el('optgroup', { label: p.name }, items.map((e) => el('option', { value: e.id }, e.name))) : null;
    }).filter(Boolean);
    sel.replaceChildren(el('option', { value: '' }, '（使わない）'), ...groups);
    sel.value = exById(state.big3[key]) ? state.big3[key] : '';
  }
  document.getElementById('big3-goal').value = state.big3.goal ? fmtNum(state.big3.goal) : '';
  document.getElementById('big3-dialog').showModal();
}

function setupStats() {
  document.getElementById('big3-edit').addEventListener('click', openBig3Dialog);
  document.getElementById('big3-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const goal = toNum(document.getElementById('big3-goal').value);
    const big3 = { goal: goal || 0 };
    for (const [key] of BIG3_LIFTS) big3[key] = document.getElementById(`big3-${key}`).value || null;
    await saveBig3(big3);
    document.getElementById('big3-dialog').close();
    renderStats();
    toast('BIG3の設定を保存しました');
  });
}

// ---------- グラフ ----------
const METRICS = {
  top: { label: '最大重量', short: '最大', value: topWeight },
  e1rm: { label: '推定MAX', short: '推定', value: bestE1RM },
  volume: { label: '総挙上量', short: '総量', value: volume },
};

function chartPoints() {
  const id = state.chartExercise;
  const pts = [];
  for (const s of state.sessions) {
    const ex = s.exercises.find((e) => e.exerciseId === id);
    if (!ex || !validSets(ex).length) continue;
    const v = METRICS[state.chartMetric].value(ex);
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
  const metricLabel = METRICS[state.chartMetric].label;
  document.getElementById('chart-title').textContent = `${exName(state.chartExercise, '')}：${metricLabel}（${unit}）`;
  document.getElementById('chart-table-metric').textContent = METRICS[state.chartMetric].short;
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
    el('td', {}, setsText(p.ex), achievedTarget(p.ex.sets, recTarget(p.ex)) ? ' ✓' : '',
      p.ex.memo ? el('div', { class: 'muted small' }, `📝 ${p.ex.memo}`) : null),
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
    version: 3,
    exportedAt: new Date().toISOString(),
    exercises: state.exercises,
    menus: state.menus,
    big3: state.big3,
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
  if (typeof raw.day !== 'string' || !raw.day) return null;
  if (!Array.isArray(raw.exercises)) return null;
  const exercises = raw.exercises
    .filter((e) => e && (typeof e.name === 'string' || typeof e.exerciseId === 'string') && Array.isArray(e.sets))
    .map((e) => ({
      exerciseId: typeof e.exerciseId === 'string' ? e.exerciseId : null,
      name: typeof e.name === 'string' ? e.name : '',
      ...(typeof e.memo === 'string' && e.memo.trim() ? { memo: e.memo.trim().slice(0, 500) } : {}),
      ...(e.target && Number(e.target.sets) > 0 && Number(e.target.reps) > 0
        ? { target: { sets: Number(e.target.sets), reps: Number(e.target.reps) } } : {}),
      sets: e.sets.slice(0, MAX_SETS).map((s) => ({
        weight: s && s.weight != null && Number.isFinite(Number(s.weight)) ? Number(s.weight) : null,
        reps: s && s.reps != null && Number.isFinite(Number(s.reps)) ? Number(s.reps) : null,
      })),
    }));
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(),
    date: raw.date,
    day: raw.day,
    ...(typeof raw.dayName === 'string' && raw.dayName ? { dayName: raw.dayName } : {}),
    exercises,
    ...normalizeCardio(raw.cardio),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function normalizeCardio(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const cardio = {};
  for (const [k] of CARDIO_FIELDS) {
    const n = Number(raw[k]);
    if (raw[k] != null && Number.isFinite(n) && n >= 0) cardio[k] = n;
  }
  return Object.keys(cardio).length ? { cardio } : {};
}

function normalizeExercise(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: raw.id,
    name: raw.name.trim(),
    part: PART_NAME[raw.part] ? raw.part : 'other',
    order: Number(raw.order) || 0,
    archived: !!raw.archived,
    ...(Number(raw.increment) > 0 ? { increment: Number(raw.increment) } : {}),
    ...(Number(raw.sets) >= 1 && Number(raw.sets) <= MAX_SETS ? { sets: Number(raw.sets) } : {}),
    ...(Number(raw.reps) >= 1 ? { reps: Number(raw.reps) } : {}),
    ...(typeof raw.heavyOf === 'string' ? { heavyOf: raw.heavyOf } : {}),
    ...(Number(raw.restSec) > 0 ? { restSec: Number(raw.restSec) } : {}),
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
  // 旧形式（A日/B日）のメニューは取り込まず、今のメニューを残す
  const importedMenus = Array.isArray(data.menus)
    ? data.menus
      .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string' && m.name.trim())
      .map((m) => cleanPairs({
        id: m.id,
        name: m.name.trim(),
        exerciseIds: (Array.isArray(m.exerciseIds) ? m.exerciseIds : []).filter((x) => typeof x === 'string'),
        supersets: (Array.isArray(m.supersets) ? m.supersets : []).filter((pp) => Array.isArray(pp) && pp.length === 2 && pp.every((x) => typeof x === 'string')),
      }))
    : null;
  const b = data.big3;
  const importedBig3 = b && typeof b === 'object' ? {
    goal: Number(b.goal) > 0 ? Number(b.goal) : 0,
    ...Object.fromEntries(BIG3_LIFTS.map(([key]) => [key, typeof b[key] === 'string' ? b[key] : null])),
  } : null;
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
    (importedMenus ? '\nメニューもファイルの内容に置き換わります。' : '') +
    '\nよろしいですか？';
  if (!confirm(msg)) return;

  await DB.run(['sessions', 'exercises', 'meta'], 'readwrite', (s) => {
    [...importedExercises, ...added].forEach((e) => s.exercises.put(e));
    sessions.forEach((x) => s.sessions.put(x));
    if (importedMenus) s.meta.put({ key: 'config', menus: importedMenus });
    if (importedBig3) s.meta.put({ key: 'big3', ...importedBig3 });
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
  const lines = [`【${fmtDate(s.date)} ${sessionDayLabel(s)}】`];
  for (const ex of s.exercises) {
    if (!validSets(ex).length && !ex.memo) continue;
    lines.push(`${exName(ex.exerciseId, ex.name)}：${setsText(ex)}${achievedTarget(ex.sets, recTarget(ex)) ? ` ✓（次回+${fmtNum(incrementFor(ex.exerciseId))}kg）` : ''}`);
    if (ex.memo) lines.push(`　メモ：${ex.memo.replace(/\s*\n\s*/g, ' ／ ')}`);
  }
  if (s.cardio) lines.push(`有酸素：${cardioText(s.cardio)}`);
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
const TITLES = { record: '記録', chart: 'グラフ・自己ベスト', history: '履歴', menu: '種目・メニュー', settings: 'データ' };
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
  if (view === 'chart') { renderStats(); renderChart(); }
  window.scrollTo({ top: 0 });
}

function renderAll() {
  renderRecord();
  renderHistory();
  renderMenu();
  renderSettings();
  renderChartSelect();
  if (isActive('chart')) { renderStats(); renderChart(); }
}

async function reloadData() {
  const [sessions, exercises, config, big3] = await Promise.all([
    DB.getAll('sessions'), DB.getAll('exercises'), DB.get('meta', 'config'), DB.get('meta', 'big3'),
  ]);
  state.sessions = sortSessions(sessions);
  state.exercises = exercises;
  state.menus = Array.isArray(config?.menus) ? config.menus : [];
  const { key, ...savedBig3 } = big3 || {};
  state.big3 = { ...DEFAULT_BIG3, ...savedBig3 };
}

function setupRecordControls() {
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
  setupStats();
  setupCardio();
  setupDialogs();

  try {
    await ensureCatalog();
    await ensureHeavySetup();
    await ensureSupersetSetup();
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
  setupRest();

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
