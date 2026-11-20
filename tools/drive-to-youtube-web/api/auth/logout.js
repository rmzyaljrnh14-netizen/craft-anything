'use strict';

const { sendJson } = require('../../lib/http');
const { readSession, writeSession, clearSession } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  // Keep saved OAuth clientId/clientSecret while revoking active user tokens
  const existing = readSession(req);
  if (existing.clientId) {
    writeSession(req, res, {
      clientId: existing.clientId,
      clientSecret: existing.clientSecret || ''
    });
  } else {
    clearSession(req, res);
  }

  return sendJson(res, 200, { ok: true });
};
