'use strict';

const { redirect, parseQuery, getRequestOrigin } = require('../../lib/http');
const {
  readSession,
  writeSession,
  readOAuthStateCookie,
  getOAuthCredentials
} = require('../../lib/session');
const { exchangeCodeForTokens } = require('../../lib/google-api');

module.exports = async function handler(req, res) {
  const query = parseQuery(req);

  if (query.error) {
    return redirect(res, `/?auth_error=${encodeURIComponent(query.error_description || query.error)}`);
  }

  const expectedState = readOAuthStateCookie(req);
  if (!query.state || !expectedState || query.state !== expectedState) {
    return redirect(res, `/?auth_error=${encodeURIComponent('انتهت صلاحية رمز التحقق (state) — يرجى المحاولة مرة أخرى.')}`);
  }

  if (!query.code) {
    return redirect(res, `/?auth_error=${encodeURIComponent('لم يتم استلام رمز التفويض من Google.')}`);
  }

  const creds = getOAuthCredentials(req);
  if (!creds.clientId || !creds.clientSecret) {
    return redirect(res, `/?auth_error=${encodeURIComponent('بيانات OAuth غير مكتملة — يرجى حفظ Client ID و Client Secret.')}`);
  }

  try {
    const origin = getRequestOrigin(req);
    const redirectUri = `${origin}/api/auth/callback`;
    const tokens = await exchangeCodeForTokens({
      code: query.code,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri
    });

    const prev = readSession(req);
    writeSession(req, res, {
      ...prev,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || prev.refreshToken || null,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope
    });

    return redirect(res, '/?connected=1');
  } catch (err) {
    return redirect(res, `/?auth_error=${encodeURIComponent(err.message || 'فشل ربط حساب Google.')}`);
  }
};
