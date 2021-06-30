const fs = require("fs");
const path = require("path");
const git = require('git-client');
const semver = require('semver');
const { spawnSync } = require("child_process");

const spawnOpts = { shell: true, stdio: "pipe", windowsHide: true };

function hasLerna(cwd) {
  return fs.existsSync(path.join(cwd, "lerna.json"));
}

function getCurrentVersion(cwd) {
  const configPath = path.join(cwd, hasLerna(cwd) ? "lerna.json" : "package.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  return semver.parse(config.version);
}

function getBumpKeyword(sourceRef, destRef) {
  const keywords = {
    "dev->alpha": "prerelease",
    "alpha->release": "patch",
    "release->main": "preminor",
    "main->main": "premajor"
  };

  const source = sourceRef.split('/')[0];
  const dest = destRef.split('/')[0];
  const key = `${source}->${dest}`;

  if (sourceRef.replace(source, "") !== destRef.replace(dest, "") && dest != "main") {
    throw new Error(`Versions not match for source/dest refs: ${sourceRef} -> ${destRef}`);
  }

  return keywords[key];
}

function verify(cwd, sourceRef, destRef) {
  const sourceMatch = sourceRef.match(/(\w+)\/v(\d+)\/v(\d+\.\d)/);
  const currentVersion = getCurrentVersion(cwd);

  if (!sourceMatch) {
    throw new Error(`Invalid versions for source/dest refs: ${sourceRef} -> ${destRef}`);
  }

  if (sourceMatch[2] != currentVersion.major || sourceMatch[3] != `${currentVersion.major}.${currentVersion.minor}`) {
    throw new Error(`The version of source ref ${sourceRef} does not match current ${currentVersion}`);
  }

  const keyword = getBumpKeyword(sourceRef, destRef);

  if (!keyword) {
    throw new Error(`No rule to bump for source/dest refs: ${sourceRef} -> ${destRef}`);
  }

  console.log(`keyword: ${keyword}`);
  return keyword;
}

function bumpWithLerna(keyword) {
  spawnSync("lerna", ["version", `${keyword}`, "--yes", "--no-push"], spawnOpts);
}

function bumpWithYarn(keyword) {
  spawnSync("yarn", ["version", `--${keyword}`, "--preid", "alpha"], spawnOpts);
}

function bump(cwd, keyword) {
  if (hasLerna(cwd)) {
    bumpWithLerna(keyword);
  } else {
    bumpWithYarn(keyword);
  }
}

async function gitCall(...args) {
  console.log("$ git", ...args);
  const output = await git(...args);
  console.log(output);
}

async function push(cwd, keyword) {
  const pushback = {
    "premajor": async () => { },
    "preminor": async () => { },
    "prerelease": async () => gitCall("push", "-f"),
    "patch": async () => gitCall("push", "-f")
  };
  const downstreams = {
    "premajor": ["release", "alpha", "dev"],
    "preminor": ["release", "alpha", "dev"],
    "prerelease": ["dev"],
    "patch": ["alpha", "dev"]
  };
  const switchOpts = {
    "premajor": ["-c"],
    "preminor": ["-c"],
    "prerelease": [],
    "patch": []
  };
  const currentVersion = getCurrentVersion(cwd);

  await gitCall("fetch");
  await gitCall("tag", "-f", `v${currentVersion.major}`);
  await gitCall("tag", "-f", `v${currentVersion.major}.${currentVersion.minor}`);
  await gitCall("push", "-f", "--tags");
  await pushback[keyword]();

  const branchPath = `v${currentVersion.major}/v${currentVersion.major}.${currentVersion.minor}`;
  const upstreams = {
    "release": "main",
    "alpha": `release/${branchPath}`,
    "dev": `alpha/${branchPath}`
  };
  for (const branchPrefix of downstreams[keyword]) {
    const upstreamBranch = upstreams[branchPrefix];
    const targetBranch = `${branchPrefix}/${branchPath}`;
    await gitCall("switch", ...switchOpts[keyword], targetBranch);
    await gitCall("reset", "--hard", upstreamBranch);
    await gitCall("push", "-u", "-f", "origin", targetBranch);
  }
}

const BumpActions = {
  "auto": (cwd, sourceRef, destRef) => bump(cwd, getBumpKeyword(sourceRef, destRef)),
  "verify": verify,
  "patch": (cwd) => bump(cwd, "patch"),
  "premajor": (cwd) => bump(cwd, "premajor"),
  "preminor": (cwd) => bump(cwd, "preminor"),
  "prerelease": (cwd) => bump(cwd, "prerelease")
};

const PushActions = {
  "auto": async (cwd, sourceRef, destRef) => push(cwd, getBumpKeyword(sourceRef, destRef)),
  "verify": async () => { },
  "patch": async (cwd) => push(cwd, "patch"),
  "premajor": async (cwd) => push(cwd, "premajor"),
  "preminor": async (cwd) => push(cwd, "preminor"),
  "prerelease": async (cwd) => push(cwd, "prerelease")
};

exports.gitCall = gitCall;

exports.bumpVersion = function (bumpKeyword, sourceRef, destRef) {
  BumpActions[bumpKeyword](process.cwd(), sourceRef, destRef);
};

exports.pushOrigin = function (bumpKeyword, sourceRef, destRef) {
  return PushActions[bumpKeyword](process.cwd(), sourceRef, destRef);
};