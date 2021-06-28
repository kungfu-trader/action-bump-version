const core = require('@actions/core');
const github = require("@actions/github");
const lib = require("./lib.js");

try {
    const context = github.context;
    const bumpKeyword = core.getInput('bump-keyword');
    console.log(`GitHub Actor: ${context.actor} `);
    lib.bumpVersion(bumpKeyword);
} catch (error) {
    core.setFailed(error.message);
}