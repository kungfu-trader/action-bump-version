const core = require('@actions/core');
const github = require("@actions/github");
const git = require('git-client');
const lib = require("./lib.js");

try {
    const context = github.context;
    const bumpKeyword = core.getInput('bump-keyword');

    console.log(`GitHub Actor: ${context.actor}`);

    const setupGit = async function () {
        await git("config", "--global", "user.name", context.actor);
        await git("config", "--global", "user.email", `${context.actor}@noreply.kungfu.link`);
    };

    setupGit().then(() => lib.bumpVersion(bumpKeyword));
} catch (error) {
    core.setFailed(error.message);
}