const core = require('@actions/core');
const github = require("@actions/github");
const lib = require("./lib.js");

try {
    const context = github.context;
    const bumpKeyword = core.getInput('bump-keyword');

    console.log(`GitHub Actor: ${context.actor}`);

    const setupGit = async function () {
        await lib.gitCall("config", "--global", "user.name", context.actor);
        await lib.gitCall("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);
    };

    setupGit().then(() => lib.bumpVersion(bumpKeyword));
} catch (error) {
    core.setFailed(error.message);
}