// Optional AI features (English translation, LinkedIn post) through the Claude API.
// The user brings their own API key; it is kept in this browser only and never goes into backups.
import { store } from './util.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（默认，效果最好）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（更快、更便宜）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最便宜）' },
];
// Models that accept the server-side refusal fallback.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export class AIError extends Error {}

export function config() {
  try { return JSON.parse(store.get('ai') || '{}'); } catch { return {}; }
}
export const saveConfig = cfg => store.set('ai', JSON.stringify(cfg));
export const hasKey = () => !!config().apiKey;

let sdk;
function loadSDK() {
  return (sdk ??= import(SDK_URL).then(m => m.default).catch(() => {
    sdk = null;
    throw new AIError('AI 组件加载失败，请检查网络');
  }));
}

async function ask({ system, user, schema, effort = 'low' }) {
  const cfg = config();
  if (!cfg.apiKey) throw new AIError('请先在「我的」里填写 Claude API Key');
  const Anthropic = await loadSDK();
  const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
  const model = cfg.model || DEFAULT_MODEL;
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
  };

  let res;
  try {
    res = FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIError('API Key 无效，请在「我的」里检查');
    if (err instanceof Anthropic.PermissionDeniedError) throw new AIError('这个 Key 没有权限使用所选模型');
    if (err instanceof Anthropic.RateLimitError) throw new AIError('请求太频繁或额度不足，稍后再试');
    if (err instanceof Anthropic.BadRequestError) throw new AIError(`请求被拒绝：${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new AIError('连不上 Anthropic 服务器，请检查网络');
    if (err instanceof Anthropic.APIError) throw new AIError(`AI 服务出错（${err.status ?? '未知'}），稍后再试`);
    throw err;
  }
  if (res.stop_reason === 'refusal') throw new AIError('AI 拒绝处理这段内容，换一段再试');
  if (res.stop_reason === 'max_tokens') throw new AIError('内容太长，缩小范围再试');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return schema ? JSON.parse(text) : text;
}

export const ping = () => ask({ system: 'Reply with the single word OK.', user: 'ping' });

const ENTRY_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, todos: { type: 'array', items: { type: 'string' } } },
  required: ['text', 'todos'],
  additionalProperties: false,
};

// src: { text, todos: [string] }
export async function translateEntry(src) {
  const out = await ask({
    system: "Translate a Chinese intern's daily work diary into natural, plain English. Keep the meaning, the first-person voice and the line breaks. Keep product and tool names as they are. Do not add or drop content. Return the translated diary text and the translated to-do items in the same order.",
    user: JSON.stringify(src),
    schema: ENTRY_SCHEMA,
  });
  return { text: out.text, todos: src.todos.map((t, i) => out.todos[i] || t) };
}

const LABELS_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
  additionalProperties: false,
};

// Short labels (company, department, job title, custom time categories), cached across exports.
export async function translateLabels(labels) {
  let cache = {};
  try { cache = JSON.parse(store.get('en-labels') || '{}'); } catch { /* start fresh */ }
  const missing = [...new Set(labels)].filter(l => l && !(l in cache) && /[一-鿿]/.test(l));
  if (missing.length) {
    const out = await ask({
      system: 'Translate each short Chinese label (company names, department names, job titles, work activity categories) into concise, natural English. Use the official English name for well-known companies. Return the translations in the same order.',
      user: JSON.stringify(missing),
      schema: LABELS_SCHEMA,
    });
    missing.forEach((l, i) => { if (out.items[i]) cache[l] = out.items[i]; });
    store.set('en-labels', JSON.stringify(cache));
  }
  return cache;
}

// entries: [{ date, day, text, done: [string], time: [{ cat, h }] }]
export function linkedInPrompt({ entries, profile, lang, mentionCompany, from, to }) {
  const system = [
    'You help an intern turn their private work diary into a LinkedIn post about what they worked on and learned.',
    `Write in ${lang === 'en' ? 'English' : 'Simplified Chinese'}, in the first person. Be plain and specific: the kind of work they did, one or two concrete lessons, and what they want to try next. No hype or buzzwords, at most two emojis.`,
    'Use 120 to 220 words in short paragraphs, then 3 to 5 relevant hashtags on the last line.',
    'Confidentiality: leave out project code names, internal metrics or figures, colleague and client names, and unreleased products. Describe the type of work instead.',
    mentionCompany ? 'You may name the company.' : 'Do not name the company or the department; refer to the workplace generically.',
    'Output only the post text.',
  ].join('\n');
  const where = mentionCompany ? ` at ${profile.company}${profile.department ? ` (${profile.department})` : ''}` : '';
  const body = entries.map(e => [
    `### ${e.date}${e.day > 0 ? ` (day ${e.day} of the internship)` : ''}`,
    e.text,
    e.done.length ? `Finished: ${e.done.join('; ')}` : '',
    e.time.length ? `Time spent: ${e.time.map(t => `${t.cat} ${t.h}h`).join(', ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
  const user = `About me: ${profile.role}${where}, internship started ${profile.startDate}.\nPeriod: ${from} to ${to}.\n\nMy diary entries (written in Chinese):\n\n${body}`;
  return { system, user };
}

export function linkedInPromptText(args) {
  const { system, user } = linkedInPrompt(args);
  return `${system}\n\n---\n\n${user}`;
}

export function draftLinkedInPost(args) {
  const { system, user } = linkedInPrompt(args);
  return ask({ system, user, effort: 'medium' });
}
