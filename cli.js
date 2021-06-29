const lib = require("./lib.js");

const argv = require("yargs/yargs")(process.argv.slice(2))
    .option("bump-keyword", {
        description: "Increment version(s) by semver keyword",
        type: "string",
        choices: ["patch", "premajor", "preminor", "prerelease", "test"]
    })
    .demandOption(["bump-keyword"])
    .help()
    .argv;

lib.bumpVersion(argv.bumpKeyword);