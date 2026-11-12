// Spec-driven tests for saveAnalysisWith in analystRole.ts (spec §4), against a FAKE Document
// service with real optimistic locking (string version counter; a stale version → {status:409})
// and hooks to interleave other writers between the analyst's read and write.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { saveAnalysisWith } from "../ui/app/components/analystRole.ts";
import type { SaveDeps, SaveDoc } from "../ui/app/components/analystRole.ts";

const DOC_ID = "8d3f1c2e-0000-4000-8000-00000000d0c1";
const ME = "aaaaaaaa-1111-4222-8333-000000000001";
const OWNER = "bbbbbbbb-1111-4222-8333-000000000002";
const PEER = "cccccccc-1111-4222-8333-000000000003";
const ANALYST_LABELS = ["team:noc", `an:${PEER};${ME}`];

const BASE = {
  schemaVersion: 2,
  title: "Mapa core",
  nodes: [{ id: "n1", label: "API" }, { id: "n2", label: "DB" }],
  settings: { theme: "dark", glow: true, cadence: 5 },
  edges: [{ id: "e1", source: "n1", target: "n2" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};
type Content = Record<string, any>;
const ANALYSIS = { executionId: "exec-2", at: "2026-10-28T10:00:00Z", rootNodes: ["n2"], summary: "DB saturada" };
const withRc = (c: Content, rc: unknown): Content => ({ ...c, settings: { ...c.settings, rootCause: rc } });
const withoutRc = (c: Content): Content => {
  const { rootCause: _drop, ...settings } = c.settings ?? {};
  return { ...c, settings };
};

// ── fake Document service ─────────────────────────────────────────────────────
type UpdateRec = { id: string; version: string; lastRead: string | undefined; text: string; outcome: "ok" | "conflict" | "injected" };
type Init = { content: unknown; version?: number; access?: string[] | null; owner?: string | null; labels?: string[] };

function fakeDocService(init: Init) {
  const doc = {
    content: typeof init.content === "string" ? init.content : JSON.stringify(init.content),
    version: init.version ?? 1,
    access: "access" in init ? init.access : ["read", "write"],
    owner: "owner" in init ? init.owner : OWNER,
    labels: init.labels ?? [...ANALYST_LABELS],
  };
  const log = { getIds: [] as string[], updates: [] as UpdateRec[] };
  let lastRead: string | undefined;
  const hooks: {
    /** return a value to make the n-th read throw it */
    getError?: (n: number) => unknown;
    /** other writers act right before the n-th update reaches the server */
    beforeUpdate?: (n: number) => void;
    /** return a value to make the n-th update throw it */
    updateError?: (n: number) => unknown;
  } = {};

  const getDocument = async (id: string): Promise<SaveDoc> => {
    log.getIds.push(id);
    const err = hooks.getError?.(log.getIds.length);
    if (err !== undefined) throw err;
    lastRead = String(doc.version);
    return {
      text: doc.content,
      version: String(doc.version),
      access: doc.access ? [...doc.access] : doc.access,
      owner: doc.owner,
      labels: [...doc.labels],
    };
  };

  const updateContent = async (id: string, version: string, text: string): Promise<{ version: string }> => {
    const n = log.updates.length + 1;
    hooks.beforeUpdate?.(n);
    const rec: UpdateRec = { id, version, lastRead, text, outcome: "ok" };
    log.updates.push(rec);
    const err = hooks.updateError?.(n);
    if (err !== undefined) {
      rec.outcome = "injected";
      throw err;
    }
    if (version !== String(doc.version)) {
      rec.outcome = "conflict";
      throw { status: 409, message: `version ${version} is stale (current ${doc.version})` };
    }
    doc.content = text;
    doc.version += 1;
    return { version: String(doc.version) };
  };

  /** Another user writes the document: content changes and the version is bumped. */
  const otherWrite = (mutate: (c: Content) => Content) => {
    doc.content = JSON.stringify(mutate(JSON.parse(doc.content)));
    doc.version += 1;
  };

  return { doc, log, hooks, getDocument, updateContent, otherWrite };
}
type Srv = ReturnType<typeof fakeDocService>;

const validMap = (p: unknown) => {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "content is not an object";
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return "nodes/edges must be arrays";
  return null;
};
const statusOf = (e: unknown) => (e && typeof e === "object" ? (e as { status?: unknown }).status : undefined);
const isConflict = (e: unknown) => statusOf(e) === 409;
const isForbidden = (e: unknown) => statusOf(e) === 403;

function depsOf(srv: Srv, extra: Partial<SaveDeps> = {}): SaveDeps {
  return { getDocument: srv.getDocument, updateContent: srv.updateContent, validate: validMap, isConflict, isForbidden, ...extra };
}
const serverContent = (srv: Srv): Content => JSON.parse(srv.doc.content);
const okWrites = (srv: Srv) => srv.log.updates.filter((u) => u.outcome === "ok");
const SET = { kind: "set", analysis: ANALYSIS } as const;

function assertNoWrite(srv: Srv, before: string, what = "") {
  assert.equal(okWrites(srv).length, 0, `${what}: nothing may be written`);
  assert.equal(srv.doc.content, before, `${what}: server content must be unchanged`);
}
function assertEveryUpdateUsedLatestRead(srv: Srv) {
  for (const [i, u] of srv.log.updates.entries()) {
    assert.equal(u.version, u.lastRead, `update #${i + 1} must use the version just read`);
    assert.equal(u.id, DOC_ID, `update #${i + 1} must target the document id`);
  }
  for (const id of srv.log.getIds) assert.equal(id, DOC_ID);
}
function assertFail(r: any, reason: string) {
  assert.equal(r.ok, false, `expected ok:false/${reason}, got ${JSON.stringify(r)}`);
  assert.equal(r.reason, reason, `expected reason ${reason}, got ${JSON.stringify(r)}`);
}

// ── success paths ─────────────────────────────────────────────────────────────
describe("saveAnalysisWith — success", () => {
  test("set: one read, one write with the version just read; only settings.rootCause changes", async () => {
    const srv = fakeDocService({ content: withRc(BASE, { executionId: "exec-1", summary: "old" }), version: 7 });
    const before = serverContent(srv);
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, true);
    assert.equal(srv.log.getIds.length, 1);
    assert.equal(srv.log.updates.length, 1);
    assert.equal(srv.log.updates[0].version, "7");
    assertEveryUpdateUsedLatestRead(srv);
    assert.equal(r.version, "8", "result carries the version returned by updateContent");
    assert.equal(r.text, srv.doc.content, "result carries the text that was written");

    const after = serverContent(srv);
    assert.deepEqual(after, withRc(before, ANALYSIS));
    assert.deepEqual(Object.keys(after), Object.keys(before), "top-level key order preserved");
    for (const k of Object.keys(before)) if (k !== "settings") assert.deepEqual(after[k], before[k], `key ${k} untouched`);
    assert.deepEqual(withoutRc(after).settings, withoutRc(before).settings, "other settings untouched");
  });

  test("set on a map without settings creates settings.rootCause", async () => {
    const { settings: _s, ...noSettings } = BASE;
    const srv = fakeDocService({ content: noSettings });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assert.equal(r.written, true, JSON.stringify(r));
    assert.deepEqual(serverContent(srv), { ...noSettings, settings: { rootCause: ANALYSIS } });
  });

  test("clear with matching executionId removes settings.rootCause and keeps everything else", async () => {
    const srv = fakeDocService({ content: withRc(BASE, { executionId: "exec-1" }), version: 3 });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, { kind: "clear", executionId: "exec-1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, true);
    assert.equal(r.version, "4");
    assert.deepEqual(serverContent(srv), BASE);
    assert.equal("rootCause" in serverContent(srv).settings, false);
    assertEveryUpdateUsedLatestRead(srv);
  });

  test("clear without executionId removes whatever analysis is stored", async () => {
    const srv = fakeDocService({ content: withRc(BASE, { executionId: "exec-9" }) });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, { kind: "clear" });
    assert.equal(r.written, true, JSON.stringify(r));
    assert.deepEqual(serverContent(srv), BASE);
  });

  test("access missing on the document (not an array) counts as write → the analyst can save", async () => {
    const srv = fakeDocService({ content: BASE, access: undefined });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assert.equal(r.written, true, JSON.stringify(r));
  });
});

// ── concurrency (optimistic locking) ──────────────────────────────────────────
describe("saveAnalysisWith — concurrency", () => {
  test("an editor writes between read and write → conflict → re-read; the result keeps the EDITOR's content + the analysis", async () => {
    const srv = fakeDocService({ content: BASE, version: 1 });
    let editorContent: Content | undefined;
    srv.hooks.beforeUpdate = (n) => {
      if (n !== 1) return;
      srv.otherWrite((c) => ({
        ...c,
        title: "Mapa core (editado)",
        nodes: [...c.nodes, { id: "n3", label: "Cache" }],
        settings: { ...c.settings, theme: "light" },
      }));
      editorContent = serverContent(srv);
    };
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, true);
    assert.equal(srv.log.getIds.length, 2, "must re-read after the conflict");
    assert.deepEqual(srv.log.updates.map((u) => u.outcome), ["conflict", "ok"]);
    assertEveryUpdateUsedLatestRead(srv);

    const final = serverContent(srv);
    assert.deepEqual(final, withRc(editorContent as Content, ANALYSIS));
    assert.equal(final.title, "Mapa core (editado)", "stale title must not come back");
    assert.equal(final.nodes.length, 3, "the editor's node must survive");
    assert.equal(final.settings.theme, "light", "the editor's setting must survive");
    assert.equal(r.text, srv.doc.content);
    assert.equal(r.version, String(srv.doc.version));
  });

  test("conflicts on attempts 1 and 2, success on attempt 3 (default maxAttempts)", async () => {
    const srv = fakeDocService({ content: BASE });
    srv.hooks.beforeUpdate = (n) => {
      if (n <= 2) srv.otherWrite((c) => ({ ...c, title: `${c.title} v${n}` }));
    };
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assert.equal(r.written, true, JSON.stringify(r));
    assert.equal(srv.log.getIds.length, 3);
    assert.deepEqual(srv.log.updates.map((u) => u.outcome), ["conflict", "conflict", "ok"]);
    assert.deepEqual(serverContent(srv), withRc({ ...BASE, title: "Mapa core v1 v2" }, ANALYSIS));
    assertEveryUpdateUsedLatestRead(srv);
  });

  for (const maxAttempts of [undefined, 1, 2, 5]) {
    const n = maxAttempts ?? 3;
    test(`conflict on every attempt → "conflict" after exactly ${n} read(s) (maxAttempts ${maxAttempts ?? "default"}), nothing written`, async () => {
      const srv = fakeDocService({ content: BASE });
      srv.hooks.beforeUpdate = () => srv.otherWrite((c) => ({ ...c, title: `${c.title}!` }));
      const deps = maxAttempts === undefined ? depsOf(srv) : depsOf(srv, { maxAttempts });
      const r: any = await saveAnalysisWith(deps, DOC_ID, ME, SET);
      assertFail(r, "conflict");
      assert.equal(srv.log.getIds.length, n, "reads");
      assert.equal(srv.log.updates.length, n, "write attempts");
      assert.equal(okWrites(srv).length, 0, "no successful write");
      assert.equal(serverContent(srv).settings.rootCause, undefined);
      assertEveryUpdateUsedLatestRead(srv);
    });
  }

  test("label removed mid-way (second read no longer analyst) → 'role', nothing written", async () => {
    const srv = fakeDocService({ content: BASE });
    srv.hooks.beforeUpdate = (n) => {
      if (n !== 1) return;
      srv.doc.labels = ["team:noc", `an:${PEER}`]; // the owner removes me from the analysts…
      srv.otherWrite((c) => ({ ...c, title: "otro" })); // …and the document changes meanwhile
    };
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assertFail(r, "role");
    assert.equal(srv.log.getIds.length, 2);
    assert.equal(srv.log.updates.length, 1, "only the first (rejected) attempt");
    assert.equal(okWrites(srv).length, 0);
    assert.equal(serverContent(srv).settings.rootCause, undefined);
  });

  test("content became invalid on the re-read → 'invalid', nothing written", async () => {
    const srv = fakeDocService({ content: BASE });
    srv.hooks.beforeUpdate = (n) => {
      if (n === 1) srv.otherWrite(() => ({ broken: true }));
    };
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assertFail(r, "invalid");
    assert.equal(srv.log.getIds.length, 2);
    assert.equal(okWrites(srv).length, 0);
    assert.deepEqual(serverContent(srv), { broken: true });
  });

  test("clear: a newer analysis was saved meanwhile → written:false 'newer' with the server's analysis", async () => {
    const NEWER = { executionId: "exec-3", summary: "nuevo análisis" };
    const srv = fakeDocService({ content: withRc(BASE, { executionId: "exec-1" }) });
    srv.hooks.beforeUpdate = (n) => {
      if (n === 1) srv.otherWrite((c) => withRc(c, NEWER));
    };
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, { kind: "clear", executionId: "exec-1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, false);
    assert.equal(r.reason, "newer");
    assert.equal(r.version, String(srv.doc.version), "version of the latest read");
    assert.deepEqual(r.current, NEWER);
    assert.deepEqual(serverContent(srv).settings.rootCause, NEWER, "the newer analysis must survive");
    assert.equal(okWrites(srv).length, 0);
  });
});

// ── role gate ─────────────────────────────────────────────────────────────────
describe("saveAnalysisWith — role gate (only analysts may write)", () => {
  const cases: { name: string; init: Partial<Init>; me?: string }[] = [
    { name: "owner (even if labeled as analyst)", init: { owner: ME, labels: ["team:noc", `an:${ME}`] } },
    { name: "viewer (no write access, even if labeled)", init: { access: ["read"], labels: [`an:${ME}`] } },
    { name: "editor (write access, not labeled)", init: { labels: ["team:noc", `an:${PEER}`] } },
    { name: "empty me", init: {}, me: "" },
  ];
  for (const c of cases) {
    test(`${c.name} → 'role', no write attempted`, async () => {
      const srv = fakeDocService({ content: BASE, ...c.init });
      const before = srv.doc.content;
      const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, c.me ?? ME, SET);
      assertFail(r, "role");
      assert.equal(srv.log.getIds.length, 1);
      assert.equal(srv.log.updates.length, 0, "updateContent must not be called");
      assertNoWrite(srv, before, c.name);
    });
  }

  test("the role is checked before the content is parsed", async () => {
    const srv = fakeDocService({ content: "{not json", owner: ME });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assertFail(r, "role");
    assert.equal(srv.log.updates.length, 0);
  });
});

// ── content checks ────────────────────────────────────────────────────────────
describe("saveAnalysisWith — content checks", () => {
  test("stored content is not JSON → 'invalid', no write", async () => {
    const srv = fakeDocService({ content: "{not json" });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assertFail(r, "invalid");
    assert.equal(srv.log.updates.length, 0);
  });

  test("validate(stored content) not null → 'invalid', no write", async () => {
    const srv = fakeDocService({ content: { title: "no nodes", settings: {} } });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
    assertFail(r, "invalid");
    assert.equal(srv.log.updates.length, 0);
  });

  test("stored content is not a map (patch → notMap) → 'invalid', no write (permissive validator)", async () => {
    for (const content of ["[1,2,3]", "null", '"text"', "42", '{"nodes":[],"edges":[],"settings":5}', '{"nodes":[],"edges":[],"settings":null}']) {
      const srv = fakeDocService({ content });
      const r: any = await saveAnalysisWith(depsOf(srv, { validate: () => null }), DOC_ID, ME, SET);
      assertFail(r, "invalid");
      assert.equal(srv.log.updates.length, 0, `content ${content}`);
    }
  });

  test("validator rejects the PATCHED result → 'invalid', no write", async () => {
    const srv = fakeDocService({ content: BASE });
    const seen: unknown[] = [];
    const validate = (p: unknown) => {
      seen.push(p);
      const rc = (p as Content)?.settings?.rootCause;
      return rc && rc.poison ? "rootCause rejected" : validMap(p);
    };
    const r: any = await saveAnalysisWith(depsOf(srv, { validate }), DOC_ID, ME, { kind: "set", analysis: { poison: true } });
    assertFail(r, "invalid");
    assert.equal(srv.log.updates.length, 0);
    assert.ok(seen.some((p) => (p as Content)?.settings?.rootCause?.poison === true), "the patched object must be validated");
  });

  test("JSON.stringify(next).length > maxBytes → 'tooBig', no write", async () => {
    const srv = fakeDocService({ content: BASE });
    const r: any = await saveAnalysisWith(depsOf(srv, { maxBytes: 50 }), DOC_ID, ME, SET);
    assertFail(r, "tooBig");
    assert.equal(srv.log.updates.length, 0);
  });

  test("maxBytes boundary: length === maxBytes is written, length === maxBytes + 1 is tooBig", async () => {
    const len = JSON.stringify(withRc(BASE, ANALYSIS)).length;
    const atLimit = fakeDocService({ content: BASE });
    const r1: any = await saveAnalysisWith(depsOf(atLimit, { maxBytes: len }), DOC_ID, ME, SET);
    assert.equal(r1.written, true, `maxBytes=${len}: ${JSON.stringify(r1)}`);

    const over = fakeDocService({ content: BASE });
    const r2: any = await saveAnalysisWith(depsOf(over, { maxBytes: len - 1 }), DOC_ID, ME, SET);
    assertFail(r2, "tooBig");
    assert.equal(over.log.updates.length, 0);
  });

  test("clear when there is no analysis → {ok:true, written:false, reason:'absent'} with the version read, no write", async () => {
    const srv = fakeDocService({ content: BASE, version: 12 });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, { kind: "clear", executionId: "exec-1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, false);
    assert.equal(r.reason, "absent");
    assert.equal(r.version, "12");
    assert.equal(r.current, undefined);
    assert.equal(srv.log.updates.length, 0);
  });

  test("clear of an older execution → {ok:true, written:false, reason:'newer', current: server analysis}, no write", async () => {
    const SERVER_RC = { executionId: "exec-9", summary: "más reciente", rootNodes: ["n1"] };
    const srv = fakeDocService({ content: withRc(BASE, SERVER_RC), version: 4 });
    const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, { kind: "clear", executionId: "exec-2" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.written, false);
    assert.equal(r.reason, "newer");
    assert.equal(r.version, "4");
    assert.deepEqual(r.current, SERVER_RC);
    assert.equal(srv.log.updates.length, 0);
  });
});

// ── errors ────────────────────────────────────────────────────────────────────
describe("saveAnalysisWith — errors", () => {
  const readErrors: [string, unknown, string][] = [
    ["403", { status: 403 }, "forbidden"],
    ["500", { status: 500 }, "error"],
    ["a thrown string", "boom", "error"],
    ["an Error without status", new Error("network down"), "error"],
  ];
  for (const [name, err, reason] of readErrors) {
    test(`getDocument throws ${name} → '${reason}', no write`, async () => {
      const srv = fakeDocService({ content: BASE });
      srv.hooks.getError = () => err;
      const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
      assertFail(r, reason);
      assert.equal(srv.log.updates.length, 0);
    });
  }

  const writeErrors: [string, unknown, string][] = [
    ["500", { status: 500 }, "error"],
    ["403", { status: 403 }, "forbidden"],
  ];
  for (const [name, err, reason] of writeErrors) {
    test(`updateContent throws ${name} → '${reason}', no retry`, async () => {
      const srv = fakeDocService({ content: BASE });
      srv.hooks.updateError = () => err;
      const before = srv.doc.content;
      const r: any = await saveAnalysisWith(depsOf(srv), DOC_ID, ME, SET);
      assertFail(r, reason);
      assert.equal(srv.log.getIds.length, 1, "no re-read");
      assert.equal(srv.log.updates.length, 1, "no retry");
      assertNoWrite(srv, before, name);
    });
  }
});
