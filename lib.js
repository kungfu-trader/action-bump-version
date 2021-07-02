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

function exec(cmd, args) {
  console.log("$", cmd, ...args);
  if (bumpOpts.dry) {
    return;
  }
  const output = spawnSync(cmd, args, spawnOpts).output;
  console.log(output.toString());
}

function bumpCall(keyword, argv) {
  if (hasLerna(argv.cwd)) {
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

async function mergeCall(keyword, argv) {
  const version = getCurrentVersion(argv.cwd);

  await gitCall("tag", "-f", `v${version.major}`);
  await gitCall("tag", "-f", `v${version.major}.${version.minor}`);
  await gitCall("push", "-f", "--tags");

  const octokit = github.getOctokit(argv.token);

  const { data: tagMajorRef } = await octokit.rest.git.getRef({
    owner: argv.owner,
    repo: argv.repo,
    ref: `tags/v${version.major}`
  });

  const mergeRemote = async (branchRef) => {
    console.log(`-- merging to origin: ${branchRef}`);
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
      sha: tagMajorRef.object.sha
    }));
    const merge = await octokit.rest.repos.merge({
      owner: argv.owner,
      repo: argv.repo,
      base: branch.ref,
      head: tagMajorRef.object.sha
    });
    console.log(merge);
  };

  const mergeTargets = {
    "premajor": ["release", "alpha", "dev"],
    "preminor": ["release", "alpha", "dev"],
    "patch": ["release", "alpha", "dev"],
    "prerelease": ["alpha", "dev"]
  };
  for (const stream of mergeTargets[keyword]) {
    await mergeRemote(`${stream}/v${version.major}/v${version.major}.${version.minor}`);
  }
}

const BumpActions = {
  "auto": (argv) => bumpCall(getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef)),
  "patch": (argv) => bumpCall("patch", argv),
  "premajor": (argv) => bumpCall("premajor", argv),
  "preminor": (argv) => bumpCall("preminor", argv),
  "prerelease": (argv) => bumpCall("prerelease", argv)
};

const MergeActions = {
  "auto": async (argv) => mergeCall(getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef), argv),
  "patch": async (argv) => mergeCall("patch", argv),
  "premajor": async (argv) => mergeCall("premajor", argv),
  "preminor": async (argv) => mergeCall("preminor", argv),
  "prerelease": async (argv) => mergeCall("prerelease", argv)
};

exports.gitCall = gitCall;

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};

exports.bumpVersion = (argv) => BumpActions[argv.keyword](argv);

exports.mergeOrigin = (argv) => MergeActions[argv.keyword](argv);

exports.verify = (argv) => {
  const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
  if (!keyword) {
    throw new Error(`No rule to bump for head/base refs: ${argv.headRef} -> ${argv.baseRef}`);
  }
  return keyword;
};

exports.protectBranches = async (argv) => {
  // for (const rule of branchRulesQuery.repository.branchProtectionRules.nodes) {
  //   const m = await octokit.graphql(`
  //         mutation {
  //           updateBranchProtectionRule(input: {
  //             branchProtectionRuleId: "${rule.id}",
  //             restrictsPushes: false
  //           }) {
  //             branchProtectionRule {
  //               id
  //               pattern
  //               restrictsPushes
  //             }
  //           }1
  //         }`);
  //   console.log(m);
  // }

  const protection = await octokit.rest.repos.updateBranchProtection({
    owner: argv.owner,
    repo: argv.repo,
    branch: "dev/v1/v1.1",
    allow_force_pushes: false,
    allow_deletions: false,
    enforce_admins: true,
    required_pull_request_reviews: true,
    required_status_checks: null,
    restrictions: null
  });
  console.log(protection);
};

exports.checkStatus = async (argv) => {
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
                      statusCheckRollup {
                         state
                      }
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
                                  startedAt
                                  completedAt
                                  secondsToCompletion
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

  console.log(JSON.stringify(commit, null, 2));

  const checkRuns = commit.checkSuites.nodes[0].checkRuns.nodes;
  for (const checkRun of checkRuns) {
    console.log(`-- check run ${checkRun.name} status ${checkRun.status} conclusion ${checkRun.conclusion}`);
    for (const step of checkRun.steps.nodes) {
      if (step.status == "COMPLETED" && step.conclusion == "FAILURE") {
        throw new Error(`Step ${step.number} [${step.name}] failed`);
      }
    }
  }
};