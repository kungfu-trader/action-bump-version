const core = require('@actions/core');
const coreCommand = require('@actions/core/lib/command');
const github = require("@actions/github");
const { context } = require('@actions/github/lib/utils');
const lib = require("./lib.js");

const invoked = !!process.env['STATE_INVOKED'];

const bumpKeyword = core.getInput('bump-keyword');
const sourceRef = core.getInput('source-ref');
const destRef = core.getInput('dest-ref');

const handleError = (error) => {
    console.error(error);
    core.setFailed(error.message);
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

    lib.bumpVersion(bumpKeyword, sourceRef, destRef);
}

async function post() {
    const actor = core.getInput('github-actor') || context.actor;
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN;
    console.log(`actor: ${actor}`);
    console.log(`token: ${token}`);
    const url = `https://${actor}:${token}@github.com/${process.env.GITHUB_REPOSITORY}`;
    await lib.gitCall("remote", "add", "github", url);
    await lib.pushOrigin(bumpKeyword, sourceRef, destRef);
}

const run = invoked ? post : main;

run().catch(handleError);