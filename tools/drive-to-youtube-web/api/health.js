'use strict';

const { DEFAULTS, OAUTH_SCOPES } = require('../lib/defaults');
const { sendJson, getRequestOrigin } = require('../lib/http');
const { getOAuthCredentials } = require('../lib/session');

module.exports = async function handler(req, res) {
  const origin = getRequestOrigin(req);
  const creds = getOAuthCredentials(req);

  return sendJson(res, 200, {
    ok: true,
    origin,
    redirectUri: `${origin}/api/auth/callback`,
    oauth: {
      hasClientId: Boolean(creds.clientId),
      hasClientSecret: Boolean(creds.clientSecret),
      clientId: creds.clientId || '',
      fromEnv: creds.fromEnv,
      scopes: OAUTH_SCOPES
    },
    defaults: DEFAULTS
  });
};
