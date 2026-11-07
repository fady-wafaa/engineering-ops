#!/usr/bin/env node
// Read-only Trello REST CLI (fallback when the Trello MCP connector is not available).
//
//   node trello.mjs check                       -> verifies credentials, prints your member id
//   node trello.mjs boards                      -> your open boards
//   node trello.mjs lists --board <boardId>     -> open lists on a board
//   node trello.mjs fetch [--project <slug>] [--out <file>]
//        -> reads every configured list and prints watch-ingest input JSON
//
// Credentials: environment variables TRELLO_API_KEY and TRELLO_TOKEN only.
// Never pass them as arguments and never paste them into chat.

import process from "node:process";
import { atomicWrite, fail, loadConfig, parseArgs, printJson, resolveProject } from "./lib/common.mjs";
import { TrelloError, createTrelloClient, fetchAssignedCards } from "./lib/trello.mjs";

// The command is the first non-flag argument, so `--project <slug> <command>` also works.
const args = parseArgs(process.argv.slice(2));
const command = args._[0];

function client() {
  return createTrelloClient({ key: process.env.TRELLO_API_KEY, token: process.env.TRELLO_TOKEN });
}

async function main() {
  switch (command) {
    case "check": {
      const me = await client().me();
      return printJson({ ok: true, member_id: me.id, username: me.username, full_name: me.fullName });
    }
    case "boards":
      return printJson({ ok: true, boards: await client().boards() });
    case "lists":
      if (!args.board) return fail("lists requires --board <boardId>");
      return printJson({ ok: true, lists: await client().lists(String(args.board)) });
    case "fetch": {
      const project = resolveProject(args);
      const cfg = loadConfig(project);
      if (!cfg?.provider?.member_id || !cfg.provider.boards?.length) {
        return fail("project is not set up; run /engineering-ops:engineering -> Initial setup", { project: project.slug });
      }
      let result;
      try {
        result = await fetchAssignedCards(client(), { memberId: cfg.provider.member_id, boards: cfg.provider.boards });
      } catch (e) {
        result = { status: "blocked", reason: e.message, error_code: e.code || "unknown", member_id: cfg.provider.member_id, cards: [] };
      }
      if (args.out) {
        atomicWrite(String(args.out), JSON.stringify(result, null, 2));
        return printJson({ ok: true, written: String(args.out), status: result.status, cards: result.cards.length });
      }
      return printJson(result);
    }
    default:
      return fail("unknown command", { commands: ["check", "boards", "lists", "fetch"] });
  }
}

main().catch((e) => {
  if (e instanceof TrelloError) return fail(e.code, { detail: e.message });
  return fail("trello command failed", { detail: String(e?.message || e) });
});
