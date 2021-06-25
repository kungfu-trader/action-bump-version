const fs = require("fs");
const path = require("path");
const glob = require("glob");
const semver = require('semver');
const { spawn, spawnSync } = require("child_process");

const spawnOptsInherit = { shell: true, stdio: "inherit", windowsHide: true };
const spawnOptsPipe = { shell: true, stdio: "pipe", windowsHide: true };

exports.updatePackagesVersion = function (versionPart) {
  console.log(`updateing ${versionPart}`);
};