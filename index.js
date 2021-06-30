const core = require('@actions/core');
const coreCommand = require('@actions/core/lib/command');
const github = require("@actions/github");
const lib = require("./lib.js");

const invoked = !!process.env['STATE_INVOKED'];

const bumpKeyword = core.getInput('bump-keyword');
const sourceRef = core.getInput('source-ref');
const destRef = core.getInput('dest-ref');

function main() {
    coreCommand.issueCommand('save-state', { name: 'INVOKED' }, 'true');

    const context = github.context;

    const isPullRequest = context.eventName == "pull_request";
    const isManualTrigger = context.eventName == "workflow_dispatch";

    if (!isPullRequest && !isManualTrigger) {
        throw new Error("Bump version can only be triggered by pull_request or workflow_dispatch");
    }

    console.log(`GitHub Actor: ${context.actor}`);

    const setupGit = async function () {
        await lib.gitCall("config", "--global", "user.name", context.actor);
        await lib.gitCall("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);
    };

    setupGit().then(() => {
        lib.bumpVersion(bumpKeyword, sourceRef, destRef);
    });
}

function post() {
    lib.pushOrigin(bumpKeyword, sourceRef, destRef).catch((error) => {
        console.error(error);
        core.setFailed(error.message);
    });
}

try {
    if (!invoked) {
        main();
    } else {
        post();
    }
} catch (error) {
    core.setFailed(error.message);
}