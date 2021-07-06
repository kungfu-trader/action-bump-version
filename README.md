# 功夫源代码版本控制流程 Bump Version V2

在功夫项目中，我们使用如下几个分支频道进行版本控制：

* main
* release/v(\d+)/v(\d+).(\d+)
* alpha/v(\d+)/v(\d+).(\d+)
* dev/v(\d+)/v(\d+).(\d+)

除 main 分支外，其他分支命名的规则为 {channel-name}/v{semver.major}/v{semver.major}.{semver.minor}，其中 channel-name 对应频道名 release/alpha/dev，v{semver.version} 对应主版本，例如 v1、v2 等，v${semver.major}.{semver.minor} 对应副版本，例如 v1.1、v2.3 等。

其中仅 dev 频道接受 git push，其余几个频道均只接受下游频道的 pull request，具体规则如下：

* 发起 pull request 时上下游频道的版本信息必须一致，例如 dev/v1/v1.1 -> alpha/v1/v1.1 或 release/v1/v1.1 -> main 正确，而如 dev/v1/v1.1 -> release/v1/v1.1 或 dev/v1/v1.1 -> release/v1/v1.1 均不正确
* 当从 dev 向 alpha 发起 pull request 时，合并后的提交对应一次 prerelease 版本，例如 v1.0.1-alpha.1、v2.4.0-alpha.3 等，以及对应的标签，并产生一个新的 commit 对应下一个 prerelease 版本，将 v{semver.major}.{semver.minor}-alpha 这个标签 指向更新后的 commit。因此 v{semver.major}.${semver.minor}-alpha 这个标签 总是会对应指向对应副版本的最新一版 prerelease
* 当从 alpha 向 release 发起 pull request 时，合并后的提交对应一次 release 版本，例如 v1.0.1、v2.4.0 等，以及对应的标签，并将标签 v{semver.major}.{semver.minor} 指向这次 release，因此 v{semver.major}.{semver.minor} 这个标签 总是会指向对应副版本的最新一版 release。当该 release 频道对应的是对应主版本下的最新一个副版本时，还会将标签 v{semver.major} 也指向这次 release，例如当前最新副版本为 1.2，alpha/v1/v1.2 -> release/v1/v1.2 产生最新 release 为 v1.2.5, 则 v1 会指向 v1.2.5；alpha/v1/v1.1 -> release/v1/v1.1 产生的最新 release v1.1.9 则不会更新 v1。因此 v{semver.major} 这个标签 总是指向对应的主版本下最高副版本的最新 release
* 当从 release 向 main 发起 pull request 时，会进行副版本升级并产生相应的新的 release/alpha/dev 频道，例如 release/v1/v1.1 -> main 会从 v1.1 中最后一个正式 release （如 v1.1.5）对应的 commit 生成 v1.2 对应的 release/v1/v1.2、alpha/v1/v1.2、dev/v1/v1.2 三个频道分支，并将这几个频道分支上的版本信息更新为 v1.2.0-alpha.0
* 当从 main 分支执行手动 workflow action 时，会进行主版本升级，并产生相应的新的 release/alpha/dev 频道

版本信息存储在根目录下的 [package.json](https://docs.npmjs.com/cli/v7/configuring-npm/package-json)（单一项目）或 [lerna.json](https://github.com/lerna/lerna)（复合项目）中。使用此 action 必须提供这两种文件其中之一。具体格式请参阅相关文档。

## 用法 - Usage

#### 参数

* token - 用于访问 GitHub 资源的 token，建议使用 ${{ secrets.GITHUB_TOKEN }}
* action - 具体执行操作，有如下几种选择：
    * auto - 根据 pull request 或者 workflow 事件自动执行
    * prebuild - 如果需要在升级版本过程中执行其他操作，则可使用 prebuild/postbuild 组合，其中 prebuild 仅在 alpha->release 过程中进行版本升级，这样使得该操作完成后，action runner 所在的工作路径中对应的当前版本总是对应最新正在发布的 release/prerelease 版本
    * postbuild - 而 postbuild 则执行所有剩余操作，包括打标签，推送回 origin，准备新的频道分支等。该操作完成后，action runner 所在的工作路径中对应的当前版本会对应最新的未发布的 prerelease 版本。
* no-publish - 默认为 false。此 action 默认行为会发布到 npm repo（对应 npm publish），如果不希望执行 npm publish，则需将此参数设定为 true

## 示例 - Example

#### 自动升级版本 - Auto bump on pull requests

```
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
        uses: kungfu-trader/action-bump-version@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

#### 自定义编译流程 - Custom

```
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
        uses: kungfu-trader/action-bump-version@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          action: prebuild

      - name: Build
        run: |
          yarn build

      - name: Publish
        uses: kungfu-trader/action-bump-version@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          action: postbuild
```

#### 手动升级主版本 - Manually bump major version

```
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
        uses: kungfu-trader/action-bump-version@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```
