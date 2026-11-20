'use strict';

// Pre-configured with the Google Drive folders and Sheet created for this workspace
const DEFAULTS = {
  ROOT_FOLDER_ID: '15d44JmLZT1D2pd_LXQis6w6UhNS8uHbn',
  QUEUE_FOLDER_ID: '1w8S6j9i6FCuZmIBsAbSTt-tSWGM05GI0',
  PUBLISHED_FOLDER_ID: '1IiRsRxQ0IA-dNWTrDYY8grySSPqfMzGF',
  FAILED_FOLDER_ID: '1aVfmXO_IRr8yGJRwqGdBPcQbiXgQN2kC',
  SPREADSHEET_ID: '1KLpJRf3f3RzAtRo75dZa2dAF1zhqoC-7NAXQ80lJ7WU',
  DEFAULT_PRIVACY: 'private',
  DEFAULT_CATEGORY_ID: '22',
  DEFAULT_LANGUAGE: 'ar',
  CHUNK_SIZE_MB: 8
};

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

module.exports = {
  DEFAULTS,
  OAUTH_SCOPES
};
