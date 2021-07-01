const github = require("@actions/github");
const fs = require("fs");
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
  const keywords = {
    "dev->alpha": "prerelease",
    "alpha->release": "patch",
    "release->main": "preminor",
    "main->main": "premajor"
  };

  const headMatch = headRef.match(/(\w+)\/v(\d+)\/v(\d+\.\d)/);
  const currentVersion = getCurrentVersion(cwd);

  if (!headMatch) {
    throw new Error(`Invalid versions for head/base refs: ${headRef} -> ${baseRef}`);
  }

  if (headMatch[2] != currentVersion.major || headMatch[3] != `${currentVersion.major}.${currentVersion.minor}`) {
    throw new Error(`The version of head ref ${headRef} does not match current ${currentVersion}`);
  }

  const source = headRef.split('/')[0];
  const dest = baseRef.split('/')[0];
  const key = `${source}->${dest}`;

  if (headRef.replace(source, "") !== baseRef.replace(dest, "") && dest != "main") {
    throw new Error(`Versions not match for head/base refs: ${headRef} -> ${baseRef}`);
  }

  return keywords[key];
}

function verify(cwd, headRef, baseRef) {
  const keyword = getBumpKeyword(cwd, headRef, baseRef);

  if (!keyword) {
    throw new Error(`No rule to bump for head/base refs: ${headRef} -> ${baseRef}`);
  }

  return keyword;
}

function exec(cmd, args) {
  console.log("$", cmd, ...args);
  if (bumpOpts.dry) {
    return;
  }
  const output = spawnSync(cmd, args, spawnOpts);
  console.log(output.output);
}

function bumpCall(cwd, keyword) {
  if (hasLerna(cwd)) {
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

  await gitCall("fetch", "--all");
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
  "auto": (cwd, headRef, baseRef) => bumpCall(cwd, getBumpKeyword(cwd, headRef, baseRef)),
  "verify": verify,
  "patch": (cwd) => bumpCall(cwd, "patch"),
  "premajor": (cwd) => bumpCall(cwd, "premajor"),
  "preminor": (cwd) => bumpCall(cwd, "preminor"),
  "prerelease": (cwd) => bumpCall(cwd, "prerelease")
};

const PushActions = {
  "auto": async (cwd, headRef, baseRef) => push(cwd, getBumpKeyword(cwd, headRef, baseRef)),
  "verify": async () => { },
  "patch": async (cwd) => push(cwd, "patch"),
  "premajor": async (cwd) => push(cwd, "premajor"),
  "preminor": async (cwd) => push(cwd, "preminor"),
  "prerelease": async (cwd) => push(cwd, "prerelease")
};

exports.gitCall = gitCall;

exports.bumpVersion = function (argv) {
  BumpActions[argv.keyword](process.cwd(), argv.headRef, argv.baseRef);
};

exports.pushOrigin = function (argv) {
  const checkAndPush = async () => {
    const octokit = github.getOctokit(argv.token);
    const pullRequestQuery = await octokit.graphql(`
          query {
            repository(name: "${argv.repo}", owner: "${argv.owner}") {
              pullRequests(headRefName: "${argv.headRef}", baseRefName: "${argv.baseRef}", last: 1) {
                nodes {
                  number
                }
              }
            }
          }`);
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner: argv.owner,
      repo: argv.repo,
      pull_number: pullRequestQuery.repository.pullRequests.nodes[0].number
    });
    const checkRunsQuery = await octokit.graphql(`
          query {
            repository(name: "${argv.repo}", owner: "${argv.owner}") {
              pullRequest(number: ${pullRequest.number}) {
                commits(last: 1) {
                  nodes {
                    commit {
                      oid
                      checkSuites(last: 1) {
                        nodes {
                          checkRuns(last: 1) {
                            nodes {
                              id
                              name
                              conclusion
                              status
                              steps(first: 100) {
                                nodes {
                                  name
                                  number
                                  status
                                  conclusion
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`);
    const commit = checkRunsQuery.repository.pullRequest.commits.nodes[0].commit;
    const checkRuns = commit.checkSuites.nodes[0].checkRuns.nodes;
    for (const checkRun of checkRuns) {
      console.log(`-- check run ${checkRun.name} status ${checkRun.status} conclusion ${checkRun.conclusion}`);
      console.log(JSON.stringify(checkRun, null, 2));
      for (const step of checkRun.steps.nodes) {
        if (step.status == "COMPLETED" && step.conclusion == "FAILURE") {
          throw new Error(`Step ${step.number} [${step.name}] failed`);
        }
      }
    }
    await PushActions[argv.keyword](process.cwd(), argv.headRef, argv.baseRef);
  };
  return checkAndPush();
};

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};