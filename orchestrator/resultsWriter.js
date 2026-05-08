const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const logger = require('./logger');
const config = require('./config');

const git = simpleGit(config.GIT_REPO_PATH);

async function ensureGitRepo() {
  logger.fn(__filename, 'ensureGitRepo', null);
  await fs.ensureDir(config.GIT_REPO_PATH);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    logger.info('ensureGitRepo: initializing new git repo at GIT_REPO_PATH');
    await git.init();
    await git.addConfig('user.name', 'vpn-speed-tester');
    await git.addConfig('user.email', 'orchestrator@local');
  } else {
    logger.info('ensureGitRepo: git repo exists');
  }
}

async function writeResults(data) {
  logger.fn(__filename, 'writeResults', { path: config.RESULTS_PATH });
  await fs.ensureDir(path.dirname(config.RESULTS_PATH));
  const tmpPath = path.join(
    path.dirname(config.RESULTS_PATH),
    `.results.tmp.${Date.now()}.json`
  );
  await fs.writeJson(tmpPath, data, { spaces: 2 });
  await fs.move(tmpPath, config.RESULTS_PATH, { overwrite: true });

  // Log the first server's data shape for debugging
  const firstServerName = Object.keys(data)[0];
  const firstServer = data[firstServerName];
  let summary = `wrote ${Object.keys(data).length} servers`;
  if (firstServer && Object.keys(firstServer.tiers).some(t => firstServer.tiers[t].length > 0)) {
    const tier = Object.keys(firstServer.tiers).find(t => firstServer.tiers[t].length > 0);
    const latestSession = firstServer.tiers[tier][firstServer.tiers[tier].length - 1];
    if (latestSession && latestSession.runs && latestSession.runs.length > 0) {
      const latestRun = latestSession.runs[latestSession.runs.length - 1];
      summary += ` | ${firstServerName} ${tier} runs=${latestSession.runs.length} ↓${latestRun.download_mbps ?? 'null'} Mbps ↑${latestRun.upload_mbps ?? 'null'} Mbps`;
    }
  }
  logger.info(`writeResults: ${summary} to ${config.RESULTS_PATH}`);
}

async function loadResults() {
  logger.fn(__filename, 'loadResults', null);
  try {
    const data = await fs.readJson(config.RESULTS_PATH);
    logger.info(`loadResults: loaded ${Object.keys(data).length} servers from existing results`);
    return data;
  } catch {
    logger.info('loadResults: no existing results file — starting fresh');
    return {};
  }
}

async function commitResults(message) {
  logger.fn(__filename, 'commitResults', { message });
  await git.add(config.RESULTS_PATH);
  await git.commit(message, { '--allow-empty': null });
  logger.info(`commitResults: committed — "${message}"`);
}

module.exports = { writeResults, loadResults, commitResults, ensureGitRepo };
