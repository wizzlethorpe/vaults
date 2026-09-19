// How core decides the add-on is missing, and that an installed one is its own version.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADDON_PACKAGE, isAbsent, versionMismatch } from "../src/addons.js";

const notFound = (message: string) => Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });

describe("isAbsent", () => {
  it("reads the add-on package itself being missing as absent", () => {
    assert.equal(isAbsent(notFound(`Cannot find package '${ADDON_PACKAGE}' imported from /usr/lib/node_modules/@wizzlethorpe/vaults/dist/addons.js`)), true);
  });

  it("does not read a broken add-on as absent", () => {
    // Node 22's own messages, each for an add-on that is installed and cannot load.
    const broken = [
      notFound("Cannot find package 'hast-util-select' imported from /usr/lib/node_modules/@wizzlethorpe/vaults-ttrpg/dist/index.js"),
      notFound("Cannot find package '@wizzlethorpe/vaults' imported from /usr/lib/node_modules/@wizzlethorpe/vaults-ttrpg/dist/index.js"),
      notFound("Cannot find module '/usr/lib/node_modules/@wizzlethorpe/vaults-ttrpg/dist/index.js' imported from /usr/lib/node_modules/@wizzlethorpe/vaults/dist/addons.js"),
      notFound("Cannot find package '/usr/lib/node_modules/@wizzlethorpe/vaults-ttrpg/index.js' imported from /usr/lib/node_modules/@wizzlethorpe/vaults/dist/addons.js"),
      Object.assign(new Error(`No "exports" main defined in /usr/lib/node_modules/@wizzlethorpe/vaults-ttrpg/package.json`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
      new SyntaxError("Unexpected token"),
    ];
    for (const err of broken) assert.equal(isAbsent(err), false, err.message);
  });
});

describe("versionMismatch", () => {
  it("accepts the add-on at the CLI's own version and nothing else", () => {
    assert.equal(versionMismatch("0.22.0", "0.22.0"), undefined);
    assert.match(versionMismatch("0.22.1", "0.22.0")!, /vaults-ttrpg is 0\.22\.0 and the CLI is 0\.22\.1.*npm install -g/);
  });
});
