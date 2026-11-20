'use strict';

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function getRequestOrigin(req) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = protoHeader
    ? String(protoHeader).split(',')[0].trim()
    : req.socket && req.socket.encrypted
      ? 'https'
      : 'http';
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const host = String(hostHeader).split(',')[0].trim();
  return `${proto}://${host}`;
}

function isHttpsRequest(req) {
  return getRequestOrigin(req).startsWith('https://');
}

function parseQuery(req) {
  const rawUrl = req.url || '/';
  const u = new URL(rawUrl, 'http://localhost');
  const out = {};
  for (const [k, v] of u.searchParams.entries()) {
    out[k] = v;
  }
  return out;
}

module.exports = {
  readJsonBody,
  sendJson,
  redirect,
  getRequestOrigin,
  isHttpsRequest,
  parseQuery
};
