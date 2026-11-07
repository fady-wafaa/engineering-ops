// Read-only Trello REST client (fallback when no Trello MCP connector is available).
// Credentials come only from environment variables TRELLO_API_KEY and TRELLO_TOKEN.
// The token is never printed: every error message is scrubbed.
// Only GET requests exist in this module. It cannot change Trello.

export class TrelloError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.code = code; // auth_failed | timeout | network | rate_limited | not_found | http_error | missing_credentials
    this.status = status;
  }
}

const BASE = "https://api.trello.com/1";

export function scrub(text, secrets) {
  let s = String(text ?? "");
  for (const v of secrets) if (v) s = s.split(v).join("***");
  return s;
}

export function createTrelloClient({ key, token, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!key || !token) {
    throw new TrelloError("missing_credentials", "Set TRELLO_API_KEY and TRELLO_TOKEN as environment variables.");
  }
  const secrets = [key, token];

  async function get(pathname, params = {}) {
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set("key", key);
    url.searchParams.set("token", token);
    let res;
    try {
      res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new TrelloError("timeout", `Trello did not answer within ${Math.round(timeoutMs / 1000)} s (${pathname}).`);
      }
      throw new TrelloError("network", scrub(`Network error calling Trello ${pathname}: ${e?.message || e}`, secrets));
    }
    if (res.status === 401 || res.status === 403) {
      throw new TrelloError("auth_failed", "Trello rejected the API key or token (check TRELLO_API_KEY / TRELLO_TOKEN).", res.status);
    }
    if (res.status === 429) throw new TrelloError("rate_limited", "Trello rate limit reached. Try again later.", 429);
    if (res.status === 404) throw new TrelloError("not_found", `Trello resource not found: ${pathname}`, 404);
    if (!res.ok) throw new TrelloError("http_error", `Trello returned HTTP ${res.status} for ${pathname}`, res.status);
    return res.json();
  }

  return {
    me: () => get("/members/me", { fields: "id,username,fullName" }),
    boards: () => get("/members/me/boards", { filter: "open", fields: "id,name,url" }),
    lists: (boardId) => get(`/boards/${encodeURIComponent(boardId)}/lists`, { filter: "open", fields: "id,name" }),
    listCards: (listId) =>
      get(`/lists/${encodeURIComponent(listId)}/cards`, {
        filter: "open",
        fields: "id,name,desc,url,shortUrl,idMembers,labels,due,closed,dateLastActivity,idBoard,idList",
        checklists: "all",
        checklist_fields: "name",
      }),
  };
}

export function normalizeCard(raw, { listName = null, boardName = null } = {}) {
  return {
    id: raw.id,
    name: raw.name || "",
    desc: raw.desc || "",
    url: raw.url || raw.shortUrl || null,
    board: boardName,
    list: listName,
    labels: (raw.labels || []).map((l) => ({ name: l.name || l.color || "" })),
    due: raw.due || null,
    checklists: (raw.checklists || []).map((cl) => ({
      name: cl.name,
      items: (cl.checkItems || cl.items || []).map((i) => ({ name: i.name, state: i.state || "" })),
    })),
    members: raw.idMembers || (raw.members || []).map((m) => m.id),
    closed: Boolean(raw.closed),
    dateLastActivity: raw.dateLastActivity || null,
  };
}

// Reads every configured list completely. Any failure makes the whole result
// "incomplete" (or "blocked" for auth/credentials) so no card is marked seen.
export async function fetchAssignedCards(client, { memberId, boards }) {
  const cards = [];
  try {
    for (const board of boards || []) {
      for (const list of board.lists || []) {
        const raw = await client.listCards(list.id);
        for (const c of raw) cards.push(normalizeCard(c, { listName: list.name, boardName: board.name }));
      }
    }
  } catch (e) {
    const blocked = e instanceof TrelloError && (e.code === "auth_failed" || e.code === "missing_credentials");
    return { status: blocked ? "blocked" : "incomplete", reason: e.message, error_code: e.code || "unknown", member_id: memberId, cards: [] };
  }
  return { status: "ok", member_id: memberId, cards };
}
