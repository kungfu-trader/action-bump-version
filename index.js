const core = require('@actions/core');
const github = require("@actions/github");
const lib = require("./lib.js");

const context = github.context;

const token = core.getInput('token');
const action = core.getInput('action');
const headRef = core.getInput('head-ref') || process.env.GITHUB_HEAD_REF;
const baseRef = core.getInput('base-ref') || process.env.GITHUB_BASE_REF;
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

const octokit = github.getOctokit(argv.token);

async function setup() {
    if (context.eventName == "pull_request") {
        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: argv.owner,
            repo: argv.repo,
            pull_number: context.payload.pull_request.number
        });
        if (action != "verify" && !pullRequest.merged) {
            throw new Error(`Pull request #${pullRequest.number} [${pullRequest.html_url}]  must be merged`);
        }
    }
    if (context.eventName == "workflow_dispatch") {
        if (headRef != "main" || headRef != baseRef) {
            throw new Error(`Manual trigger on head [${headRef}] -> base [${baseRef}] not supported`);
        }
    }
    await lib.gitCall("config", "--global", "user.name", context.actor);
    await lib.gitCall("config", "--global", "user.email", `${context.actor}@users.noreply.github.com`);
}

const run = {
    "auto": async () => {
        await lib.tryBump(argv);
        await lib.tryMerge(argv);
    },
    "bump": async () => {
        await lib.tryBump(argv);
    },
    "publish": async () => {
        await lib.tryMerge(argv);
    },
    "prebuild": async () => {
        if (lib.getBumpKeyword(argv) == "patch") {
            await lib.tryBump(argv);
        }
    },
    "postbuild": async () => {
        if (lib.getBumpKeyword(argv) != "patch") {
            await lib.tryBump(argv);
        }
        await lib.tryMerge(argv);
    },
    "verify": async () => {
        lib.verify(argv);
    }
};

async function main() {
    core.setOutput("keyword", lib.getBumpKeyword(argv));
    core.setOutput("last-version", lib.currentVersion().toString());
    await setup();
    await run[action]();
    const version = lib.currentVersion();
    core.setOutput("version", `v${version}`);
    core.setOutput("tags", [`v${version}`, `v${version.major}`, `v${version.major}.${version.minor}`]);
}

main().catch(handleError);