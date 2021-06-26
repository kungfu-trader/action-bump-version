const core = require('@actions/core');
const github = require("@actions/github");
const { bumpVersion } = require("./lib.js");

try {
    const context = github.context;
    const versionPart = core.getInput('version-part');
    bumpVersion(versionPart);
} catch (error) {
    core.setFailed(error.message);
}