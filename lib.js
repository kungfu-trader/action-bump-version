const github = require("@actions/github");
const fs = require("fs");
const os = require("os");
const path = require("path");
const git = require('git-client');
const semver = require('semver');
const { spawnSync } = require("child_process");

const bumpOpts = { dry: false };
const spawnOpts = { shell: true, stdio: "pipe", windowsHide: true };

function hasLerna(cwd) {
  return fs.existsSync(path.join(cwd, "lerna.json"));
}

function getCurrentVersion(cwd) {
  const configPath = path.join(cwd, hasLerna(cwd) ? "lerna.json" : "package.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  return semver.parse(config.version);
}

function getLooseVersion(version) {
  return `${version.major}.${version.minor}`;
}

function getBumpKeyword(cwd, headRef, baseRef, loose = false) {
  const version = getCurrentVersion(cwd);
  const looseVersionNumber = Number(getLooseVersion(version));
  const lastLooseVersionNumber = looseVersionNumber - 0.1;
  const headChannel = headRef.split('/')[0];
  const baseChannel = baseRef.split('/')[0];
  const key = `${headChannel}->${baseChannel}`;
  const keywords = {
    "dev->alpha": "prerelease",
    "alpha->release": "patch",
    "release->main": "preminor",
    "main->main": "premajor"
  };

  if (headRef.replace(headChannel, "") !== baseRef.replace(baseChannel, "") && baseChannel != "main") {
    throw new Error(`Versions not match for head/base refs: ${headRef} -> ${baseRef}`);
  }

  if (headChannel == "main") { // for main -> main
    return keywords[key];
  }

  const headMatch = headRef.match(/(\w+)\/v(\d+)\/v(\d+\.\d)/);
  const mismatchMsg = `The version of head ref ${headRef} does not match current ${version}`;

  if (!headMatch) {
    throw new Error(mismatchMsg);
  }

  if (headMatch[2] != version.major || headMatch[3] > looseVersionNumber) {
    throw new Error(mismatchMsg);
  }

  if (headMatch[3] < lastLooseVersionNumber) {
    throw new Error(mismatchMsg);
  }

  if (headMatch[3] == lastLooseVersionNumber && !loose) {
    throw new Error(mismatchMsg);
  }

  return keywords[key];
}

function exec(cmd, args = []) {
  console.log("$", cmd, ...args);
  if (bumpOpts.dry) {
    return;
  }
  const result = spawnSync(cmd, args, spawnOpts);
  const output = result.output.filter(e => e && e.length > 0).toString();
  console.log(output);
  if (result.status != 0) {
    throw new Error(`Failed with status ${result.status}`);
  }
}

async function gitCall(...args) {
  console.log("$ git", ...args);
  if (bumpOpts.dry) {
    return;
  }
  const output = await git(...args);
  console.log(output);
}

async function bumpCall(argv, keyword, message) {
  const version = getCurrentVersion(argv.cwd);
  semver.inc(version, keyword, 'alpha'); // Get next version to make up message
  const nonReleaseMessageOpt = ["--message", message ? `"${message}"` : `"Move on to v${version}"`];
  const messageOpt = keyword == "patch" ? [] : nonReleaseMessageOpt;

  if (hasLerna(argv.cwd)) {
    exec("npm", ["install", "-g", "lerna@4.0.0"]);
    exec("lerna", ["version", `${keyword}`, "--yes", "--no-push", ...messageOpt]);
  } else {
    exec("yarn", ["version", `--${keyword}`, "--preid", "alpha", ...messageOpt]);
  }
}

async function publishCall(argv) {
  if (hasLerna(argv.cwd)) {
    exec("lerna", ["publish", "from-package", "--preid", "alpha"]);
  } else {
    exec("npm", ["publish"]);
  }
}

async function mergeCall(argv, keyword) {
  const octokit = github.getOctokit(argv.token);
  const headVersion = getCurrentVersion(argv.cwd);

  const pushTag = (tag) => gitCall("push", "-f", "origin", `HEAD:refs/tags/${tag}`);
  const pushAlphaVersionTag = (v) => pushTag(`v${getLooseVersion(v)}-alpha`);
  const pushLooseVersionTag = (v) => pushTag(`v${getLooseVersion(v)}`);
  const pushMajorVersionTag = (v) => octokit.rest.git.getRef({
    owner: argv.owner,
    repo: argv.repo,
    ref: `tags/v${v.major}.${v.minor + 1}`
  }).catch(() => pushTag(`v${v.major}`));

  await pushAlphaVersionTag(headVersion);

  const pushVersionTags = {
    "premajor": async (version) => { },
    "preminor": async (version) => { },
    "patch": async (version) => {
      // Track loose version ${major.minor} on release channel
      await pushLooseVersionTag(version);
      // Track major version on release channel
      await pushMajorVersionTag(version);
      // Push release tag
      await gitCall("push", "-f", "origin", `HEAD:refs/tags/v${version}`);
      // Push release commit
      await gitCall("push", "-f", "origin", `HEAD:refs/heads/${argv.baseRef}`);
      // Prepare new prerelease version for alpha channel
      await bumpCall(argv, "prerelease");
      await pushAlphaVersionTag(getCurrentVersion(argv.cwd));
    },
    "prerelease": async (version) => gitCall("push", "-f", "origin", `HEAD~1:refs/tags/v${version}`)
  };

  await pushVersionTags[keyword](headVersion);

  const currentVersion = getCurrentVersion(argv.cwd); // Version might be changed after patch bump
  const looseVersion = getLooseVersion(currentVersion);

  const { data: alphaVersionRef } = await octokit.rest.git.getRef({
    owner: argv.owner,
    repo: argv.repo,
    ref: `tags/v${looseVersion}-alpha`
  });

  const mergeRemoteChannel = async (channelRef) => {
    console.log(`> merge ${argv.repo}/v${looseVersion} into ${argv.repo}/${channelRef}`);
    if (bumpOpts.dry) {
      return;
    }
    const { data: branch } = await octokit.rest.git.getRef({
      owner: argv.owner,
      repo: argv.repo,
      ref: `heads/${channelRef}`
    }).catch(() => octokit.rest.git.createRef({
      owner: argv.owner,
      repo: argv.repo,
      ref: `refs/heads/${channelRef}`,
      sha: alphaVersionRef.object.sha
    }));
    const merge = await octokit.rest.repos.merge({
      owner: argv.owner,
      repo: argv.repo,
      base: branch.ref,
      head: alphaVersionRef.object.sha,
      commit_message: `Update ${channelRef} to work on ${currentVersion}`
    });
    if (merge.status != 201 && merge.status != 204) {
      console.error(merge);
      throw new Error(`Merge failed with status ${merge.status}`);
    }
  };

  const mergeTargets = {
    "premajor": ["release", "alpha", "dev"],
    "preminor": ["release", "alpha", "dev"],
    "patch": ["alpha"],
    "prerelease": ["dev"]
  };
  const versionRef = `v${currentVersion.major}/v${currentVersion.major}.${currentVersion.minor}`;

  console.log(`${os.EOL}# https://docs.github.com/en/rest/reference/repos#merge-a-branch${os.EOL}`);
  for (const channel of mergeTargets[keyword]) {
    await mergeRemoteChannel(`${channel}/${versionRef}`);
  }

  if (keyword == "patch") {
    // Prepare new prerelease version for dev channel
    const devChannel = `dev/${versionRef}`;
    await gitCall("fetch");
    await gitCall("switch", "-c", devChannel, `origin/${devChannel}`);
    await gitCall("tag", "-d", `v${currentVersion}`);
    await bumpCall(argv, "prepatch", `Update ${devChannel} to work on ${currentVersion}`);
    await gitCall("push", "origin", `HEAD:${devChannel}`);
    await gitCall("switch", argv.baseRef);
  }
}

exports.exec = exec;

exports.gitCall = gitCall;

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};

exports.currentVersion = () => getCurrentVersion(process.cwd());

exports.getBumpKeyword = (argv) => getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);

exports.tryBump = (argv) => bumpCall(argv, getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef));

exports.tryPublish = async (argv) => {
  if (process.env.NODE_AUTH_TOKEN) {
    const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
    if (keyword == "patch" || keyword == "prerelease") {
      publishCall(argv);
    }
  }
};

exports.tryMerge = (argv) => mergeCall(argv, getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef, true));

exports.verify = (argv) => {
  const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
  if (!keyword) {
    throw new Error(`No rule to bump for head/base refs: ${argv.headRef} -> ${argv.baseRef}`);
  }
  return keyword;
};