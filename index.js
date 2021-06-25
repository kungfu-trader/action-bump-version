const core = require('@actions/core');
const github = require("@actions/github");
const { updatePackagesVersion } = require("./lib.js");

try {
    const context = github.context;
    const versionPart = core.getInput('version-part');
    updatePackagesVersion(versionPart);
} catch (error) {
    core.setFailed(error.message);
}