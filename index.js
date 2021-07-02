const core = require('@actions/core');
const { context } = require("@actions/github");
const lib = require("./lib.js");

const action = core.getInput('action');
const token = core.getInput('token');
const headRef = core.getInput('head-ref');
const baseRef = core.getInput('base-ref');
const keyword = core.getInput('keyword');

const handleError = (error) => {
    console.error(error);
    core.setFailed(error.message);
};

const argv = {
    cwd: process.cwd(),
    token: token,
    owner: context.repo.owner,
    repo: context.repo.repo,
    headRef: headRef,
    baseRef: baseRef,
    keyword: keyword
};

async function bump() {
    await lib.gitCall("config", "--global", "user.name", context.actor);
    await lib.gitCall("config", "--global", "user.email", `${context.actor}@noreply.github.com`);
    lib.bumpVersion(argv);
}

const run = {
    "auto": bump().then(() => lib.mergeOrigin(argv)),
    "bump": bump,
    "publish": async () => lib.mergeOrigin(argv),
    "verify": async () => lib.verify(argv),
    "protect": async () => lib.protectBranches(argv)
};

console.log(`run action ${action}`);

run[action]().catch(handleError);