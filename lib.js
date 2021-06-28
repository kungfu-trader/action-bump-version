const fs = require("fs");
const path = require("path");
const git = require('git-client');
const glob = require("glob");
const semver = require('semver');
const { spawn, spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };

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

async function gitCall(...args) {
  console.log("$ git", ...args);
  await git(...args);
}

async function bump(cwd, keyword) {
  if (hasLerna(cwd)) {
    bumpWithLerna(keyword);
  } else {
    bumpWithYarn(keyword);
  }
  const currentVersion = getCurrentVersion(cwd);

  await gitCall("push");
  await gitCall("tag", `v${currentVersion.major}`);
  await gitCall("tag", `v${currentVersion.major}.${currentVersion.minor}`);
  await gitCall("push", "-f", "--tags");
}

async function prepareNewBranch(cwd, keyword) {
  console.log(`Bump keyword: ${keyword}`);

  const currentVersion = getCurrentVersion(cwd);
  console.log(`Current version: ${currentVersion}`);

  const nextVersion = currentVersion.inc(keyword);
  const devVersionBranch = `dev/v${nextVersion.major}/v${nextVersion.major}.${nextVersion.minor}`;

  await gitCall("switch", "-c", devVersionBranch);
  await gitCall("push", "-u", "origin");
}

const BumpActions = {
  "premajor": (cwd) => {
    prepareNewBranch(cwd, "premajor").then(() => bump(cwd, "premajor"));
  },
  "preminor": (cwd) => {
    prepareNewBranch(cwd, "preminor").then(() => bump(cwd, "preminor"));
  },
  "prepatch": (cwd) => bump(cwd, "prepatch"),
  "major": (cwd) => bump(cwd, "major"),
  "minor": (cwd) => bump(cwd, "minor"),
  "patch": (cwd) => bump(cwd, "patch")
};

exports.gitCall = gitCall;

exports.bumpVersion = function (bumpKeyword) {
  BumpActions[bumpKeyword](process.cwd());
};