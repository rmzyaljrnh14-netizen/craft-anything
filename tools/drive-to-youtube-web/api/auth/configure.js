'use strict';

const { readJsonBody, sendJson } = require('../../lib/http');
const { readSession, writeSession } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const clientId = String(body.clientId || '').trim();
    const clientSecret = String(body.clientSecret || '').trim();

    if (!clientId) {
      return sendJson(res, 400, { error: 'يرجى إدخال Google OAuth Client ID.' });
    }
    if (!clientId.includes('.apps.googleusercontent.com')) {
      return sendJson(res, 400, {
        error: 'صيغة Client ID غير صحيحة (يجب أن ينتهي بـ .apps.googleusercontent.com).'
      });
    }

    const existing = readSession(req);
    const updated = {
      ...existing,
      clientId,
      clientSecret: clientSecret || existing.clientSecret || ''
    };
    writeSession(req, res, updated);

    return sendJson(res, 200, {
      ok: true,
      hasClientId: true,
      hasClientSecret: Boolean(updated.clientSecret),
      mode: updated.clientSecret ? 'oauth_server' : 'gis'
    });
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'طلب غير صالح.' });
  }
};
