const lib = require("./lib.js");

const argv = require("yargs/yargs")(process.argv.slice(2))
    .option("bump-keyword", {
        description: "Increment version(s) by semver keyword",
        type: "string",
        choices: ["auto", "patch", "premajor", "preminor", "prerelease", "verify"]
    })
    .option("source-ref", {
        description: "Source git ref",
        type: "string"
    })
    .option("dest-ref", {
        description: "Dest git ref",
        type: "string"
    })
    .demandOption(["bump-keyword", "source-ref", "dest-ref"])
    .help()
    .argv;


console.log("-- bump --");
lib.bumpVersion(argv["bump-keyword"], argv["source-ref"], argv["dest-ref"]);

console.log("-- push --");
lib.pushOrigin(argv["bump-keyword"], argv["source-ref"], argv["dest-ref"]).catch(console.error);