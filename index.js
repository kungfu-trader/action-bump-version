const core = require('@actions/core');
const coreCommand = require('@actions/core/lib/command');
const github = require("@actions/github");
const { context } = require('@actions/github/lib/utils');
const lib = require("./lib.js");

const invoked = !!process.env['STATE_INVOKED'];

const token = core.getInput('token');
const headRef = core.getInput('head-ref');
const baseRef = core.getInput('base-ref');
const keyword = core.getInput('keyword');

const handleError = (error) => {
    console.error(error);
    core.setFailed(error.message);
};

const argv = {
    token: token,
    owner: context.repo.owner,
    repo: context.repo.repo,
    headRef: headRef,
    baseRef: baseRef,
    keyword: keyword
};

async function main() {
    coreCommand.issueCommand('save-state', { name: 'INVOKED' }, 'true');

    const context = github.context;

    const isPullRequest = context.eventName == "pull_request";
    const isManualTrigger = context.eventName == "workflow_dispatch";

    if (!isPullRequest && !isManualTrigger) {
        throw new Error("Bump version can only be triggered by pull_request or workflow_dispatch");
    }

    await lib.gitCall("config", "--global", "user.name", context.actor);
    await lib.gitCall("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);

    lib.bumpVersion(argv);
}

async function post() {
    await lib.pushOrigin(argv);
}

const run = invoked ? post : main;

run().catch(handleError);