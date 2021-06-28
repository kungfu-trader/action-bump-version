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

function bump(cwd, next) {
  if (hasLerna(cwd)) {
    spawnSync("lerna", ["version", `${next}`, "--yes", "--no-git-tag-version", "--no-push"], spawnOptsInherit);
  } else {
    spawnSync("yarn", ["version", `--${next}`], spawnOptsInherit);
  }
}

async function prepareNewBranch(cwd, next) {
  const currentVersion = getCurrentVersion(cwd);
  console.log(`increment ${next}: ${currentVersion}`);
  const nextVersion = currentVersion.inc(next);
  const versionBranch = `dev/v${nextVersion.major}/v${nextVersion.major}.${nextVersion.minor}`;
  await git("switch", "-c", versionBranch);
  await git("push", "-u", "origin", versionBranch);
}

const actions = {
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
  actions[bumpKeyword](process.cwd());
};