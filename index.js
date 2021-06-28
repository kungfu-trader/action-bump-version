const core = require('@actions/core');
const github = require("@actions/github");
const lib = require("./lib.js");

try {
    const context = github.context;
    const bumpKeyword = core.getInput('bump-keyword');
    const defaultBranch = core.getInput('default-branch');

    console.log(`GitHub Actor: ${context.actor}`);

    const setupGit = async function () {
        await lib.gitRun("config", "--global", "user.name", context.actor);
        await lib.gitRun("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);
    };

    setupGit().then(() => lib.bumpVersion(bumpKeyword, defaultBranch));
} catch (error) {
    core.setFailed(error.message);
}