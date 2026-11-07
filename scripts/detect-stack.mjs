#!/usr/bin/env node
// Prints the detected stack of a project as JSON. Read-only: it only reads manifest files.
//   node detect-stack.mjs [--dir <projectRoot>]   (default: git top level of the current folder)

import process from "node:process";
import { fail, parseArgs, printJson, projectRoot } from "./lib/common.mjs";
import { detectStack } from "./lib/stack.mjs";

const args = parseArgs(process.argv.slice(2));
try {
  printJson(detectStack(args.dir ? String(args.dir) : projectRoot()));
} catch (e) {
  fail("detect-stack failed", { detail: String(e?.message || e) });
}
