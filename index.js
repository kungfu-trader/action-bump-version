const core = require('@actions/core');
const github = require("@actions/github");
const lib = require("./lib.js");

try {
    const context = github.context;

    const isPullRequest = context.eventName == "pull_request";
    const isManualTrigger = context.eventName == "workflow_dispatch";

    if (!isPullRequest && !isManualTrigger) {
        throw new Error("Bump version can only be triggered by pull_request or workflow_dispatch");
    }

    const bumpKeyword = core.getInput('bump-keyword');
    const sourceRef = core.getInput('source-ref');
    const destRef = core.getInput('dest-ref');

    console.log(`GitHub Actor: ${context.actor}`);

    const setupGit = async function () {
        await lib.gitCall("config", "--global", "user.name", context.actor);
        await lib.gitCall("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);
    };

    setupGit().then(() => lib.bumpVersion(bumpKeyword, sourceRef, destRef));
} catch (error) {
    core.setFailed(error.message);
}