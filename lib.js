const fs = require("fs");
const path = require("path");
const git = require('git-client');
const glob = require("glob");
const semver = require('semver');
const { spawn, spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };
const spawnOptsPipe = { shell: true, stdio: "pipe", windowsHide: true };

function getPackageJson(cwd = process.cwd()) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.error("package.json not found");
  }
  return JSON.parse(fs.readFileSync(packageJsonPath));
}

function hasLerna(cwd = process.cwd()) {
  return fs.existsSync(path.join(cwd, "lerna.json"));
}

function getCurrentVersion(cwd = process.cwd()) {
  const configPath = path.join(cwd, hasLerna(cwd) ? "lerna.json" : "package.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  return semver.parse(config.version);
}

function bump(cwd = process.cwd()) {
  if (hasLerna(cwd)) {
    spawnSync("lerna", ["version", `pre${next}`, "--yes", "--no-git-tag-version", "--no-push"], spawnOptsInherit);
  } else {
    spawnSync("yarn", ["version", `pre${next}`], spawnOptsInherit);
  }
}

async function bumpToNext(cwd = process.cwd(), next = "minor") {
  const currentVersion = getCurrentVersion();
  console.log(`increment ${next}: ${currentVersion}`);
  const nextVersion = currentVersion.inc(next);
  const versionBranch = `dev/v${nextVersion.major}/v${nextVersion.major}.${nextVersion.minor}`;
  await git("switch", "-c", versionBranch);
  bump(cwd);
}

const actions = {
  "major": async (cwd = process.cwd()) => bumpToNext(cwd, "major"),
  "minor": async (cwd = process.cwd()) => bumpToNext(cwd, "minor"),
  "patch": (cwd = process.cwd()) => bump(cwd)
};

exports.bumpVersion = async function (bumpKeyword) {
  actions[bumpKeyword]();
};