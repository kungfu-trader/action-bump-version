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

function verify(cwd, sourceRef, destRef) {
  console.log(`Source ref: ${sourceRef}`);
  console.log(`Dest ref: ${destRef}`);
}

function bumpWithLerna(keyword) {
  spawnSync("lerna", ["version", `${keyword}`, "--yes", "--no-push"], spawnOptsInherit);
}

function bumpWithYarn(keyword) {
  spawnSync("yarn", ["version", `--${keyword}`, "--preid", "alpha"], spawnOptsInherit);
}

async function gitCall(...args) {
  console.log("$ git", ...args);
  await git(...args);
}

async function bump(cwd, keyword, branchPrefixes = [], pushMatch = true) {
  if (hasLerna(cwd)) {
    bumpWithLerna(keyword);
  } else {
    bumpWithYarn(keyword);
  }

  const currentVersion = getCurrentVersion(cwd);

  await gitCall("tag", `v${currentVersion.major}`);
  await gitCall("tag", `v${currentVersion.major}.${currentVersion.minor}`);
  await gitCall("push", "-f", "--tags");

  await gitCall("fetch");

  if (pushMatch) {
    await gitCall("push");
  }

  const branchPath = `v${currentVersion.major}/v${currentVersion.major}.${currentVersion.minor}`;
  const upstreams = {
    "release": "main",
    "alpha": `release/${branchPath}`,
    "dev": `alpha/${branchPath}`
  };
  for (const branchPrefix of branchPrefixes) {
    const upstreamBranch = upstreams[branchPrefix];
    const targetBranch = `${branchPrefix}/${branchPath}`;
    await gitCall("switch", targetBranch);
    await gitCall("merge", "--allow-unrelated-histories", `origin/${upstreamBranch}`);
    await gitCall("push", `HEAD:origin/${targetBranch}`);
  }
}

const BumpActions = {
  "verify": verify,
  "patch": (cwd) => bump(cwd, "patch", ["alpha", "dev"]),
  "premajor": (cwd) => bump(cwd, "premajor", ["release", "alpha", "dev"], false),
  "preminor": (cwd) => bump(cwd, "preminor", ["release", "alpha", "dev"], false),
  "prerelease": (cwd) => bump(cwd, "prerelease", ["dev"])
};

exports.gitCall = gitCall;

exports.bumpVersion = function (bumpKeyword, sourceRef, destRef) {
  BumpActions[bumpKeyword](process.cwd(), sourceRef, destRef);
};