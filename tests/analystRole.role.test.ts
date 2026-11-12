// Spec-driven tests for role resolution in analystRole.ts (spec §2).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hasWriteAccess, resolveRole, isReadOnlyRole } from "../ui/app/components/analystRole.ts";

const ME = "0f1e2d3c-4b5a-4968-8776-655443322110";
const OTHER = "11111111-2222-4333-8444-555555555555";
const RW = ["read", "write"];

describe("hasWriteAccess", () => {
  test("access that is not an array → true", () => {
    const values: unknown[] = [undefined, null, "write", "read", {}, 0, { includes: () => false }];
    for (const v of values) assert.equal(hasWriteAccess(v), true, `access=${String(v)}`);
  });

  test("array that includes 'write' → true", () => {
    assert.equal(hasWriteAccess(["write"]), true);
    assert.equal(hasWriteAccess(["read", "write"]), true);
    assert.equal(hasWriteAccess(["read", "delete", "write", "share"]), true);
  });

  test("array without exactly 'write' → false", () => {
    for (const a of [[], ["read"], ["read", "delete", "share"], ["WRITE"], ["write "], ["writer"]]) {
      assert.equal(hasWriteAccess(a), false, `access=${JSON.stringify(a)}`);
    }
  });
});

describe("resolveRole", () => {
  test("no write access → viewer (even for the owner, even when labeled as analyst)", () => {
    assert.equal(resolveRole({ access: ["read"], owner: ME, labels: [`an:${ME}`] }, ME), "viewer");
    assert.equal(resolveRole({ access: ["read"], owner: OTHER, labels: [`an:${ME}`] }, ME), "viewer");
    assert.equal(resolveRole({ access: [], owner: OTHER }, ME), "viewer");
  });

  test("write + owner === me → owner; the owner is never analyst even if labeled", () => {
    assert.equal(resolveRole({ access: RW, owner: ME }, ME), "owner");
    assert.equal(resolveRole({ access: RW, owner: ME, labels: [`an:${ME}`] }, ME), "owner");
    assert.equal(resolveRole({ access: RW, owner: ME, labels: [`an:${OTHER};${ME}`] }, ME), "owner");
  });

  test("access missing (not an array) counts as write", () => {
    assert.equal(resolveRole({ owner: ME }, ME), "owner");
    assert.equal(resolveRole({ access: null, owner: OTHER, labels: [`an:${ME}`] }, ME), "analyst");
    assert.equal(resolveRole({ access: undefined, owner: OTHER }, ME), "editor");
  });

  test("write, not owner, me listed in the analyst labels → analyst (either slot of a packed label)", () => {
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`an:${ME}`] }, ME), "analyst");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: ["team", `an:${OTHER};${ME}`] }, ME), "analyst");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`an:${ME};${OTHER}`, "env"] }, ME), "analyst");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`an: ${ME} `] }, ME), "analyst", "label ids are trimmed by readAnalysts");
  });

  test("write, not owner, not listed → editor", () => {
    assert.equal(resolveRole({ access: RW, owner: OTHER }, ME), "editor");
    assert.equal(resolveRole({ access: ["write"], owner: OTHER, labels: null }, ME), "editor");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: ["team", `an:${OTHER}`] }, ME), "editor");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`team:${ME}`, `x-an:${ME}`] }, ME), "editor");
  });

  test("empty / undefined / null me → never owner nor analyst", () => {
    assert.equal(resolveRole({ access: RW, owner: "" }, ""), "editor");
    assert.equal(resolveRole({ access: RW, owner: undefined }, undefined), "editor");
    assert.equal(resolveRole({ access: RW, owner: null }, null), "editor");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: ["an:", "an: ;", "an:;;"] }, ""), "editor");
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`an:${OTHER}`] }, undefined), "editor");
    assert.equal(resolveRole({ access: ["read"], owner: "" }, ""), "viewer");
  });

  test("ids are compared exactly (case-sensitive)", () => {
    const upper = ME.toUpperCase();
    assert.equal(resolveRole({ access: RW, owner: OTHER, labels: [`an:${ME}`] }, upper), "editor");
    assert.equal(resolveRole({ access: RW, owner: ME }, upper), "editor");
  });
});

describe("isReadOnlyRole", () => {
  test("viewer and analyst are read-only; owner and editor are not", () => {
    assert.equal(isReadOnlyRole("viewer"), true);
    assert.equal(isReadOnlyRole("analyst"), true);
    assert.equal(isReadOnlyRole("owner"), false);
    assert.equal(isReadOnlyRole("editor"), false);
  });
});
