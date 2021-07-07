const lib = exports.lib = require("./lib.js");
const fs = require("fs");
const path = require("path");
const core = require('@actions/core');
const github = require("@actions/github");

const setup = exports.setup = async function (argv) {
    const context = github.context;
    const octokit = github.getOctokit(argv.token);
    if (context.eventName == "pull_request") {
        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: argv.owner,
            repo: argv.repo,
            pull_number: context.payload.pull_request.number
        });
        if (argv.action != "verify" && !pullRequest.merged) {
            throw new Error(`Pull request #${pullRequest.number} [${pullRequest.html_url}]  must be merged`);
        }
    }
    if (context.eventName == "workflow_dispatch") {
        if (lib.getChannel(argv.headRef) != "main" || lib.getChannel(argv.baseRef) != "main") {
            throw new Error(`Manual trigger on head [${argv.headRef}] -> base [${argv.baseRef}] not supported`);
        }
    }
    await lib.gitCall("config", "--global", "user.name", argv.actor);
    await lib.gitCall("config", "--global", "user.email", `${argv.actor}@users.noreply.github.com`);
};

const prebuild = async (argv) => {
    core.setOutput("prebuild-version", `v${lib.currentVersion()}`);
    if (lib.getBumpKeyword(argv) == "patch") {
        // The release version commit must be made before build to have the right release info.
        await lib.tryBump(argv);
    }
    core.setOutput("version", `v${lib.currentVersion()}`);
};

const postbuild = async (argv) => {
    await lib.tryPublish(argv);
    if (lib.getBumpKeyword(argv) != "patch") {
        // The next prerelease version commit must be made after build to update tracking branches.
        await lib.tryBump(argv);
    }
    await lib.tryMerge(argv);
    core.setOutput("postbuild-version", `v${lib.currentVersion()}`);
};

const actions = exports.actions = {
    "auto": async (argv) => {
        await prebuild(argv);
        await postbuild(argv);
    },
    "prebuild": prebuild,
    "postbuild": postbuild,
    "verify": async (argv) => lib.verify(argv)
};

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
        publish: !!core.getInput('no-publish'),
        protection: !!core.getInput('no-protection'),
        headRef: headRef,
        baseRef: baseRef,
        keyword: lib.getBumpKeyword({ cwd: process.cwd(), headRef: headRef, baseRef: baseRef }),
        version: lib.currentVersion()
    };

    core.setOutput("keyword", argv.keyword);
    await setup(argv);
    await actions[argv.action](argv);
};

if (process.env.GITHUB_ACTION) {
    const configPath = path.join(path.dirname(__dirname), 'package.json'); // Find package.json for dist/index.js
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath)) : {};
    if (config.name && process.env.GITHUB_ACTION_REPOSITORY == config.name.slice(1)) {
        main().catch((error) => {
            console.error(error);
            core.setFailed(error.message);
        });
    }
}