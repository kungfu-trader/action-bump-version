/* eslint-disable no-restricted-globals */
const github = require('@actions/github');
const fs = require('fs');
const os = require('os');
const path = require('path');
const git = require('git-client');
const semver = require('semver');
const { spawnSync } = require('child_process');
const { boolean } = require('yargs');

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
    console.log('> detected lerna, use yarn workspaces publish');
    const result = spawnSync('yarn', ['-s', 'workspaces', 'info'], spawnOpts);
    const output = result.output.filter((e) => e && e.length > 0).toString();
    if (output.toString().split(' ')[0] != 'error') {
      const workspaces = JSON.parse(output);
      for (const key in workspaces) {
        const workspace = workspaces[key];
        tryPublish(path.join(argv.cwd, workspace.location));
      }
    } else {
      console.log('[error]: Found lerna.json in a non-workspace project, please remove lerna.json in your project!');
    }
  } else {
    console.log('> use npm publish');
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
    await octokit.graphql(mutation);
  }
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
  await exports.resetDefaultBranch(argv);
  await exports.traversalMessage(argv);
}
exports.resetDefaultBranch = async function (argv) {
  const octokit = github.getOctokit(argv.token);
  const lastDevVersion = await octokit.graphql(`
    query {
      repository(owner: "${argv.owner}", name: "${argv.repo}") {
        refs(refPrefix: "refs/heads/dev/", last: 1) {
          edges {
            node {
             name
            }
          } 
        }
      }
    }`);
  if (typeof lastDevVersion.repository.refs.edges[0] === 'undefined') {
    return;
  }
  const tempStoreName = lastDevVersion.repository.refs.edges[0].node.name;
  const lastDevName = 'dev/' + tempStoreName;
  await octokit.request('PATCH /repos/{owner}/{repo}', {
    owner: argv.owner,
    repo: argv.repo,
    default_branch: lastDevName,
  });
};
//下方代码用于在github-action-控制台输出测试能否获取我们想要的package-version
async function* traversalPackagesGraphQL(octokit) {
  //循环遍历获取所有package的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  //let startCursor = ''; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
  const graphResponse = await octokit.graphql(`
          query{
            organization(login: "kungfu-trader") {
              packages(first: ${maxPerPage}) {
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  name
                  repository {
                    name
                  }
                  latestVersion {
                    version
                  }
                }
              }
            }
          }`);
  let startCursor = graphResponse.organization.packages.pageInfo.endCursor;
  hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage;
  for (const graphPackage of graphResponse.organization.packages.nodes) {
    yield graphPackage;
  }
  while (hasNextPage) {
    const graphResponse = await octokit.graphql(`
        query{
          organization(login: "kungfu-trader") {
            packages(first: ${maxPerPage}, after: "${startCursor}") {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                name
                repository {
                  name
                }
                latestVersion {
                  version
                }
              }
            }
          }
        }`); //这里的first后面所需为int，而加了引号之后就成为string，所以要去掉引号
    for (const graphPackage of graphResponse.organization.packages.nodes) {
      yield graphPackage;
    }
    hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage;
    startCursor = graphResponse.organization.packages.pageInfo.endCursor;
  }
}
//遍历版本出错，似乎还是after的原因
async function* traversalVersionsGraphQL(octokit, package_name, repository_name) {
  //循环遍历获取所有Versions的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  //let startCursor = ''; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
  const graphResponse = await octokit.graphql(`
    query{
      repository(name: "${repository_name}", owner: "kungfu-trader") {
        packages(names: "${package_name}", last: 1) {
          totalCount
          nodes {
            versions(first: ${maxPerPage}) {
              nodes {
                version
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      }
    }`);
  let startCursor = graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
  hasNextPage = graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
  for (const graphVersion of graphResponse.repository.packages.nodes[0].versions.nodes) {
    yield graphVersion;
  }
  while (hasNextPage) {
    console.log(`startCursor: ${startCursor}`); //用于后续比较，怀疑是赋值问题
    console.log(`超过100: ${package_name}`);
    const graphResponse = await octokit.graphql(`
        query{
          repository(name: "${repository_name}", owner: "kungfu-trader") {
            packages(names: "${package_name}", last: 1) {
              totalCount
              nodes {
                versions(first: ${maxPerPage}, after: "${startCursor}") {
                  nodes {
                    version
                  }
                  pageInfo {
                    endCursor
                    hasNextPage
                  }
                }
              }
            }
          }
        }`); //startCursor自身就是sting，是否还需要引号？
    //为了测试，这里将package和repo指定为action-bump-version
    //如果这次还是提示after后的内容为空（即startCursor未赋有效值的原因）则将其在do-while循环前不加after执行一次并将结构变为while-do
    for (const graphVersion of graphResponse.repository.packages.nodes[0].versions.nodes) {
      yield graphVersion;
    }
    hasNextPage = graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
    startCursor = graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
    console.log(`hasNextPage: ${hasNextPage}`); //after位置错了
    console.log(`endCursor: ${startCursor}`); //目前看是这个循环没有正常跳出
  }
}

//实现了上述rest及graphQL查询方法后，下面构建调用函数完成整个查询，这里使用exports
//exports.traversalMessage = async function (octokit) {
exports.traversalMessage = async function (argv) {
  const octokit = github.getOctokit(argv.token);
  //let countVersion = 0; //该变量用于存储当前位置
  let countPackage = 0; //store steps of for-loops
  let traversalResult = []; //该变量用于存储json信息
  for await (const graphPackage of traversalPackagesGraphQL(octokit)) {
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //如果通过下方判别函数则这俩参数用于后续查询versions
    if (graphPackage.latestVersion === null) {
      console.log(`跳过package: ${package_name}`);
      continue;
    }
    for await (const graphVersion of traversalVersionsGraphQL(octokit, package_name, repository_name)) {
      const version_name = graphVersion.version;
      /*const tempStoreResult = {
        version: version_name,
        package: package_name,
        repo: repository_name,
      };*/
      //暂时将变量名删去，看看是否还需要做引号的转义
      //当然也有可能，json定义出错，直接跑失败了
      const tempStoreResult = {
        version_name,
        package_name,
        repository_name,
      };
      traversalResult.push(tempStoreResult);
      //countVersion++;
      //console.log(`countVersion: ${countVersion}`);
      //break; //这里加个break用于测试，这样只用遍历一次(这里只跳出了内层循环，每次获取有效package后都来一次获取action-bump-version的first:1，然后再push进数组)
    }
    //break; //测试action-bump-version的所有version能否正常遍历（这个目前包最多）
    countPackage++;
    console.log(`当前package: ${package_name}`);
    console.log(`countPackage: ${countPackage}`);
  }
  //console.log(JSON.stringify(traversalResult)); //用于控制台输出最终结果
  console.log(traversalResult.length); //用于测试数组长度看看遍历能否进入下一页
  const storeTraversalResult = JSON.stringify(traversalResult);
  //exports.sendMessageToAirtable(storeTraversalResult);
  //exports.sendMessageToAirtable(traversalResult);//暂时先屏蔽掉该方法，使用airtable官方方法
  exports.airtableOfferedMethod(storeTraversalResult);
};
//下方为发送遍历数据到airtable
const request = require('request');

exports.sendMessageToAirtable = async function (traversalResult) {
  //const messageToAirtable = JSON.stringify(traversalResult);
  console.log(typeof traversalResult);
  //const param = '"' + `${traversalResult}` + '"';
  //const param = '"' + traversalResult + '"';
  //const param = traversalResult + ''; //要注意yarn build后会变为‘’
  const param = JSON.stringify(traversalResult); //string化
  console.log(typeof param);
  console.log(param);
  //console.log(traversalResult);
  let stringBodyStore = {
    records: [
      {
        fields: {
          store: `${param}`,
        },
      },
    ],
  };
  //stringBodyStore.store = stringBodyStore.store + "";
  //console.log(stringBodyStore.records[0].fields.store); //输出一下string之前的store值
  //stringBodyStore.records[0].fields.store = stringBodyStore.records[0].fields.store.toString();//这是一种方法
  //console.log(stringBodyStore.records[0].fields.store); //输出一下string之前的store值
  stringBodyStore.records[0].fields.store = stringBodyStore.records[0].fields.store + ''; //这是另外一种方法
  //当然还要考虑是否需要前后加比如'"'+store+'"'(这样还可以摆脱yarn build的影响)
  console.log(stringBodyStore.records[0].fields.store); //输出一下string后的store值
  let options = {
    method: 'POST',
    url: 'https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201',
    headers: {
      Authorization: 'Bearer keyV2K62gr8l53KRn',
      'Content-Type': 'application/json',
      Cookie: 'brw=brwjmHKMyO4TjVGoS',
    },
    //body: JSON.stringify(stringBodyStore),
    //body: `${stringBodyStore}`,
    body: stringBodyStore,
  }; //在stringify之前先tostring
  //之前这里多了一个右花括号，导致后面的一直是undefined。。。（神奇的是居然没有报格式错误。。。）
  request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body); //输出返回的body
    console.log(error); //加了一个输出错误类型
  });
  process.on('unhandledRejection', (reason, p) => {
    console.log('Promise: ', p, 'Reason: ', reason);
    // do something
    //这里用来解决UnhandledPromiseRejectionWarning的问题
  });
  /*
  const options = {
    'method': 'POST',
  'url': 'https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201',
  'headers': {
    'Authorization': 'Bearer keyV2K62gr8l53KRn',
    'Content-Type': 'application/json',
    'Cookie': 'brw=brwjmHKMyO4TjVGoS'
  },
  body: JSON.stringify({
    "records": [
      {
        "fields": {
          "store": `${param}`
        }
      }
    ]
  })
  };*/
  /* 'method': 'POST',
  'url': 'https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201',
  'headers': {
    'Authorization': 'Bearer keyV2K62gr8l53KRn',
    'Content-Type': 'application/json',
    'Cookie': 'brw=brwjmHKMyO4TjVGoS'
  },
  body: JSON.stringify({
    "records": [
      {
        "fields": {
          "store": "{111}\n"
        }
      }
    ]
  })
*/
};
exports.airtableOfferedMethod = async function (traversalResult) {
  exec('npm', ['install', '-g', 'airtable']); //使用exec调用npm指令安装airtable，这样require时不会出错
  const Airtable = require('airtable'); //引入airtable
  const base = new Airtable({ apiKey: 'keyV2K62gr8l53KRn' }).base('appd2XwFJcQWZM8fw'); //声明一些必要的信息
  base('Table 1').create(
    [
      {
        fields: {
          store: `${traversalResult}`,
        },
      },
    ],
    function (err, records) {
      if (err) {
        console.error(err);
        return;
      }
      records.forEach(function (record) {
        console.log(record.getId());
      });
    },
  );
};
exports.getChannel = getChannel;

exports.exec = exec;

exports.gitCall = gitCall;

exports.ensureBranchesProtection = ensureBranchesProtection;

exports.suspendBranchesProtection = suspendBranchesProtection;

exports.setOpts = function (argv) {
  bumpOpts.dry = argv.dry;
};

exports.currentVersion = () => getCurrentVersion(process.cwd());

exports.getBumpKeyword = (argv) => getBumpKeyword(argv.cwd, argv.headRef, argv.baseRef);

exports.ensureLerna = (argv) => {
  if (hasLerna(argv.cwd)) {
    const result = spawnSync('lerna', ['--version'], spawnOpts);
    if (result.status !== 0) {
      exec('npm', ['install', '-g', 'lerna@^5.0.0']);
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
