#!/usr/bin/env node
// CARROTCAP CLI — System One judgment call for agents (task-025).
// One request, typed answers back: an agent classifies / filters / ranks / verifies many items
// without reading them into its own context (CLAUDE.md §8 "System One 우선 판단").
//
// Backends (same /v1/systemone request format):
//   clm — CLM-8B (Stanford·NVIDIA, Apache 2.0), a local/self-hosted `clm-serve` (default http://127.0.0.1:8700)
//   jev — TypeSafe Jev cloud API (needs TYPESAFE_API_KEY)
// SYSTEM_ONE_BACKEND=auto (default) tries CLM first and falls back to Jev only when the CLM
// server cannot be reached (not when it answers with an error).
//
//   node scripts/system-one.js request.json        (or "-" for stdin)
//   request = { "state": ..., "questions": { "<id>": { "type": "noul|choice|score", "instructions": ..., "criteria": ... } }, "model"?: "jev-1.13.0" }
//
// Output (stdout, one JSON line): { backend, model, answers, usage, ms }. Errors go to stderr.
// Exit: 0 ok · 2 bad request · 3 no backend available · 4 API / network error.
// Usage log (no state text, no key): <cwd>/logs/system-one/usage.jsonl when <cwd>/logs exists.
'use strict';
const fs = require('fs');
const path = require('path');

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const CLM_DEFAULT_URL = 'http://127.0.0.1:8700';
// pinned: thresholds tuned on one version must not move with "jev-latest" (guide §8.8)
const DEFAULT_MODEL = 'jev-1.13.0';
const TIMEOUT_MS = 20000;
const CLM_CONNECT_MS = 1500; // a local server that is not running should not hold the agent up
const RETRIES = 3; // 429 / 529 only, exponential backoff
const MAX_BODY = 512 * 1024;
const MAX_QUESTIONS = 64;
const QUESTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JEV_MODEL_RE = /^jev-\d+\.\d+\.\d+$/;

class UsageError extends Error {}

// CLM server base URL: plain http only on this machine (loopback); anything remote must be
// https so an optional CLM_API_KEY and the project text are not sent in the clear.
// No credentials, query or fragment. Returns the normalized base (no trailing slash) or null.
function clmBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

// Tests only: a local server instead of the real Jev API (never another remote host).
function jevEndpoint(env = process.env) {
  const o = env.JEV_API_URL;
  if (o && /^http:\/\/127\.0\.0\.1:\d{2,5}\/[\w/-]*$/.test(o)) return o;
  return JEV_ENDPOINT;
}

function validate(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw new UsageError('request must be a JSON object');
  if (req.state === undefined || req.state === null || req.state === '') throw new UsageError('state is required');
  const qs = req.questions;
  if (!qs || typeof qs !== 'object' || Array.isArray(qs) || !Object.keys(qs).length) throw new UsageError('questions must be a non-empty object');
  if (Object.keys(qs).length > MAX_QUESTIONS) throw new UsageError(`at most ${MAX_QUESTIONS} questions per request`);
  // Messages name a question by its position, never by its id: an id is user text and could even
  // be a key (review task-025 r4). Ids are replaced by q0, q1, … before sending (r3).
  for (const [i, [id, q]] of Object.entries(qs).entries()) {
    const qn = `question #${i + 1}`;
    if (!QUESTION_ID_RE.test(id)) throw new UsageError(`${qn}: the id must be 1-64 letters, digits, _ or -`);
    if (!q || typeof q !== 'object') throw new UsageError(`${qn}: must be an object`);
    if (q.instructions === undefined || q.instructions === '') throw new UsageError(`${qn}: instructions are required`);
    if (q.type === 'noul') continue;
    if (q.type === 'choice') {
      const n = q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria) ? Object.keys(q.criteria).length : 0;
      if (n < 2 || n > 255) throw new UsageError(`${qn}: choice needs 2-255 criteria (got ${n})`);
      continue;
    }
    if (q.type === 'score') {
      const n = Array.isArray(q.criteria) ? q.criteria.length : 0;
      if (n < 2 || n > 10) throw new UsageError(`${qn}: score needs 2-10 levels (got ${n})`);
      continue;
    }
    throw new UsageError(`${qn}: type must be noul, choice or score`);
  }
  // pinned versions only — "jev-latest" would move the thresholds silently (§8.5, review r3)
  if (req.model !== undefined && !JEV_MODEL_RE.test(String(req.model))) throw new UsageError('model must be a pinned version like jev-1.13.0');
  return { state: req.state, questions: qs, model: req.model || null };
}
function jevModel(env, body) {
  const m = body.model || env.JEV_MODEL || DEFAULT_MODEL;
  if (!JEV_MODEL_RE.test(m)) throw new UsageError('JEV_MODEL must be a pinned version like jev-1.13.0');
  return m;
}

function post(url, body, key, { timeoutMs = TIMEOUT_MS, connectMs = null } = {}) {
  const mod = url.startsWith('https:') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'carrotcap-cli-system-one' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const req = mod.request(url, { method: 'POST', headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    // "cannot reach" = no connection within connectMs (only for the auto fallback)
    let connectTimer = null;
    if (connectMs) {
      connectTimer = setTimeout(() => { const e = new Error('connect timeout'); e.unreachable = true; req.destroy(e); }, connectMs);
      req.on('socket', (s) => {
        const done = () => clearTimeout(connectTimer);
        if (s.connecting === false) done(); else s.once(url.startsWith('https:') ? 'secureConnect' : 'connect', done);
      });
    }
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => {
      clearTimeout(connectTimer);
      if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(e.code)) e.unreachable = true;
      reject(e);
    });
    req.end(body);
  });
}

function logUsage(cwd, entry) {
  const logs = path.join(cwd, 'logs');
  try {
    if (!fs.lstatSync(logs).isDirectory()) return;
    const dir = path.join(logs, 'system-one');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'usage.jsonl'), JSON.stringify(entry) + '\n');
  } catch { /* no logs/ here, or not writable: logging is optional */ }
}

// Fixed text per status only: a server's own error body may echo the bearer key or the state,
// so it is never printed or logged (review task-025 r1).
function apiError(backend, res) {
  const hint = { 401: 'invalid API key', 403: 'forbidden', 404: 'no /v1/systemone at this URL', 422: 'request validation failed — check question types/criteria', 429: 'rate limit', 500: 'server error', 502: 'bad gateway', 503: 'unavailable', 529: 'service overloaded' }[res.status] || (res.status === 200 ? 'response without answers' : 'unexpected response');
  const err = new Error(`${backend} API ${res.status} (${hint})`);
  err.exit = 4;
  return err;
}
// A backend's reply is copied field by field into what we print/log, never passed through: a
// server could reflect the bearer key or the state into any free-form field (review task-025 r2).
// Only the requested question ids, only these fields, numbers only, choice/probability keys only
// from our own criteria; the score legend is rebuilt from our request.
const prob = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
function sanitizeAnswers(questions, answers) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = answers && Object.prototype.hasOwnProperty.call(answers, id) ? answers[id] : null;
    // runs on the wire ids (q0, q1, …): the message names the position only
    const bad = () => { const e = new Error(`answer for question #${Number(String(id).slice(1)) + 1} is missing or malformed`); e.exit = 4; return e; };
    if (!a || typeof a !== 'object') throw bad();
    if (q.type === 'noul') {
      if (prob(a.noul) === null) throw bad();
      out[id] = { type: 'noul', noul: a.noul };
    } else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      if (typeof a.choice !== 'string' || !keys.includes(a.choice)) throw bad();
      const probabilities = {};
      for (const k of keys) if (a.probabilities && prob(a.probabilities[k]) !== null) probabilities[k] = a.probabilities[k];
      out[id] = { type: 'choice', choice: a.choice, probabilities, confidence: prob(a.confidence) };
    } else {
      const n = q.criteria.length;
      if (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > n - 1) throw bad();
      const probabilities = {};
      const legend = {};
      for (let i = 0; i < n; i++) {
        legend[String(i)] = q.criteria[i];
        if (a.probabilities && prob(a.probabilities[String(i)]) !== null) probabilities[String(i)] = a.probabilities[String(i)];
      }
      out[id] = { type: 'score', score: a.score, legend, probabilities, confidence: prob(a.confidence) };
    }
  }
  return out;
}
const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);
function sanitizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return { input_tokens: count(u.input_tokens), output_tokens: count(u.output_tokens) };
}
// The model we report is never the server's own value (it could be a reflected key, review r3):
// Jev → the pinned version we asked for; CLM → "clm" (the weights are whatever that server runs).
const reportedModel = (backend, requested) => (backend === 'jev' ? requested : 'clm');
// our question ids ↔ the opaque ids sent over the wire
function wireQuestions(questions) {
  const ids = Object.keys(questions);
  return { ids, wire: Object.fromEntries(ids.map((id, i) => [`q${i}`, questions[id]])) };
}

// Which backends to try, in order: [{ backend, url, key, model }]
function plan(env) {
  const mode = String(env.SYSTEM_ONE_BACKEND || 'auto').toLowerCase();
  if (!['auto', 'clm', 'jev'].includes(mode)) throw new UsageError('SYSTEM_ONE_BACKEND must be auto, clm or jev');
  const out = [];
  if (mode !== 'jev') {
    const base = clmBaseUrl(env.CLM_URL || CLM_DEFAULT_URL);
    if (!base) {
      if (mode === 'clm') throw new UsageError('CLM_URL must be http://127.0.0.1|localhost:<port> or an https URL');
    } else {
      out.push({ backend: 'clm', url: `${base}/v1/systemone`, key: (env.CLM_API_KEY || '').trim() || null });
    }
  }
  if (mode !== 'clm') {
    const key = (env.TYPESAFE_API_KEY || '').trim();
    if (key) out.push({ backend: 'jev', url: jevEndpoint(env), key });
    else if (mode === 'jev') { const e = new Error('TYPESAFE_API_KEY is not set (https://console.typesafe.ai/keys)'); e.exit = 3; throw e; }
  }
  return { mode, targets: out };
}

async function judge(req, { env = process.env, cwd = process.cwd(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = TIMEOUT_MS } = {}) {
  const body = validate(req);
  const { mode, targets } = plan(env);
  const pinned = targets.some((t) => t.backend === 'jev') ? jevModel(env, body) : null;
  const { ids, wire } = wireQuestions(body.questions);
  const t0 = Date.now();
  const log = (backend, status, extra = {}) => logUsage(cwd, {
    at: new Date().toISOString(), backend, model: reportedModel(backend, pinned), status, ms: Date.now() - t0,
    questions: Object.values(body.questions).map((q) => q.type), ...extra, // types by position, never the ids
  });
  const unreachable = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const isLast = i === targets.length - 1;
    // CLM decides its own model; Jev gets a pinned version. Question ids go out as q0, q1, …
    const payload = { state: body.state, questions: wire };
    if (t.backend === 'jev') payload.model = pinned;
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY) throw new UsageError('request is larger than 512KB — send only the fields the questions need');
    let res;
    try {
      for (let attempt = 0; ; attempt++) {
        // in auto mode a CLM server that is not running must fail fast, so the Jev fallback is quick
        res = await post(t.url, text, t.key, { timeoutMs, connectMs: t.backend === 'clm' && mode === 'auto' ? CLM_CONNECT_MS : null });
        if ((res.status === 429 || res.status === 529) && attempt < RETRIES) { await sleep(500 * 2 ** attempt); continue; }
        break;
      }
    } catch (e) {
      if (e.unreachable && !isLast) { unreachable.push(`${t.backend} (${e.code || e.message})`); continue; }
      log(t.backend, 'network');
      const err = new Error(`${t.backend} network error: ${e.message}${unreachable.length ? ` — also unreachable: ${unreachable.join(', ')}` : ''}`);
      err.exit = e.unreachable && t.backend === 'clm' && targets.length === 1 && mode === 'auto' ? 3 : 4;
      if (err.exit === 3) err.message = `no System One backend: CLM server not reachable at ${t.url} and TYPESAFE_API_KEY is not set`;
      throw err;
    }
    let data = null;
    try { data = JSON.parse(res.text); } catch { /* reported below */ }
    if (res.status !== 200 || !data || typeof data.answers !== 'object' || data.answers === null) {
      log(t.backend, res.status);
      throw apiError(t.backend, res);
    }
    let answers;
    try {
      const byWire = sanitizeAnswers(wire, data.answers);
      answers = Object.fromEntries(ids.map((id, k) => [id, byWire[`q${k}`]]));
    } catch (e) {
      log(t.backend, 'bad-answer');
      throw e;
    }
    const usage = sanitizeUsage(data.usage);
    const model = reportedModel(t.backend, pinned);
    const out = { backend: t.backend, model, answers, usage, ms: Date.now() - t0, ...(unreachable.length ? { fallbackFrom: unreachable } : {}) };
    // Last guard: nothing we print may contain a key we sent. Every printed string now comes from
    // our own request or constants, so this only catches a key the user put in their own
    // criteria; keys shorter than 4 characters cannot be told apart from ordinary words.
    const printed = JSON.stringify(out);
    if ([t.key, (env.TYPESAFE_API_KEY || '').trim(), (env.CLM_API_KEY || '').trim()].some((k) => k && k.length >= 4 && printed.includes(k))) {
      log(t.backend, 'refused-echo');
      const e = new Error(`${t.backend} API reply refused: it contained a credential`);
      e.exit = 4;
      throw e;
    }
    log(t.backend, 200, { input_tokens: usage && usage.input_tokens, ...(unreachable.length ? { fallbackFrom: unreachable } : {}) });
    return out;
  }
  const e = new Error(mode === 'clm' ? 'CLM_URL is not usable' : 'no System One backend: start a CLM server (scripts/setup-clm.sh) or set TYPESAFE_API_KEY');
  e.exit = 3;
  throw e;
}

async function main(argv) {
  const src = argv[0];
  if (!src || argv.length > 1) throw new UsageError('usage: node scripts/system-one.js <request.json | ->');
  let raw;
  try { raw = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8'); } catch (e) { throw new UsageError(`cannot read ${src}: ${e.message}`); }
  let req;
  try { req = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new UsageError(`not valid JSON: ${e.message}`); }
  process.stdout.write(JSON.stringify(await judge(req)) + '\n');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`[system-one] ${e.message}\n`);
    process.exit(e instanceof UsageError ? 2 : e.exit || 4);
  });
}

module.exports = { judge, validate, plan, clmBaseUrl, jevEndpoint, UsageError, DEFAULT_MODEL, JEV_ENDPOINT, CLM_DEFAULT_URL };
