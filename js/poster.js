import { fmtH } from './util.js';

const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif';

// unlock = longest streak (in days) needed to use the theme.
export const THEMES = [
  { id: 'plain', name: '晨白', unlock: 0, bg: ['#FBFAF6', '#ECE8DE'], text: '#1D1F1E', sub: '#6B706C', accent: '#1F7A5C', card: 'rgba(31,122,92,0.08)' },
  { id: 'mint', name: '薄荷', unlock: 3, bg: ['#E8F7EF', '#BBE3CE'], text: '#12392B', sub: '#3D6656', accent: '#16805B', card: 'rgba(255,255,255,0.62)' },
  { id: 'dusk', name: '晚霞', unlock: 7, bg: ['#FFE4C9', '#F29E7C'], text: '#3A1C0F', sub: '#7B4631', accent: '#C2412D', card: 'rgba(255,255,255,0.5)', glow: [[920, 180, 560, 'rgba(255,244,214,0.75)']] },
  { id: 'night', name: '夜航', unlock: 14, bg: ['#22305A', '#0B1124'], text: '#F2F4FF', sub: '#A7B1D8', accent: '#FFC567', card: 'rgba(255,255,255,0.08)', stars: true },
  { id: 'kraft', name: '牛皮纸', unlock: 21, bg: ['#EADBBD', '#D2B888'], text: '#3A2A12', sub: '#6D5531', accent: '#8C4A12', card: 'rgba(255,255,255,0.38)', grain: 0.07 },
  { id: 'gold', name: '鎏金', unlock: 30, bg: ['#2C2318', '#110C06'], text: '#F6E6C0', sub: '#BBA374', accent: '#E3B75A', card: 'rgba(227,183,90,0.10)', frame: true },
  { id: 'aurora', name: '极光', unlock: 100, bg: ['#0A2433', '#1A0E36'], text: '#EEFFF9', sub: '#9ED6CC', accent: '#7BF0C6', card: 'rgba(255,255,255,0.07)', glow: [[180, 300, 640, 'rgba(60,220,170,0.38)'], [940, 760, 620, 'rgba(140,90,255,0.32)']] },
];

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function ellipsize(g, s, maxW) {
  if (g.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && g.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

// Chinese breaks between any two characters; Latin words stay whole unless too long for a line.
const CJK = '⺀-鿿豈-﫿＀-￯　-〿';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

function wrapLines(g, text, maxW, maxLines) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const raw of para.match(TOKEN) || []) {
      const parts = g.measureText(raw).width > maxW ? [...raw] : [raw];
      for (const tk of parts) {
        if (!line || g.measureText(line + tk).width <= maxW) {
          line += tk;
        } else {
          lines.push(line.trimEnd());
          line = tk.trimStart();
        }
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = ellipsize(g, lines[maxLines - 1] + '…', maxW);
  }
  return lines.length ? lines : [''];
}

// d: { dateLabel, streak, dayN, role, company, quote, todoDone, todoTotal, time: [{ name, h, color }], totalH }
export function renderPoster(canvas, d, theme) {
  const W = 1080, H = 1440, P = 88;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  const bg = g.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(1, theme.bg[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, c] of theme.glow || []) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }
  if (theme.stars) {
    const rnd = rng(7);
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.6;
      g.beginPath();
      g.arc(rnd() * W, rnd() * H * 0.55, 1 + rnd() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  if (theme.grain) {
    const rnd = rng(3);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
      g.globalAlpha = rnd() * theme.grain;
      g.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    g.globalAlpha = 1;
  }
  if (theme.frame) {
    g.strokeStyle = theme.accent;
    g.globalAlpha = 0.6;
    g.lineWidth = 3;
    g.strokeRect(36, 36, W - 72, H - 72);
    g.lineWidth = 1.5;
    g.strokeRect(50, 50, W - 100, H - 100);
    g.globalAlpha = 1;
  }

  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  g.font = `600 32px ${FONT}`;
  g.fillStyle = theme.sub;
  g.fillText('实习成长日记', P, 132);
  g.textAlign = 'right';
  g.font = `500 32px ${FONT}`;
  g.fillText(d.dateLabel, W - P, 132);
  g.textAlign = 'left';

  g.font = `600 44px ${FONT}`;
  g.fillStyle = theme.text;
  g.fillText('连续打卡', P, 270);
  g.font = `800 280px ${FONT}`;
  g.fillStyle = theme.accent;
  const num = String(d.streak);
  g.fillText(num, P - 12, 530);
  const numW = g.measureText(num).width;
  g.font = `700 72px ${FONT}`;
  g.fillStyle = theme.text;
  g.fillText('天', P - 12 + numW + 16, 530);

  const who = [d.dayN > 0 ? `入职第 ${d.dayN} 天` : '', d.company ? `${d.role} @ ${d.company}` : d.role].filter(Boolean).join(' · ');
  g.font = `500 36px ${FONT}`;
  g.fillStyle = theme.sub;
  g.fillText(ellipsize(g, who, W - 2 * P), P, 610);

  const cardY = 668, cardW = W - 2 * P, padX = 52, lh = 72;
  g.font = `500 46px ${FONT}`;
  // Text stops short of the right edge, where the large quote mark sits.
  const lines = wrapLines(g, d.quote, cardW - padX - 130, 3);
  const cardH = 110 + (lines.length - 1) * lh + 60;
  roundRect(g, P, cardY, cardW, cardH, 32);
  g.fillStyle = theme.card;
  g.fill();
  g.save();
  g.globalAlpha = 0.16;
  g.fillStyle = theme.accent;
  g.font = `700 260px Georgia, "Times New Roman", serif`;
  g.textAlign = 'right';
  g.fillText('”', P + cardW - 24, cardY + 228);
  g.restore();
  g.fillStyle = theme.text;
  g.font = `500 46px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, P + padX, cardY + 104 + i * lh));

  let y = cardY + cardH + 44;
  const gap = 24, boxW = (cardW - gap) / 2, boxH = 150;
  const stat = (x, label, value, unit) => {
    roundRect(g, x, y, boxW, boxH, 28);
    g.fillStyle = theme.card;
    g.fill();
    g.fillStyle = theme.sub;
    g.font = `500 30px ${FONT}`;
    g.fillText(label, x + 36, y + 54);
    g.fillStyle = theme.text;
    g.font = `700 64px ${FONT}`;
    g.fillText(value, x + 36, y + 124);
    const vw = g.measureText(value).width;
    g.fillStyle = theme.sub;
    g.font = `500 30px ${FONT}`;
    g.fillText(unit, x + 36 + vw + 12, y + 124);
  };
  stat(P, '今日计划', d.todoTotal ? `${d.todoDone}/${d.todoTotal}` : '—', d.todoTotal ? '完成' : '');
  stat(P + boxW + gap, '时间复盘', d.totalH ? fmtH(d.totalH) : '—', d.totalH ? '小时' : '');
  y += boxH + 40;

  if (d.time.length) {
    const barH = 20;
    let x = P;
    g.save();
    roundRect(g, P, y, cardW, barH, 10);
    g.clip();
    for (const t of d.time) {
      const w = (cardW * t.h) / d.totalH;
      g.fillStyle = t.color;
      g.fillRect(x, y, w, barH);
      x += w;
    }
    g.restore();
    let lx = P;
    const ly = y + 64;
    g.font = `500 28px ${FONT}`;
    for (const t of d.time.slice(0, 3)) {
      const label = `${t.name} ${fmtH(t.h)}h`;
      const w = 26 + g.measureText(label).width;
      if (lx + w > W - P) break;
      g.fillStyle = t.color;
      g.beginPath();
      g.arc(lx + 9, ly - 10, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = theme.sub;
      g.fillText(label, lx + 26, ly);
      lx += w + 36;
    }
  }

  g.fillStyle = theme.sub;
  g.globalAlpha = 0.75;
  g.font = `400 28px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('每天记一点，实习结束时就有一整本', W / 2, H - 72);
  g.globalAlpha = 1;
  g.textAlign = 'left';
}
