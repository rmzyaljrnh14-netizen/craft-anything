'use strict';

const crypto = require('node:crypto');
const { isHttpsRequest } = require('./http');

const SESSION_COOKIE = 'd2yt_session';
const OAUTH_STATE_COOKIE = 'd2yt_oauth_state';

function getEncryptionKey() {
  const seed =
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'drive-to-youtube-studio-default-session-key-v1';
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptPayload(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const json = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptPayload(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  const pairs = String(header).split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieStr]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieStr]);
  }
}

function setCookie(req, res, name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (typeof maxAgeSec === 'number') {
    parts.push(`Max-Age=${maxAgeSec}`);
  }
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  appendSetCookie(res, parts.join('; '));
}

function clearCookie(req, res, name) {
  setCookie(req, res, name, '', 0);
}

function readSession(req) {
  const cookies = parseCookies(req);
  return decryptPayload(cookies[SESSION_COOKIE]) || {};
}

function writeSession(req, res, sessionObj) {
  const encoded = encryptPayload(sessionObj);
  setCookie(req, res, SESSION_COOKIE, encoded, 60 * 60 * 24 * 30);
}

function clearSession(req, res) {
  clearCookie(req, res, SESSION_COOKIE);
  clearCookie(req, res, OAUTH_STATE_COOKIE);
}

function setOAuthStateCookie(req, res, state) {
  setCookie(req, res, OAUTH_STATE_COOKIE, state, 600);
}

function readOAuthStateCookie(req) {
  const cookies = parseCookies(req);
  return cookies[OAUTH_STATE_COOKIE] || null;
}

function getOAuthCredentials(req) {
  const session = readSession(req);
  const clientId = String(process.env.GOOGLE_CLIENT_ID || session.clientId || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || session.clientSecret || '').trim();
  const fromEnv = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return { clientId, clientSecret, fromEnv };
}

function extractBearerToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth) return null;
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

module.exports = {
  SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  encryptPayload,
  decryptPayload,
  parseCookies,
  readSession,
  writeSession,
  clearSession,
  setOAuthStateCookie,
  readOAuthStateCookie,
  getOAuthCredentials,
  extractBearerToken
};
