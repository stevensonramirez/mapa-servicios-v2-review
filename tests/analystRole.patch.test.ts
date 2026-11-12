// Spec-driven tests for patchRootCause and httpStatus in analystRole.ts (spec §4, pure parts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { patchRootCause, httpStatus } from "../ui/app/components/analystRole.ts";

const show = (v: unknown) => (typeof v === "function" ? "function" : v === undefined ? "undefined" : JSON.stringify(v));

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

function assertSkip(r: unknown, reason: "notMap" | "absent" | "newer", what = "") {
  const res = r as { skip?: unknown; next?: unknown };
  assert.equal(res.skip, reason, `${what}: expected {skip:"${reason}"}, got ${show(r)}`);
  assert.equal(res.next, undefined, `${what}: a skip result must not carry next`);
}

function nextOf(r: unknown, what = ""): Record<string, any> {
  const res = r as { skip?: unknown; next?: unknown };
  assert.equal(res.skip, undefined, `${what}: unexpected skip ${show(res.skip)}`);
  assert.ok(res.next && typeof res.next === "object" && !Array.isArray(res.next), `${what}: expected {next: object}`);
  return res.next as Record<string, any>;
}

const ANALYSIS = { executionId: "exec-2", rootNodes: ["n2"], summary: "DB saturada" };
const PATCHES = [
  { kind: "set", analysis: ANALYSIS },
  { kind: "clear" },
  { kind: "clear", executionId: "exec-1" },
] as const;

describe("patchRootCause — notMap", () => {
  test("raw is not a plain object → {skip:'notMap'} (set and clear)", () => {
    const raws: unknown[] = [null, undefined, 0, 1, "", "map", true, false, [], [{ settings: {} }], () => ({})];
    for (const raw of raws) {
      for (const p of PATCHES) assertSkip(patchRootCause(raw, p as any), "notMap", `raw=${show(raw)} patch=${show(p)}`);
    }
  });

  test("raw.settings present but not a plain object → {skip:'notMap'} (set and clear)", () => {
    const settingsValues: unknown[] = [null, [], [{ rootCause: {} }], "x", "", 0, 5, true, false];
    for (const settings of settingsValues) {
      const raw = { nodes: [], settings };
      for (const p of PATCHES) assertSkip(patchRootCause(raw, p as any), "notMap", `settings=${show(settings)} patch=${show(p)}`);
    }
  });
});

describe("patchRootCause — set", () => {
  test("shallow copy; settings = {...old, rootCause}; other top-level keys identical (===) and in the same order", () => {
    const raw = deepFreeze({
      schemaVersion: 2,
      nodes: [{ id: "n1" }, { id: "n2" }],
      settings: { theme: "dark", rootCause: { executionId: "old" }, cadence: 5, rules: [{ color: "red" }] },
      edges: [{ id: "e1" }],
      meta: { owner: "x" },
      title: "Mapa",
    });
    const snapshot = structuredClone(raw);
    const next = nextOf(patchRootCause(raw, { kind: "set", analysis: ANALYSIS }), "set");
    assert.notEqual(next, raw, "next must be a new object");
    assert.deepEqual(Object.keys(next), Object.keys(raw), "top-level key order");
    for (const k of Object.keys(raw)) {
      if (k !== "settings") assert.equal(next[k], (raw as Record<string, unknown>)[k], `top-level key ${k} must be the same reference`);
    }
    assert.notEqual(next.settings, raw.settings, "settings must be a new object");
    const expectedSettings = { ...raw.settings, rootCause: ANALYSIS };
    assert.deepEqual(next.settings, expectedSettings);
    assert.deepEqual(Object.keys(next.settings), Object.keys(expectedSettings), "settings key order of {...old, rootCause}");
    assert.deepEqual(raw, snapshot, "input must not be mutated");
  });

  test("settings absent → created as {rootCause}; other keys identical and in order", () => {
    const raw = deepFreeze({ nodes: [{ id: "n1" }], edges: [], title: "t" });
    const next = nextOf(patchRootCause(raw, { kind: "set", analysis: ANALYSIS }), "set without settings");
    assert.deepEqual(next.settings, { rootCause: ANALYSIS });
    assert.deepEqual(Object.keys(next).filter((k) => k !== "settings"), Object.keys(raw));
    for (const k of Object.keys(raw)) assert.equal(next[k], (raw as Record<string, unknown>)[k]);
    assert.equal("settings" in raw, false, "input must not gain settings");
  });

  test("empty settings object → {rootCause}", () => {
    const raw = deepFreeze({ nodes: [], settings: {} });
    const next = nextOf(patchRootCause(raw, { kind: "set", analysis: ANALYSIS }), "set on {}");
    assert.deepEqual(next.settings, { rootCause: ANALYSIS });
    assert.deepEqual(raw.settings, {});
  });

  test("works on an empty map object", () => {
    const next = nextOf(patchRootCause({}, { kind: "set", analysis: ANALYSIS }), "set on {}");
    assert.deepEqual(next, { settings: { rootCause: ANALYSIS } });
  });
});

describe("patchRootCause — clear", () => {
  test("no settings or no settings.rootCause → {skip:'absent'} (with or without executionId)", () => {
    for (const raw of [{ nodes: [] }, { nodes: [], settings: {} }, { nodes: [], settings: { theme: "x" } }]) {
      assertSkip(patchRootCause(raw, { kind: "clear" }), "absent", show(raw));
      assertSkip(patchRootCause(raw, { kind: "clear", executionId: "e1" }), "absent", show(raw));
    }
  });

  test("executionId given and different from the stored one → {skip:'newer'}", () => {
    assertSkip(patchRootCause({ settings: { rootCause: { executionId: "e2" } } }, { kind: "clear", executionId: "e1" }), "newer");
    assertSkip(
      patchRootCause({ settings: { rootCause: { summary: "no id stored" } } }, { kind: "clear", executionId: "e1" }),
      "newer",
      "stored analysis without executionId",
    );
  });

  test("matching executionId → next.settings has no rootCause key; other settings kept; input untouched", () => {
    const raw = deepFreeze({
      nodes: [{ id: "n1" }],
      settings: { theme: "dark", rootCause: { executionId: "e1" }, cadence: 5 },
      edges: [],
    });
    const snapshot = structuredClone(raw);
    const next = nextOf(patchRootCause(raw, { kind: "clear", executionId: "e1" }), "clear e1");
    assert.equal(Object.prototype.hasOwnProperty.call(next.settings, "rootCause"), false, "rootCause key must be gone");
    assert.deepEqual(next.settings, { theme: "dark", cadence: 5 });
    assert.deepEqual(raw, snapshot, "input must not be mutated");
    assert.ok(Object.prototype.hasOwnProperty.call(raw.settings, "rootCause"), "input settings must keep rootCause");
  });

  test("no executionId → removes whatever analysis is stored", () => {
    const raw = deepFreeze({ settings: { rootCause: { executionId: "anything" }, theme: "x" } });
    const next = nextOf(patchRootCause(raw, { kind: "clear" }), "clear");
    assert.deepEqual(next.settings, { theme: "x" });
    assert.equal("rootCause" in next.settings, false);
  });

  test("other top-level keys identical (===) and in the same order (next is a shallow copy, as for set)", () => {
    const raw = deepFreeze({ a: { x: 1 }, settings: { rootCause: { executionId: "e1" } }, nodes: [1], z: "z" });
    const next = nextOf(patchRootCause(raw, { kind: "clear", executionId: "e1" }), "clear");
    assert.notEqual(next, raw);
    assert.deepEqual(Object.keys(next), Object.keys(raw));
    for (const k of ["a", "nodes", "z"]) assert.equal(next[k], (raw as Record<string, unknown>)[k], `key ${k}`);
  });

  test("rootCause was the only setting → next.settings is an empty object", () => {
    const next = nextOf(patchRootCause({ settings: { rootCause: { executionId: "e1" } } }, { kind: "clear" }), "clear");
    assert.deepEqual(next.settings, {});
  });

  test("skip results never mutate the input", () => {
    const raws = [
      deepFreeze({ settings: { rootCause: { executionId: "e2" } } }),
      deepFreeze({ settings: {} }),
      deepFreeze({ settings: null }),
    ];
    for (const raw of raws) {
      const snap = structuredClone(raw);
      patchRootCause(raw, { kind: "clear", executionId: "e1" });
      assert.deepEqual(raw, snap);
    }
  });
});

describe("httpStatus", () => {
  test("reads e.status", () => {
    assert.equal(httpStatus({ status: 409 }), 409);
    assert.equal(httpStatus(Object.assign(new Error("x"), { status: 403 })), 403);
  });

  test("falls back to e.response.status", () => {
    assert.equal(httpStatus({ response: { status: 403 } }), 403);
    assert.equal(httpStatus(Object.assign(new Error("x"), { response: { status: 500 } })), 500);
  });

  test("e.status takes precedence over e.response.status", () => {
    assert.equal(httpStatus({ status: 409, response: { status: 500 } }), 409);
  });

  test("status 0 is a number and is returned as such", () => {
    assert.equal(httpStatus({ status: 0 }), 0);
  });

  test("undefined when there is no status (null, strings, numbers, plain errors, empty shapes)", () => {
    const values: unknown[] = [null, undefined, "409", "error", 409, true, {}, [], { response: null }, { response: {} }, { response: "x" }, new Error("x"), { status: null }];
    for (const e of values) assert.equal(httpStatus(e), undefined, `e=${show(e)}`);
  });

  test("non-numeric status values are not returned (the result is number | undefined)", () => {
    assert.equal(httpStatus({ status: "409" }), undefined);
    assert.equal(httpStatus({ response: { status: "403" } }), undefined);
    assert.equal(httpStatus({ status: "oops", response: { status: 409 } }), 409);
  });
});
