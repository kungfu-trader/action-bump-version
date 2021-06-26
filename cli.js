const argv = require("yargs/yargs")(process.argv.slice(2))
    .option("version-part", {
        description: "version part to update", type: "string",
        choices: ["major", "minor", "patch", "prerelease"]
    })
    .demandOption(["version-part"])
    .help()
    .argv;

const { bumpVersion } = require("./lib.js");

bumpVersion(argv.versionPart);