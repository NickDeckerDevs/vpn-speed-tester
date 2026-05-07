const path = require('path');
const fs = require('fs-extra');
const config = require('./config');

const LEVELS = { INFO: 'INFO ', WARN: 'WARN ', ERROR: 'ERROR', DEBUG: 'DEBUG' };

function timestamp() {
  return new Date().toISOString();
}

function writeToFile(line) {
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.LOGS_PATH, `${date}.log`);
  try {
    fs.ensureDirSync(config.LOGS_PATH);
    fs.appendFileSync(logPath, line);
  } catch (err) {
    process.stderr.write(`[logger] file write failed: ${err.message}\n`);
  }
}

function log(level, message) {
  const line = `[${timestamp()}] [${LEVELS[level]}] ${message}\n`;
  process.stdout.write(line);
  writeToFile(line);
}

function info(message)  { log('INFO',  message); }
function warn(message)  { log('WARN',  message); }
function error(message) { log('ERROR', message); }
function debug(message) { log('DEBUG', message); }

function fn(filepath, fnName, args) {
  const basename = path.basename(filepath);
  let argsStr = 'none';
  if (args !== undefined && args !== null) {
    try {
      argsStr = typeof args === 'object' ? JSON.stringify(args) : String(args);
    } catch {
      argsStr = '[unserializable]';
    }
  }
  info(`starting ${basename}-${fnName} | args: ${argsStr}`);
}

module.exports = { info, warn, error, debug, fn };
