const fs = require("fs");
const path = require("path");
const glob = require("glob");
const semver = require('semver');
const { spawn, spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };
const spawnOptsPipe = { shell: true, stdio: "pipe", windowsHide: true };

function getPackageJson(cwd = process.cwd()) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.log("package.json not found");
    return;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath));
}

exports.bumpVersion = function (versionPart) {
  const packageJson = getPackageJson();
  console.log(`updateing ${versionPart}: ${packageJson.version}`);
};