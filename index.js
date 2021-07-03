const core = require('@actions/core');
const { context } = require("@actions/github");
const lib = require("./lib.js");

const token = core.getInput('token');
const action = core.getInput('action');
const headRef = core.getInput('head-ref');
const baseRef = core.getInput('base-ref');
const keyword = core.getInput('keyword');

const handleError = (error) => {
    console.error(error);
    core.setFailed(error.message);
};

const argv = {
    cwd: process.cwd(),
    token: token,
    owner: context.repo.owner,
    repo: context.repo.repo,
    headRef: headRef,
    baseRef: baseRef,
    keyword: keyword
};

const octokit = github.getOctokit(argv.token);

async function setup() {
    if (context.eventName == "pull_request") {
        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: argv.owner,
            repo: argv.repo,
            number: context.payload.pull_request.number
        });
        if (pullRequest.status != "merged") {
            throw new Error(`Pull request must be merged, but got status ${pullRequest.status}`);
        }
    }
    if (context.eventName == "workflow_dispatch") {
        if (headRef != "main" || headRef != baseRef) {
            throw new Error(`Manual trigger on head [${headRef}] -> base [${baseRef}] not supported`);
        }
    }
    await lib.gitCall("config", "--global", "user.name", context.actor);
    await lib.gitCall("config", "--global", "user.email", `${context.actor}@users.noreply.github.com`);
}

const run = {
    "auto": async () => {
        await lib.tryBump(argv);
        await lib.tryMerge(argv);
    },
    "bump": async () => {
        await lib.tryBump(argv);
    },
    "publish": async () => {
        await lib.tryMerge(argv);
    },
    "prebuild": async () => {
        if (lib.getBumpKeyword(argv) == "patch") {
            await lib.tryBump(argv);
        }
    },
    "postbuild": async () => {
        if (lib.getBumpKeyword(argv) != "patch") {
            await lib.tryBump(argv);
        }
        await lib.tryMerge(argv);
    },
    "protect": async () => {
        await lib.protectBranches(argv);
    },
    "verify": async () => {
        lib.verify(argv);
    }
};

async function main() {
    await setup();
    await run[action]();
}

main().catch(handleError);