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
    await gitCall("reset", "--hard", `origin/${targetBranch}`);
    await gitCall("diff", `origin/${upstreamBranch}`);
    await gitCall("merge", `origin/${upstreamBranch}`);
    await gitCall("push", `HEAD:origin/${targetBranch}`);
  }
}

async function verify(cwd, sourceRef, destRef) {
  const currentVersion = getCurrentVersion(cwd);
  console.log(`Source ref: ${sourceRef}`);
  console.log(`Dest ref: ${destRef}`);
}

const BumpActions = {
  "verify": verify,
  "patch": async (cwd) => bump(cwd, "patch", ["alpha", "dev"]),
  "premajor": async (cwd) => bump(cwd, "premajor", ["release", "alpha", "dev"], false),
  "preminor": async (cwd) => bump(cwd, "preminor", ["release", "alpha", "dev"], false),
  "prerelease": async (cwd) => bump(cwd, "prerelease", ["dev"])
};

exports.gitCall = gitCall;

exports.bumpVersion = function (bumpKeyword, sourceRef, destRef) {
  return BumpActions[bumpKeyword](process.cwd(), sourceRef, destRef);
};