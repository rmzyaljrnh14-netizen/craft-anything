'use strict';

const { sendJson } = require('../../lib/http');
const { resolveAccessToken, fetchGoogleUserAndChannel } = require('../../lib/google-api');

module.exports = async function handler(req, res) {
  try {
    const auth = await resolveAccessToken(req, res);
    if (!auth.accessToken) {
      return sendJson(res, 200, { connected: false });
    }

    const info = await fetchGoogleUserAndChannel(auth.accessToken);
    return sendJson(res, 200, {
      connected: true,
      mode: auth.mode,
      hasRefreshToken: Boolean(auth.hasRefreshToken),
      user: info.user,
      channel: info.channel,
      youtubeError: info.youtubeError
    });
  } catch (err) {
    return sendJson(res, 200, {
      connected: false,
      error: err.message || 'انتهت صلاحية الجلسة.'
    });
  }
};
