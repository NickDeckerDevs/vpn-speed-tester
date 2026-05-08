const fs = require('fs-extra');
const logger = require('./logger');
const config = require('./config');

async function appendServerData(timestamp, serverObj) {
  logger.fn(__filename, 'appendServerData', { timestamp });
  let data = {};
  try {
    data = await fs.readJson(config.SERVER_DATA_PATH);
  } catch {
    // File doesn't exist yet, start with empty object
  }
  data[timestamp] = serverObj;
  await fs.outputJson(config.SERVER_DATA_PATH, data, { spaces: 2 });
  logger.info(`appendServerData: saved server "${serverObj.public_name}" with timestamp ${timestamp}`);
}

async function appendRawResult(key, resultObj) {
  logger.fn(__filename, 'appendRawResult', { key });
  let data = {};
  try {
    data = await fs.readJson(config.RAW_RESULTS_PATH);
  } catch {
    // File doesn't exist yet, start with empty object
  }
  data[key] = resultObj;
  await fs.outputJson(config.RAW_RESULTS_PATH, data, { spaces: 2 });
  logger.info(`appendRawResult: saved result for key ${key}`);
}

module.exports = { appendServerData, appendRawResult };
