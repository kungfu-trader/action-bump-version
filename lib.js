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

async function bumpToNext(cwd = process.cwd(), next = "patch") {
  const currentVersion = getCurrentVersion();
  const nextVersion = currentVersion.inc(next);
  const versionBranch = `dev/v${nextVersion.major}/v${nextVersion.minor}`;
  await git('switch', '-c', versionBranch);
  if (hasLerna(cwd)) {
    spawnSync("lerna", ["version", `pre${next}`], spawnOptsInherit);
  } else {
    spawnSync("yarn", ["version", `pre${next}`], spawnOptsInherit);
  }
}

const actions = {
  "minor": async (cwd = process.cwd()) => bumpToNext(cwd)
};

exports.bumpVersion = async function (versionPart) {
  const packageJson = getPackageJson();
  console.log(`updateing ${versionPart}: ${packageJson.version}`);
  const hash = await git('rev-parse', { verify: true, short: 6 }, 'HEAD');
  console.log(`git head ${hash}`);
};