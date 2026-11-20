'use strict';

const crypto = require('node:crypto');
const { redirect, sendJson, getRequestOrigin } = require('../../lib/http');
const { getOAuthCredentials, setOAuthStateCookie } = require('../../lib/session');
const { buildGoogleAuthUrl } = require('../../lib/google-api');

module.exports = async function handler(req, res) {
  const creds = getOAuthCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    return sendJson(res, 400, {
      error: 'يرجى حفظ Client ID و Client Secret أولاً في إعدادات الربط (أو استخدام الربط السريع بـ Client ID فقط).'
    });
  }

  const state = crypto.randomBytes(24).toString('base64url');
  setOAuthStateCookie(req, res, state);

  const origin = getRequestOrigin(req);
  const redirectUri = `${origin}/api/auth/callback`;
  const authUrl = buildGoogleAuthUrl({
    clientId: creds.clientId,
    redirectUri,
    state
  });

  return redirect(res, authUrl);
};
