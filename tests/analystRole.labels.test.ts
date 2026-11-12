// Spec-driven tests for the analyst LABEL helpers of analystRole.ts (spec §1), including the
// 2026-10-28 update from real-tenant verification: the Document service returns labels SORTED,
// rejects duplicate labels and bumps the version on every write. Therefore:
//   • sameLabels is order-insensitive (multiset equality),
//   • writeAnalysts/withAnalyst never return duplicate labels,
//   • reading/updating must work on the server-sorted label array.
// Written from the spec, not from the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYST_LABEL_PREFIX,
  ANALYST_SEP,
  MAX_LABELS,
  MAX_LABEL_LEN,
  ANALYSTS_PER_LABEL,
  MAX_ANALYSTS,
  AnalystLabelError,
  readAnalysts,
  writeAnalysts,
  withAnalyst,
  sameLabels,
} from "../ui/app/components/analystRole.ts";

// ── helpers (independent of the implementation) ──────────────────────────────
const ID_RE = /^[A-Za-z0-9-]{1,36}$/;
const hex = (n: number, len: number) => n.toString(16).padStart(len, "0").slice(-len);
/** Deterministic 36-char UUID-shaped id (8-4-4-4-12), unique per index. */
const uuid = (i: number) =>
  `${hex(i, 8)}-${hex(i * 7 + 1, 4)}-4${hex(i, 3)}-a${hex(i * 3, 3)}-${hex(i * 1234567 + 99, 12)}`;
const uuids = (n: number, from = 0) => Array.from({ length: n }, (_, k) => uuid(from + k));
const isAn = (l: unknown): l is string => typeof l === "string" && l.startsWith("an:");
const foreignOf = (labels: readonly unknown[]) =>
  labels.filter((l) => typeof l === "string" && !l.startsWith("an:")) as string[];
/** Spec normalisation of an id list: trim, drop empties, dedupe keeping first appearance. */
const norm = (ids: readonly string[]) => {
  const out: string[] = [];
  for (const raw of ids) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
};
/** What the Document service does to labels: ASCII sort. */
const serverSort = (xs: readonly string[]) => [...xs].sort();
const asSet = (xs: readonly string[]) => [...new Set(xs)].sort();
const show = (v: unknown) => {
  try {
    return typeof v === "function" ? "function" : JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

function expectLabelError(fn: () => unknown, code: "badId" | "tooMany", what = "") {
  let result: unknown;
  let caught: unknown;
  let threw = false;
  try {
    result = fn();
  } catch (e) {
    threw = true;
    caught = e;
  }
  assert.ok(threw, `${what}: expected AnalystLabelError(${code}) but it returned ${show(result)}`);
  assert.ok(caught instanceof AnalystLabelError, `${what}: expected an AnalystLabelError, got ${String(caught)}`);
  assert.ok(caught instanceof Error, `${what}: AnalystLabelError must extend Error`);
  assert.equal((caught as { code?: unknown }).code, code, `${what}: wrong error code`);
}

/** Structural guarantees of ANY label array produced by writeAnalysts / withAnalyst. */
function assertWellFormed(out: unknown, what = "") {
  assert.ok(Array.isArray(out), `${what}: result must be an array`);
  const arr = out as unknown[];
  assert.ok(arr.every((l) => typeof l === "string"), `${what}: every produced label must be a string`);
  assert.ok(arr.length <= 25, `${what}: ${arr.length} labels > MAX_LABELS (25)`);
  assert.equal(new Set(arr).size, arr.length, `${what}: duplicate labels in ${show(arr)}`);
  const an = arr.filter(isAn);
  for (const l of an) {
    assert.ok(l.length <= 80, `${what}: label longer than 80 chars (${l.length}): ${l}`);
    const parts = l.slice(3).split(";");
    assert.ok(parts.length === 1 || parts.length === 2, `${what}: a label must pack 1–2 ids: ${l}`);
    for (const p of parts) assert.match(p, ID_RE, `${what}: malformed id ${show(p)} in produced label ${l}`);
  }
  const ids = readAnalysts(arr);
  assert.equal(an.length, Math.ceil(ids.length / 2), `${what}: ids must be packed two per label: ${show(an)}`);
}

/** Small deterministic PRNG for the fuzz tests. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── constants ─────────────────────────────────────────────────────────────────
test("constants match the spec", () => {
  assert.equal(ANALYST_LABEL_PREFIX, "an:");
  assert.equal(ANALYST_SEP, ";");
  assert.equal(MAX_LABELS, 25);
  assert.equal(MAX_LABEL_LEN, 80);
  assert.equal(ANALYSTS_PER_LABEL, 2);
  assert.equal(MAX_ANALYSTS, 50);
});

// ── readAnalysts ──────────────────────────────────────────────────────────────
describe("readAnalysts", () => {
  test("non-array, null and undefined → []", () => {
    const inputs: unknown[] = [undefined, null, "an:abc", 42, true, {}, { 0: "an:abc", length: 1 }, new Set(["an:abc"])];
    for (const v of inputs) assert.deepEqual(readAnalysts(v as any), [], `input ${show(v)}`);
  });

  test("[] → []", () => {
    assert.deepEqual(readAnalysts([]), []);
  });

  test("one id, two ids in one label, ids spread over several labels", () => {
    assert.deepEqual(readAnalysts(["an:a"]), ["a"]);
    assert.deepEqual(readAnalysts(["an:a;b"]), ["a", "b"]);
    assert.deepEqual(readAnalysts(["an:a;b", "an:c"]), ["a", "b", "c"]);
  });

  test("trims ids and drops empty pieces", () => {
    assert.deepEqual(readAnalysts(["an: a ; b "]), ["a", "b"]);
    assert.deepEqual(readAnalysts(["an:;a;;b;"]), ["a", "b"]);
    assert.deepEqual(readAnalysts(["an:"]), []);
    assert.deepEqual(readAnalysts(["an: ;  ; "]), []);
    assert.deepEqual(readAnalysts(["an:\ta\t;\nb"]), ["a", "b"]);
  });

  test("dedupes (after trimming) keeping first-appearance order, within and across labels", () => {
    assert.deepEqual(readAnalysts(["an:b;a", "an:a;c", "an:c; b", "an: a"]), ["b", "a", "c"]);
    assert.deepEqual(readAnalysts(["an:x;x", "an:x"]), ["x"]);
  });

  test("ignores non-string entries (no coercion)", () => {
    const labels = [null, undefined, 7, {}, ["an:x"], { toString: () => "an:y" }, "an:a"];
    assert.deepEqual(readAnalysts(labels as any), ["a"]);
  });

  test("ignores labels that do not start with exactly 'an:'", () => {
    const labels = ["x-an:a", "AN:b", "An:c", " an:d", "an", "an;e", "a:n:f", "team:blue", "analyst:g"];
    assert.deepEqual(readAnalysts(labels), []);
  });

  test("foreign labels interleaved with analyst labels", () => {
    assert.deepEqual(readAnalysts(["team", "an:a;b", "env:prod", "an:c"]), ["a", "b", "c"]);
  });

  test("returns ids verbatim — the spec lists no id-syntax validation when reading", () => {
    assert.deepEqual(readAnalysts(["an:has space;x:y;ok"]), ["has space", "x:y", "ok"]);
  });

  test("does not mutate its input (frozen array)", () => {
    const labels = Object.freeze(["f", "an:a;b", "an:c"]);
    assert.deepEqual(readAnalysts(labels), ["a", "b", "c"]);
    assert.deepEqual(labels, ["f", "an:a;b", "an:c"]);
  });
});

// ── writeAnalysts ─────────────────────────────────────────────────────────────
describe("writeAnalysts", () => {
  test("packs ids two per label, in the given order", () => {
    assert.deepEqual(writeAnalysts([], []), []);
    assert.deepEqual(writeAnalysts([], ["a"]), ["an:a"]);
    assert.deepEqual(writeAnalysts([], ["a", "b"]), ["an:a;b"]);
    assert.deepEqual(writeAnalysts([], ["a", "b", "c"]), ["an:a;b", "an:c"]);
    assert.deepEqual(writeAnalysts([], ["d", "c", "b", "a"]), ["an:d;c", "an:b;a"]);
  });

  test("null/undefined labels behave like []", () => {
    assert.deepEqual(writeAnalysts(null, ["a"]), ["an:a"]);
    assert.deepEqual(writeAnalysts(undefined, ["a", "b", "c"]), ["an:a;b", "an:c"]);
  });

  test("replaces (does not merge) existing analyst labels; foreign labels first, analyst labels last", () => {
    assert.deepEqual(writeAnalysts(["an:old1;old2", "f1", "an:old3", "f2"], ["x", "y", "z"]), ["f1", "f2", "an:x;y", "an:z"]);
    assert.deepEqual(writeAnalysts(["an:old1;old2", "f1"], []), ["f1"]);
  });

  test("distinct foreign labels are preserved byte-for-byte and in their original order", () => {
    const foreign = [
      "zeta", "Alpha", " spaced ", "ñandú-ü", "AN:upper-prefix", "an", "an;x", "x;y",
      "key:a,b", "a".repeat(80), "emoji-🙂", "analyst:z",
    ];
    const input = ["an:p;q", ...foreign.slice(0, 4), "an:r", ...foreign.slice(4)];
    assert.deepEqual(writeAnalysts(input, ["s", "t", "u"]), [...foreign, "an:s;t", "an:u"]);
  });

  test("non-string entries are dropped (only string labels are kept)", () => {
    const input = ["f", 1, null, undefined, { x: 1 }, ["g"], "h"];
    assert.deepEqual(writeAnalysts(input as any, ["a"]), ["f", "h", "an:a"]);
  });

  test("an empty-string label is a non-'an:' string label and is kept", () => {
    assert.deepEqual(writeAnalysts(["", "f"], []), ["", "f"]);
  });

  test("ids: trimmed, deduped after trimming (first appearance wins), empties dropped", () => {
    assert.deepEqual(writeAnalysts([], [" a ", "b", "a", "", "   ", "b ", "c"]), ["an:a;b", "an:c"]);
    assert.deepEqual(writeAnalysts([], ["", "  "]), []);
  });

  test("surrounding whitespace is trimmed before the id is validated", () => {
    const id = uuid(5);
    assert.deepEqual(writeAnalysts([], [`  ${id}\t`]), [`an:${id}`]);
  });

  test("returns a NEW array and never mutates its inputs", () => {
    const labels = Object.freeze(["f1", "an:a;b", "f2"]);
    const ids = Object.freeze(["c", "d"]);
    const out = writeAnalysts(labels, ids);
    assert.notEqual(out, labels);
    assert.deepEqual(out, ["f1", "f2", "an:c;d"]);
    assert.deepEqual(labels, ["f1", "an:a;b", "f2"]);
    assert.deepEqual(ids, ["c", "d"]);

    const same = ["f1"];
    const out2 = writeAnalysts(same, []);
    assert.notEqual(out2, same, "a new array even when nothing changes");
    out2.push("mutated");
    assert.deepEqual(same, ["f1"], "the result must not alias the input");
  });

  test("two 36-char UUIDs fit in one label of exactly 76 chars (≤ 80)", () => {
    const [a, b] = uuids(2, 1000);
    assert.equal(a.length, 36);
    const out = writeAnalysts([], [a, b]);
    assert.deepEqual(out, [`an:${a};${b}`]);
    assert.equal(out[0].length, 76);
    assert.ok(out[0].length <= MAX_LABEL_LEN);
  });

  for (const n of [0, 1, 2, 3, 49, 50]) {
    test(`${n} analyst(s), no foreign labels → ${Math.ceil(n / 2)} label(s), each ≤ 80 chars, round-trips`, () => {
      const ids = uuids(n);
      const out = writeAnalysts([], ids);
      assert.equal(out.length, Math.ceil(n / 2));
      assert.ok(out.every((l) => l.startsWith("an:") && l.length <= 80));
      assertWellFormed(out, `n=${n}`);
      assert.deepEqual(readAnalysts(out), ids);
    });
  }

  test("51 analysts with no foreign labels → tooMany", () => {
    expectLabelError(() => writeAnalysts([], uuids(51)), "tooMany", "51 analysts");
  });

  test("24 foreign labels → at most 2 analysts", () => {
    const foreign = Array.from({ length: 24 }, (_, i) => `tag-${i}`);
    const two = writeAnalysts(foreign, uuids(2));
    assert.equal(two.length, 25);
    assert.deepEqual(readAnalysts(two), uuids(2));
    expectLabelError(() => writeAnalysts(foreign, uuids(3)), "tooMany", "24 foreign + 3 analysts");
  });

  test("capacity shrinks by one label (two analysts) per foreign label", () => {
    for (const f of [1, 2, 10, 23, 24, 25]) {
      const foreign = Array.from({ length: f }, (_, i) => `tag-${i}`);
      const cap = (25 - f) * 2;
      const ok = writeAnalysts(foreign, uuids(cap));
      assert.equal(ok.length, 25, `f=${f}: capacity ${cap} must fill exactly 25 labels`);
      assert.deepEqual(readAnalysts(ok), uuids(cap));
      expectLabelError(() => writeAnalysts(foreign, uuids(cap + 1)), "tooMany", `f=${f}, ${cap + 1} analysts`);
    }
  });

  test("capacity is counted on the normalised (trimmed, deduped) ids", () => {
    const ids = [...uuids(50), uuid(0), ` ${uuid(1)} `, "", "   "];
    const out = writeAnalysts([], ids);
    assert.equal(out.length, 25);
    assert.deepEqual(readAnalysts(out), uuids(50));
  });

  test("accepts every id matching /^[A-Za-z0-9-]{1,36}$/ (uppercase, 1 char, 36 chars, digits, hyphen) and keeps case", () => {
    const ids = ["A", "z", "0", "-", "ABCDEF00-1111-4222-8333-444455556666", "abc", "ABC", "x".repeat(36), "123456"];
    const out = writeAnalysts([], ids);
    assertWellFormed(out);
    assert.deepEqual(readAnalysts(out), ids);
  });

  test("rejects malformed ids with badId (37 chars, ';', ':', spaces, other characters)", () => {
    const bad = [
      "x".repeat(37),
      `${uuid(1)}0`,
      "a;b",
      "a:b",
      "an:abc",
      "a b",
      "ab cd",
      "a\tb",
      "a\nb",
      "a_b",
      "a.b",
      "a,b",
      "a/b",
      "user@example.com",
      "ñandu",
      "é",
    ];
    for (const b of bad) {
      expectLabelError(() => writeAnalysts(["f"], ["good-1", b]), "badId", `id ${show(b)}`);
      expectLabelError(() => writeAnalysts([], [b]), "badId", `id ${show(b)} alone`);
    }
  });

  test("round-trip: readAnalysts(writeAnalysts(L, ids)) equals the normalised ids", () => {
    const foreignSets = [[], ["f1"], ["team:x", "an-not-analyst", "AN:upper"], Array.from({ length: 20 }, (_, i) => `t${i}`)];
    for (const foreign of foreignSets) {
      const cap = (25 - foreign.length) * 2;
      for (let n = 0; n <= cap; n++) {
        const ids = uuids(n, 100).map((s, i) => (i % 4 === 1 ? s.toUpperCase() : s));
        const noisy = [...ids, ...ids.slice(0, 3).map((s) => ` ${s} `), "", "  "];
        const out = writeAnalysts(["an:stale;old", ...foreign], noisy);
        assert.deepEqual(readAnalysts(out), ids, `foreign=${foreign.length}, n=${n}`);
        assert.deepEqual(foreignOf(out), foreign, `foreign=${foreign.length}, n=${n}`);
        assertWellFormed(out, `foreign=${foreign.length}, n=${n}`);
      }
    }
  });
});

// ── withAnalyst ───────────────────────────────────────────────────────────────
describe("withAnalyst", () => {
  test("add (on=true): the id appears exactly once, previous analysts keep their order, foreign labels untouched", () => {
    const L = ["team", "an:a;b", "env", "an:c"];
    const out = withAnalyst(L, "d", true);
    const ids = readAnalysts(out);
    assert.equal(ids.filter((x) => x === "d").length, 1);
    assert.deepEqual(ids.filter((x) => x !== "d"), ["a", "b", "c"]);
    assert.deepEqual(foreignOf(out), ["team", "env"]);
    assertWellFormed(out);
  });

  test("add to empty / null / undefined labels", () => {
    assert.deepEqual(withAnalyst([], "a", true), ["an:a"]);
    assert.deepEqual(withAnalyst(null, "a", true), ["an:a"]);
    assert.deepEqual(withAnalyst(undefined, "a", true), ["an:a"]);
  });

  test("uppercase ids are allowed and matched exactly (case-sensitive)", () => {
    const up = "ABCDEF00-1111-4222-8333-444455556666";
    const out = withAnalyst(["team"], up, true);
    assert.deepEqual(readAnalysts(out), [up]);
    assert.deepEqual(readAnalysts(withAnalyst(out, up.toLowerCase(), false)), [up], "removing the lowercase id must not remove the uppercase one");
    assert.deepEqual(readAnalysts(withAnalyst(out, up, false)), []);
  });

  test("adding an id that is already present is idempotent (add twice == add once)", () => {
    const L = writeAnalysts(["team"], ["a", "b", "c"]);
    const again = withAnalyst(L, "b", true);
    assert.deepEqual(readAnalysts(again), ["a", "b", "c"]);
    assert.ok(sameLabels(again, L), `${show(again)} vs ${show(L)}`);

    const once = withAnalyst(L, "z", true);
    const twice = withAnalyst(once, "z", true);
    assert.deepEqual(readAnalysts(twice), readAnalysts(once));
    assert.ok(sameLabels(twice, once));
  });

  test("removing an absent id is a no-op; removing twice == removing once", () => {
    const L = writeAnalysts(["team"], ["a", "b", "c"]);
    const absent = withAnalyst(L, "zz", false);
    assert.deepEqual(readAnalysts(absent), ["a", "b", "c"]);
    assert.ok(sameLabels(absent, L));

    const once = withAnalyst(L, "a", false);
    const twice = withAnalyst(once, "a", false);
    assert.deepEqual(readAnalysts(once), ["b", "c"]);
    assert.deepEqual(readAnalysts(twice), ["b", "c"]);
    assert.ok(sameLabels(twice, once));
  });

  test("removing someone who shares a label with another person keeps the other person", () => {
    const L = ["team", "an:a;b", "an:c;d", "zz"];
    const outB = withAnalyst(L, "b", false);
    assert.deepEqual(readAnalysts(outB), ["a", "c", "d"]);
    assert.deepEqual(foreignOf(outB), ["team", "zz"]);
    assertWellFormed(outB);

    const outC = withAnalyst(L, "c", false);
    assert.deepEqual(readAnalysts(outC), ["a", "b", "d"]);
    assert.deepEqual(foreignOf(outC), ["team", "zz"]);
    assertWellFormed(outC);
  });

  test("removing the last analyst leaves exactly the foreign labels", () => {
    assert.deepEqual(withAnalyst(["team", "an:a"], "a", false), ["team"]);
  });

  test("foreign labels are kept byte-for-byte (add and remove)", () => {
    const foreign = ["zeta", " spaced ", "ñandú", "AN:caps", "an;x", "key:a,b"];
    const L = [foreign[0], "an:a;b", ...foreign.slice(1)];
    assert.deepEqual(foreignOf(withAnalyst(L, "c", true)), foreign);
    assert.deepEqual(foreignOf(withAnalyst(L, "a", false)), foreign);
  });

  test("malformed ids already present in labels are dropped on repack, without throwing", () => {
    const L = ["f", "an:good1;bad id", "an:x:y;good2", `an:${"z".repeat(37)}`, "an:under_score", "g"];
    const added = withAnalyst(L, "new-1", true);
    const ids = readAnalysts(added);
    assert.ok(ids.includes("new-1"));
    assert.deepEqual(ids.filter((x) => x !== "new-1"), ["good1", "good2"]);
    assert.deepEqual(foreignOf(added), ["f", "g"]);
    assertWellFormed(added);

    const removed = withAnalyst(L, "good1", false);
    assert.deepEqual(readAnalysts(removed), ["good2"]);
    assert.deepEqual(foreignOf(removed), ["f", "g"]);
    assertWellFormed(removed);
  });

  test("invalid new uid with on=true → badId", () => {
    for (const bad of ["bad id", "a;b", "a:b", "x".repeat(37), "a_b", "user@example.com"]) {
      expectLabelError(() => withAnalyst(["team", "an:a"], bad, true), "badId", `uid ${show(bad)}`);
    }
  });

  test("on=false with a malformed uid does not throw (badId is specified for on=true only)", () => {
    const out = withAnalyst(["team", "an:a;b"], "bad id", false);
    assert.deepEqual(readAnalysts(out), ["a", "b"]);
  });

  test("capacity: the 51st analyst → tooMany; with 24 foreign labels only 2 analysts fit", () => {
    const L50 = writeAnalysts([], uuids(50));
    expectLabelError(() => withAnalyst(L50, uuid(999), true), "tooMany", "51st analyst");
    assert.ok(sameLabels(withAnalyst(L50, uuid(10), true), L50), "re-adding a present analyst at full capacity is fine");

    const L49 = withAnalyst(L50, uuid(0), false);
    assert.deepEqual(readAnalysts(L49), uuids(49, 1));
    assertWellFormed(L49);
    const back = withAnalyst(L49, uuid(0), true);
    assert.deepEqual(asSet(readAnalysts(back)), asSet(uuids(50)));
    assertWellFormed(back);

    const foreign24 = Array.from({ length: 24 }, (_, i) => `t${i}`);
    const one = withAnalyst(foreign24, uuid(1), true);
    const two = withAnalyst(one, uuid(2), true);
    assert.equal(two.length, 25);
    assert.deepEqual(readAnalysts(two), [uuid(1), uuid(2)]);
    expectLabelError(() => withAnalyst(two, uuid(3), true), "tooMany", "24 foreign + 3rd analyst");
  });

  test("does not mutate its input (frozen array)", () => {
    const L = Object.freeze(["team", "an:a;b", "an:c"]);
    withAnalyst(L, "d", true);
    withAnalyst(L, "a", false);
    assert.deepEqual(L, ["team", "an:a;b", "an:c"]);
  });
});

// ── sameLabels (spec update: order-insensitive multiset equality) ──────────────
describe("sameLabels", () => {
  test("null/undefined are treated as []", () => {
    assert.equal(sameLabels(null, []), true);
    assert.equal(sameLabels(undefined, null), true);
    assert.equal(sameLabels([], undefined), true);
    assert.equal(sameLabels(null, ["a"]), false);
    assert.equal(sameLabels(["a"], undefined), false);
  });

  test("same labels in any order → true", () => {
    assert.equal(sameLabels(["a", "b"], ["a", "b"]), true);
    assert.equal(sameLabels(["b", "a"], ["a", "b"]), true);
    assert.equal(sameLabels(["team", "an:a;b", "env"], ["an:a;b", "env", "team"]), true);
  });

  test("multiplicity matters (multiset, not set)", () => {
    assert.equal(sameLabels(["a", "a"], ["a"]), false);
    assert.equal(sameLabels(["a"], ["a", "a"]), false);
    assert.equal(sameLabels(["a", "a", "b"], ["a", "b", "b"]), false);
    assert.equal(sameLabels(["a", "a", "b"], ["b", "a", "a"]), true);
  });

  test("different labels → false; comparison is exact (case, whitespace)", () => {
    assert.equal(sameLabels(["a"], ["b"]), false);
    assert.equal(sameLabels(["a", "b"], ["a", "c"]), false);
    assert.equal(sameLabels(["A"], ["a"]), false);
    assert.equal(sameLabels(["a "], ["a"]), false);
  });

  test("no concatenation collisions", () => {
    assert.equal(sameLabels(["a,b", "c"], ["a", "b,c"]), false);
    assert.equal(sameLabels(["a;b", "c"], ["a", "b;c"]), false);
    assert.equal(sameLabels(["a\nb", "c"], ["a", "b\nc"]), false);
    assert.equal(sameLabels(["ab", ""], ["a", "b"]), false);
  });

  test("compares sorted COPIES: inputs are neither reordered nor mutated", () => {
    const a = ["c", "a", "b"];
    const b = ["b", "c", "a"];
    assert.equal(sameLabels(a, b), true);
    assert.deepEqual(a, ["c", "a", "b"]);
    assert.deepEqual(b, ["b", "c", "a"]);
    assert.equal(sameLabels(Object.freeze(["y", "x"]), Object.freeze(["x", "y"])), true);
  });

  test("labels produced by writeAnalysts equal their server-sorted copy", () => {
    const L = writeAnalysts(["zeta", "alpha"], uuids(7));
    assert.equal(sameLabels(L, serverSort(L)), true);
    assert.equal(sameLabels(L, serverSort(L).slice(1)), false);
  });
});

// ── spec update: never duplicate labels ────────────────────────────────────────
const FOREIGN_POOL = ["team:noc", "env:prod", "Zeta", "alpha", "AN:caps", "an", "an;x", "x;y", "ñandú", "", " spaced ", "key:a,b"];
const ID_POOL = [...uuids(40, 500), "A", "b", "ABC", "abc", "x-1", "Z9"];
const MALFORMED = ["bad id", "x:y", "under_score", "z".repeat(37)];

/** Random label array for the fuzz: foreign labels + messy analyst labels (random packing 1–3 ids,
 *  duplicated analyst labels, sometimes malformed ids), in random order. */
function randomLabels(r: () => number, distinctForeign: boolean) {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const k = Math.floor(r() * 8);
  let foreign: string[];
  if (distinctForeign) {
    foreign = [...FOREIGN_POOL].sort(() => r() - 0.5).slice(0, k);
  } else {
    foreign = Array.from({ length: k }, () => pick(FOREIGN_POOL));
    if (foreign.length) foreign.push(pick(foreign)); // at least one duplicated foreign label
  }
  const existingIds: string[] = [];
  const anLabels: string[] = [];
  for (let n = Math.floor(r() * 8); n > 0; n--) {
    const parts = Array.from({ length: 1 + Math.floor(r() * 3) }, () => (r() < 0.1 ? pick(MALFORMED) : pick(ID_POOL)));
    existingIds.push(...parts);
    anLabels.push(`an:${parts.join(";")}`);
    if (r() < 0.2) anLabels.push(anLabels[anLabels.length - 1]); // duplicated analyst label
  }
  const labels = [...foreign, ...anLabels].sort(() => r() - 0.5);
  return { foreign, labels, validExisting: norm(existingIds).filter((id) => ID_RE.test(id)), pick };
}

describe("no duplicate labels (spec update)", () => {
  const CASES = [["d", true], ["a", true], ["a", false], ["zz", false]] as const;
  const expectedSet = (base: string[], uid: string, on: boolean) => (on ? asSet([...base, uid]) : asSet(base.filter((x) => x !== uid)));

  test("writeAnalysts: duplicate ids and duplicate analyst labels never yield duplicate labels", () => {
    const out = writeAnalysts(["x", "an:a;b", "an:a;b", "an:c", ""], ["a", "a", " a ", "b", "c", "c", "b "]);
    assert.deepEqual(foreignOf(out), ["x", ""]);
    assert.deepEqual(readAnalysts(out), ["a", "b", "c"]);
    assertWellFormed(out);
  });

  test("writeAnalysts: duplicate FOREIGN labels collapse (no duplicate in the result)", () => {
    const out = writeAnalysts(["dup", "x", "dup", "x", "", ""], ["a"]);
    assert.deepEqual(readAnalysts(out), ["a"]);
    assert.deepEqual(asSet(foreignOf(out)), ["", "dup", "x"]);
    assert.equal(new Set(out).size, out.length, `duplicate labels in ${show(out)}`);
  });

  test("withAnalyst: duplicate analyst labels in the input never yield duplicate labels (add and remove)", () => {
    const L = ["team", "an:a;b", "an:a;b", "an:c", "an:c"];
    for (const [uid, on] of CASES) {
      const out = withAnalyst(L, uid, on);
      assert.deepEqual(foreignOf(out), ["team"]);
      assert.deepEqual(asSet(readAnalysts(out)), expectedSet(["a", "b", "c"], uid, on), `withAnalyst(${uid}, ${on})`);
      assertWellFormed(out, `withAnalyst(${uid}, ${on})`);
    }
  });

  test("withAnalyst: duplicate FOREIGN labels in the input collapse (add and remove)", () => {
    const L = ["dup", "dup", "an:a;b", "team", "an:c", "team"];
    const v: string[] = [];
    for (const [uid, on] of CASES) {
      const out = withAnalyst(L, uid, on);
      assert.deepEqual(asSet(foreignOf(out)), ["dup", "team"]);
      assert.deepEqual(asSet(readAnalysts(out)), expectedSet(["a", "b", "c"], uid, on), `withAnalyst(${uid}, ${on})`);
      if (new Set(out).size !== out.length) v.push(`withAnalyst(L, ${uid}, ${on}) → ${show(out)}`);
    }
    assert.deepEqual(v, [], `input ${show(L)}`);
  });

  test("fuzz A (400 seeds, distinct foreign labels; messy ids/analyst labels): well-formed, no duplicates, right sets, server-sorted round-trip", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = mulberry32(seed);
      const { foreign, labels, validExisting, pick } = randomLabels(r, true);
      const cap = (25 - foreign.length) * 2;
      const ctx = `seed=${seed} labels=${show(labels)}`;

      const wantIds = norm(Array.from({ length: Math.floor(r() * Math.min(cap, 30)) }, () => pick(ID_POOL))).slice(0, cap - 1);
      const noisy = wantIds.flatMap((id) => (r() < 0.3 ? [id, ` ${id} `] : [id]));
      const written = writeAnalysts(labels, noisy);
      assertWellFormed(written, `write ${ctx}`);
      assert.deepEqual(readAnalysts(written), wantIds, `write ${ctx}`);
      assert.deepEqual(foreignOf(written), foreignOf(labels), `write ${ctx}`);
      assert.deepEqual(asSet(readAnalysts(serverSort(written))), asSet(wantIds), `server-sorted ${ctx}`);

      const uid = r() < 0.5 && validExisting.length ? pick(validExisting) : pick(ID_POOL);
      const on = r() < 0.5;
      const expected = on ? asSet([...validExisting, uid]) : asSet(validExisting.filter((x) => x !== uid));
      if (foreign.length + Math.ceil(expected.length / 2) > 25) continue;
      for (const [name, input] of [["raw", labels], ["server-sorted", serverSort(written)]] as const) {
        const base = name === "raw" ? expected : on ? asSet([...wantIds, uid]) : asSet(wantIds.filter((x) => x !== uid));
        const out = withAnalyst(input, uid, on);
        const what = `with(${uid},${on}) on ${name} ${ctx}`;
        assertWellFormed(out, what);
        assert.deepEqual(asSet(readAnalysts(out)), base, what);
        assert.deepEqual(asSet(foreignOf(out)), asSet(foreign), what);
      }
    }
  });

  test("fuzz B (400 seeds, DUPLICATED foreign labels): writeAnalysts/withAnalyst never return duplicate labels", () => {
    const v: string[] = [];
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = mulberry32(seed);
      const { foreign, labels, validExisting, pick } = randomLabels(r, false);
      if (!foreign.length) continue;
      const ids = norm(Array.from({ length: Math.floor(r() * 10) }, () => pick(ID_POOL)));
      const written = writeAnalysts(labels, ids);
      checked++;
      if (new Set(written).size !== written.length) v.push(`seed=${seed} writeAnalysts(${show(labels)}) → ${show(written)}`);
      const uid = validExisting.length && r() < 0.5 ? pick(validExisting) : pick(ID_POOL);
      const on = r() < 0.5;
      const out = withAnalyst(labels, uid, on);
      if (new Set(out).size !== out.length) v.push(`seed=${seed} withAnalyst(${show(labels)}, ${uid}, ${on}) → ${show(out)}`);
    }
    assert.ok(checked > 300, `only ${checked} seeds exercised`);
    assert.equal(v.length, 0, `${v.length} results with duplicate labels over ${checked} seeds; first ones:\n${v.slice(0, 2).join("\n")}`);
  });
});

// ── spec update: the server returns labels sorted ──────────────────────────────
describe("server returns labels sorted (spec update)", () => {
  test("readAnalysts(serverSort(writeAnalysts(L, ids))) yields the same SET of ids, without loss or duplicates", () => {
    const foreignSets = [[], ["team:noc"], ["zz", "AA", "an;x", "key:a,b"], Array.from({ length: 20 }, (_, i) => `t${i}`)];
    for (const foreign of foreignSets) {
      const cap = (25 - foreign.length) * 2;
      for (const n of [0, 1, 2, 3, Math.floor(cap / 2), cap - 1, cap]) {
        const ids = uuids(n, 200).map((s, i) => (i % 3 === 0 ? s.toUpperCase() : s));
        const back = readAnalysts(serverSort(writeAnalysts(foreign, ids)));
        assert.equal(back.length, ids.length, `foreign=${foreign.length}, n=${n}`);
        assert.deepEqual(asSet(back), asSet(ids), `foreign=${foreign.length}, n=${n}`);
      }
    }
  });

  test("withAnalyst on the server-sorted array gives the same id set (and foreign labels) as on the written array", () => {
    const foreign = ["zeta", "team:noc", "Alpha"];
    const ids = [...uuids(7, 30), "B-2", "a-1"];
    const L = writeAnalysts(foreign, ids);
    const S = serverSort(L);
    for (const uid of [ids[0], ids[3], ids[8], "new-id-1", "NEW-ID-2"]) {
      for (const on of [true, false]) {
        const fromL = withAnalyst(L, uid, on);
        const fromS = withAnalyst(S, uid, on);
        const what = `withAnalyst(sorted, ${uid}, ${on})`;
        assertWellFormed(fromS, what);
        const expected = on ? asSet([...ids, uid]) : asSet(ids.filter((x) => x !== uid));
        assert.deepEqual(asSet(readAnalysts(fromS)), expected, what);
        assert.deepEqual(asSet(readAnalysts(fromS)), asSet(readAnalysts(fromL)), what);
        assert.deepEqual(asSet(foreignOf(fromS)), asSet(foreign), what);
      }
    }
  });

  test("full cycle: write → server sort → add/remove → server sort → read keeps the expected set", () => {
    let server = serverSort(writeAnalysts(["team"], uuids(5, 70)));
    const want = new Set(uuids(5, 70));
    const steps: [string, boolean][] = [[uuid(70), false], ["NEW-1", true], [uuid(72), false], ["new-2", true], ["NEW-1", true]];
    for (const [uid, on] of steps) {
      server = serverSort(withAnalyst(server, uid, on));
      if (on) want.add(uid);
      else want.delete(uid);
      assertWellFormed(server, `after ${uid}/${on}`);
      assert.deepEqual(asSet(readAnalysts(server)), [...want].sort(), `after ${uid}/${on}`);
      assert.deepEqual(foreignOf(server), ["team"]);
    }
  });

  test("(derived: idempotency under the new label equality) re-adding a present analyst / removing an absent one on server-sorted labels leaves them sameLabels-equal", () => {
    const cases: { foreign: string[]; ids: string[] }[] = [
      { foreign: [], ids: ["b", "c", "a"] }, // odd count: the single-id label sorts first on the server
      { foreign: ["team"], ids: uuids(5, 7) },
      { foreign: ["zz", "aa"], ids: uuids(3, 20).map((s) => s.toUpperCase()) },
      { foreign: [], ids: uuids(4) },
      { foreign: ["team"], ids: uuids(6, 40) },
      { foreign: [], ids: uuids(1) },
    ];
    const v: string[] = [];
    for (const { foreign, ids } of cases) {
      const S = serverSort(writeAnalysts(foreign, ids));
      for (const present of ids) {
        const out = withAnalyst(S, present, true);
        if (!sameLabels(out, S)) v.push(`n=${ids.length} re-add ${present}: ${show(S)} → ${show(out)}`);
      }
      const out2 = withAnalyst(S, "not-there", false);
      if (!sameLabels(out2, S)) v.push(`n=${ids.length} remove absent: ${show(S)} → ${show(out2)}`);
    }
    assert.equal(v.length, 0, `${v.length} no-op calls changed the label multiset:\n${v.join("\n")}`);
  });
});
