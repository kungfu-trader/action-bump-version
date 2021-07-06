const lib = exports.lib = require("./lib.js");
const core = require('@actions/core');
const github = require("@actions/github");

const handleError = (error) => {
    console.error(error);
    core.setFailed(error.message);
};

const setup = exports.setup = async function (argv) {
    const octokit = github.getOctokit(argv.token);
    if (context.eventName == "pull_request") {
        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: argv.owner,
            repo: argv.repo,
            pull_number: context.payload.pull_request.number
        });
        if (action != "verify" && !pullRequest.merged) {
            throw new Error(`Pull request #${pullRequest.number} [${pullRequest.html_url}]  must be merged`);
        }
    }
    if (context.eventName == "workflow_dispatch") {
        if (argv.headRef != "main" || argv.baseRef != "main") {
            throw new Error(`Manual trigger on head [${argv.headRef}] -> base [${argv.baseRef}] not supported`);
        }
    }
    await lib.gitCall("config", "--global", "user.name", argv.actor);
    await lib.gitCall("config", "--global", "user.email", `${argv.actor}@users.noreply.github.com`);
};

const actions = exports.actions = {
    "auto": async (argv) => {
        await lib.tryBump(argv);
        await lib.tryMerge(argv);
    },
    "prebuild": async (argv) => {
        if (lib.getBumpKeyword(argv) == "patch") {
            await lib.tryBump(argv);
        }
    },
    "postbuild": async (argv) => {
        if (lib.getBumpKeyword(argv) != "patch") {
            await lib.tryBump(argv);
        }
        await lib.tryMerge(argv);
    },
    "verify": async (argv) => lib.verify(argv)
};

const main = async function () {
    const context = github.context;
    const headRef = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF;
    const baseRef = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF;
    const argv = {
        cwd: process.cwd(),
        token: core.getInput('token'),
        owner: context.repo.owner,
        repo: context.repo.repo,
        actor: context.actor,
        headRef: headRef,
        baseRef: baseRef,
        keyword: lib.getBumpKeyword({ cwd: process.cwd(), headRef: headRef, baseRef: baseRef})
    };

    core.setOutput("keyword", argv.keyword);
    core.setOutput("last-version", `v${lib.currentVersion()}`);
    await setup(argv);
    await actions[core.getInput('action')](argv);
    const version = lib.currentVersion();
    core.setOutput("version", `v${version}`);
};

if (process.env.GITHUB_ACTION) {
    main().catch(handleError);
}