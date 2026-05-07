const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const config = require('./config');

const git = simpleGit(config.GIT_REPO_PATH);

async function ensureGitRepo() {
  await fs.ensureDir(config.GIT_REPO_PATH);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    await git.init();
    await git.addConfig('user.name', 'vpn-speed-tester');
    await git.addConfig('user.email', 'orchestrator@local');
  }
}

async function writeResults(data) {
  await fs.ensureDir(path.dirname(config.RESULTS_PATH));
  const tmpPath = path.join(
    path.dirname(config.RESULTS_PATH),
    `.results.tmp.${Date.now()}.json`
  );
  await fs.writeJson(tmpPath, data, { spaces: 2 });
  await fs.move(tmpPath, config.RESULTS_PATH, { overwrite: true });
}

async function loadResults() {
  try {
    return await fs.readJson(config.RESULTS_PATH);
  } catch {
    return {};
  }
}

async function commitResults(message) {
  await git.add(config.RESULTS_PATH);
  await git.commit(message, { '--allow-empty': null });
}

module.exports = { writeResults, loadResults, commitResults, ensureGitRepo };
