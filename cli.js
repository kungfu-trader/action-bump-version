const { boolean } = require("yargs");
const lib = require("./lib.js");

const keywords = ["auto", "patch", "premajor", "preminor", "prerelease", "verify"];

exports.argv = require("yargs/yargs")(process.argv.slice(2))
    .option("token", { type: "string", demandOption: true })
    .option("base-ref", { type: "string", demandOption: true })
    .option("head-ref", { type: "string", demandOption: true })
    .option("owner", { type: "string", default: "kungfu-trader" })
    .option("repo", { type: "string", default: "action-bump-version" })
    .option("dry", { type: boolean })
    .command("main <keyword>", "main", (yargs) => {
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
    .command("post <keyword>", "post", (yargs) => {
        yargs.positional("keyword", {
            description: "Increment version(s) by semver keyword",
            type: "string",
            choices: keywords,
            demandOption: true
        });
    }, (argv) => {
        lib.setOpts(argv);
        lib.pushOrigin(argv).catch(console.error);
    })
    .command("check", "check", (yargs) => {
    }, (argv) => {
        lib.setOpts(argv);
        lib.checkStatus(argv).catch(console.error);
    })
    .demandCommand()
    .help()
    .argv;