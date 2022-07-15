/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 572:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

/* eslint-disable no-restricted-globals */
const github = __nccwpck_require__(484);
const fs = __nccwpck_require__(147);
const os = __nccwpck_require__(37);
const path = __nccwpck_require__(17);
const git = __nccwpck_require__(578);
const semver = __nccwpck_require__(903);
const { spawnSync } = __nccwpck_require__(81);

const ProtectedBranchPatterns = ['main', 'release/*/*', 'alpha/*/*', 'dev/*/*'];

const bumpOpts = { dry: false };
const spawnOpts = { shell: true, stdio: 'pipe', windowsHide: true };

function hasLerna(cwd) {
  return fs.existsSync(path.join(cwd, 'lerna.json'));
}

function makeNpmrcForLerna(argv) {
  // https://github.com/lerna/lerna/issues/2404
  // Note that the only .npmrc file respected by Lerna is the project root. (lerna@4.0.0)
  const lineRegistry = `@${argv.owner}:registry=https://npm.pkg.github.com/`;
  const lineAuthToken = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}';
  const lineAwaysAuth = 'always-auth=false';
  const npmrcContent = `${lineRegistry}${os.EOL}${lineAuthToken}${os.EOL}${lineAwaysAuth}${os.EOL}`;
  console.log('> write .npmrc');
  if (bumpOpts.dry) {
    console.log(npmrcContent);
    return;
  }
  fs.writeFileSync('.npmrc', npmrcContent);
}

function getCurrentVersion(cwd) {
  const configPath = path.join(cwd, hasLerna(cwd) ? 'lerna.json' : 'package.json');
  const config = JSON.parse(fs.readFileSync(configPath));
  return semver.parse(config.version);
}

function getLooseVersion(version) {
  return `${version.major}.${version.minor}`;
}

function getChannel(ref) {
  return ref.replace(/^refs\/heads\//, '').split('/')[0];
}

function getBumpKeyword(cwd, headRef, baseRef, loose = false) {
  const version = getCurrentVersion(cwd);
  const looseVersionNumber = Number(getLooseVersion(version));
  const lastLooseVersionNumber = looseVersionNumber - 0.1;
  const headChannel = getChannel(headRef);
  const baseChannel = getChannel(baseRef);
  const key = `${headChannel}->${baseChannel}`;
  const keywords = {
    'dev->alpha': 'prerelease',
    'alpha->release': 'patch',
    'release->main': 'preminor',
    'release->release': 'preminor',
    'main->main': 'premajor',
  };

  const lts = baseChannel === 'release' && baseRef.split('/').pop() === 'lts';
  const preminor = headChannel === 'release' && (baseChannel === 'main' || lts);

  if (headRef.replace(headChannel, '') !== baseRef.replace(baseChannel, '') && !preminor) {
    throw new Error(`Versions not match for head/base refs: ${headRef} -> ${baseRef}`);
  }

  if (headChannel === 'main') {
    // for main -> main
    return keywords[key];
  }

  const headMatch = headRef.match(/(\w+)\/v(\d+)\/v(\d+\.\d)/);
  const mismatchMsg = `The version of head ref ${headRef} does not match current ${version}`;

  if (!headMatch) {
    throw new Error(mismatchMsg);
  }

  const headMajor = Number(headMatch[2]);
  const headLoose = Number(headMatch[3]);

  if (headMajor !== version.major || headLoose > looseVersionNumber) {
    throw new Error(mismatchMsg);
  }

  if (headLoose < lastLooseVersionNumber) {
    throw new Error(mismatchMsg);
  }

  if (headLoose === lastLooseVersionNumber && !loose) {
    throw new Error(mismatchMsg);
  }

  return keywords[key];
}

function exec(cmd, args = [], opts = spawnOpts) {
  console.log('$', cmd, ...args);
  if (bumpOpts.dry) {
    return;
  }
  const result = spawnSync(cmd, args, opts);
  const output = result.output.filter((e) => e && e.length > 0).toString();
  console.log(output);
  if (result.status !== 0) {
    throw new Error(`Failed with status ${result.status}`);
  }
}

async function gitCall(...args) {
  console.log('$ git', ...args);
  if (bumpOpts.dry) {
    return;
  }
  const output = await git(...args);
  console.log(output);
}

async function bumpCall(argv, keyword, message) {
  const version = getCurrentVersion(argv.cwd);
  semver.inc(version, keyword, 'alpha'); // Get next version to make up message
  const nonReleaseMessageOpt = ['--message', message ? `"${message}"` : `"Move on to v${version}"`];
  const messageOpt = keyword === 'patch' ? [] : nonReleaseMessageOpt;

  if (hasLerna(argv.cwd)) {
    exec('lerna', ['version', `${keyword}`, '--yes', '--no-push', ...messageOpt]);
  } else {
    exec('yarn', ['version', `--${keyword}`, '--preid', 'alpha', ...messageOpt]);
  }
}

async function publishCall(argv) {
  const tryPublish = (cwd) => {
    const packageConfig = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
    if (!packageConfig.private) {
      const execOpts = { cwd: cwd, ...spawnOpts };
      exec('npm', ['publish'], execOpts);
    } else {
      console.log(`> bypass private package ${packageConfig.name}`);
    }
  };
  if (hasLerna(argv.cwd)) {
    // https://github.com/lerna/lerna/issues/2404
    // Until lerna solves this issue we have to use yarn workspaces and npm publish
    const result = spawnSync('yarn', ['-s', 'workspaces', 'info'], spawnOpts);
    const output = result.output.filter((e) => e && e.length > 0).toString();
    const workspaces = JSON.parse(output);
    for (const key in workspaces) {
      const workspace = workspaces[key];
      tryPublish(path.join(argv.cwd, workspace.location));
    }
  } else {
    tryPublish(argv.cwd);
  }
}

async function getBranchProtectionRulesMap(argv) {
  const ruleIds = {};
  const octokit = github.getOctokit(argv.token);

  const { repository } = await octokit.graphql(`query{repository(name:"${argv.repo}",owner:"${argv.owner}"){id}}`);

  const rulesQuery = await octokit.graphql(`
        query {
          repository(name: "${argv.repo}", owner: "${argv.owner}") {
            branchProtectionRules(first:100) {
              nodes {
                id
                creator { login }
                pattern
              }
            }
          }
        }`);

  for (const rule of rulesQuery.repository.branchProtectionRules.nodes) {
    ruleIds[rule.pattern] = rule.id;
  }

  for (const pattern of ProtectedBranchPatterns.filter((p) => !(p in ruleIds))) {
    console.log(`> creating protection rule for branch name pattern ${pattern}`);
    const { createBranchProtectionRule } = await octokit.graphql(`
      mutation {
        createBranchProtectionRule(input: {
          repositoryId: "${repository.id}"
          pattern: "${pattern}"
        }) {
          branchProtectionRule { id }
        }
      }
    `);
    ruleIds[pattern] = createBranchProtectionRule.branchProtectionRule.id;
  }
  return ruleIds;
}

async function ensureBranchesProtection(argv) {
  if (!argv.protection) return;
  console.log(00000);
  const octokit = github.getOctokit(argv.token);
  const ruleIds = await getBranchProtectionRulesMap(argv);
  for (const pattern in ruleIds) {
    const id = ruleIds[pattern];
    const restrictsPushes = pattern.split('/')[0] !== 'dev';
    const statusCheckContexts = '["verify"]';
    const mutation = `
      mutation {
        updateBranchProtectionRule(input: {
          branchProtectionRuleId: "${id}"
          requiresApprovingReviews: ${restrictsPushes},
          requiredApprovingReviewCount: ${restrictsPushes ? 1 : 0},
          dismissesStaleReviews: true,
          restrictsReviewDismissals: true,
          requiresStatusChecks: true,
          requiredStatusCheckContexts: ${restrictsPushes ? statusCheckContexts : '[]'},
          requiresStrictStatusChecks: true,
          requiresConversationResolution: true,
          isAdminEnforced: true,
          restrictsPushes: ${restrictsPushes},
          allowsForcePushes: false,
          allowsDeletions: false
        }) { clientMutationId }
      }
    `;
    console.log(`> ensure protection for branch name pattern ${pattern}`);
    if (bumpOpts.dry) {
      console.log(mutation);
      continue;
    }
    console.log(`111`);
    await octokit.graphql(mutation);
    console.log(`222`);
  }
  console.log(`3333`);
}

async function suspendBranchesProtection(argv, branchPatterns = ProtectedBranchPatterns) {
  if (!argv.protection) return;

  const octokit = github.getOctokit(argv.token);
  const ruleIds = await getBranchProtectionRulesMap(argv);
  for (const pattern of branchPatterns) {
    const id = ruleIds[pattern];
    const mutation = `
      mutation {
        updateBranchProtectionRule(input: {
          branchProtectionRuleId: "${id}"
          requiresApprovingReviews: false,
          requiredApprovingReviewCount: 0,
          dismissesStaleReviews: false,
          restrictsReviewDismissals: false,
          requiresStatusChecks: false,
          requiresStrictStatusChecks: false,
          requiresConversationResolution: false,
          isAdminEnforced: true,
          restrictsPushes: false,
          allowsForcePushes: true,
          allowsDeletions: false
        }) { clientMutationId }
      }
    `;
    console.log(`> suspend protection for branch name pattern ${pattern}`);
    if (bumpOpts.dry) {
      console.log(mutation);
      continue;
    }
    await octokit.graphql(mutation);
  }
}

async function mergeCall(argv, keyword) {
  const pushTargets = {
    premajor: ['release', 'alpha', 'dev'],
    preminor: ['release', 'alpha', 'dev'],
    patch: ['release', 'alpha', 'dev'],
    prerelease: ['dev'],
  };
  const branchPatterns = pushTargets[keyword].map((p) => `${p}/*/*`);
  await suspendBranchesProtection(argv, branchPatterns).catch(console.error);

  const octokit = github.getOctokit(argv.token);
  const headVersion = getCurrentVersion(argv.cwd);

  const pushTag = (tag) => gitCall('push', '-f', 'origin', `HEAD:refs/tags/${tag}`);
  const pushAlphaVersionTag = (v) => pushTag(`v${getLooseVersion(v)}-alpha`);
  const pushLooseVersionTag = (v) => pushTag(`v${getLooseVersion(v)}`);
  const pushMajorVersionTag = (v) =>
    octokit.rest.git
      .getRef({
        owner: argv.owner,
        repo: argv.repo,
        ref: `tags/v${v.major}.${v.minor + 1}`,
      })
      .catch(() => pushTag(`v${v.major}`));

  await pushAlphaVersionTag(headVersion);

  const pushVersionTags = {
    premajor: async () => {
      await gitCall('push', '-f', 'origin', `HEAD~1:refs/heads/release/v${argv.version.major}/lts`);
    },
    preminor: async () => {},
    patch: async (version) => {
      // Track loose version ${major.minor} on release channel
      await pushLooseVersionTag(version);
      // Track major version on release channel
      await pushMajorVersionTag(version);
      // Push release tag
      await gitCall('push', '-f', 'origin', `HEAD:refs/tags/v${version}`);
      // Push release commit
      await gitCall('push', '-f', 'origin', `HEAD:refs/heads/${argv.baseRef}`);
      // Prepare new prerelease version for alpha channel
      await bumpCall(argv, 'prerelease');
      await pushAlphaVersionTag(getCurrentVersion(argv.cwd));
    },
    prerelease: async () => {
      await gitCall('push', '-f', 'origin', `HEAD~1:refs/tags/v${argv.version}`);
    },
  };

  await pushVersionTags[keyword](headVersion);

  const currentVersion = getCurrentVersion(argv.cwd); // Version might be changed after patch bump
  const looseVersion = getLooseVersion(currentVersion);

  const { data: alphaVersionRef } = await octokit.rest.git.getRef({
    owner: argv.owner,
    repo: argv.repo,
    ref: `tags/v${looseVersion}-alpha`,
  });

  const mergeRemoteChannel = async (channelRef) => {
    console.log(`> merge ${argv.repo}/v${looseVersion} into ${argv.repo}/${channelRef}`);
    if (bumpOpts.dry) {
      return;
    }
    const { data: branch } = await octokit.rest.git
      .getRef({
        owner: argv.owner,
        repo: argv.repo,
        ref: `heads/${channelRef}`,
      })
      .catch(() =>
        octokit.rest.git.createRef({
          owner: argv.owner,
          repo: argv.repo,
          ref: `refs/heads/${channelRef}`,
          sha: alphaVersionRef.object.sha,
        }),
      );
    const merge = await octokit.rest.repos.merge({
      owner: argv.owner,
      repo: argv.repo,
      base: branch.ref,
      head: alphaVersionRef.object.sha,
      commit_message: `Update ${channelRef} to work on ${currentVersion}`,
    });
    if (merge.status !== 201 && merge.status !== 204) {
      console.error(merge);
      throw new Error(`Merge failed with status ${merge.status}`);
    }
  };

  const mergeTargets = {
    premajor: ['release', 'alpha', 'dev'],
    preminor: ['release', 'alpha', 'dev'],
    patch: ['alpha'],
    prerelease: ['dev'],
  };
  const versionRef = `v${currentVersion.major}/v${currentVersion.major}.${currentVersion.minor}`;

  console.log(`${os.EOL}# https://docs.github.com/en/rest/reference/repos#merge-a-branch${os.EOL}`);
  for (const channel of mergeTargets[keyword]) {
    await mergeRemoteChannel(`${channel}/${versionRef}`);
  }

  if (keyword === 'patch') {
    // Prepare new prerelease version for dev channel
    const devChannel = `dev/${versionRef}`;
    await gitCall('fetch');
    await gitCall('switch', '-c', devChannel, `origin/${devChannel}`);
    await gitCall('tag', '-d', `v${currentVersion}`);
    await bumpCall(argv, 'prepatch', `Update ${devChannel} to work on ${currentVersion}`);
    await gitCall('push', 'origin', `HEAD:${devChannel}`);
    await gitCall('switch', argv.baseRef);
  }

  await ensureBranchesProtection(argv).catch(console.error);
  console.log(`开始执行`);
  await resetDefaultBranch(argv); //在此处调用函数以更新默认分支名
  console.log(`结束执行`);
}
async function resetDefaultBranch(argv) {
  //更改默认分支名
  const octokit = github.getOctokit(argv.token);
  const lastDevVersion = await octokit.graphql(
    `query {
      repository(name: "${argv.repo}", owner: "${argv.owner}") {
          refs(refPrefix: "refs/heads/dev/", last: 1){
            nodes{
              name
            }
          }
        }
      }
    }`,
  ); //获取最新版本
  for (const lastVersion of lastDevVersion.repository.refs.nodes) {
    const lastDevName = 'dev/' + lastVersion.name;
  }
  console.log(`latestVersion is : ${lastDevVersion.repository.refs.nodes.name}`);
  console.log(` latestName is : ${lastDevName}`);
  const response = await octokit.request('PATCH /repos/{owner}/{repo}', {
    owner: argv.owner,
    repo: argv.repo,
    default_branch: lastDevName,
  }); //使用REST API来上传以更新默认分支名
}

exports.getChannel = getChannel;

exports.exec = exec;

exports.gitCall = gitCall;

exports.ensureBranchesProtection = ensureBranchesProtection;

exports.suspendBranchesProtection = suspendBranchesProtection;

exports.resetDefaultBranch = resetDefaultBranch; //添加exports

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};

exports.currentVersion = () => getCurrentVersion(process.cwd());

exports.getBumpKeyword = (argv) => getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);

exports.ensureLerna = (argv) => {
  if (hasLerna(argv.cwd)) {
    const result = spawnSync('lerna', ['--version'], spawnOpts);
    if (result.status !== 0) {
      exec('npm', ['install', '-g', 'lerna@4.0.0']);
    }
  }
};

exports.tryBump = (argv) => bumpCall(argv, getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef));

exports.tryPublish = async (argv) => {
  if (argv.publish) {
    process.env.NODE_AUTH_TOKEN = argv.token;
    const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
    if (keyword === 'patch' || keyword === 'prerelease') {
      await publishCall(argv);
    }
  }
};

exports.tryMerge = (argv) => mergeCall(argv, getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef, true));

exports.verify = async (argv) => {
  const keyword = getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);
  if (!keyword) {
    throw new Error(`No rule to bump for head/base refs: ${argv.headRef} -> ${argv.baseRef}`);
  }
  return keyword;
};


/***/ }),

/***/ 508:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 484:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 578:
/***/ ((module) => {

module.exports = eval("require")("git-client");


/***/ }),

/***/ 903:
/***/ ((module) => {

module.exports = eval("require")("semver");


/***/ }),

/***/ 81:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 37:
/***/ ((module) => {

"use strict";
module.exports = require("os");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
/* eslint-disable no-restricted-globals */
const lib = (exports.lib = __nccwpck_require__(572));
const fs = __nccwpck_require__(147);
const path = __nccwpck_require__(17);
const semver = __nccwpck_require__(903);
const core = __nccwpck_require__(508);
const github = __nccwpck_require__(484);

function getPullRequestNumber() {
  const issue = github.context.issue;
  return issue.number ? issue.number : github.context.payload.pull_request.number;
}

const setup = (exports.setup = async function (argv) {
  const context = github.context;
  if (context.eventName === 'pull_request') {
    const octokit = github.getOctokit(argv.token);
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner: argv.owner,
      repo: argv.repo,
      pull_number: getPullRequestNumber(),
    });
    const merge = argv.action === 'auto' || argv.action === 'postbuild';
    if (merge && !pullRequest.merged) {
      throw new Error(`Pull request [${pullRequest.html_url}] must be merged to perform action ${argv.action}`);
    }
    argv.pullRequest = pullRequest;
  }
  if (context.eventName === 'workflow_dispatch') {
    if (lib.getChannel(argv.headRef) !== 'main' || lib.getChannel(argv.baseRef) !== 'main') {
      throw new Error(`Manual trigger on head [${argv.headRef}] -> base [${argv.baseRef}] not supported`);
    }
  }
  await lib.gitCall('config', '--global', 'user.name', argv.actor);
  await lib.gitCall('config', '--global', 'user.email', `${argv.actor}@users.noreply.github.com`);
  lib.ensureLerna(argv);
});

const teardown = (exports.teardown = async function (argv) {
  if (github.context.eventName === 'pull_request' && argv.action === 'verify') {
    const keyword = lib.getBumpKeyword(argv);
    const octokit = github.getOctokit(argv.token);
    const title = {
      premajor: (v) => `Prepare v${semver.inc(v, 'major')}`,
      preminor: (v) => `Prepare v${semver.inc(v, 'minor')}`,
      patch: (v) => `Release v${semver.inc(v, 'patch')}`,
      prerelease: (v) => `Prerelease v${v}`,
    };
    const mutation = `mutation {
                updatePullRequest(input: {
                    pullRequestId: "${argv.pullRequest.node_id}"
                    title: "${title[keyword](lib.currentVersion())}"
                }) { pullRequest { id } }
            }`;
    await octokit.graphql(mutation);
  }
});

const prebuild = async (argv) => {
  core.setOutput('prebuild-version', `v${lib.currentVersion()}`);
  if (lib.getBumpKeyword(argv) === 'patch') {
    // The release version commit must be made before build to have the right release info.
    await lib.tryBump(argv);
  }
  core.setOutput('version', `v${lib.currentVersion()}`);
};

const postbuild = async (argv) => {
  await lib.tryPublish(argv);
  if (lib.getBumpKeyword(argv) !== 'patch') {
    // The next prerelease version commit must be made after build to update tracking branches.
    await lib.tryBump(argv);
  }
  await lib.tryMerge(argv);
  core.setOutput('postbuild-version', `v${lib.currentVersion()}`);
};

const tryClosePullRequest = async (error) => {
  const token = core.getInput('token');
  const headRef = process.env.GITHUB_HEAD_REF || context.ref;
  const baseRef = process.env.GITHUB_BASE_REF || context.ref;
  if (github.context.eventName === 'pull_request' && core.getInput('action') === 'verify') {
    const repo = github.context.repo;
    const octokit = github.getOctokit(token);
    const pullRequestQuery = await octokit.graphql(`
            query {
            repository(name: "${repo.repo}", owner: "${repo.owner}") {
                pullRequest(number: ${getPullRequestNumber()}) { id }
            }
        }`);
    const pullRequestId = pullRequestQuery.repository.pullRequest.id;
    const body = `Invalid Pull Request from ${headRef} to ${baseRef} for version ${lib.currentVersion()}: ${
      error.message
    }`;
    await octokit.graphql(`mutation{addComment(input:{subjectId:"${pullRequestId}",body:"${body}"}){subject{id}}}`);
    await octokit.graphql(
      `mutation {updatePullRequest(input:{pullRequestId:"${pullRequestId}", state:CLOSED}) {pullRequest{id}}}`,
    );
  }
};

const actions = (exports.actions = {
  auto: async (argv) => {
    await prebuild(argv);
    await postbuild(argv);
  },
  prebuild: prebuild,
  postbuild: postbuild,
  verify: lib.verify,
});

const main = async function () {
  const context = github.context;
  const headRef = process.env.GITHUB_HEAD_REF || context.ref;
  const baseRef = process.env.GITHUB_BASE_REF || context.ref;
  const argv = {
    cwd: process.cwd(),
    owner: context.repo.owner,
    repo: context.repo.repo,
    actor: context.actor,
    token: core.getInput('token'),
    action: core.getInput('action'),
    publish: core.getInput('no-publish') === 'false',
    protection: core.getInput('no-protection') === 'false',
    headRef: headRef,
    baseRef: baseRef,
    keyword: lib.getBumpKeyword({ cwd: process.cwd(), headRef: headRef, baseRef: baseRef }),
    version: lib.currentVersion(),
  };

  core.setOutput('keyword', argv.keyword);
  await setup(argv);
  await actions[argv.action](argv);
  await teardown(argv);
};

if (process.env.GITHUB_ACTION) {
  const configPath = path.join(path.dirname(__dirname), 'package.json'); // Find package.json for dist/index.js
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath)) : {};
  if (config.name && process.env.GITHUB_ACTION_REPOSITORY === config.name.slice(1)) {
    main().catch((error) => {
      console.error(error);
      core.setFailed(error.message);
      tryClosePullRequest(error).catch(console.error);
    });
  }
}

})();

module.exports = __webpack_exports__;
/******/ })()
;