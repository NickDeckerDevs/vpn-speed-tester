const axios = require('axios');
const logger = require('./logger');

function handleError(err, context) {
  const rawError = err.response ? err.response.data : err.message;
  const error = typeof rawError === 'object' ? JSON.stringify(rawError) : rawError;
  const status = err.response?.status;

  if (status === 429) {
    const retryAfter = err.response.headers?.['retry-after'];
    logger.warn(`[${context}] 429 Rate Limited${retryAfter ? ` — retry-after: ${retryAfter}s` : ''}`);
  } else if (status === 401 || status === 403) {
    logger.error(`[${context}] Auth error (${status}) — check credentials`);
  } else if (status >= 500) {
    logger.error(`[${context}] Server error ${status}: ${error}`);
  } else if (status >= 400) {
    logger.error(`[${context}] Client error ${status}: ${error}`);
  } else if (err.code === 'ECONNREFUSED') {
    logger.error(`[${context}] ECONNREFUSED — is the service running?`);
  } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
    logger.error(`[${context}] ETIMEDOUT — connection timed out`);
  } else if (err.code === 'ENOTFOUND') {
    logger.error(`[${context}] ENOTFOUND — DNS failure (tunnel not up?)`);
  } else if (err.code === 'ECONNRESET') {
    logger.error(`[${context}] ECONNRESET — connection was reset`);
  } else {
    logger.error(`[${context}] ${error}`);
  }

  throw new Error(`[${context}] ${error}`);
}

async function get(url, options = {}, context = 'HTTP GET') {
  try {
    const response = await axios.get(url, options);
    return response.data;
  } catch (err) {
    handleError(err, context);
  }
}

async function post(url, body, options = {}, context = 'HTTP POST') {
  try {
    const response = await axios.post(url, body, options);
    return response.data;
  } catch (err) {
    handleError(err, context);
  }
}

module.exports = { get, post, handleError };
