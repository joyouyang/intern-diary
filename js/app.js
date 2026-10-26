import * as db from './db.js';
import {
  todayStr, dateStr, parseDate, addDays, daysBetween, weekdayCN, fmtCN, fmtH, pad,
  escapeHtml, uid, debounce, store, toast, downloadBlob, copyText, fmtMin, CAT_COLORS,
} from './util.js';
import { computeStreak, MILESTONES } from './streak.js';
import { THEMES, renderPoster } from './poster.js';
import * as exporter from './export.js';
import * as ai from './ai.js';
import * as plaza from './plaza.js';
import { chime, splash } from './sound.js';
import { buildICS, startReminderLoop } from './reminder.js';

const DEFAULT_SETTINGS = {
  reminderTime: '21:00',
  skipWeekends: true,
  posterTheme: 'plain',
  posterShowCompany: false,
  boatShowCompany: true,
};
// Choices offered when a to-do is ticked off: [minutes, label].
const DURATIONS = [[15, '15 分钟'], [30, '30 分钟'], [45, '45 分钟'], [60, '1 小时'], [90, '1.5 小时'], [120, '2 小时'], [180, '3 小时'], [240, '半天']];

const state = {
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  entries: new Map(),
  view: 'todo',
  date: todayStr(),
  followToday: true,
  exp: { range: 'week', from: '', to: '', lang: 'zh', images: true, todos: true },
  li: { lang: 'en', mentionCompany: false, text: '' },
  plaza: { loaded: false, loading: false, error: '', stats: null, mine: [], caught: [], inbox: [] },
};
const imageCache = new Map();

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const svg = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
// iOS-style line icons.
const ICON = {
  left: svg('<path d="m15 18-6-6 6-6"/>'),
  right: svg('<path d="m9 18 6-6-6-6"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.4),
  check: svg('<path d="m6 12.5 4 4 8-9"/>', 3),
  boat: svg('<path d="M2.5 14.5h19l-3.2 4.5H5.7z"/><path d="M7 14.5 12 4.5l5 10"/><path d="M12 4.5v10"/>', 1.8),
  export: svg('<path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>', 1.8),
};
// Paper boats on a calm sea, for the top of the plaza.
const SEA_ART = `<svg viewBox="0 0 400 140" preserveAspectRatio="xMidYMid slice">
  <circle cx="330" cy="38" r="20" fill="#fff" opacity=".55"/>
  <path d="M0 92c40-10 80-10 120 0s80 10 120 0 80-10 120 0 40 6 40 6v42H0z" fill="#fff" opacity=".35"/>
  <path d="M0 108c40-8 80-8 120 0s80 8 120 0 80-8 120 0 40 4 40 4v28H0z" fill="#fff" opacity=".5"/>
  <g fill="#fff"><path d="M118 86h44l-7 9h-30z"/><path d="M128 86 140 64l12 22z" opacity=".85"/></g>
  <g fill="#fff" opacity=".9"><path d="M250 98h30l-5 6h-20z"/><path d="M257 98l8-15 8 15z" opacity=".85"/></g>
</svg>`;

/* ---------- Data helpers ---------- */

const blankEntry = date => ({ date, text: '', images: [], todos: [], time: {}, createdAt: null, updatedAt: null });
const entryOf = date => state.entries.get(date) || blankEntry(date);
function ensureEntry(date) {
  if (!state.entries.has(date)) state.entries.set(date, blankEntry(date));
  return state.entries.get(date);
}
const isWritten = e => !!(e && e.text && e.text.trim());
const legacyHours = time => Object.values(time || {}).reduce((a, b) => a + b, 0);
const hasContent = e => !!e && (isWritten(e) || e.todos.length > 0 || legacyHours(e.time) > 0 || e.images.length > 0);
const writtenSet = () => new Set([...state.entries.values()].filter(isWritten).map(e => e.date));
const streak = asOf => computeStreak(writtenSet(), state.settings, asOf);
const dayNumber = date => (state.profile?.startDate ? daysBetween(state.profile.startDate, date) + 1 : 0);
const spentMinutes = e => e.todos.reduce((s, t) => s + (t.done && t.minutes ? t.minutes : 0), 0);
const shortDate = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

function relTime(iso) {
  const t = new Date(iso);
  const mins = (Date.now() - t) / 60000;
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${Math.floor(mins)} 分钟前`;
  if (mins < 1440) return `${Math.floor(mins / 60)} 小时前`;
  if (dateStr(t) === addDays(todayStr(), -1)) return '昨天';
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

async function persist(entry) {
  entry.updatedAt = Date.now();
  state.entries.set(entry.date, entry);
  await db.putEntry(entry);
}
const saveSettings = () => db.setKV('settings', state.settings);

async function loadImage(id) {
  if (imageCache.has(id)) return imageCache.get(id);
  const img = await db.getImage(id);
  if (img) imageCache.set(id, img);
  return img;
}

/* ---------- Drafts: the diary line is never lost, even before saving ---------- */

const draftKey = date => 'draft:' + date;
const DRAFT_NOTE = '未保存 · 草稿已自动保留';
function writeDraft(date, value) {
  if (value !== entryOf(date).text) store.set(draftKey(date), value);
  else store.del(draftKey(date));
}
const writeDraftSoon = debounce(writeDraft, 400);
function captureDraft() {
  const ta = $('#diary-text');
  if (ta) writeDraft(ta.dataset.date, ta.value);
}

/* ---------- Rendering ---------- */

const VIEWS = { todo: viewTodo, diary: viewDiary, plaza: viewPlaza, inbox: viewInbox, settings: viewSettings };

function render() {
  captureDraft();
  const tabbar = $('#tabbar');
  if (!state.profile) {
    tabbar.hidden = true;
    app.innerHTML = viewOnboarding();
    return;
  }
  tabbar.hidden = false;
  app.innerHTML = VIEWS[state.view]();
  tabbar.querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  updateBadge();
  const ta = $('#diary-text');
  if (ta) autosize(ta);
}

function updateBadge() {
  const badge = $('#tabbar [data-view="inbox"] .badge');
  const n = state.plaza.stats?.unread || 0;
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
}

function go(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
  if (view === 'plaza' || view === 'inbox') refreshPlaza();
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight + 2, 64) + 'px';
}

function pageHead(title, sub, actions = '') {
  return `<header class="page-head">
    <div><h1 class="page-title">${title}</h1>${sub ? `<div class="page-sub">${sub}</div>` : ''}</div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ''}
  </header>`;
}
const shareButtons = kind => `
  <button class="icon-btn" data-act="share" data-kind="${kind}" aria-label="分享成纸船">${ICON.boat}</button>
  <button class="icon-btn" data-act="open-export" aria-label="导出">${ICON.export}</button>`;

function profileFields(p = {}) {
  return `
    <label class="field"><span>在职公司</span><input name="company" required maxlength="40" value="${escapeHtml(p.company)}"></label>
    <label class="field"><span>部门（选填）</span><input name="department" maxlength="40" value="${escapeHtml(p.department)}"></label>
    <label class="field"><span>岗位名称</span><input name="role" required maxlength="40" value="${escapeHtml(p.role)}"></label>
    <label class="field"><span>入职日期</span><input name="startDate" type="date" required value="${escapeHtml(p.startDate)}"></label>`;
}

function viewOnboarding() {
  return `<div class="onboard">
    <div class="brand">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>实习成长日记</h1>
      <p>每天列好待办、记一句心情。<br>实习结束时，你会有一整本自己的成长记录。</p>
    </div>
    <form class="card" data-form="profile">
      ${profileFields()}
      <button class="btn primary block" type="submit">开始记录</button>
      <p class="hint">待办和日记只保存在这台设备上；只有你主动放进广场的纸船才会被别人看到。</p>
    </form>
    <label class="btn ghost block">已有备份？从备份恢复<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
  </div>`;
}

/* 待办 */

function carryCandidates(date) {
  const prev = [...state.entries.values()]
    .filter(x => x.date < date && x.todos.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return prev ? prev.todos.filter(t => !t.done) : [];
}

function todoRow(t) {
  return `<li class="todo ${t.done ? 'done' : ''}">
    <button class="check ${t.done ? 'on' : ''}" data-act="todo-check" data-id="${t.id}" aria-label="${t.done ? '改回未完成' : '完成'}：${escapeHtml(t.text)}">${ICON.check}</button>
    <div class="todo-main">
      <span class="todo-text">${escapeHtml(t.text)}</span>
      ${t.done ? `<button class="dur ${t.minutes ? '' : 'empty'}" data-act="todo-duration" data-id="${t.id}">${t.minutes ? fmtMin(t.minutes) : '记录用时'}</button>` : ''}
    </div>
    <button class="icon-btn sm del" data-act="todo-del" data-id="${t.id}" aria-label="删除">${ICON.x}</button>
  </li>`;
}

function viewTodo() {
  const date = state.date;
  const isToday = date === todayStr();
  const e = entryOf(date);
  const n = dayNumber(date);
  const done = e.todos.filter(t => t.done).length;
  const spent = spentMinutes(e);
  const carry = e.todos.length ? [] : carryCandidates(date);
  const sub = `
    <button class="icon-btn xs" data-act="prev-day" aria-label="前一天">${ICON.left}</button>
    <span>${fmtCN(date)}</span>
    <button class="icon-btn xs" data-act="next-day" aria-label="后一天" ${isToday ? 'disabled' : ''}>${ICON.right}</button>`;
  const progress = [
    n > 0 ? `入职第 ${n} 天` : '',
    e.todos.length ? `完成 ${done}/${e.todos.length}` : '',
    spent ? `用时 ${fmtMin(spent)}` : '',
  ].filter(Boolean).join(' · ');
  return `
    ${pageHead('待办', sub, shareButtons('todo'))}
    ${isToday ? '' : '<button class="btn ghost small back-today" data-act="go-today">回到今天</button>'}
    ${progress ? `<p class="progress-line">${progress}</p>` : ''}
    <section class="card todo-card">
      ${e.todos.length
        ? `<ul class="todo-list">${e.todos.map(todoRow).join('')}</ul>`
        : `<div class="todo-empty"><p>${isToday ? '今天还没有待办' : '这天没有待办'}</p><span>点右下角的 + 添加</span></div>`}
    </section>
    ${carry.length ? `<button class="btn ghost block" data-act="carry-todos">带上上次未完成的 ${carry.length} 项</button>` : ''}
    <button class="fab" data-act="open-add" aria-label="添加待办">${ICON.plus}</button>`;
}

/* 日记 */

function viewDiary() {
  const today = todayStr();
  const e = entryOf(today);
  const draft = store.get(draftKey(today));
  const text = draft ?? e.text;
  const written = isWritten(e);
  const s = streak();
  const past = [...state.entries.values()].filter(x => x.date !== today && isWritten(x)).sort((a, b) => b.date.localeCompare(a.date));
  return `
    ${pageHead('日记', `<span>${s.current ? `已连续记录 ${s.current} 天` : '每天一句就好'}</span>`, shareButtons('diary'))}
    <section class="card diary-today">
      <div class="diary-date">${fmtCN(today)}${written ? '<span class="tag">已记下</span>' : ''}</div>
      <textarea id="diary-text" data-date="${today}" rows="2" maxlength="200" placeholder="今天开心吗^ ^？">${escapeHtml(text)}</textarea>
      <div class="save-row">
        <span class="muted small" id="draft-state">${draft != null && draft !== e.text ? DRAFT_NOTE : ''}</span>
        <button class="btn primary" id="save-diary" data-act="save-diary" ${text.trim() ? '' : 'disabled'}>${written ? '更新' : '记下'}</button>
      </div>
    </section>
    ${past.length ? `<h2 class="list-title">以前的日记</h2>
      <section class="card diary-list"><ul>${past.map(x => `<li>
        <button data-act="edit-diary" data-date="${x.date}"><span class="d">${fmtCN(x.date)}</span><span class="t">${escapeHtml(x.text.trim())}</span></button>
      </li>`).join('')}</ul></section>` : ''}`;
}

/* 广场 */

function boatBody(kind, body) {
  if (kind === 'diary') return `<p class="boat-text">${escapeHtml(body?.text || '')}</p>`;
  const todos = body?.todos || [];
  if (!todos.length) return '<p class="boat-text muted">（空的待办）</p>';
  return `<ul class="boat-todos">${todos.map(t => `<li class="${t.done ? 'done' : ''}">
    <i aria-hidden="true"></i><span>${escapeHtml(t.text)}</span>${t.done && t.minutes ? `<em>${fmtMin(t.minutes)}</em>` : ''}
  </li>`).join('')}</ul>`;
}

function boatCard(b, { act = '', attrs = '', foot = '' } = {}) {
  const clickable = act ? `data-act="${act}" role="button" tabindex="0" ${attrs}` : '';
  return `<article class="boat ${act ? 'clickable' : ''}" ${clickable}>
    <div class="boat-head">
      <span class="boat-kind">${b.kind === 'todo' ? '待办' : '日记'}</span>
      <span class="boat-sign">${escapeHtml(b.signature || '一位实习生')}</span>
      <span class="boat-date">${shortDate(b.boat_date)}</span>
    </div>
    ${boatBody(b.kind, b.body)}
    ${foot ? `<div class="boat-foot">${foot}</div>` : ''}
  </article>`;
}

const demoBanner = () => (plaza.isDemo() ? '<div class="demo-banner">演示模式：还没有连接广场服务器，海上的纸船是模拟的。</div>' : '');

function viewPlaza() {
  const p = state.plaza;
  const st = p.stats || { released: 0, caught: 0, unread: 0 };
  const quota = Math.max(0, st.released - st.caught);
  const caught = p.caught.map(b => boatCard(b, {
    act: 'open-caught', attrs: `data-boat="${b.id}" data-other="${b.author}"`,
    foot: b.unread ? `<span class="unread-dot"></span>${b.unread} 条新回复` : '<span>留言</span>',
  })).join('');
  const mine = p.mine.map(b => boatCard(b, {
    act: 'open-mine', attrs: `data-boat="${b.id}"`,
    foot: b.unread ? `<span class="unread-dot"></span>${b.unread} 条新留言` : b.people.length ? `<span>${b.people.length} 人留言</span>` : '<span class="muted">还没有人留言</span>',
  })).join('');
  return `
    ${pageHead('广场', '<span>把今天放进纸船，也捞一只别人的</span>')}
    ${demoBanner()}
    <section class="card sea">
      <div class="sea-art" aria-hidden="true">${SEA_ART}</div>
      <div class="sea-info">
        <p class="sea-stats">你放出了 <b>${st.released}</b> 只纸船，还能捞 <b>${quota}</b> 只</p>
        <div class="btn-row">
          <button class="btn" data-act="plaza-release">放纸船</button>
          <button class="btn primary" data-act="plaza-fish" ${p.loaded && quota ? '' : 'disabled'}>捞纸船</button>
        </div>
        <p class="hint">放出几只，就能捞几只。每天的待办和日记各算一只。</p>
      </div>
    </section>
    ${p.error ? `<div class="card error-card"><span>${escapeHtml(p.error)}</span><button class="btn small" data-act="plaza-retry">重试</button></div>` : ''}
    ${!p.loaded && !p.error ? '<div class="empty-state">正在连接广场…</div>' : ''}
    ${p.loaded ? `
      <h2 class="list-title">捞到的纸船</h2>
      ${caught || '<div class="empty-state small-empty">还没有捞过纸船</div>'}
      <h2 class="list-title">我放的纸船</h2>
      ${mine || '<div class="empty-state small-empty">还没有放过纸船</div>'}` : ''}`;
}

/* 通知 */

function viewInbox() {
  const p = state.plaza;
  const items = p.inbox.map(m => `<li>
    <button class="note ${m.unread ? 'unread' : ''}" data-act="open-thread" data-boat="${m.boat_id}" data-other="${m.other}">
      <span class="note-title">${m.my_boat ? '有人给你的纸船留言了' : '纸船的主人回复了你'}</span>
      <span class="note-body">${escapeHtml(m.body)}</span>
      <span class="note-meta">${m.kind === 'todo' ? '待办' : '日记'}纸船 · ${relTime(m.created_at)}</span>
    </button>
  </li>`).join('');
  return `
    ${pageHead('通知', '<span>纸船上的留言和回复</span>')}
    ${demoBanner()}
    ${p.error ? `<div class="card error-card"><span>${escapeHtml(p.error)}</span><button class="btn small" data-act="plaza-retry">重试</button></div>` : ''}
    ${!p.loaded && !p.error ? '<div class="empty-state">正在加载…</div>' : ''}
    ${p.loaded ? (items ? `<section class="card note-list"><ul>${items}</ul></section>` : '<div class="empty-state">还没有通知。<br>放出纸船后，有人留言会出现在这里。</div>') : ''}`;
}

/* 我的 */

const signature = () => [state.settings.boatShowCompany ? state.profile.company : '', state.profile.role].filter(Boolean).join(' · ');

function viewSettings() {
  const p = state.profile;
  const s = state.settings;
  const cfg = ai.config();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const notifyLabel = { granted: '浏览器通知已开启', denied: '通知被浏览器拒绝了', unsupported: '这个浏览器不支持通知' }[perm] || '开启浏览器通知';
  const lastBackup = store.get('lastBackup');
  return `
    ${pageHead('我的')}
    <form class="card" data-form="profile">
      <div class="card-head"><h2>我的实习</h2></div>
      ${profileFields(p)}
      <button class="btn primary block" type="submit">保存</button>
    </form>

    <section class="card">
      <div class="card-head"><h2>纸船署名</h2></div>
      <p class="sign-preview">${escapeHtml(signature() || '一位实习生')}</p>
      <label class="switch"><input type="checkbox" data-change="boat-company" ${s.boatShowCompany ? 'checked' : ''}><span>署名里显示公司</span></label>
      <p class="hint">别人捞到你的纸船时会看到这个署名。${plaza.isDemo() ? '广场目前是演示模式，还没有连接服务器。' : ''}</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>每日提醒</h2></div>
      <label class="field row"><span>提醒时间</span><input type="time" data-change="reminder-time" value="${s.reminderTime}"></label>
      <label class="switch"><input type="checkbox" data-change="skip-weekends" ${s.skipWeekends ? 'checked' : ''}><span>周末不写不算中断</span></label>
      <div class="btn-row">
        <button class="btn primary" data-act="download-ics">添加到手机日历</button>
        <button class="btn" data-act="enable-notify" ${perm === 'default' ? '' : 'disabled'}>${notifyLabel}</button>
      </div>
      <p class="hint">网页 App 关掉以后没法自己弹提醒。最稳的是「添加到手机日历」，每天到点由日历提醒你；改了提醒时间要重新添加一次。</p>
    </section>

    <form class="card" data-form="ai">
      <div class="card-head"><h2>AI 翻译与帖子（可选）</h2></div>
      <p class="muted small" style="margin-bottom:12px">用来把记录翻译成英文、生成 LinkedIn 帖子。需要你自己的 Claude API Key（在 console.anthropic.com 创建，按用量付费）。</p>
      <label class="field"><span>Claude API Key</span><input name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${escapeHtml(cfg.apiKey || '')}"></label>
      <label class="field"><span>模型</span><select name="model">${ai.MODELS.map(m => `<option value="${m.id}" ${m.id === (cfg.model || ai.DEFAULT_MODEL) ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      <div class="btn-row">
        <button class="btn primary" type="submit">保存</button>
        <button class="btn" type="button" data-act="test-ai">测试连接</button>
      </div>
      <p class="hint">Key 只存在这台设备上，不会写进备份文件。</p>
    </form>

    <section class="card">
      <div class="card-head"><h2>数据</h2></div>
      <p class="muted small">待办和日记只保存在这台设备的浏览器里。换手机、清理浏览器数据之前，先导出备份。${lastBackup ? `上次备份：${lastBackup}。` : '还没有备份过。'}</p>
      <div class="btn-row">
        <button class="btn" data-act="backup-export">导出备份</button>
        <label class="btn">从备份恢复<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
      </div>
      <button class="btn danger block" data-act="clear-all">清空全部数据</button>
    </section>
    <p class="muted small center">实习成长日记 v2.0</p>`;
}

/* ---------- Sheets ---------- */

function openModal(html, onMount) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modal-backdrop" data-modal-close></div><div class="modal-sheet" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').appendChild(wrap);
  document.body.classList.add('modal-open');
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  function close() {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (!$('#modal-root').children.length) document.body.classList.remove('modal-open');
  }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', ev => { if (ev.target.closest('[data-modal-close]')) close(); });
  onMount?.($('.modal-sheet', wrap), close);
  return close;
}

function busy(btn, on, label = '处理中…') {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function openAdd() {
  const date = state.date;
  openModal(`
    <h2 class="modal-title">添加待办</h2>
    <form class="inline-form add-form"><input name="text" maxlength="80" placeholder="要做什么？" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">添加</button></form>
    <ul class="added-list"></ul>
    <p class="hint center">回车可以连续添加</p>
    <button class="btn ghost block" data-modal-close>完成</button>`, sheet => {
    const input = $('input', sheet);
    input.focus();
    $('form', sheet).addEventListener('submit', async ev => {
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const e = ensureEntry(date);
      e.todos.push({ id: uid(), text, done: false });
      await persist(e);
      input.value = '';
      input.focus();
      $('.added-list', sheet).insertAdjacentHTML('beforeend', `<li>${escapeHtml(text)}</li>`);
      render();
    });
  });
}

function askDuration(date, id) {
  const t = entryOf(date).todos.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <h2 class="modal-title">大概用了多久？</h2>
    <p class="dur-task">${escapeHtml(t.text)}</p>
    <div class="dur-grid">${DURATIONS.map(([m, l]) => `<button type="button" class="chip ${t.minutes === m ? 'sel' : ''}" data-min="${m}">${l}</button>`).join('')}</div>
    <form class="inline-form"><input name="min" type="number" min="1" max="720" inputmode="numeric" placeholder="自己填（分钟）"><button class="btn" type="submit">确定</button></form>
    <button class="btn ghost block" data-modal-close>先跳过</button>`, (sheet, close) => {
    const set = async minutes => {
      const e = ensureEntry(date);
      const todo = e.todos.find(x => x.id === id);
      if (todo) {
        todo.minutes = minutes;
        await persist(e);
        render();
      }
      close();
    };
    sheet.querySelectorAll('[data-min]').forEach(b => b.addEventListener('click', () => set(Number(b.dataset.min))));
    $('form', sheet).addEventListener('submit', ev => {
      ev.preventDefault();
      const m = Math.round(Number(ev.target.elements.min.value));
      if (m >= 1 && m <= 720) set(m);
      else toast('填 1 到 720 之间的分钟数');
    });
  });
}

function editDiary(date) {
  const e = entryOf(date);
  openModal(`
    <h2 class="modal-title">${fmtCN(date)}</h2>
    <textarea id="edit-diary-text" rows="3" maxlength="200" placeholder="今天开心吗^ ^？">${escapeHtml(e.text)}</textarea>
    <div class="btn-row"><button class="btn" data-modal-close>取消</button><button class="btn primary" id="edit-diary-save">保存</button></div>`, (sheet, close) => {
    $('#edit-diary-save', sheet).addEventListener('click', async () => {
      const target = ensureEntry(date);
      target.text = $('#edit-diary-text', sheet).value.trim();
      await persist(target);
      close();
      render();
      toast('已更新');
    });
  });
}

function celebrateDiary(date, newly) {
  const s = streak(date);
  const next = MILESTONES.find(m => m > s.current);
  const extra = newly.length ? `解锁新海报主题：${newly.map(t => t.name).join('、')}` : next ? `再坚持 ${next - s.current} 天，达成 ${next} 天` : '';
  openModal(`
    <div class="celebrate">
      <div class="done-badge">${ICON.check}</div>
      <h2>记下了</h2>
      <p>已连续记录 ${s.current} 天${extra ? ` · ${extra}` : ''}</p>
    </div>
    <div class="btn-row"><button class="btn primary" data-boat>放成纸船</button><button class="btn" data-poster>生成图片</button></div>
    <button class="btn ghost block" data-modal-close>好的</button>`, (sheet, close) => {
    $('[data-boat]', sheet).addEventListener('click', () => { close(); openShare('diary', date); });
    $('[data-poster]', sheet).addEventListener('click', () => { close(); openPoster(date); });
  });
}

/* Sharing: a page becomes a paper boat in the plaza, or a picture. */

function boatPayload(kind, date) {
  const e = entryOf(date);
  if (kind === 'todo') {
    if (!e.todos.length) return null;
    return { todos: e.todos.map(t => ({ text: t.text, done: t.done, ...(t.done && t.minutes ? { minutes: t.minutes } : {}) })) };
  }
  return isWritten(e) ? { text: e.text.trim() } : null;
}

function openShare(kind, date = kind === 'todo' ? state.date : todayStr()) {
  const body = boatPayload(kind, date);
  const tooOld = daysBetween(date, todayStr()) > 1;
  const empty = kind === 'todo' ? '先添加几项待办，再放成纸船' : '先写一句今天的日记，再放成纸船';
  openModal(`
    <h2 class="modal-title">分享${kind === 'todo' ? '待办' : '日记'}</h2>
    ${body ? boatCard({ kind, body, signature: signature(), boat_date: date }) : `<p class="empty-state small-empty">${empty}</p>`}
    <button class="btn primary block" data-release ${body && !tooOld ? '' : 'disabled'}>${ICON.boat}放成纸船，漂到广场</button>
    <button class="btn block" data-poster>生成分享图片</button>
    <p class="hint center">${tooOld ? '只能放今天或昨天的纸船。' : `纸船署名：${escapeHtml(signature() || '一位实习生')}，可以在「我的」里修改。`}</p>`, (sheet, close) => {
    $('[data-release]', sheet).addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      splash();
      busy(btn, true, '正在放纸船…');
      try {
        const r = await plaza.release(kind, body, signature(), date);
        store.set('plaza-used', '1');
        close();
        toast(r.is_new ? '纸船漂出去了，去广场捞一只吧' : '纸船内容已更新');
        refreshPlaza();
      } catch (err) {
        busy(btn, false);
        toast(err.message, 3500);
      }
    });
    $('[data-poster]', sheet).addEventListener('click', () => { close(); openPoster(date); });
  });
}

function openReleasePicker() {
  const today = todayStr();
  const e = entryOf(today);
  const todo = boatPayload('todo', today);
  const diary = boatPayload('diary', today);
  openModal(`
    <h2 class="modal-title">放一只纸船</h2>
    <button class="pick" data-kind="todo" ${todo ? '' : 'disabled'}>
      <b>今天的待办</b><span>${todo ? `${e.todos.length} 项，完成 ${e.todos.filter(t => t.done).length} 项` : '今天还没有待办'}</span>
    </button>
    <button class="pick" data-kind="diary" ${diary ? '' : 'disabled'}>
      <b>今天的日记</b><span>${diary ? escapeHtml(diary.text) : '今天还没写日记'}</span>
    </button>
    <button class="btn ghost block" data-modal-close>取消</button>`, (sheet, close) => {
    sheet.querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => { close(); openShare(b.dataset.kind, today); }));
  });
}

/* Plaza data */

async function refreshPlaza() {
  const p = state.plaza;
  if (p.loading) return;
  p.loading = true;
  try {
    const [stats, mine, caught, inbox] = await Promise.all([plaza.stats(), plaza.myBoats(), plaza.caughtBoats(), plaza.inbox()]);
    Object.assign(p, { stats, mine, caught, inbox, loaded: true, error: '' });
    store.set('plaza-used', '1');
  } catch (err) {
    p.error = err.message;
  } finally {
    p.loading = false;
  }
  if (state.view === 'plaza' || state.view === 'inbox') render();
  else updateBadge();
}

// Cheap check for the 通知 badge; only for people who have used the plaza, so nobody is signed in just by opening the app.
async function refreshUnread() {
  if (!state.profile || !store.get('plaza-used') || document.visibilityState !== 'visible') return;
  try {
    state.plaza.stats = await plaza.stats();
    updateBadge();
  } catch { /* offline: keep the last count */ }
}

async function fishBoat(btn) {
  splash();
  busy(btn, true, '正在捞…');
  try {
    const b = await plaza.fish();
    await refreshPlaza();
    openThread(b.id, b.author, { title: '捞到一只纸船', fresh: true });
  } catch (err) {
    toast(err.message, 3500);
  } finally {
    busy(btn, false);
  }
}

const bubbles = list => (list.length
  ? list.map(m => `<div class="msg ${m.mine ? 'mine' : ''}"><p>${escapeHtml(m.body)}</p><span>${relTime(m.created_at)}</span></div>`).join('')
  : '<p class="msgs-empty">还没有留言，说点什么吧</p>');

async function openThread(boatId, other, { title = '', fresh = false } = {}) {
  let data;
  try {
    data = await plaza.openThread(boatId, other);
  } catch (err) {
    toast(err.message, 3500);
    return;
  }
  refreshPlaza();
  const mine = data.boat.mine;
  openModal(`
    <h2 class="modal-title">${title || (mine ? '你的纸船' : '捞到的纸船')}</h2>
    <div class="${fresh ? 'boat-arrive' : ''}">${boatCard(data.boat)}</div>
    <div class="msgs">${bubbles(data.messages)}</div>
    <form class="inline-form msg-form"><input name="body" maxlength="300" placeholder="${mine ? '回复 TA' : '给 TA 留言，TA 会收到'}" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">发送</button></form>
    ${mine ? '' : '<button class="link-btn" data-report>举报这只纸船</button>'}`, sheet => {
    const msgs = $('.msgs', sheet);
    msgs.scrollTop = msgs.scrollHeight;
    $('form', sheet).addEventListener('submit', async ev => {
      ev.preventDefault();
      const input = ev.target.elements.body;
      const body = input.value.trim();
      if (!body) return;
      const btn = $('button[type=submit]', sheet);
      busy(btn, true, '发送中…');
      try {
        const m = await plaza.send(boatId, body, mine ? other : null);
        data.messages.push(m);
        msgs.innerHTML = bubbles(data.messages);
        msgs.scrollTop = msgs.scrollHeight;
        input.value = '';
      } catch (err) {
        toast(err.message, 3500);
      } finally {
        busy(btn, false);
      }
    });
    $('[data-report]', sheet)?.addEventListener('click', async () => {
      if (!confirm('举报这只纸船？被多人举报的纸船会从海上消失。')) return;
      try {
        await plaza.report(boatId, '用户举报');
        toast('已举报，谢谢');
      } catch (err) {
        toast(err.message, 3500);
      }
    });
  });
}

// One of my own boats: talk to whoever wrote to me about it.
function openMine(boatId) {
  const b = state.plaza.mine.find(x => x.id === boatId);
  if (!b) return;
  if (b.people.length === 1) {
    openThread(b.id, b.people[0]);
    return;
  }
  openModal(`
    <h2 class="modal-title">你的纸船</h2>
    ${boatCard(b)}
    ${b.people.length
      ? `<h3 class="list-title">谁给你留言了</h3><div class="people">${b.people.map((who, i) => `<button class="pick" data-who="${who}"><b>第 ${i + 1} 位读者</b><span>点开看留言</span></button>`).join('')}</div>`
      : '<p class="msgs-empty">还没有人留言。有人捞到并留言时，会出现在「通知」里。</p>'}
    <button class="link-btn danger" data-remove>收回这只纸船</button>`, (sheet, close) => {
    sheet.querySelectorAll('[data-who]').forEach(btn => btn.addEventListener('click', () => { close(); openThread(b.id, btn.dataset.who); }));
    $('[data-remove]', sheet).addEventListener('click', async () => {
      if (!confirm('收回后，别人就看不到这只纸船了，留言也会一起删除。确定吗？')) return;
      try {
        await plaza.removeBoat(b.id);
        close();
        toast('已收回');
        refreshPlaza();
      } catch (err) {
        toast(err.message, 3500);
      }
    });
  });
}

/* Picture (poster) */

function defaultQuote(text) {
  const first = (text || '').split(/[。！？!?\n]/).map(s => s.trim()).find(Boolean) || '今天也在认真成长。';
  return first.length > 60 ? first.slice(0, 60) + '…' : first;
}

function posterData(date, quote, showCompany) {
  const e = entryOf(date);
  const d = parseDate(date);
  const timed = e.todos.filter(t => t.done && t.minutes).sort((a, b) => b.minutes - a.minutes);
  return {
    dateLabel: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${weekdayCN(date)}`,
    streak: streak(date).current,
    dayN: dayNumber(date),
    role: state.profile.role,
    company: showCompany ? state.profile.company : '',
    quote: quote.trim() || defaultQuote(e.text),
    todoDone: e.todos.filter(t => t.done).length,
    todoTotal: e.todos.length,
    time: timed.map((t, i) => ({ name: t.text.length > 8 ? t.text.slice(0, 8) + '…' : t.text, h: t.minutes / 60, color: CAT_COLORS[i % CAT_COLORS.length] })),
    totalH: spentMinutes(e) / 60,
  };
}

function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'poster.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function openPoster(date) {
  const e = entryOf(date);
  const unlocked = THEMES.filter(t => streak().longest >= t.unlock);
  let themeId = unlocked.some(t => t.id === state.settings.posterTheme) ? state.settings.posterTheme : unlocked[0].id;
  const next = THEMES.find(t => t.unlock > streak().longest);
  const share = canShareFiles();
  openModal(`
    <h2 class="modal-title">分享图片</h2>
    <div class="poster-wrap"><canvas id="poster-canvas" role="img" aria-label="分享图片预览"></canvas></div>
    <div class="chips theme-row">${unlocked.map(t => `<button type="button" class="chip ${t.id === themeId ? 'sel' : ''}" data-theme="${t.id}">${t.name}</button>`).join('')}</div>
    ${next ? `<p class="hint center">连续记录 ${next.unlock} 天，解锁「${next.name}」</p>` : ''}
    <label class="field"><span>图片上的一句话</span><textarea id="poster-quote" rows="2" maxlength="80">${escapeHtml(e.posterQuote ?? defaultQuote(e.text))}</textarea></label>
    <label class="switch"><input type="checkbox" id="poster-company" ${state.settings.posterShowCompany ? 'checked' : ''}><span>图片上显示公司名</span></label>
    <div class="btn-row">
      <button type="button" class="btn" data-modal-close>关闭</button>
      <button type="button" class="btn primary" id="poster-save">保存图片</button>
      ${share ? '<button type="button" class="btn" id="poster-share">分享</button>' : ''}
    </div>`, sheet => {
    const canvas = $('#poster-canvas', sheet);
    const quoteEl = $('#poster-quote', sheet);
    const companyEl = $('#poster-company', sheet);
    let blob = null;
    let drawId = 0;
    const draw = async () => {
      const id = ++drawId;
      blob = null;
      await renderPoster(canvas, posterData(date, quoteEl.value, companyEl.checked), THEMES.find(t => t.id === themeId));
      if (id === drawId) canvas.toBlob(b => { if (id === drawId) blob = b; }, 'image/png');
    };
    draw();
    sheet.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
      themeId = b.dataset.theme;
      sheet.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('sel', x === b));
      state.settings.posterTheme = themeId;
      saveSettings();
      draw();
    }));
    quoteEl.addEventListener('input', debounce(draw, 150));
    quoteEl.addEventListener('change', () => {
      const target = ensureEntry(date);
      target.posterQuote = quoteEl.value;
      db.putEntry(target);
    });
    companyEl.addEventListener('change', () => {
      state.settings.posterShowCompany = companyEl.checked;
      saveSettings();
      draw();
    });
    $('#poster-save', sheet).addEventListener('click', () => {
      canvas.toBlob(b => downloadBlob(b, `实习成长日记_${date}.png`), 'image/png');
    });
    // navigator.share has to run inside the tap itself, so the image is prepared in advance.
    $('#poster-share', sheet)?.addEventListener('click', async () => {
      if (!blob) {
        toast('图片还在生成，请稍后再点');
        return;
      }
      try {
        await navigator.share({ files: [new File([blob], `diary-${date}.png`, { type: 'image/png' })] });
      } catch (err) {
        if (err.name !== 'AbortError') toast('分享失败，可以先保存图片');
      }
    });
  });
}

/* Export (a sheet on the 待办 and 日记 pages) */

function exportRange() {
  const today = todayStr();
  const x = state.exp;
  if (x.range === 'week') return { from: addDays(today, -((parseDate(today).getDay() + 6) % 7)), to: today };
  if (x.range === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (x.range === 'all') {
    const first = [...state.entries.values()].filter(hasContent).map(e => e.date).sort()[0];
    return { from: first || today, to: today };
  }
  let from = x.from || addDays(today, -6);
  let to = x.to || today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
const entriesBetween = (from, to) => [...state.entries.values()]
  .filter(e => e.date >= from && e.date <= to && hasContent(e))
  .sort((a, b) => a.date.localeCompare(b.date));

function exportHTML() {
  const { from, to } = exportRange();
  const list = entriesBetween(from, to);
  const x = state.exp;
  const aiOn = ai.hasKey();
  const anyText = list.some(e => isWritten(e) || e.todos.length);
  const seg = (act, key, options) => `<div class="seg">${options.map(([v, l]) => `<button class="${key === v ? 'sel' : ''}" data-x="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const dis = list.length ? '' : 'disabled';
  return `
    <h2 class="modal-title">导出</h2>
    <div class="field"><span>范围</span>${seg('exp-range', x.range, [['week', '本周'], ['month', '本月'], ['all', '全部'], ['custom', '自定义']])}</div>
    ${x.range === 'custom'
      ? `<div class="two">
          <label class="field"><span>从</span><input type="date" data-xc="exp-from" value="${from}" max="${todayStr()}"></label>
          <label class="field"><span>到</span><input type="date" data-xc="exp-to" value="${to}" max="${todayStr()}"></label>
        </div>`
      : `<p class="muted small" style="margin:-4px 0 12px 4px">${from} 至 ${to}</p>`}
    <div class="field"><span>包含</span><div class="checks">
      <label><input type="checkbox" checked disabled> 日记</label>
      <label><input type="checkbox" data-xc="exp-opt" data-key="todos" ${x.todos ? 'checked' : ''}> 待办和用时</label>
      <label><input type="checkbox" data-xc="exp-opt" data-key="images" ${x.images ? 'checked' : ''}> 图片</label>
    </div></div>
    <div class="field"><span>语言</span>${seg('exp-lang', x.lang, [['zh', '中文原文'], ['en', '英文（AI 翻译）']])}
      ${x.lang === 'en' && !aiOn ? '<p class="warn small">翻译需要先在「我的」里填 Claude API Key。</p>' : ''}
    </div>
    <p class="count">共 <b>${list.length}</b> 天的记录</p>
    <div class="btn-row">
      <button class="btn primary" data-x="export" data-fmt="docx" ${dis}>Word</button>
      <button class="btn primary" data-x="export" data-fmt="pdf" ${dis}>PDF</button>
      <button class="btn primary" data-x="export" data-fmt="md" ${dis}>Markdown</button>
    </div>
    <p class="hint">PDF 会打开系统的打印窗口，目标选「存储为 PDF」即可。</p>
    <h3 class="list-title">生成 LinkedIn 帖子</h3>
    ${aiOn ? `<div class="field"><span>帖子语言</span>${seg('li-lang', state.li.lang, [['en', 'English'], ['zh', '中文']])}</div>` : ''}
    <label class="switch"><input type="checkbox" data-xc="li-company" ${state.li.mentionCompany ? 'checked' : ''}><span>帖子里写出公司名</span></label>
    <button class="btn primary block" data-x="li-generate" ${anyText ? '' : 'disabled'}>${aiOn ? 'AI 生成帖子' : '用模板生成（中文）'}</button>
    <textarea id="li-text" rows="8" placeholder="生成的帖子会出现在这里，可以直接修改">${escapeHtml(state.li.text)}</textarea>
    <div class="btn-row">
      <button class="btn primary" data-x="li-open" ${state.li.text.trim() ? '' : 'disabled'}>复制并打开 LinkedIn</button>
      <button class="btn" data-x="li-prompt" ${anyText ? '' : 'disabled'}>复制 AI 提示词</button>
    </div>
    <button class="btn ghost block" data-modal-close>完成</button>`;
}

function openExport() {
  openModal('', sheet => {
    const paint = () => { sheet.innerHTML = exportHTML(); };
    paint();
    sheet.addEventListener('click', ev => {
      const el = ev.target.closest('[data-x]');
      if (!el || el.disabled) return;
      ev.preventDefault();
      EXPORT_ACTIONS[el.dataset.x]?.(el, paint);
    });
    sheet.addEventListener('change', ev => {
      const el = ev.target.closest('[data-xc]');
      if (el) EXPORT_CHANGES[el.dataset.xc]?.(el, paint);
    });
    sheet.addEventListener('input', ev => {
      if (ev.target.id !== 'li-text') return;
      state.li.text = ev.target.value;
      const btn = $('[data-x="li-open"]', sheet);
      if (btn) btn.disabled = !ev.target.value.trim();
    });
  });
}

// Translates every entry in the range (three at a time), reusing cached translations.
async function translateAll(list) {
  const need = list.filter(e => isWritten(e) || e.todos.length);
  const result = new Map();
  let done = 0;
  const queue = [...need];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const src = { text: e.text || '', todos: e.todos.map(t => t.text) };
      const key = JSON.stringify(src);
      if (e.en?.key !== key) {
        const out = await ai.translateEntry(src);
        e.en = { key, ...out };
        await db.putEntry(e);
      }
      result.set(e.date, e.en);
      toast(`正在翻译 ${++done}/${need.length}…`, 60000);
    }
  };
  toast(`正在翻译 0/${need.length}…`, 60000);
  await Promise.all([worker(), worker(), worker()]);
  const p = state.profile;
  const custom = list.flatMap(e => Object.keys(e.time || {})).filter(c => !exporter.CAT_EN[c]);
  const labels = await ai.translateLabels([p.company, p.department, p.role, ...custom]);
  return { entries: result, labels };
}

async function doExport(fmt, btn) {
  const { from, to } = exportRange();
  const list = entriesBetween(from, to);
  if (!list.length) return;
  const x = state.exp;
  if (x.lang === 'en' && !ai.hasKey()) {
    toast('英文导出需要先在「我的」里填 Claude API Key');
    return;
  }
  busy(btn, true);
  try {
    const tr = x.lang === 'en' ? await translateAll(list) : null;
    const images = new Map();
    if (x.images) {
      for (const id of list.flatMap(e => e.images)) {
        const img = await loadImage(id);
        if (img) images.set(id, img);
      }
    }
    const include = { todos: x.todos, time: x.todos, images: x.images };
    const model = exporter.buildModel({ entries: list, profile: state.profile, from, to, lang: x.lang, include, images, tr });
    if (fmt === 'md') {
      downloadBlob(new Blob([exporter.toMarkdown(model)], { type: 'text/markdown;charset=utf-8' }), exporter.fileName(model, 'md'));
    } else if (fmt === 'docx') {
      downloadBlob(await exporter.toDocx(model), exporter.fileName(model, 'docx'));
    } else {
      await exporter.printPDF(model);
    }
    if (fmt !== 'pdf') toast('已导出');
  } catch (err) {
    console.error(err);
    toast(err instanceof ai.AIError ? err.message : `导出失败：${err.message || err}`, 4000);
  } finally {
    busy(btn, false);
  }
}

function postArgs() {
  const { from, to } = exportRange();
  const entries = entriesBetween(from, to).filter(e => isWritten(e) || e.todos.some(t => t.done)).map(e => ({
    date: e.date,
    day: dayNumber(e.date),
    text: (e.text || '').trim(),
    done: e.todos.filter(t => t.done).map(t => t.text),
    time: e.todos.filter(t => t.done && t.minutes).map(t => ({ cat: t.text, h: Math.round((t.minutes / 60) * 10) / 10 })),
  }));
  return { entries, profile: state.profile, lang: state.li.lang, mentionCompany: state.li.mentionCompany, from, to };
}

function templatePost({ entries, profile, mentionCompany, from, to }) {
  const firstLine = t => {
    const line = t.split('\n').map(s => s.trim()).find(Boolean) || '';
    return line.length > 40 ? line.slice(0, 40) + '…' : line;
  };
  const lines = entries.slice(-5).map(e => `· ${firstLine(e.text || e.done.join('、'))}`);
  const totals = {};
  entries.forEach(e => e.time.forEach(t => { totals[t.cat] = (totals[t.cat] || 0) + t.h; }));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return [
    `实习成长记录｜${shortDate(from)}–${shortDate(to)}`,
    '',
    `作为${profile.role}${mentionCompany ? `（${profile.company}）` : ''}，这段时间我主要在做：`,
    ...lines,
    ...(top ? ['', `花时间最多的是「${top[0]}」，共 ${fmtH(top[1])} 小时。`] : []),
    '',
    '这段时间最大的收获：（在这里写一句你自己的感受）',
    '',
    `#实习 #成长记录 #${profile.role.replace(/\s+/g, '')}`,
  ].join('\n');
}

async function generatePost(btn, paint) {
  const args = postArgs();
  if (!args.entries.length) return;
  if (!ai.hasKey()) {
    state.li.text = templatePost(args);
    paint();
    toast('已用模板生成，可以直接修改');
    return;
  }
  busy(btn, true);
  try {
    state.li.text = await ai.draftLinkedInPost(args);
    paint();
    toast('帖子写好了，发之前再读一遍');
  } catch (err) {
    console.error(err);
    toast(err.message || '生成失败', 4000);
    busy(btn, false);
  }
}

const EXPORT_ACTIONS = {
  'exp-range': (el, paint) => {
    state.exp.range = el.dataset.v;
    if (el.dataset.v === 'custom' && !state.exp.from) {
      state.exp.from = addDays(todayStr(), -6);
      state.exp.to = todayStr();
    }
    paint();
  },
  'exp-lang': (el, paint) => {
    state.exp.lang = el.dataset.v;
    paint();
  },
  export: el => doExport(el.dataset.fmt, el),
  'li-lang': (el, paint) => {
    state.li.lang = el.dataset.v;
    paint();
  },
  'li-generate': (el, paint) => generatePost(el, paint),
  'li-open': () => {
    const text = state.li.text.trim();
    if (!text) return;
    copyText(text);
    window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    toast('帖子已复制。如果 LinkedIn 没有自动填好，直接粘贴即可', 4000);
  },
  'li-prompt': async () => {
    const args = postArgs();
    if (!args.entries.length) return;
    await copyText(ai.linkedInPromptText(args));
    toast('提示词已复制，粘贴到任意 AI 助手里就能生成帖子', 4000);
  },
};

const EXPORT_CHANGES = {
  'exp-from': (el, paint) => { state.exp.from = el.value; paint(); },
  'exp-to': (el, paint) => { state.exp.to = el.value; paint(); },
  'exp-opt': el => { state.exp[el.dataset.key] = el.checked; },
  'li-company': el => { state.li.mentionCompany = el.checked; },
};

/* ---------- Actions on the pages ---------- */

async function saveDiary() {
  const ta = $('#diary-text');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) {
    toast('先写一句再记下');
    return;
  }
  const date = ta.dataset.date;
  const e = ensureEntry(date);
  const wasWritten = isWritten(e);
  const before = streak();
  e.text = text;
  e.createdAt ??= Date.now();
  await persist(e);
  ta.value = text;
  store.del(draftKey(date));
  const after = streak();
  const newly = THEMES.filter(t => t.unlock > 0 && before.longest < t.unlock && after.longest >= t.unlock);
  render();
  if (!wasWritten) celebrateDiary(date, newly);
  else toast('已更新');
}

const ACTIONS = {
  'prev-day': () => {
    state.date = addDays(state.date, -1);
    state.followToday = false;
    render();
  },
  'next-day': () => {
    if (state.date >= todayStr()) return;
    state.date = addDays(state.date, 1);
    state.followToday = state.date === todayStr();
    render();
  },
  'go-today': () => {
    state.date = todayStr();
    state.followToday = true;
    render();
  },
  'open-add': openAdd,
  'todo-check': async el => {
    const e = ensureEntry(state.date);
    const t = e.todos.find(x => x.id === el.dataset.id);
    if (!t) return;
    if (!t.done) {
      // Sound first, inside the tap, so the browser lets it play.
      chime();
      navigator.vibrate?.(12);
      t.done = true;
      t.doneAt = Date.now();
      await persist(e);
      render();
      askDuration(state.date, t.id);
    } else {
      t.done = false;
      delete t.minutes;
      delete t.doneAt;
      await persist(e);
      render();
    }
  },
  'todo-duration': el => askDuration(state.date, el.dataset.id),
  'todo-del': async el => {
    const e = ensureEntry(state.date);
    e.todos = e.todos.filter(t => t.id !== el.dataset.id);
    await persist(e);
    render();
  },
  'carry-todos': async () => {
    const e = ensureEntry(state.date);
    e.todos = carryCandidates(state.date).map(t => ({ id: uid(), text: t.text, done: false }));
    await persist(e);
    render();
  },
  'save-diary': saveDiary,
  'edit-diary': el => editDiary(el.dataset.date),
  share: el => openShare(el.dataset.kind),
  'open-export': openExport,
  'plaza-release': openReleasePicker,
  'plaza-fish': el => fishBoat(el),
  'plaza-retry': () => {
    state.plaza.error = '';
    render();
    refreshPlaza();
  },
  'open-caught': el => openThread(el.dataset.boat, el.dataset.other),
  'open-mine': el => openMine(el.dataset.boat),
  'open-thread': el => openThread(el.dataset.boat, el.dataset.other),
  'download-ics': () => {
    const url = location.href.split(/[?#]/)[0];
    const ics = buildICS({ time: state.settings.reminderTime, weekdaysOnly: state.settings.skipWeekends, url });
    downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), '实习日记提醒.ics');
    toast('打开下载的文件，选择「添加到日历」即可', 4000);
  },
  'enable-notify': async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? '已开启，App 开着时到点会提醒你' : '没有开启通知');
    render();
  },
  'test-ai': async el => {
    const form = el.closest('form');
    const data = Object.fromEntries(new FormData(form));
    ai.saveConfig({ apiKey: data.apiKey.trim(), model: data.model });
    busy(el, true);
    try {
      await ai.ping();
      toast('连接成功 ✓');
    } catch (err) {
      toast(err.message || '连接失败', 4000);
    } finally {
      busy(el, false);
    }
  },
  'backup-export': async () => {
    const [entries, images] = await Promise.all([db.allEntries(), db.allImages()]);
    const data = { app: 'intern-diary', version: 2, exportedAt: new Date().toISOString(), profile: state.profile, settings: state.settings, entries, images };
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `实习日记备份_${todayStr()}.json`);
    store.set('lastBackup', todayStr());
    render();
  },
  'clear-all': async () => {
    if (!confirm('确定清空这台设备上的全部待办、日记和设置（包括 API Key）吗？')) return;
    if (!confirm('清空后无法恢复。建议先「导出备份」。真的要清空吗？')) return;
    await db.clearAll();
    Object.keys(localStorage)
      .filter(k => k.startsWith('draft:') || k.startsWith('sb-'))
      .forEach(k => store.del(k));
    ['lastBackup', 'notified', 'en-labels', 'ai', 'plaza-used'].forEach(k => store.del(k));
    plaza.resetDemo();
    state.profile = null;
    state.entries.clear();
    imageCache.clear();
    state.settings = { ...DEFAULT_SETTINGS };
    state.plaza = { loaded: false, loading: false, error: '', stats: null, mine: [], caught: [], inbox: [] };
    state.view = 'todo';
    render();
    toast('已清空');
  },
};

const CHANGES = {
  'boat-company': async el => {
    state.settings.boatShowCompany = el.checked;
    await saveSettings();
    render();
  },
  'reminder-time': async el => {
    state.settings.reminderTime = el.value || '21:00';
    await saveSettings();
    toast('提醒时间已修改。加过日历提醒的话，需要重新添加一次', 4000);
  },
  'skip-weekends': async el => {
    state.settings.skipWeekends = el.checked;
    await saveSettings();
  },
  'backup-import': async el => {
    const file = el.files[0];
    el.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (data.app !== 'intern-diary' || !Array.isArray(data.entries)) throw new Error('not a backup');
    } catch {
      toast('这个文件不是实习成长日记的备份');
      return;
    }
    const prompt = state.profile
      ? `备份里有 ${data.entries.length} 天的记录。恢复会覆盖这台设备上现在的全部记录，确定吗？`
      : `从备份恢复 ${data.entries.length} 天的记录？`;
    if (!confirm(prompt)) return;
    await db.restore(data);
    imageCache.clear();
    await boot();
    toast('已从备份恢复');
  },
};

const FORMS = {
  profile: async form => {
    const d = Object.fromEntries(new FormData(form));
    const p = { company: d.company.trim(), department: d.department.trim(), role: d.role.trim(), startDate: d.startDate };
    if (!p.company || !p.role || !p.startDate) {
      toast('请填写公司、岗位名称和入职日期');
      return;
    }
    const first = !state.profile;
    state.profile = p;
    await db.setKV('profile', p);
    if (first) {
      await saveSettings();
      state.view = 'todo';
      render();
      window.scrollTo(0, 0);
      toast('设置完成，先列一下今天的待办吧');
    } else {
      render();
      toast('已保存');
    }
  },
  ai: form => {
    const d = Object.fromEntries(new FormData(form));
    ai.saveConfig({ apiKey: d.apiKey.trim(), model: d.model });
    toast(d.apiKey.trim() ? '已保存' : '已清除 API Key');
    render();
  },
};

app.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled || !app.contains(el)) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  fn(el, ev);
});
// Boat cards are <article role="button">; let Enter and Space open them too.
app.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][data-act]')) {
    ev.preventDefault();
    ev.target.click();
  }
  if (ev.target.id === 'diary-text' && ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    saveDiary();
  }
});
app.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (el) CHANGES[el.dataset.change]?.(el, ev);
});
app.addEventListener('submit', ev => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  FORMS[form.dataset.form]?.(form);
});
app.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id !== 'diary-text') return;
  autosize(t);
  const changed = t.value !== entryOf(t.dataset.date).text;
  $('#save-diary').disabled = !t.value.trim();
  $('#draft-state').textContent = changed ? DRAFT_NOTE : '';
  writeDraftSoon(t.dataset.date, t.value);
});
$('#tabbar').addEventListener('click', ev => {
  const b = ev.target.closest('[data-view]');
  if (b) go(b.dataset.view);
});

// Keep "today" current when the app stays open past midnight.
function syncToday() {
  if (state.profile && state.followToday && state.date !== todayStr()) {
    state.date = todayStr();
    render();
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') captureDraft();
  else {
    syncToday();
    refreshUnread();
  }
});
window.addEventListener('pagehide', captureDraft);
setInterval(syncToday, 60000);
setInterval(refreshUnread, 60000);

/* ---------- Boot ---------- */

async function boot() {
  const [profile, settings, entries] = await Promise.all([db.getKV('profile'), db.getKV('settings'), db.allEntries()]);
  state.profile = profile || null;
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.entries = new Map(entries.map(e => [e.date, e]));
  state.date = todayStr();
  state.followToday = true;
  if (!VIEWS[state.view]) state.view = 'todo';
  render();
  refreshUnread();
}

boot().catch(err => {
  console.error(err);
  app.innerHTML = `<div class="card">打不开本地数据库：${escapeHtml(err.message || err)}。如果正在用无痕模式，请换成普通窗口。</div>`;
});

startReminderLoop(() => ({
  ready: !!state.profile,
  time: state.settings.reminderTime,
  skipWeekends: state.settings.skipWeekends,
  writtenToday: isWritten(state.entries.get(todayStr())),
}));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
