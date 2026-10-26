import * as db from './db.js';
import {
  todayStr, parseDate, addDays, daysBetween, shiftMonth, weekdayCN, isWeekend, fmtCN, nowHM, fmtH, pad,
  escapeHtml, uid, debounce, store, toast, downloadBlob, copyText, compressImage, CAT_COLORS,
} from './util.js';
import { computeStreak, MILESTONES } from './streak.js';
import { THEMES, renderPoster } from './poster.js';
import * as exporter from './export.js';
import * as ai from './ai.js';
import { buildICS, startReminderLoop } from './reminder.js';

const DEFAULT_CATEGORIES = ['开会', '写文档', '数据分析', '写代码', '沟通对接', '学习', '杂事'];
const DEFAULT_SETTINGS = {
  reminderTime: '21:00',
  skipWeekends: true,
  categories: DEFAULT_CATEGORIES,
  posterTheme: 'plain',
  posterShowCompany: false,
};
const MAX_IMAGES = 9;
const MAX_CATEGORIES = 12;

const state = {
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  entries: new Map(),
  view: 'today',
  date: todayStr(),
  followToday: true,
  calMonth: todayStr().slice(0, 7),
  exp: { range: 'week', from: '', to: '', lang: 'zh', images: true, todos: true, time: true },
  li: { lang: 'en', mentionCompany: false, text: '' },
};
const imageCache = new Map();

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  left: svg('<path d="M15 18l-6-6 6-6"/>'),
  right: svg('<path d="M9 18l6-6-6-6"/>'),
  x: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  flame: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 3.2 2.6 5 4.4 6.9C18 10.6 19 12.4 19 14.6 19 18.7 15.9 22 12 22s-7-3.3-7-7.4c0-2.6 1.3-4.7 3.1-6.2.2 1.9 1 3.2 2.3 3.9C10.2 8.6 10.6 5.1 12 2z"/></svg>',
};

/* ---------- Data helpers ---------- */

const blankEntry = date => ({ date, text: '', images: [], todos: [], time: {}, createdAt: null, updatedAt: null });
const entryOf = date => state.entries.get(date) || blankEntry(date);
function ensureEntry(date) {
  if (!state.entries.has(date)) state.entries.set(date, blankEntry(date));
  return state.entries.get(date);
}
const isWritten = e => !!(e && e.text && e.text.trim());
const sumTime = time => Object.values(time || {}).reduce((a, b) => a + b, 0);
const hasContent = e => !!e && (isWritten(e) || e.todos.length > 0 || sumTime(e.time) > 0 || e.images.length > 0);
const writtenSet = () => new Set([...state.entries.values()].filter(isWritten).map(e => e.date));
const streak = asOf => computeStreak(writtenSet(), state.settings, asOf);
const dayNumber = date => daysBetween(state.profile.startDate, date) + 1;

async function persist(entry) {
  entry.updatedAt = Date.now();
  state.entries.set(entry.date, entry);
  await db.putEntry(entry);
}
const saveSettings = () => db.setKV('settings', state.settings);

function catColor(c) {
  const i = state.settings.categories.indexOf(c);
  if (i >= 0) return CAT_COLORS[i % CAT_COLORS.length];
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}
const catsFor = e => [...state.settings.categories, ...Object.keys(e.time || {}).filter(c => !state.settings.categories.includes(c))];

async function loadImage(id) {
  if (imageCache.has(id)) return imageCache.get(id);
  const img = await db.getImage(id);
  if (img) imageCache.set(id, img);
  return img;
}
function hydrateImages(root) {
  root.querySelectorAll('img[data-img-id]').forEach(async el => {
    const img = await loadImage(el.dataset.imgId);
    if (img) el.src = img.data;
  });
}

function defaultQuote(text) {
  const first = (text || '').split(/[。！？!?\n]/).map(s => s.trim()).find(Boolean) || '今天也在认真成长。';
  return first.length > 60 ? first.slice(0, 60) + '…' : first;
}

/* ---------- Drafts: the diary text is never lost, even before saving ---------- */

const draftKey = date => 'draft:' + date;
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

const VIEWS = { today: viewToday, history: viewHistory, streak: viewStreak, export: viewExport, settings: viewSettings };

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
  hydrateImages(app);
  const ta = $('#diary-text');
  if (ta) autosize(ta);
}

function go(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight + 2, 168) + 'px';
}

function profileFields(p = {}) {
  return `
    <label class="field"><span>在职公司</span><input name="company" required maxlength="40" placeholder="例如：腾讯" value="${escapeHtml(p.company)}"></label>
    <label class="field"><span>部门</span><input name="department" maxlength="40" placeholder="例如：微信事业群 · 产品部" value="${escapeHtml(p.department)}"></label>
    <label class="field"><span>岗位名称</span><input name="role" required maxlength="40" placeholder="例如：产品经理实习生" value="${escapeHtml(p.role)}"></label>
    <label class="field"><span>入职日期</span><input name="startDate" type="date" required value="${escapeHtml(p.startDate)}"></label>`;
}

function viewOnboarding() {
  return `<div class="onboard">
    <div class="brand">
      <img src="icons/icon.svg" alt="" width="64" height="64">
      <h1>实习成长日记</h1>
      <p>每天 3 分钟，记下做了什么、学到了什么。实习结束时，你会有一整本自己的成长记录。</p>
    </div>
    <form class="card" data-form="profile">
      ${profileFields()}
      <button class="btn primary block" type="submit">开始记录</button>
      <p class="hint">所有内容只保存在这台设备的浏览器里，不会上传到任何服务器。</p>
    </form>
    <label class="btn ghost block">换了手机？从备份恢复<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
  </div>`;
}

/* Today */

function viewToday() {
  const date = state.date;
  const isToday = date === todayStr();
  const e = entryOf(date);
  const n = dayNumber(date);
  const draft = store.get(draftKey(date));
  const text = draft ?? e.text;
  return `
    <header class="day-head">
      <button class="icon-btn" data-act="prev-day" aria-label="前一天">${ICON.left}</button>
      <div class="day-title">
        <div class="day-date">${fmtCN(date)}${isToday ? '<span class="tag">今天</span>' : ''}</div>
        <div class="day-sub">${n > 0 ? `入职第 ${n} 天` : '还没到入职日期'}</div>
      </div>
      <button class="icon-btn" data-act="next-day" aria-label="后一天" ${isToday ? 'disabled' : ''}>${ICON.right}</button>
    </header>
    ${isToday ? streakBanner(e) : '<button class="btn ghost block" data-act="go-today" style="margin:0 0 12px">回到今天</button>'}
    ${planCard(e)}
    ${diaryCard(e, text, draft != null && draft !== e.text)}
    ${timeCard(e)}`;
}

function streakBanner(e) {
  const s = streak();
  const written = isWritten(e);
  const today = todayStr();
  let title = s.current ? `连续打卡 ${s.current} 天` : '开始你的第 1 天';
  let sub = '写下一句话就算打卡';
  let due = false;
  if (written) sub = '今天已打卡，明天见';
  else if (state.settings.skipWeekends && isWeekend(today)) sub = '周末休息，不写也不会断签';
  else if (nowHM() >= state.settings.reminderTime) {
    sub = '已经过了提醒时间，今天还没写哦';
    due = true;
  } else if (s.current) sub = '今天写下一句话就能续上';
  if (!s.current && written) title = '连续打卡 1 天';
  return `<div class="streak-banner ${due ? 'due' : ''}">
    <span class="flame">${ICON.flame}</span>
    <div class="txt"><b>${title}</b><span class="sub">${sub}</span></div>
  </div>`;
}

function carryCandidates(date) {
  const prev = [...state.entries.values()]
    .filter(x => x.date < date && x.todos.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return prev ? prev.todos.filter(t => !t.done) : [];
}

function planCard(e) {
  const carry = e.todos.length ? [] : carryCandidates(e.date);
  return `<section class="card">
    <div class="card-head"><h2>今日计划</h2><span class="muted small">上班前列一下</span></div>
    ${e.todos.length ? `<ul class="todos">${e.todos.map(t => `
      <li class="${t.done ? 'done' : ''}">
        <label><input type="checkbox" data-change="todo-toggle" data-id="${t.id}" ${t.done ? 'checked' : ''}><span>${escapeHtml(t.text)}</span></label>
        <button class="icon-btn sm" data-act="todo-del" data-id="${t.id}" aria-label="删除这项">${ICON.x}</button>
      </li>`).join('')}</ul>` : ''}
    ${carry.length ? `<button class="btn ghost small" data-act="carry-todos">把上次没完成的 ${carry.length} 项带过来</button>` : ''}
    <form class="inline-form" data-form="add-todo">
      <input name="text" placeholder="添加一件今天要做的事" maxlength="80" autocomplete="off" enterkeyhint="done">
      <button class="btn" type="submit">添加</button>
    </form>
  </section>`;
}

function diaryCard(e, text, hasDraft) {
  const written = isWritten(e);
  return `<section class="card">
    <div class="card-head">
      <h2>今日日记${written ? '<span class="tag">已保存</span>' : ''}</h2>
      ${written ? `<button class="btn small" data-act="open-poster" data-date="${e.date}">打卡海报</button>` : ''}
    </div>
    <textarea id="diary-text" data-date="${e.date}" rows="6" placeholder="今天做了什么？学到了什么？卡在哪里？&#10;小提示：写“做了哪类事”，别写项目代号和内部数据。">${escapeHtml(text)}</textarea>
    <div class="thumbs">
      ${e.images.map(id => `<div class="thumb">
        <img data-img-id="${id}" alt="日记图片" data-act="view-img" data-id="${id}">
        <button class="thumb-del" data-act="img-del" data-id="${id}" aria-label="删除图片">${ICON.x}</button>
      </div>`).join('')}
      ${e.images.length < MAX_IMAGES ? `<label class="thumb add" title="添加图片">${ICON.image}<input type="file" accept="image/*" multiple data-change="add-images" hidden aria-label="添加图片"></label>` : ''}
    </div>
    <div class="save-row">
      <span class="muted small" id="draft-state">${hasDraft ? '有未保存的修改（草稿已自动保留）' : ''}</span>
      <button class="btn primary" id="save-diary" data-act="save-diary" ${text.trim() ? '' : 'disabled'}>${written ? '更新日记' : '保存日记'}</button>
    </div>
  </section>`;
}

function timeCard(e) {
  const cats = catsFor(e);
  const total = sumTime(e.time);
  const done = e.todos.filter(t => t.done).length;
  return `<section class="card">
    <div class="card-head"><h2>时间复盘</h2><span class="muted small">下班后填一下</span></div>
    ${e.todos.length ? `<p class="plan-sum">今日计划 ${e.todos.length} 项，完成 ${done} 项</p>` : ''}
    ${total ? `<div class="timebar">${cats.filter(c => e.time[c]).map(c => `<span style="flex:${e.time[c]};background:${catColor(c)}" title="${escapeHtml(c)} ${fmtH(e.time[c])} 小时"></span>`).join('')}</div>` : ''}
    <ul class="cats">${cats.map(c => {
      const v = e.time[c] || 0;
      return `<li>
        <span class="dot" style="background:${catColor(c)}"></span>
        <span class="cat-name">${escapeHtml(c)}</span>
        <div class="stepper">
          <button class="icon-btn sm" data-act="time-dec" data-cat="${escapeHtml(c)}" ${v ? '' : 'disabled'} aria-label="${escapeHtml(c)}减少半小时">−</button>
          <span class="val ${v ? '' : 'muted'}">${fmtH(v)}h</span>
          <button class="icon-btn sm" data-act="time-inc" data-cat="${escapeHtml(c)}" aria-label="${escapeHtml(c)}增加半小时">+</button>
        </div>
      </li>`;
    }).join('')}</ul>
    <div class="time-total">${total ? `共 ${fmtH(total)} 小时` : '每按一次 + 记半小时'}</div>
  </section>`;
}

/* History */

function viewHistory() {
  const m = state.calMonth;
  const [y, mo] = m.split('-').map(Number);
  const today = todayStr();
  const offset = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  const daysIn = new Date(y, mo, 0).getDate();
  const cells = Array.from({ length: offset }, () => '<span></span>');
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${m}-${pad(d)}`;
    const e = state.entries.get(ds);
    const cls = [isWritten(e) ? 'written' : hasContent(e) ? 'partial' : '', ds === today ? 'today' : '', ds > today ? 'future' : ''].join(' ');
    cells.push(`<button class="cal-cell ${cls}" data-act="open-day" data-date="${ds}" ${ds > today ? 'disabled' : ''} aria-label="${fmtCN(ds)}">${d}</button>`);
  }
  const monthEntries = [...state.entries.values()].filter(e => e.date.startsWith(m) && hasContent(e)).sort((a, b) => b.date.localeCompare(a.date));
  const writtenCount = monthEntries.filter(isWritten).length;
  return `
    <h1 class="page-title">日记</h1>
    <section class="card">
      <div class="cal-head">
        <button class="icon-btn" data-act="cal-prev" aria-label="上个月">${ICON.left}</button>
        <b>${y} 年 ${mo} 月</b>
        <button class="icon-btn" data-act="cal-next" aria-label="下个月" ${m >= today.slice(0, 7) ? 'disabled' : ''}>${ICON.right}</button>
      </div>
      <div class="cal-grid">${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="cal-w">${w}</span>`).join('')}${cells.join('')}</div>
      <p class="muted small center">本月写了 ${writtenCount} 天 · 累计 ${streak().total} 篇</p>
    </section>
    ${monthEntries.length ? monthEntries.map(entryListItem).join('') : '<div class="empty-state">这个月还没有记录</div>'}`;
}

function entryListItem(e) {
  const total = sumTime(e.time);
  const done = e.todos.filter(t => t.done).length;
  const n = dayNumber(e.date);
  return `<button class="card entry-item" data-act="open-day" data-date="${e.date}">
    <div class="entry-top"><b>${fmtCN(e.date)}</b>${n > 0 ? `<span class="muted small">入职第 ${n} 天</span>` : ''}</div>
    <p class="entry-text">${isWritten(e) ? escapeHtml(e.text.trim().slice(0, 160)) : '<span class="muted">（还没写日记）</span>'}</p>
    <div class="entry-meta">
      ${e.todos.length ? `<span>计划完成 ${done}/${e.todos.length}</span>` : ''}
      ${total ? `<span>${fmtH(total)} 小时</span>` : ''}
      ${e.images.length ? `<span>${e.images.length} 张图</span>` : ''}
    </div>
    ${e.images.length ? `<div class="entry-thumbs">${e.images.slice(0, 3).map(id => `<img data-img-id="${id}" alt="">`).join('')}</div>` : ''}
  </button>`;
}

/* Streak & posters */

function viewStreak() {
  const s = streak();
  const next = MILESTONES.find(m => m > s.current);
  return `
    <h1 class="page-title">打卡</h1>
    <section class="card streak-hero">
      <div class="flame big">${ICON.flame}</div>
      <div class="streak-num">${s.current}<small>天</small></div>
      <div class="muted">当前连续打卡</div>
      <div class="streak-stats">
        <div><b>${s.longest}</b><span>最长连续</span></div>
        <div><b>${s.total}</b><span>累计篇数</span></div>
        <div><b>${next ? next - s.current : '—'}</b><span>${next ? `天后达成 ${next} 天` : '全部达成'}</span></div>
      </div>
      ${s.writtenToday
        ? `<button class="btn primary block" data-act="open-poster" data-date="${todayStr()}">生成今天的打卡海报</button>`
        : '<button class="btn primary block" data-act="goto" data-view="today">去写今天的日记</button>'}
      <p class="hint">${state.settings.skipWeekends ? '周末不写不算断签，写了照样计数。' : '每天都要写才算连续。'}可以在「我的」里修改。</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>里程碑</h2><span class="muted small">按最长连续天数</span></div>
      <div class="milestones">${MILESTONES.map(m => `<div class="ms ${s.longest >= m ? 'on' : ''}"><b>${m}</b><span>天</span></div>`).join('')}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>海报主题</h2><span class="muted small">连续打卡解锁</span></div>
      <div class="themes">${THEMES.map(t => {
        const ok = s.longest >= t.unlock;
        const sel = state.settings.posterTheme === t.id;
        return `<button class="theme-swatch ${ok ? '' : 'locked'} ${sel ? 'sel' : ''}" data-act="pick-theme" data-id="${t.id}" ${ok ? '' : 'disabled'}
          style="background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]});color:${t.text}">
          <b>${t.name}</b><span>${ok ? (sel ? '使用中' : '已解锁') : `${ICON.lock}连续 ${t.unlock} 天解锁`}</span>
        </button>`;
      }).join('')}</div>
    </section>`;
}

function posterData(date, quote, showCompany) {
  const e = entryOf(date);
  const d = parseDate(date);
  const time = Object.entries(e.time || {}).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]).map(([name, h]) => ({ name, h, color: catColor(name) }));
  return {
    dateLabel: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${weekdayCN(date)}`,
    streak: streak(date).current,
    dayN: dayNumber(date),
    role: state.profile.role,
    company: showCompany ? state.profile.company : '',
    quote: quote.trim() || defaultQuote(e.text),
    todoDone: e.todos.filter(t => t.done).length,
    todoTotal: e.todos.length,
    time,
    totalH: sumTime(e.time),
  };
}

function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'poster.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function openPoster(date, { celebrate = false, newly = [] } = {}) {
  const e = entryOf(date);
  const count = streak(date).current;
  const unlocked = THEMES.filter(t => streak().longest >= t.unlock);
  let themeId = newly.length ? newly[newly.length - 1].id
    : unlocked.some(t => t.id === state.settings.posterTheme) ? state.settings.posterTheme : unlocked[0].id;
  const next = MILESTONES.find(m => m > count);
  const head = celebrate
    ? `<div class="celebrate"><div class="flame big">${ICON.flame}</div>
        <h2>打卡成功！连续 ${count} 天</h2>
        <p>${newly.length ? `解锁了新海报主题：<b>${newly.map(t => t.name).join('、')}</b>` : next ? `再坚持 ${next - count} 天，就到 ${next} 天里程碑` : '所有里程碑都达成了，了不起'}</p>
      </div>`
    : '<h2 class="modal-title">打卡海报</h2>';
  const share = canShareFiles();
  openModal(`${head}
    <div class="poster-wrap"><canvas id="poster-canvas" role="img" aria-label="打卡海报预览"></canvas></div>
    <div class="chips theme-row">${unlocked.map(t => `<button type="button" class="chip ${t.id === themeId ? 'sel' : ''}" data-theme="${t.id}">${t.name}</button>`).join('')}</div>
    <label class="field"><span>海报上的一句话</span><textarea id="poster-quote" rows="2" maxlength="80">${escapeHtml(e.posterQuote ?? defaultQuote(e.text))}</textarea></label>
    <label class="switch"><input type="checkbox" id="poster-company" ${state.settings.posterShowCompany ? 'checked' : ''}><span>海报上显示公司名</span></label>
    <div class="btn-row">
      <button type="button" class="btn" data-modal-close>关闭</button>
      <button type="button" class="btn primary" id="poster-save">保存图片</button>
      ${share ? '<button type="button" class="btn" id="poster-share">分享</button>' : ''}
    </div>`, sheet => {
    const canvas = $('#poster-canvas', sheet);
    const quoteEl = $('#poster-quote', sheet);
    const companyEl = $('#poster-company', sheet);
    let blob = null;
    const draw = () => {
      renderPoster(canvas, posterData(date, quoteEl.value, companyEl.checked), THEMES.find(t => t.id === themeId));
      blob = null;
      canvas.toBlob(b => { blob = b; }, 'image/png');
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
      canvas.toBlob(b => downloadBlob(b, `打卡海报_${date}.png`), 'image/png');
    });
    // navigator.share has to run inside the tap itself, so the image is prepared in advance.
    $('#poster-share', sheet)?.addEventListener('click', async () => {
      if (!blob) {
        toast('海报还在生成，请再点一次');
        return;
      }
      try {
        await navigator.share({ files: [new File([blob], `poster-${date}.png`, { type: 'image/png' })] });
      } catch (err) {
        if (err.name !== 'AbortError') toast('分享失败，可以先保存图片');
      }
    });
  });
}

/* Export & LinkedIn */

function exportRange() {
  const today = todayStr();
  const x = state.exp;
  if (x.range === 'week') return { from: addDays(today, -((parseDate(today).getDay() + 6) % 7)), to: today };
  if (x.range === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (x.range === 'all') {
    const first = [...state.entries.values()].filter(hasContent).map(e => e.date).sort()[0];
    return { from: first && first < state.profile.startDate ? first : state.profile.startDate, to: today };
  }
  let from = x.from || addDays(today, -6);
  let to = x.to || today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
const entriesBetween = (from, to) => [...state.entries.values()]
  .filter(e => e.date >= from && e.date <= to && hasContent(e))
  .sort((a, b) => a.date.localeCompare(b.date));

function viewExport() {
  const { from, to } = exportRange();
  const list = entriesBetween(from, to);
  const x = state.exp;
  const aiOn = ai.hasKey();
  const anyText = list.some(isWritten);
  const seg = (act, key, options) => `<div class="seg">${options.map(([v, l]) => `<button class="${key === v ? 'sel' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const dis = list.length ? '' : 'disabled';
  return `
    <h1 class="page-title">导出</h1>
    <section class="card">
      <div class="card-head"><h2>导出日记</h2></div>
      <div class="field"><span>范围</span>${seg('exp-range', x.range, [['week', '本周'], ['month', '本月'], ['all', '全部'], ['custom', '自定义']])}</div>
      ${x.range === 'custom'
        ? `<div class="two">
            <label class="field"><span>从</span><input type="date" data-change="exp-from" value="${from}" max="${todayStr()}"></label>
            <label class="field"><span>到</span><input type="date" data-change="exp-to" value="${to}" max="${todayStr()}"></label>
          </div>`
        : `<p class="muted small" style="margin:-4px 0 12px">${from} 至 ${to}</p>`}
      <div class="field"><span>包含</span><div class="checks">
        <label><input type="checkbox" checked disabled> 日记正文</label>
        <label><input type="checkbox" data-change="exp-opt" data-key="images" ${x.images ? 'checked' : ''}> 图片</label>
        <label><input type="checkbox" data-change="exp-opt" data-key="todos" ${x.todos ? 'checked' : ''}> 今日计划</label>
        <label><input type="checkbox" data-change="exp-opt" data-key="time" ${x.time ? 'checked' : ''}> 时间复盘</label>
      </div></div>
      <div class="field"><span>语言</span>${seg('exp-lang', x.lang, [['zh', '中文原文'], ['en', '英文（AI 翻译）']])}
        ${x.lang === 'en' && !aiOn ? '<p class="warn small">翻译需要先在「我的」里填 Claude API Key。</p>' : ''}
      </div>
      <p class="count">共 <b>${list.length}</b> 天的记录</p>
      <div class="btn-row">
        <button class="btn primary" data-act="export" data-fmt="docx" ${dis}>Word</button>
        <button class="btn primary" data-act="export" data-fmt="pdf" ${dis}>PDF</button>
        <button class="btn primary" data-act="export" data-fmt="md" ${dis}>Markdown</button>
      </div>
      <p class="hint">PDF 会打开系统的打印窗口，目标选「存储为 PDF」即可。</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>生成 LinkedIn 帖子</h2></div>
      <p class="muted small" style="margin-bottom:12px">用上面选的范围（${from} 至 ${to}）里的日记写一条帖子。</p>
      ${aiOn ? `<div class="field"><span>帖子语言</span>${seg('li-lang', state.li.lang, [['en', 'English'], ['zh', '中文']])}</div>` : ''}
      <label class="switch"><input type="checkbox" data-change="li-company" ${state.li.mentionCompany ? 'checked' : ''}><span>帖子里写出公司名</span></label>
      <button class="btn primary block" data-act="li-generate" ${anyText ? '' : 'disabled'}>${aiOn ? 'AI 生成帖子' : '用模板生成（中文）'}</button>
      ${aiOn ? '' : '<p class="hint">在「我的」里填 Claude API Key 后，可以让 AI 写中文或英文帖子。没有 Key 也可以先用模板，或者复制提示词，粘贴到任意 AI 助手里。</p>'}
      <textarea id="li-text" rows="10" placeholder="生成的帖子会出现在这里，可以直接修改">${escapeHtml(state.li.text)}</textarea>
      <div class="btn-row">
        <button class="btn primary" data-act="li-open" ${state.li.text.trim() ? '' : 'disabled'}>复制并打开 LinkedIn</button>
        <button class="btn" data-act="li-prompt" ${anyText ? '' : 'disabled'}>复制 AI 提示词</button>
      </div>
      <p class="hint">LinkedIn 不支持从网页带图片直接发帖，打卡海报需要在 LinkedIn 里手动添加。</p>
    </section>`;
}

function busy(btn, on) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = '处理中…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
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
    const model = exporter.buildModel({ entries: list, profile: state.profile, from, to, lang: x.lang, include: x, images, tr });
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
  const entries = entriesBetween(from, to).filter(isWritten).map(e => ({
    date: e.date,
    day: dayNumber(e.date),
    text: e.text.trim(),
    done: e.todos.filter(t => t.done).map(t => t.text),
    time: Object.entries(e.time || {}).filter(([, h]) => h > 0).map(([cat, h]) => ({ cat, h })),
  }));
  return { entries, profile: state.profile, lang: state.li.lang, mentionCompany: state.li.mentionCompany, from, to };
}

function templatePost({ entries, profile, mentionCompany, from, to }) {
  const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const firstLine = t => {
    const line = t.split('\n').map(s => s.trim()).find(Boolean) || '';
    return line.length > 40 ? line.slice(0, 40) + '…' : line;
  };
  const totals = {};
  entries.forEach(e => e.time.forEach(t => { totals[t.cat] = (totals[t.cat] || 0) + t.h; }));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  const role = profile.role.replace(/\s+/g, '');
  return [
    `实习成长记录｜${md(from)}–${md(to)}`,
    '',
    `作为${profile.role}${mentionCompany ? `（${profile.company}）` : ''}，这段时间我主要在做：`,
    ...entries.slice(-5).map(e => `· ${firstLine(e.text)}`),
    ...(top ? ['', `时间花得最多的是「${top[0]}」，共 ${fmtH(top[1])} 小时。`] : []),
    '',
    '这段时间最大的收获：（在这里写一句你自己的感受）',
    '',
    `#实习 #成长记录 #${role}`,
  ].join('\n');
}

async function generatePost(btn) {
  const args = postArgs();
  if (!args.entries.length) return;
  if (!ai.hasKey()) {
    state.li.text = templatePost(args);
    render();
    toast('已用模板生成，可以直接修改');
    return;
  }
  busy(btn, true);
  try {
    state.li.text = await ai.draftLinkedInPost(args);
    render();
    toast('帖子写好了，发之前再读一遍');
  } catch (err) {
    console.error(err);
    toast(err.message || '生成失败', 4000);
    busy(btn, false);
  }
}

function openLinkedIn() {
  const text = state.li.text.trim();
  if (!text) return;
  copyText(text);
  window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  toast('帖子已复制。如果 LinkedIn 没有自动填好，直接粘贴即可', 4000);
}

/* Settings */

function viewSettings() {
  const p = state.profile;
  const s = state.settings;
  const cfg = ai.config();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const notifyLabel = { granted: '浏览器通知已开启', denied: '通知被浏览器拒绝了', unsupported: '这个浏览器不支持通知' }[perm] || '开启浏览器通知';
  const lastBackup = store.get('lastBackup');
  return `
    <h1 class="page-title">我的</h1>
    <form class="card" data-form="profile">
      <div class="card-head"><h2>我的实习</h2></div>
      ${profileFields(p)}
      <button class="btn primary block" type="submit">保存</button>
    </form>

    <section class="card">
      <div class="card-head"><h2>每日提醒</h2></div>
      <label class="field row"><span>提醒时间</span><input type="time" data-change="reminder-time" value="${s.reminderTime}"></label>
      <label class="switch"><input type="checkbox" data-change="skip-weekends" ${s.skipWeekends ? 'checked' : ''}><span>周末不写不算断签（日历只在工作日提醒）</span></label>
      <div class="btn-row">
        <button class="btn primary" data-act="download-ics">添加到手机日历</button>
        <button class="btn" data-act="enable-notify" ${perm === 'default' ? '' : 'disabled'}>${notifyLabel}</button>
      </div>
      <p class="hint">网页 App 关掉以后没法自己弹提醒。最稳的是「添加到手机日历」，每天到点由日历提醒你；改了提醒时间要重新添加一次。浏览器通知只在 App 开着时有效。</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>时间复盘类别</h2></div>
      <div class="chips">${s.categories.map(c => `<span class="chip"><span class="dot" style="background:${catColor(c)}"></span>${escapeHtml(c)}<button data-act="cat-del" data-cat="${escapeHtml(c)}" aria-label="删除类别 ${escapeHtml(c)}">${ICON.x}</button></span>`).join('')}</div>
      <form class="inline-form" data-form="add-cat">
        <input name="name" maxlength="10" placeholder="添加类别，比如：跑实验" autocomplete="off">
        <button class="btn" type="submit">添加</button>
      </form>
    </section>

    <form class="card" data-form="ai">
      <div class="card-head"><h2>AI 翻译与帖子（可选）</h2></div>
      <p class="muted small" style="margin-bottom:12px">用来把日记翻译成英文、生成 LinkedIn 帖子。需要你自己的 Claude API Key（在 console.anthropic.com 创建，按用量付费）。</p>
      <label class="field"><span>Claude API Key</span><input name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${escapeHtml(cfg.apiKey || '')}"></label>
      <label class="field"><span>模型</span><select name="model">${ai.MODELS.map(m => `<option value="${m.id}" ${m.id === (cfg.model || ai.DEFAULT_MODEL) ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      <div class="btn-row">
        <button class="btn primary" type="submit">保存</button>
        <button class="btn" type="button" data-act="test-ai">测试连接</button>
      </div>
      <p class="hint">Key 只存在这台设备上，不会写进备份文件。只有你点「翻译」或「生成」时，选中范围内的日记才会发给 Anthropic。</p>
    </form>

    <section class="card">
      <div class="card-head"><h2>数据</h2></div>
      <p class="muted small">日记只保存在这台设备的浏览器里。换手机、清理浏览器数据之前，先导出备份。${lastBackup ? `上次备份：${lastBackup}。` : '还没有备份过。'}</p>
      <div class="btn-row">
        <button class="btn" data-act="backup-export">导出备份</button>
        <label class="btn">从备份恢复<input type="file" accept="application/json,.json" data-change="backup-import" hidden></label>
      </div>
      <button class="btn danger block" data-act="clear-all">清空全部数据</button>
    </section>
    <p class="muted small center">实习成长日记 v1.0</p>`;
}

/* ---------- Modal ---------- */

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

/* ---------- Actions ---------- */

async function saveDiary() {
  const ta = $('#diary-text');
  if (!ta) return;
  const text = ta.value.replace(/\s+$/, '');
  if (!text.trim()) {
    toast('写一句话再保存吧');
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
  if (!wasWritten && date === todayStr()) {
    openPoster(date, { celebrate: true, newly });
  } else {
    toast(newly.length ? `解锁新海报主题：${newly.map(t => t.name).join('、')}` : wasWritten ? '日记已更新' : '补写成功');
  }
}

async function changeTime(cat, delta) {
  const e = ensureEntry(state.date);
  const v = Math.max(0, Math.round(((e.time[cat] || 0) + delta) * 2) / 2);
  if (delta > 0 && sumTime(e.time) + delta > 24) {
    toast('一天最多 24 小时');
    return;
  }
  if (v) e.time[cat] = v;
  else delete e.time[cat];
  await persist(e);
  render();
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
  goto: el => go(el.dataset.view),
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
  'img-del': async el => {
    if (!confirm('删除这张图片？')) return;
    const id = el.dataset.id;
    const e = ensureEntry(state.date);
    e.images = e.images.filter(x => x !== id);
    await persist(e);
    await db.deleteImage(id);
    imageCache.delete(id);
    render();
  },
  'view-img': async el => {
    const img = await loadImage(el.dataset.id);
    if (img) openModal(`<img class="full-img" src="${img.data}" alt="日记图片"><div class="btn-row"><button class="btn" data-modal-close>关闭</button></div>`);
  },
  'save-diary': saveDiary,
  'time-inc': el => changeTime(el.dataset.cat, 0.5),
  'time-dec': el => changeTime(el.dataset.cat, -0.5),
  'open-poster': el => openPoster(el.dataset.date),
  'open-day': el => {
    state.date = el.dataset.date;
    state.followToday = state.date === todayStr();
    go('today');
  },
  'cal-prev': () => {
    state.calMonth = shiftMonth(state.calMonth, -1);
    render();
  },
  'cal-next': () => {
    state.calMonth = shiftMonth(state.calMonth, 1);
    render();
  },
  'pick-theme': async el => {
    state.settings.posterTheme = el.dataset.id;
    await saveSettings();
    render();
  },
  'exp-range': el => {
    state.exp.range = el.dataset.v;
    if (el.dataset.v === 'custom' && !state.exp.from) {
      state.exp.from = addDays(todayStr(), -6);
      state.exp.to = todayStr();
    }
    render();
  },
  'exp-lang': el => {
    state.exp.lang = el.dataset.v;
    render();
  },
  export: el => doExport(el.dataset.fmt, el),
  'li-lang': el => {
    state.li.lang = el.dataset.v;
    render();
  },
  'li-generate': el => generatePost(el),
  'li-open': openLinkedIn,
  'li-prompt': async () => {
    const args = postArgs();
    if (!args.entries.length) return;
    await copyText(ai.linkedInPromptText(args));
    toast('提示词已复制，粘贴到任意 AI 助手里就能生成帖子', 4000);
  },
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
  'cat-del': async el => {
    const c = el.dataset.cat;
    if (state.settings.categories.length <= 1) {
      toast('至少保留一个类别');
      return;
    }
    state.settings.categories = state.settings.categories.filter(x => x !== c);
    await saveSettings();
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
    const data = { app: 'intern-diary', version: 1, exportedAt: new Date().toISOString(), profile: state.profile, settings: state.settings, entries, images };
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `实习日记备份_${todayStr()}.json`);
    store.set('lastBackup', todayStr());
    render();
  },
  'clear-all': async () => {
    if (!confirm('确定清空全部日记、图片和设置（包括 API Key）吗？')) return;
    if (!confirm('清空后无法恢复。建议先「导出备份」。真的要清空吗？')) return;
    await db.clearAll();
    Object.keys(localStorage).filter(k => k.startsWith('draft:')).forEach(k => store.del(k));
    ['lastBackup', 'notified', 'en-labels', 'ai'].forEach(k => store.del(k));
    state.profile = null;
    state.entries.clear();
    imageCache.clear();
    state.settings = { ...DEFAULT_SETTINGS };
    state.view = 'today';
    render();
    toast('已清空');
  },
};

const CHANGES = {
  'todo-toggle': async el => {
    const e = ensureEntry(state.date);
    const t = e.todos.find(x => x.id === el.dataset.id);
    if (!t) return;
    t.done = el.checked;
    await persist(e);
    render();
  },
  'add-images': async el => {
    const files = [...el.files];
    el.value = '';
    const e = ensureEntry(state.date);
    const room = MAX_IMAGES - e.images.length;
    if (files.length > room) toast(`每天最多 ${MAX_IMAGES} 张，只添加了前 ${room} 张`);
    for (const f of files.slice(0, room)) {
      try {
        const img = { id: uid(), ...(await compressImage(f)) };
        await db.putImage(img);
        imageCache.set(img.id, img);
        e.images.push(img.id);
      } catch {
        toast('有一张图片读不出来，换一张试试');
      }
    }
    await persist(e);
    render();
  },
  'exp-from': el => {
    state.exp.from = el.value;
    render();
  },
  'exp-to': el => {
    state.exp.to = el.value;
    render();
  },
  'exp-opt': el => { state.exp[el.dataset.key] = el.checked; },
  'li-company': el => { state.li.mentionCompany = el.checked; },
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
      ? `备份里有 ${data.entries.length} 天的记录。恢复会覆盖这台设备上现在的全部日记，确定吗？`
      : `从备份恢复 ${data.entries.length} 天的记录？`;
    if (!confirm(prompt)) return;
    await db.restore(data);
    imageCache.clear();
    await boot();
    toast('恢复完成');
  },
};

const FORMS = {
  profile: async form => {
    const d = Object.fromEntries(new FormData(form));
    const p = { company: d.company.trim(), department: d.department.trim(), role: d.role.trim(), startDate: d.startDate };
    if (!p.company || !p.role || !p.startDate) {
      toast('公司、岗位名称和入职日期都要填');
      return;
    }
    const first = !state.profile;
    state.profile = p;
    await db.setKV('profile', p);
    if (first) {
      await saveSettings();
      state.view = 'today';
      render();
      window.scrollTo(0, 0);
      toast('设置好了，写下今天的第一篇吧');
    } else {
      render();
      toast('已保存');
    }
  },
  'add-todo': async form => {
    const text = form.elements.text.value.trim();
    if (!text) return;
    const e = ensureEntry(state.date);
    e.todos.push({ id: uid(), text, done: false });
    await persist(e);
    render();
    $('form[data-form="add-todo"] input')?.focus();
  },
  'add-cat': async form => {
    const name = form.elements.name.value.trim();
    if (!name) return;
    if (state.settings.categories.includes(name)) {
      toast('已经有这个类别了');
      return;
    }
    if (state.settings.categories.length >= MAX_CATEGORIES) {
      toast(`最多 ${MAX_CATEGORIES} 个类别`);
      return;
    }
    state.settings.categories = [...state.settings.categories, name];
    await saveSettings();
    render();
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
  if (t.id === 'diary-text') {
    autosize(t);
    const changed = t.value !== entryOf(t.dataset.date).text;
    $('#save-diary').disabled = !t.value.trim();
    $('#draft-state').textContent = changed ? '有未保存的修改（草稿已自动保留）' : '';
    writeDraftSoon(t.dataset.date, t.value);
  } else if (t.id === 'li-text') {
    state.li.text = t.value;
    const btn = $('[data-act="li-open"]');
    if (btn) btn.disabled = !t.value.trim();
  }
});
app.addEventListener('keydown', ev => {
  if (ev.target.id === 'diary-text' && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    saveDiary();
  }
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
  else syncToday();
});
window.addEventListener('pagehide', captureDraft);
setInterval(syncToday, 60000);

/* ---------- Boot ---------- */

async function boot() {
  const [profile, settings, entries] = await Promise.all([db.getKV('profile'), db.getKV('settings'), db.allEntries()]);
  state.profile = profile || null;
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.entries = new Map(entries.map(e => [e.date, e]));
  state.date = todayStr();
  state.followToday = true;
  render();
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
