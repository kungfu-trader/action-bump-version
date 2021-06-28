const fs = require("fs");
const path = require("path");
const git = require('git-client');
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

async function bump(cwd, keyword) {
  if (hasLerna(cwd)) {
    bumpWithLerna(keyword);
  } else {
    bumpWithYarn(keyword);
  }
  const currentVersion = getCurrentVersion(cwd);
  await git("push");
  await git("tag", `v${currentVersion.major}`);
  await git("tag", `v${currentVersion.major}.${currentVersion.minor}`);
  await git("push", "-f", "--tags");
}

async function prepareNewBranch(cwd, keyword) {
  console.log(`Bump keyword: ${keyword}`);

  const currentVersion = getCurrentVersion(cwd);
  console.log(`Current version: ${currentVersion}`);

  const nextVersion = currentVersion.inc(keyword);
  const versionBranch = `dev/v${nextVersion.major}/v${nextVersion.major}.${nextVersion.minor}`;

  await git("switch", "-c", versionBranch);
  await git("push", "-u", "origin", versionBranch);
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

exports.bumpVersion = function (bumpKeyword) {
  BumpActions[bumpKeyword](process.cwd());
};