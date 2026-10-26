import { fmtCN, fmtEN, fmtH, fmtMin, daysBetween, escapeHtml, dataURLToBytes } from './util.js';

// Loaded only when someone exports to Word, so the app itself stays light.
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js';

export const CAT_EN = {
  开会: 'Meetings',
  写文档: 'Writing docs',
  数据分析: 'Data analysis',
  写代码: 'Coding',
  沟通对接: 'Coordination',
  学习: 'Learning',
  杂事: 'Admin & misc',
};

const LABELS = {
  zh: {
    title: '实习成长日记', plan: '待办', diary: '日记', time: '时间复盘', cat: '类别', hours: '小时',
    minutes: fmtMin, spent: m => `用时共 ${fmtMin(m)}`,
    total: h => `共 ${h} 小时`, start: d => `入职日期：${d}`, range: (a, b, n) => `记录范围：${a} 至 ${b}，共 ${n} 天`, day: n => `入职第 ${n} 天`,
  },
  en: {
    title: 'Internship Growth Diary', plan: 'To-dos', diary: 'Diary', time: 'Time review', cat: 'Category', hours: 'Hours',
    minutes: m => (m < 60 ? `${m} min` : `${fmtH(m / 60)} h`), spent: m => `Time spent: ${m < 60 ? `${m} min` : `${fmtH(m / 60)} h`}`,
    total: h => `Total: ${h} h`, start: d => `Start date: ${d}`, range: (a, b, n) => `${a} to ${b} · ${n} days`, day: n => `Day ${n}`,
  },
};

const sumHours = time => time.reduce((s, t) => s + t.h, 0);
const todoLine = (m, t) => `${t.text}${t.minutes ? `（${m.L.minutes(t.minutes)}）` : ''}`;
const spentOf = todos => todos.reduce((s, t) => s + (t.minutes || 0), 0);

// One neutral model of the export, rendered three ways below.
// tr (English only): { entries: Map(date -> { text, todos }), labels: { 中文: English } }
export function buildModel({ entries, profile, from, to, lang, include, images, tr }) {
  const L = LABELS[lang];
  const en = lang === 'en';
  const label = s => (en && s && tr?.labels?.[s]) || s;
  const cat = c => (en ? CAT_EN[c] || label(c) : c);
  const org = [label(profile.company), label(profile.department)].filter(Boolean).join(' · ');
  const meta = [[label(profile.role), org].filter(Boolean).join(' · '), L.start(profile.startDate), L.range(from, to, entries.length)];
  const days = entries.map(e => {
    const t = en ? tr?.entries?.get(e.date) : null;
    const n = daysBetween(profile.startDate, e.date) + 1;
    const date = en ? fmtEN(e.date) : fmtCN(e.date, true);
    return {
      heading: n > 0 ? `${date} · ${L.day(n)}` : date,
      todos: include.todos ? e.todos.map((x, i) => ({ text: t?.todos?.[i] || x.text, done: x.done, minutes: include.time && x.done ? x.minutes || 0 : 0 })) : [],
      text: (t ? t.text : e.text || '').trim(),
      images: include.images ? e.images.map(id => images.get(id)).filter(Boolean) : [],
      time: include.time
        ? Object.entries(e.time || {}).filter(([, h]) => h > 0).sort((a, b) => b[1] - a[1]).map(([c, h]) => ({ cat: cat(c), h }))
        : [],
    };
  });
  return { lang, L, title: L.title, meta, days, from, to };
}

export const fileName = (m, ext) => `${m.lang === 'en' ? 'internship-diary' : '实习成长日记'}_${m.from}_${m.to}.${ext}`;

export function toMarkdown(m) {
  const out = [`# ${m.title}`, '', ...m.meta.map(x => `${x}  `), '', '---', ''];
  for (const d of m.days) {
    out.push(`## ${d.heading}`, '');
    if (d.todos.length) {
      out.push(`### ${m.L.plan}`, '', ...d.todos.map(t => `- [${t.done ? 'x' : ' '}] ${todoLine(m, t)}`), '');
      if (spentOf(d.todos)) out.push(m.L.spent(spentOf(d.todos)), '');
    }
    if (d.text) out.push(`### ${m.L.diary}`, '', d.text.replace(/\n/g, '  \n'), '');
    for (const img of d.images) out.push(`![](${img.data})`, '');
    if (d.time.length) {
      out.push(`### ${m.L.time}`, '', `| ${m.L.cat} | ${m.L.hours} |`, '| --- | ---: |');
      out.push(...d.time.map(t => `| ${t.cat} | ${fmtH(t.h)} |`), '', m.L.total(fmtH(sumHours(d.time))), '');
    }
  }
  return out.join('\n');
}

let docxLib;
function loadDocx() {
  return (docxLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = DOCX_URL;
    s.onload = () => resolve(window.docx);
    s.onerror = () => {
      docxLib = null;
      s.remove();
      reject(new Error('Word 导出组件加载失败，请检查网络'));
    };
    document.head.appendChild(s);
  }));
}

export async function toDocx(m) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType } = await loadDocx();
  const para = (text, run = {}) => new Paragraph({ children: [new TextRun({ text, ...run })] });
  const heading = (text, level) => new Paragraph({ heading: level, children: [new TextRun(text)] });
  const cell = (text, bold = false) => new TableCell({
    width: { size: 2400, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });

  const children = [heading(m.title, HeadingLevel.TITLE), ...m.meta.map(x => para(x, { color: '666666' }))];
  for (const d of m.days) {
    children.push(heading(d.heading, HeadingLevel.HEADING_1));
    if (d.todos.length) {
      children.push(heading(m.L.plan, HeadingLevel.HEADING_3));
      d.todos.forEach(t => children.push(para(`${t.done ? '☑' : '☐'} ${todoLine(m, t)}`)));
      if (spentOf(d.todos)) children.push(para(m.L.spent(spentOf(d.todos)), { color: '666666' }));
    }
    if (d.text) {
      children.push(heading(m.L.diary, HeadingLevel.HEADING_3));
      d.text.split('\n').forEach(line => children.push(para(line)));
    }
    for (const img of d.images) {
      const scale = Math.min(1, 420 / img.w);
      children.push(new Paragraph({
        children: [new ImageRun({
          type: 'jpg',
          data: dataURLToBytes(img.data),
          transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) },
        })],
      }));
    }
    if (d.time.length) {
      children.push(heading(m.L.time, HeadingLevel.HEADING_3));
      children.push(new Table({
        width: { size: 4800, type: WidthType.DXA },
        columnWidths: [2400, 2400],
        rows: [
          new TableRow({ children: [cell(m.L.cat, true), cell(m.L.hours, true)] }),
          ...d.time.map(t => new TableRow({ children: [cell(t.cat), cell(fmtH(t.h))] })),
        ],
      }));
      children.push(para(m.L.total(fmtH(sumHours(d.time))), { color: '666666' }));
    }
  }

  const doc = new Document({
    creator: '实习成长日记',
    title: m.title,
    styles: { default: { document: { run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }, size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

// PDF goes through the system print dialog ("Save as PDF"): Chinese text stays sharp and selectable.
export async function printPDF(m) {
  const root = document.getElementById('print-root');
  root.innerHTML = `<article class="print-doc">
    <h1>${escapeHtml(m.title)}</h1>
    ${m.meta.map(x => `<p class="meta">${escapeHtml(x)}</p>`).join('')}
    <hr>
    ${m.days.map(d => `<section class="print-day">
      <h2>${escapeHtml(d.heading)}</h2>
      ${d.todos.length ? `<h3>${m.L.plan}</h3><ul>${d.todos.map(t => `<li>${t.done ? '☑' : '☐'} ${escapeHtml(todoLine(m, t))}</li>`).join('')}</ul>${spentOf(d.todos) ? `<p class="meta">${m.L.spent(spentOf(d.todos))}</p>` : ''}` : ''}
      ${d.text ? `<h3>${m.L.diary}</h3><div class="print-text">${escapeHtml(d.text)}</div>` : ''}
      ${d.images.length ? `<div class="print-imgs">${d.images.map(i => `<img src="${i.data}" alt="">`).join('')}</div>` : ''}
      ${d.time.length ? `<h3>${m.L.time}</h3>
        <table><tr><th>${m.L.cat}</th><th>${m.L.hours}</th></tr>${d.time.map(t => `<tr><td>${escapeHtml(t.cat)}</td><td>${fmtH(t.h)}</td></tr>`).join('')}</table>
        <p class="meta">${m.L.total(fmtH(sumHours(d.time)))}</p>` : ''}
    </section>`).join('')}
  </article>`;
  await Promise.all([...root.querySelectorAll('img')].map(i => i.decode().catch(() => {})));

  const prevTitle = document.title;
  document.title = fileName(m, 'pdf').replace(/\.pdf$/, '');
  const cleanup = () => {
    root.innerHTML = '';
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(() => { if (root.innerHTML) cleanup(); }, 60000);
}
