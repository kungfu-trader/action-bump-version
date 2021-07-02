const { boolean } = require("yargs");
const lib = require("./lib.js");

const keywords = ["auto", "patch", "premajor", "preminor", "prerelease", "verify"];

exports.argv = require("yargs/yargs")(process.argv.slice(2))
    .option("cwd", { type: "string", default: process.cwd() })
    .option("token", { type: "string", demandOption: true })
    .option("base-ref", { type: "string", demandOption: true })
    .option("head-ref", { type: "string", demandOption: true })
    .option("owner", { type: "string", default: "kungfu-trader" })
    .option("repo", { type: "string", default: "action-bump-version" })
    .option("dry", { type: boolean })
    .command("bump <keyword>", "bump", (yargs) => {
        yargs.positional("keyword", {
            description: "Increment version(s) by semver keyword",
            type: "string",
            choices: keywords,
            demandOption: true
        });
    }, (argv) => {
        lib.setOpts(argv);
        lib.bumpVersion(argv);
    })
    .command("publish <keyword>", "publish", (yargs) => {
        yargs.positional("keyword", {
            description: "Increment version(s) by semver keyword",
            type: "string",
            choices: keywords,
            demandOption: true
        });
    }, (argv) => {
        lib.setOpts(argv);
        lib.mergeOrigin(argv).catch(console.error);
    })
    .command("verify", "verify", (yargs) => {
    }, (argv) => {
        lib.setOpts(argv);
        lib.verify(argv);
    })
    .command("protect", "protect", (yargs) => {
    }, (argv) => {
        lib.setOpts(argv);
        lib.protectBranches(argv).catch(console.error);
    })
    .demandCommand()
    .help()
    .argv;