import { fmtH } from './util.js';

const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif';

// unlock = longest streak (in days) needed to use the theme. Ids are kept from v1 so saved choices still match.
// bg: three gradient stops from top to bottom.
export const THEMES = [
  { id: 'plain', name: '海雾', unlock: 0, bg: ['#D7E9FA', '#E6F3F0', '#F6F3EC'], ink: '#1F2A33', sub: '#6F7F89', accent: '#2E8B9A' },
  { id: 'mint', name: '薄荷', unlock: 3, bg: ['#D9F1E6', '#EAF6F0', '#F7F6EF'], ink: '#1E2F2A', sub: '#667A72', accent: '#2F8F74' },
  { id: 'dusk', name: '晚霞', unlock: 7, bg: ['#FBDCCB', '#F8E8E0', '#F6F2EE'], ink: '#33241D', sub: '#86716A', accent: '#D0704B' },
  { id: 'night', name: '晴空', unlock: 14, bg: ['#C9E0FA', '#E1EDFB', '#F5F7FB'], ink: '#1C2A3A', sub: '#6C7C8E', accent: '#3A78D6' },
  { id: 'kraft', name: '深海', unlock: 21, bg: ['#10243A', '#123843', '#0E1C24'], ink: '#E8F0F2', sub: '#8FA3AB', accent: '#5CC2C6', dark: true },
  { id: 'gold', name: '夜航', unlock: 30, bg: ['#1E2840', '#151D2D', '#0E1520'], ink: '#EDF0F5', sub: '#8A97A8', accent: '#E2B97F', dark: true },
  { id: 'aurora', name: '极光', unlock: 100, bg: ['#13233A', '#173B44', '#24203B'], ink: '#EEFAF7', sub: '#9CC7C0', accent: '#8FE6CF', dark: true, aurora: true },
];

// The app's sailboat mark, in a 512 box.
const BOAT = [
  ['M268 104C316 168 352 250 372 330L268 330Z', 1],
  ['M248 150L248 330L150 330C176 262 208 200 248 150Z', 0.82],
  ['M128 352L384 352C372 398 336 420 296 420L216 420C176 420 140 398 128 352Z', 1],
];
const WAVE = 'M104 462C136 446 168 446 200 462S264 478 296 462S360 446 392 462';

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawLogo(g, x, y, size) {
  const grad = g.createLinearGradient(x, y, x + size * 0.3, y + size);
  grad.addColorStop(0, '#9CCFF2');
  grad.addColorStop(0.55, '#6CC0C2');
  grad.addColorStop(1, '#2E8B9A');
  roundRect(g, x, y, size, size, size * 0.225);
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.translate(x + size / 2, y + size / 2);
  g.scale((size / 512) * 0.9, (size / 512) * 0.9);
  g.translate(-248, -291);
  g.fillStyle = g.strokeStyle = '#FFFFFF';
  g.lineJoin = g.lineCap = 'round';
  g.lineWidth = 12;
  for (const [d, alpha] of BOAT) {
    const p = new Path2D(d);
    g.globalAlpha = alpha;
    g.fill(p);
    g.stroke(p);
  }
  g.globalAlpha = 0.6;
  g.stroke(new Path2D(WAVE));
  g.restore();
}

// A frosted card: translucent white with a soft shadow on light themes, a faint glass panel on dark ones.
function glass(g, t, x, y, w, h, r = 36) {
  g.save();
  if (!t.dark) {
    g.shadowColor = 'rgba(60, 100, 140, 0.10)';
    g.shadowBlur = 40;
    g.shadowOffsetY = 12;
  }
  roundRect(g, x, y, w, h, r);
  g.fillStyle = t.dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.62)';
  g.fill();
  g.restore();
  roundRect(g, x + 1, y + 1, w - 2, h - 2, r);
  g.strokeStyle = t.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  g.stroke();
}

const CJK = '⺀-鿿豈-﫿＀-￯　-〿';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

function ellipsize(g, s, maxW) {
  if (g.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && g.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

// Chinese breaks between any two characters; Latin words stay whole unless too long for a line.
function wrapLines(g, text, maxW, maxLines) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const raw of para.match(TOKEN) || []) {
      for (const tk of g.measureText(raw).width > maxW ? [...raw] : [raw]) {
        if (!line || g.measureText(line + tk).width <= maxW) line += tk;
        else {
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
// Async so callers can await it; the drawing itself happens in one synchronous pass.
export async function renderPoster(canvas, d, t) {
  const W = 1080, H = 1440, P = 72, IN = 56;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  const bg = g.createLinearGradient(0, 0, 0, H);
  t.bg.forEach((c, i) => bg.addColorStop(i / (t.bg.length - 1), c));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Soft light in the sky; on the aurora theme, two coloured glows.
  const glows = t.aurora
    ? [[220, 260, 560, 'rgba(110,230,200,0.28)'], [900, 760, 600, 'rgba(150,120,255,0.24)']]
    : [[880, 160, 420, t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)']];
  for (const [x, y, r, c] of glows) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }

  drawLogo(g, P, 64, 72);
  g.fillStyle = t.ink;
  g.font = `600 32px ${FONT}`;
  g.fillText('实习成长日记', P + 96, 112);
  g.textAlign = 'right';
  g.fillStyle = t.sub;
  g.font = `500 28px ${FONT}`;
  g.fillText(d.dateLabel, W - P, 112);
  g.textAlign = 'left';

  const cw = W - 2 * P;
  // Streak card
  let y = 184;
  glass(g, t, P, y, cw, 400);
  g.fillStyle = t.sub;
  g.font = `500 34px ${FONT}`;
  g.fillText('连续打卡', P + IN, y + 92);
  g.font = `700 250px ${FONT}`;
  const num = String(d.streak);
  const numW = g.measureText(num).width;
  g.fillStyle = t.accent;
  g.fillText(num, P + IN - 8, y + 318);
  g.fillStyle = t.ink;
  g.font = `600 60px ${FONT}`;
  g.fillText('天', P + IN + numW + 12, y + 318);
  const who = [d.dayN > 0 ? `入职第 ${d.dayN} 天` : '', [d.role, d.company].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ');
  g.fillStyle = t.sub;
  g.font = `400 28px ${FONT}`;
  g.fillText(ellipsize(g, who, cw - 2 * IN), P + IN, y + 366);
  y += 400 + 32;

  // Quote card
  g.font = `400 44px ${FONT}`;
  const lh = 66;
  const lines = wrapLines(g, d.quote, cw - 2 * IN - 28, 3);
  const qh = 76 + lines.length * lh;
  glass(g, t, P, y, cw, qh);
  roundRect(g, P + IN - 4, y + 54, 6, lines.length * lh - 16, 3);
  g.fillStyle = t.accent;
  g.fill();
  g.fillStyle = t.ink;
  lines.forEach((l, i) => g.fillText(l, P + IN + 26, y + 92 + i * lh));
  y += qh + 32;

  // Two stat cards
  const half = (cw - 24) / 2, sh = 176;
  const stat = (x, label, value, unit) => {
    glass(g, t, x, y, half, sh, 32);
    g.fillStyle = t.sub;
    g.font = `500 28px ${FONT}`;
    g.fillText(label, x + 44, y + 62);
    g.fillStyle = t.ink;
    g.font = `700 72px ${FONT}`;
    g.fillText(value, x + 44, y + 142);
    const vw = g.measureText(value).width;
    g.fillStyle = t.sub;
    g.font = `500 28px ${FONT}`;
    g.fillText(unit, x + 44 + vw + 12, y + 142);
  };
  stat(P, '今日计划', d.todoTotal ? `${d.todoDone}/${d.todoTotal}` : '—', d.todoTotal ? '完成' : '');
  stat(P + half + 24, '时间复盘', d.totalH ? fmtH(d.totalH) : '—', d.totalH ? '小时' : '');
  y += sh + 32;

  // Time split
  if (d.time.length) {
    glass(g, t, P, y, cw, 150, 32);
    const bx = P + 44, bw = cw - 88, by = y + 46, bh = 20;
    g.save();
    roundRect(g, bx, by, bw, bh, 10);
    g.clip();
    let x = bx;
    for (const item of d.time) {
      const w = (bw * item.h) / d.totalH;
      g.fillStyle = item.color;
      g.fillRect(x, by, Math.max(w - 3, 2), bh);
      x += w;
    }
    g.restore();
    let lx = bx;
    const ly = by + 70;
    g.font = `400 26px ${FONT}`;
    for (const item of d.time.slice(0, 3)) {
      const label = `${item.name} ${fmtH(item.h)}h`;
      const w = 28 + g.measureText(label).width;
      if (lx + w > bx + bw) break;
      g.fillStyle = item.color;
      g.beginPath();
      g.arc(lx + 8, ly - 9, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = t.sub;
      g.fillText(label, lx + 26, ly);
      lx += w + 34;
    }
  }

  g.fillStyle = t.sub;
  g.font = `400 26px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('每天记一点，实习结束时就有一整本', W / 2, H - 60);
  g.textAlign = 'left';
}
