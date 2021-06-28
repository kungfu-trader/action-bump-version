const fs = require("fs");
const path = require("path");
const git = require('nodegit');
const gitCall = require('git-client');
const glob = require("glob");
const semver = require('semver');
const { spawn, spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };
const spawnOptsPipe = { shell: true, stdio: "pipe", windowsHide: true };

function getPackageJson(cwd) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.error("package.json not found");
  }
  return JSON.parse(fs.readFileSync(packageJsonPath));
}

function hasLerna(cwd) {
  return fs.existsSync(path.join(cwd, "lerna.json"));
}

function getCurrentVersion(cwd) {
  const configPath = path.join(cwd, hasLerna(cwd) ? "lerna.json" : "package.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  return semver.parse(config.version);
}

function bumpWithLerna(keyword) {
  spawnSync("lerna", ["version", `${keyword}`, "--yes", "--no-push"], spawnOptsInherit);
}

function bumpWithYarn(keyword) {
  spawnSync("yarn", ["version", `--${keyword}`], spawnOptsInherit);
}

async function gitRun(...args) {
  console.log("$ git", ...args);
  await gitCall(...args);
}

async function bump(cwd, keyword, defaultBranch) {
  if (hasLerna(cwd)) {
    bumpWithLerna(keyword);
  } else {
    bumpWithYarn(keyword);
  }
  const currentVersion = getCurrentVersion(cwd);

  const repo = await git.Repository.open(cwd);
  const branch = await repo.getCurrentBranch();
  const remoteBranch = branch.isBranch() ? branch.shorthand() : defaultBranch;

  await gitRun("push", "origin", `HEAD:${remoteBranch}`);
  await gitRun("tag", `v${currentVersion.major}`);
  await gitRun("tag", `v${currentVersion.major}.${currentVersion.minor}`);
  await gitRun("push", "-f", "--tags");
}

async function prepareNewBranch(cwd, keyword) {
  console.log(`Bump keyword: ${keyword}`);

  const currentVersion = getCurrentVersion(cwd);
  console.log(`Current version: ${currentVersion}`);

  const nextVersion = currentVersion.inc(keyword);
  const devVersionBranch = `dev/v${nextVersion.major}/v${nextVersion.major}.${nextVersion.minor}`;

  await gitRun("switch", "-c", devVersionBranch);
  await gitRun("push", "origin", `HEAD:${devVersionBranch}`);
}

const BumpActions = {
  "premajor": (cwd, defaultBranch) => {
    prepareNewBranch(cwd, "premajor").then(() => bump(cwd, "premajor", defaultBranch));
  },
  "preminor": (cwd, defaultBranch) => {
    prepareNewBranch(cwd, "preminor").then(() => bump(cwd, "preminor", defaultBranch));
  },
  "prepatch": (cwd, defaultBranch) => bump(cwd, "prepatch", defaultBranch),
  "major": (cwd, defaultBranch) => bump(cwd, "major", defaultBranch),
  "minor": (cwd, defaultBranch) => bump(cwd, "minor", defaultBranch),
  "patch": (cwd, defaultBranch) => bump(cwd, "patch", defaultBranch)
};

exports.gitRun = gitRun;

exports.bumpVersion = function (bumpKeyword, defaultBranch) {
  BumpActions[bumpKeyword](process.cwd(), defaultBranch);
};