export const pad = n => String(n).padStart(2, '0');

// Dates are stored as local "YYYY-MM-DD" strings so they never shift with time zones.
export function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayStr = () => dateStr(new Date());
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekdayCN = s => WEEK_CN[parseDate(s).getDay()];
export function isWeekend(s) {
  const day = parseDate(s).getDay();
  return day === 0 || day === 6;
}
export function fmtCN(s, withYear = false) {
  const d = parseDate(s);
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日 ${weekdayCN(s)}`;
}
export const fmtEN = s => parseDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const nowHM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtH = h => (Number.isInteger(h) ? String(h) : h.toFixed(1));
// 45 → "45 分钟", 90 → "1.5 小时", 110 → "1 小时 50 分钟"
export function fmtMin(m) {
  if (m < 60) return `${m} 分钟`;
  if (m % 30 === 0) return `${fmtH(m / 60)} 小时`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// localStorage can throw (private mode, blocked storage); every access goes through here.
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// Photos are shrunk to JPEG before saving so the diary stays small on the phone.
export async function compressImage(file, max = 1280, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL('image/jpeg', quality), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataURLToBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Soft sea-and-sky tones first, then gentle warm ones for the rest.
export const CAT_COLORS = ['#2E8B9A', '#6CC0C2', '#8EC3EE', '#F2B36B', '#E98D8D', '#A99BE0', '#7FB0D8', '#B9C77C', '#B8C2C8', '#E6A3C6', '#D9B97A', '#9AA6E6'];
