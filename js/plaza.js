// 广场：纸船漂流瓶。所有读写都通过 Supabase 里的函数（见 supabase/plaza.sql），
// 每台设备用一个匿名身份登录。没有配置服务器时，用本机模拟的演示数据跑同样的流程。
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { store, todayStr, uid } from './util.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

export const isDemo = () => !(SUPABASE_URL && SUPABASE_KEY);

export class PlazaError extends Error {}

const MESSAGES = {
  no_quota: '先放一只纸船，才能捞一只',
  sea_empty: '海上暂时没有别人的纸船，晚点再来看看',
  not_signed_in: '广场登录失效了，刷新一下再试',
  too_many: '操作太频繁了，歇一会儿再试',
  bad_length: '留言要在 1 到 300 字之间',
  no_access: '这只纸船你看不到',
  no_boat: '这只纸船已经不在了',
  bad_date: '日期不对，检查一下手机时间',
  too_long: '内容太长了',
};

function toPlazaError(err) {
  const msg = String(err?.message || err || '');
  const code = Object.keys(MESSAGES).find(k => msg.includes(k));
  if (code) return new PlazaError(MESSAGES[code]);
  if (/anonymous sign-ins are disabled/i.test(msg)) return new PlazaError('广场还没开启匿名登录（需要在 Supabase 里打开）');
  if (/fetch|network|load failed/i.test(msg)) return new PlazaError('连不上广场，检查一下网络');
  return new PlazaError(`广场出错了：${msg}`);
}

/* ---------- Supabase ---------- */

let clientPromise;
function client() {
  return (clientPromise ??= (async () => {
    const { createClient } = await import(SDK_URL);
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) throw error;
    }
    return sb;
  })().catch(err => {
    clientPromise = null;
    throw err;
  }));
}

async function remote(name, args) {
  const sb = await client();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

/* ---------- Demo: the same rules, simulated on this device ---------- */

const DEMO_KEY = 'plaza-demo';
const ME = 'me';
const DEMO_SEED = [
  { kind: 'todo', signature: '某互联网公司 · 产品经理实习生', body: { todos: [{ text: '整理竞品功能对比', done: true, minutes: 90 }, { text: '跟设计对交互稿', done: true, minutes: 45 }, { text: '写周报', done: false }] } },
  { kind: 'diary', signature: '某券商 · 行研实习生', body: { text: '第一次独立写完一份行业简报，被组长夸了一句，开心到现在。' } },
  { kind: 'todo', signature: '某外企 · 市场实习生', body: { todos: [{ text: '做小红书选题表', done: true, minutes: 60 }, { text: '剪一条 30 秒视频', done: true, minutes: 120 }] } },
  { kind: 'diary', signature: '某车企 · 数据分析实习生', body: { text: 'SQL 跑了三个小时才出结果，学会了先在小样本上试。' } },
  { kind: 'diary', signature: '某咨询公司 · 实习生', body: { text: '今天有点累，但是和同组实习生一起吃了顿火锅^ ^' } },
  { kind: 'todo', signature: '某游戏公司 · 测试实习生', body: { todos: [{ text: '回归测试 20 个用例', done: true, minutes: 150 }, { text: '提 3 个 bug', done: true, minutes: 30 }, { text: '学 Charles 抓包', done: false }] } },
];

function demoState() {
  let s;
  try { s = JSON.parse(store.get(DEMO_KEY) || 'null'); } catch { s = null; }
  if (!s) {
    s = {
      boats: DEMO_SEED.map((b, i) => ({ id: `demo-${i}`, author: `demo-user-${i}`, boat_date: todayStr(), ...b })),
      catches: [],
      messages: [],
    };
  }
  return s;
}
const saveDemo = s => store.set(DEMO_KEY, JSON.stringify(s));
const fail = code => { throw new Error(code); };
const boatOut = b => ({ id: b.id, kind: b.kind, body: b.body, signature: b.signature, boat_date: b.boat_date });

const demo = {
  plaza_stats() {
    const s = demoState();
    return {
      released: s.boats.filter(b => b.author === ME).length,
      caught: s.catches.length,
      unread: s.messages.filter(m => m.recipient === ME && !m.read).length,
    };
  },
  release_boat({ p_kind, p_body, p_signature, p_date }) {
    const s = demoState();
    let b = s.boats.find(x => x.author === ME && x.kind === p_kind && x.boat_date === p_date);
    const isNew = !b;
    if (isNew) {
      b = { id: uid(), author: ME, kind: p_kind, boat_date: p_date };
      s.boats.push(b);
      // Show what a reply looks like: a simulated reader writes back once.
      if (!s.messages.some(m => m.recipient === ME)) {
        s.messages.push({ id: uid(), boat_id: b.id, sender: 'demo-user-0', recipient: ME, body: '看到你的纸船了，加油！（演示留言）', created_at: new Date().toISOString(), read: false });
      }
    }
    Object.assign(b, { body: p_body, signature: p_signature });
    saveDemo(s);
    return { id: b.id, kind: b.kind, boat_date: b.boat_date, is_new: isNew };
  },
  fish_boat() {
    const s = demoState();
    if (s.catches.length >= s.boats.filter(b => b.author === ME).length) fail('no_quota');
    const pool = s.boats.filter(b => b.author !== ME && !s.catches.some(c => c.boat_id === b.id));
    if (!pool.length) fail('sea_empty');
    const b = pool[Math.floor(Math.random() * pool.length)];
    const caughtAt = new Date().toISOString();
    s.catches.push({ boat_id: b.id, caught_at: caughtAt });
    saveDemo(s);
    return { ...boatOut(b), author: b.author, caught_at: caughtAt, unread: 0 };
  },
  my_boats() {
    const s = demoState();
    return s.boats.filter(b => b.author === ME).sort((a, b) => b.boat_date.localeCompare(a.boat_date)).map(b => ({
      ...boatOut(b),
      unread: s.messages.filter(m => m.boat_id === b.id && m.recipient === ME && !m.read).length,
      people: [...new Set(s.messages.filter(m => m.boat_id === b.id && m.sender !== ME).map(m => m.sender))],
    }));
  },
  caught_boats() {
    const s = demoState();
    return [...s.catches].reverse().map(c => {
      const b = s.boats.find(x => x.id === c.boat_id);
      return { ...boatOut(b), author: b.author, caught_at: c.caught_at, unread: s.messages.filter(m => m.boat_id === b.id && m.recipient === ME && !m.read).length };
    });
  },
  inbox() {
    const s = demoState();
    return s.messages.filter(m => m.recipient === ME).reverse().map(m => {
      const b = s.boats.find(x => x.id === m.boat_id);
      return { id: m.id, boat_id: m.boat_id, other: m.sender, body: m.body, created_at: m.created_at, unread: !m.read, kind: b.kind, boat_body: b.body, boat_date: b.boat_date, my_boat: b.author === ME };
    });
  },
  open_thread({ p_boat, p_other }) {
    const s = demoState();
    const b = s.boats.find(x => x.id === p_boat) || fail('no_boat');
    const pair = m => m.boat_id === p_boat && ((m.sender === ME && m.recipient === p_other) || (m.sender === p_other && m.recipient === ME));
    s.messages.filter(pair).forEach(m => { if (m.recipient === ME) m.read = true; });
    saveDemo(s);
    return {
      boat: { ...boatOut(b), mine: b.author === ME },
      other: p_other,
      messages: s.messages.filter(pair).map(m => ({ id: m.id, body: m.body, mine: m.sender === ME, created_at: m.created_at })),
    };
  },
  send_message({ p_boat, p_body, p_to }) {
    const s = demoState();
    const b = s.boats.find(x => x.id === p_boat) || fail('no_boat');
    const body = (p_body || '').trim();
    if (!body || body.length > 300) fail('bad_length');
    const m = { id: uid(), boat_id: p_boat, sender: ME, recipient: b.author === ME ? p_to : b.author, body, created_at: new Date().toISOString(), read: false };
    s.messages.push(m);
    saveDemo(s);
    return { id: m.id, body: m.body, mine: true, created_at: m.created_at };
  },
  report_boat() { return null; },
  delete_boat({ p_boat }) {
    const s = demoState();
    s.boats = s.boats.filter(b => !(b.id === p_boat && b.author === ME));
    saveDemo(s);
    return null;
  },
};

/* ---------- API used by the app ---------- */

async function call(name, args = {}) {
  try {
    return isDemo() ? demo[name](args) : await remote(name, args);
  } catch (err) {
    throw toPlazaError(err);
  }
}

export const stats = () => call('plaza_stats');
export const release = (kind, body, signature, date) => call('release_boat', { p_kind: kind, p_body: body, p_signature: signature, p_date: date });
export const fish = () => call('fish_boat');
export const myBoats = () => call('my_boats');
export const caughtBoats = () => call('caught_boats');
export const inbox = () => call('inbox');
export const openThread = (boat, other) => call('open_thread', { p_boat: boat, p_other: other });
export const send = (boat, body, to = null) => call('send_message', { p_boat: boat, p_body: body, p_to: to });
export const report = (boat, reason = '') => call('report_boat', { p_boat: boat, p_reason: reason });
export const removeBoat = boat => call('delete_boat', { p_boat: boat });
export const resetDemo = () => store.del(DEMO_KEY);
