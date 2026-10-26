import { todayStr, isWeekend, pad, nowHM, store } from './util.js';

// A static web app cannot wake itself up once it is closed, so the dependable reminder is a
// repeating event in the phone's own calendar. The browser notification below only works
// while the app is open (or still running in the background).
export function buildICS({ time, weekdaysOnly, url }) {
  const [h, m] = time.split(':');
  const d = new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const esc = s => s.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  const title = esc('记录今天的实习日记');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//intern-diary//zh-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:intern-diary-daily-${ymd}${h}${m}@intern-diary`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${ymd}T${h}${m}00`,
    'DURATION:PT10M',
    weekdaysOnly ? 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : 'RRULE:FREQ=DAILY',
    `SUMMARY:${title}`,
    `DESCRIPTION:${esc(`花几分钟，记下今天做了什么、学到了什么。\n${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// getInfo() -> { ready, time, skipWeekends, writtenToday }
export function startReminderLoop(getInfo) {
  const check = async () => {
    const info = getInfo();
    if (!info.ready || info.writtenToday) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const today = todayStr();
    if (info.skipWeekends && isWeekend(today)) return;
    if (nowHM() < info.time || store.get('notified') === today) return;
    store.set('notified', today);
    const opts = { body: '花几分钟，记下今天做了什么、学到了什么。', icon: 'icons/icon-192.png', tag: 'daily-diary' };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification('记录今天的实习日记', opts);
      else new Notification('记录今天的实习日记', opts);
    } catch { /* notification blocked by the browser */ }
  };
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', check);
  check();
}
