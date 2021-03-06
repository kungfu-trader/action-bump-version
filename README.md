# 功夫版本控制 Bump Version V3

## 目标 - Requirements

功夫项目的版本控制流程有以下几个核心目标：

- 版本发布应该是一种不需要执行代码或是脚本命令的人工操作，并且不能太繁琐。

- 版本发布需要有相应的人工审核操作。

- 发布版本时应对代码打标签，以及上传/发布所有相关的编译产物。

- 在发布正式的 release 版本之前，需要能够发布用于内测的 prerelease 版本。

- 版本发布之后，项目代码中应该自动将所有版本信息更新为下一个未发布的 prerelease 版本，应避免人工维护该信息以避免手误。

- 功夫的主要项目组件均使用副版本（例如 1.2、2.5 等）作为主要的特性兼容序列，当发布新的副版本后，仍有可能继续维护老的副版本一段时间，例如进行 2.4.5 -> 2.5.0 发布后，仍可能继续维护 2.4 从而继续发布 2.4.6、2.4.7 等。

鉴于一般开发者普遍对 git、npm、lerna 乃至 GitHub 等相关工具不够熟悉，不能期望在上述任何一个环节中需要开发者进行相对高阶的工具操作。例如一旦在某些节点上 git 分支合并失败并导致 git 历史线混乱时，一般开发者缺乏解决处理这种问题的能力，将会给版本控制流程带来进一步不可知的问题。

## 规则 - Rules

出于以上种种考虑，在功夫项目中，我们使用以下方法进行版本控制。

首先我们基于 GitHub 的 [Pull Request](https://docs.github.com/en/github/collaborating-with-pull-requests) 特性进行版本发布操作，这可以在 Web 页面上完成从发布到审核的所有操作。同时利用关联到相关 GitHub 事件的 [Action](https://docs.github.com/en/actions) 进行自动版本信息维护操作，以避免人工操作带来的手误风险。

### 分支规则 - Branches Pattern

由于 GitHub 事件可以在任意分支上触发，为精确控制行为，我们需要做一些限定。具体来说，我们在以下几个分支进行版本管理工作：

- dev/v(\d+)/v(\d+).(\d+)

- release/v(\d+)/v(\d+).(\d+)

- alpha/v(\d+)/v(\d+).(\d+)

- main

除 main 分支外，其他分支命名的规则为 {channel-name}/v{semver.major}/v{semver.major}.{semver.minor}，其中 channel-name 对应该分支系列的频道名（release/alpha/dev），v{semver.version} 对应主版本，例如 v1、v2 等，v{semver.major}.{semver.minor} 对应副版本，例如 v1.1、v2.3 等。

其中仅 dev 频道接受 git push，其余几个频道均只接受下游频道的 pull request，具体规则如下：

- 发起 pull request 时上下游频道的版本信息必须一致，例如 dev/v1/v1.1 -> alpha/v1/v1.1 或 release/v1/v1.1 -> main 正确，而如 dev/v1/v1.1 -> release/v1/v1.1 或 dev/v1/v1.1 -> release/v1/v1.1 均不正确。

- 当从 dev 向 alpha 发起 pull request 时，合并后的提交对应一次 prerelease 版本，例如 v1.0.1-alpha.1、v2.4.0-alpha.3 等，以及对应的标签，并产生一个新的 commit 对应下一个 prerelease 版本，将 v{semver.major}.{semver.minor}-alpha 这个标签 指向更新后的 commit。因此 v{semver.major}.{semver.minor}-alpha 这个标签 总是会对应指向对应副版本的最新一版 prerelease commit。

- 当从 alpha 向 release 发起 pull request 时，合并后的提交对应一次 release 版本，例如 v1.0.1、v2.4.0 等，以及对应的标签，并将标签 v{semver.major}.{semver.minor} 指向这次 release，因此 v{semver.major}.{semver.minor} 这个标签 总是会指向对应副版本的最新一版 release。当该 release 频道对应的是对应主版本下的最新一个副版本时，还会将标签 v{semver.major} 也指向这次 release，例如当前最新副版本为 1.2，alpha/v1/v1.2 -> release/v1/v1.2 产生最新 release 为 v1.2.5, 则 v1 会指向 v1.2.5；alpha/v1/v1.1 -> release/v1/v1.1 产生的最新 release v1.1.9 则不会更新 v1。因此 v{semver.major} 这个标签 总是指向对应的主版本下最高副版本的最新 release commit。

- 当从 release 向 main 发起 pull request 时，会进行副版本升级并产生相应的新的 release/alpha/dev 频道分支系列，例如 release/v1/v1.1 -> main 会从 v1.1 中最后一个正式 release （如 v1.1.5）对应的 commit 生成新的副版本 v1.2 所需的 release/v1/v1.2、alpha/v1/v1.2、dev/v1/v1.2 三个频道分支，并将这几个频道分支上的版本信息更新为 v1.2.0-alpha.0。同时在原主版本的 release 频道下产生 release/v{last-semver.major}/lts，以用于后续发布原主版本的副版本升级；之后进行原主版本的副版本升级发布时只需用 release/v{last-semver.major}/lts 替换 main 作为 release/v{last-semver.major}/v{last-semver.minor} 的 pull request 目标即可。

- 当从 main 分支执行手动 workflow action 时，会进行主版本升级，并产生新的 release/alpha/dev 版本对应分支。

版本信息存储在根目录下的 [package.json](https://docs.npmjs.com/cli/v7/configuring-npm/package-json)（单一项目）或 [lerna.json](https://github.com/lerna/lerna)（复合项目 Workspace）中。使用此 action 必须提供这两种文件其中之一。具体格式请参阅相关文档。

### 分支保护 - Branches Protection

action-bump-action@v3 以上版本默认对以下分支设置[保护规则](https://docs.github.com/en/github/administering-a-repository/defining-the-mergeability-of-pull-requests/managing-a-branch-protection-rule)：

- main
- release/*/*
- alpha/*/*
- dev/*/*

当分支频道为 main/release/alpha 时，规则如下：

```javascript
requiresApprovingReviews = true
requiredApprovingReviewCount = 1
dismissesStaleReviews = true
restrictsReviewDismissals = true
requiresStatusChecks = true
requiresStrictStatusChecks = true
requiresConversationResolution = true
isAdminEnforced = true
restrictsPushes = true
allowsForcePushes = false
allowsDeletions = false
```

当分支频道为 dev 时，规则如下：

```javascript
requiresApprovingReviews = false
requiredApprovingReviewCount = 0
dismissesStaleReviews = true
restrictsReviewDismissals = true
requiresStatusChecks = true
requiresStrictStatusChecks = true
requiresConversationResolution = true
isAdminEnforced = true
restrictsPushes = false
allowsForcePushes = false
allowsDeletions = false
```

注意执行规则设置需要 input 中的 token 是具备相关管理权限的 [Personal Access Token](https://docs.github.com/en/github/authenticating-to-github/keeping-your-account-and-data-secure/creating-a-personal-access-token)。如果不希望设置保护规则，可将 input 中的 no-protection 设置为 true。

### 自动检查 - Status Checks

当启用分支保护规则时，会在除 dev 外的其他各分支频道上添加一个名为 verify 的 [Status Check](https://docs.github.com/en/rest/reference/repos#statuses)，仅当其成功执行时才运行合并 Pull Request。此 Status Check 的具体行为可由用户在 workflow yml 中自行定义，建议使用本 action 且将 Input 参数中的 "aciton" 设定为 "verify" 作为关键步骤，详见下述参数说明。

## 用法 - Usage in GitHub Workflow YML

### 输入参数 - Inputs

- token - 用于访问 GitHub 资源的 token，建议使用 [${{ secrets.GITHUB_TOKEN }}](https://docs.github.com/en/actions/reference/authentication-in-a-workflow)。action-bump-version@v3 以上的版本支持对 main/release/alpha/dev 版本频道上的分支设置[保护规则](https://docs.github.com/en/github/administering-a-repository/defining-the-mergeability-of-pull-requests/managing-a-branch-protection-rule)，如要使用此特性，需要将 token 设置为具备相关权限的 [Personal Access Token](https://docs.github.com/en/github/authenticating-to-github/keeping-your-account-and-data-secure/creating-a-personal-access-token)。

- action - 具体执行操作，有如下几种选择：

  - auto - 根据 pull request 或者 workflow 事件自动执行。
  - prebuild - 如果需要在升级版本过程中执行其他操作，则可使用 prebuild/postbuild 组合，其中 prebuild 仅在 alpha->release 过程中进行版本升级，这样使得该操作完成后，action runner 所在的工作路径中对应的当前版本总是对应最新正在发布的 release/prerelease 版本。
  - postbuild - 而 postbuild 则执行所有剩余操作，包括打标签，推送回 origin，准备新的频道分支等。该操作完成后，action runner 所在的工作路径中对应的当前版本会对应最新的未发布的 prerelease 版本。
  - verify - 检查当前 Pull Request 对应的 head ref 和 base ref 是否符合版本要求，例如 dev/v1/v1.1 -> alpha/v2/2.1，alpha/v2/2.1 -> release/v2/v2.0 等都会报错。

- no-publish - 默认为 false。此 action 默认行为会发布到 npm repo（对应 npm publish），如果不希望执行 npm publish，则需将此参数设定为 true。

- no-protection - 默认为 false。此 action 默认对 main/release/alpha/dev 等分支设置[保护规则](https://docs.github.com/en/github/administering-a-repository/defining-the-mergeability-of-pull-requests/managing-a-branch-protection-rule)，如果不希望设置保护，则需将此参数设定为 true。

### 输出参数 - Outputs

- keyword - 本次执行中使用的 semver keyword：premajor/preminor/patch/prerelease 其中之一。

- version - 本次执行产生的 release/prerelease 版本信息，例如当 keyword 为 patch，prebuild-version 为 1.0.0-alpha.1 时，version 为 1.0.0。

- prebuild-version - 本次执行启动之前当前 git ref 上 HEAD 代码所对应的版本信息，例如当 keyword 为 patch 时，prebuild-version 必然为 x.x.x-alpha.x；当 keyword 为 premajor 时，prebuild-version 必然为 x.x.x。

- postbuild-version - 本次执行结束之后当前 git ref 上 HEAD 代码所对应的版本信息，例如当 keyword 为 patch，prebuild-version 为 1.0.0-alpha.1，verison 为 1.0.0， postbuild-version 为 1.0.1.alpha-0。

## 示例 - Examples

### 自动检查 - Status Check

```yaml
on:
  pull_request:
    types: [opened, reopened, synchronize]
    branches:
      - alpha/*/*
      - release/*/*
      - main

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2

      - name: Verify Version
        uses: kungfu-trader/action-bump-version@v3
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          action: "verify"
```

### 自动升级版本 - Auto bump on pull requests

```yaml
on:
  pull_request:
    types: [closed]
    branches:
      - alpha/v*/v*
      - release/v*/v*

jobs:
  bump:
    if: ${{ github.event.pull_request.merged }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2

      - name: Setup NPM registry
        uses: actions/setup-node@v2
        with:
          registry-url: 'https://npm.pkg.github.com'
          scope: '@kungfu-trader'

      - name: Bump Version
        uses: kungfu-trader/action-bump-version@v3
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

### 自定义编译流程 - Custom

```yaml
on:
  pull_request:
    types: [closed]
    branches:
      - alpha/v*/v*
      - release/v*/v*

jobs:
  bump:
    if: ${{ github.event.pull_request.merged }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2

      - name: Setup NPM registry
        uses: actions/setup-node@v2
        with:
          registry-url: 'https://npm.pkg.github.com'
          scope: '@kungfu-trader'

      - name: Bump Version
        uses: kungfu-trader/action-bump-version@v3
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          action: prebuild

      - name: Build
        run: |
          yarn build

      - name: Publish
        uses: kungfu-trader/action-bump-version@v3
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          action: postbuild
```

### 手动升级主版本 - Manually bump major version

```yaml
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type confirm to bump major version'
        required: true
        default: 'cancel'

jobs:
  bump:
    if: ${{ github.event.inputs.confirm  == 'confirm' }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2

      - name: Bump Version
        uses: kungfu-trader/action-bump-version@v3
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```
