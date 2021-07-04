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

function getBumpKeyword(cwd, headRef, baseRef) {
  const version = getCurrentVersion(cwd);
  const headChannel = headRef.split('/')[0];
  const baseChannel = baseRef.split('/')[0];
  const keywords = {
    "dev->alpha": "prerelease",
    "alpha->release": "patch",
    "release->main": "preminor",
    "main->main": "premajor"
  };
  const key = `${headChannel}->${baseChannel}`;
  const lastMinor = Number(`${version.major}.${version.minor}`) - 0.1;

  if (headRef.replace(headChannel, "") !== baseRef.replace(baseChannel, "") && baseChannel != "main") {
    throw new Error(`Versions not match for head/base refs: ${headRef} -> ${baseRef}`);
  }

  if (headChannel == "main") {
    return keywords[key];
  }

  const headMatch = headRef.match(/(\w+)\/v(\d+)\/v(\d+\.\d)/);

  if (!headMatch) {
    throw new Error(`Invalid versions for head/base refs: ${headRef} -> ${baseRef}`);
  }

  if (headMatch[2] == version.major && headMatch[3] == lastMinor && baseChannel == "main") {
    return keywords[key];
  }

  if ((headMatch[2] != version.major || headMatch[3] != `${version.major}.${version.minor}`) && baseChannel != "main") {
    throw new Error(`The version of head ref ${headRef} does not match current ${version}`);
  }

  return keywords[key];
}

function exec(cmd, args) {
  console.log("$", cmd, ...args);
  if (bumpOpts.dry) {
    return;
  }
  const output = spawnSync(cmd, args, spawnOpts).output;
  console.log(output.toString());
}

async function bumpCall(keyword, argv) {
  const version = getCurrentVersion(argv.cwd);
  const updateTag = {
    "premajor": async () => { },
    "preminor": async () => { },
    "prerelease": async () => {
      if (argv.baseRef.split('/')[0] == "alpha") { // filter out call from patch workflow
        await gitCall("push", "-f", "origin", `HEAD:refs/tags/v${version}`);
      }
    },
    "patch": async () => { }
  };
  await updateTag[keyword]();

  if (hasLerna(argv.cwd)) {
    exec("npm", ["install", "-g", "lerna"]);
    exec("lerna", ["version", `${keyword}`, "--yes", "--no-push"]);
  } else {
    exec("yarn", ["version", `--${keyword}`, "--preid", "alpha"]);
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

async function updateTrackingChannels(version) {
  await gitCall("push", "-f", "origin", `HEAD:refs/tags/v${version.major}`);
  await gitCall("push", "-f", "origin", `HEAD:refs/tags/v${version.major}.${version.minor}`);
}

async function mergeCall(keyword, argv) {
  const version = getCurrentVersion(argv.cwd);

  await updateTrackingChannels(version);

  const pushback = {
    "premajor": async () => { },
    "preminor": async () => { },
    "prerelease": async () => { },
    "patch": async () => {
      await gitCall("tag", "-f", `v${version}`);
      await gitCall("push", "origin", `HEAD:refs/tags/v${version}`);
      await gitCall("push");
      await bumpCall("prerelease", argv);
      await updateTrackingChannels(getCurrentVersion(argv.cwd));
    }
  };
  await pushback[keyword]();

  const newVersion = getCurrentVersion(argv.cwd);
  const octokit = github.getOctokit(argv.token);

  const { data: latestRef } = await octokit.rest.git.getRef({
    owner: argv.owner,
    repo: argv.repo,
    ref: `tags/v${newVersion.major}`
  });

  const mergeRemoteChannel = async (branchRef) => {
    console.log(`> merge into ${argv.repo} ${branchRef}`);
    if (bumpOpts.dry) {
      return;
    }
    const { data: branch } = await octokit.rest.git.getRef({
      owner: argv.owner,
      repo: argv.repo,
      ref: `heads/${branchRef}`
    }).catch(() => octokit.rest.git.createRef({
      owner: argv.owner,
      repo: argv.repo,
      ref: `refs/heads/${branchRef}`,
      sha: latestRef.object.sha
    }));
    const merge = await octokit.rest.repos.merge({
      owner: argv.owner,
      repo: argv.repo,
      base: branch.ref,
      head: latestRef.object.sha,
      commit_message: `Update ${branchRef} to version ${newVersion}`
    });
    if (merge.status == 409) {
      await gitCall("push", "-f", "origin", `HEAD:${branchRef}`);
      return;
    }
    if (merge.status != 201 && merge.status != 204) {
      console.error(merge);
      throw new Error(`Merge failed with status ${merge.status}`);
    }
  };

  const mergeTargets = {
    "premajor": ["release", "alpha", "dev"],
    "preminor": ["release", "alpha", "dev"],
    "patch": ["alpha", "dev"],
    "prerelease": ["dev"]
  };

  console.log(`${os.EOL}# https://docs.github.com/en/rest/reference/repos#merge-a-branch${os.EOL}`);
  for (const channel of mergeTargets[keyword]) {
    await mergeRemoteChannel(`${channel}/v${newVersion.major}/v${newVersion.major}.${newVersion.minor}`);
  }
}

const BumpActions = {
  "auto": (argv) => bumpCall(getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef), argv),
  "patch": (argv) => bumpCall("patch", argv),
  "premajor": (argv) => bumpCall("premajor", argv),
  "preminor": (argv) => bumpCall("preminor", argv),
  "prerelease": (argv) => bumpCall("prerelease", argv)
};

const MergeActions = {
  "auto": (argv) => mergeCall(getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef), argv),
  "patch": (argv) => mergeCall("patch", argv),
  "premajor": (argv) => mergeCall("premajor", argv),
  "preminor": (argv) => mergeCall("preminor", argv),
  "prerelease": (argv) => mergeCall("prerelease", argv)
};

exports.exec = exec;

exports.gitCall = gitCall;

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};

exports.currentVersion = () => getCurrentVersion(process.cwd());

exports.getBumpKeyword = (argv) => getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);

exports.tryBump = (argv) => BumpActions[argv.keyword](argv);

exports.tryMerge = (argv) => MergeActions[argv.keyword](argv);

exports.verify = (argv) => {
  const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
  if (!keyword) {
    throw new Error(`No rule to bump for head/base refs: ${argv.headRef} -> ${argv.baseRef}`);
  }
  return keyword;
};