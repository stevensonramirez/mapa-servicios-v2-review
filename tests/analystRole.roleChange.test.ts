// Spec-driven tests for role changes in analystRole.ts (spec §3): effectiveLevel, LEVEL_RANK,
// planRoleChange and runRoleChange, including the REQUIRED exhaustive property test over
// 8 initial ShareStates × 4 targets × every failure pattern (each step fails or succeeds).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_RANK, effectiveLevel, planRoleChange, runRoleChange } from "../ui/app/components/analystRole.ts";
import type { ShareState, ShareLevel, RoleOp, RoleStep, RoleOps, RoleChangeResult } from "../ui/app/components/analystRole.ts";

// ── reference model, straight from the spec (deliberately not the module's own helpers) ──
const RANK: Record<ShareLevel, number> = { none: 0, viewer: 1, analyst: 2, editor: 3 };
const refLevel = (s: ShareState): ShareLevel =>
  s.inWrite && s.labeled ? "analyst" : s.inWrite ? "editor" : s.inRead ? "viewer" : "none";
const CLEAN: Record<ShareLevel, ShareState> = {
  none: { inRead: false, inWrite: false, labeled: false },
  viewer: { inRead: true, inWrite: false, labeled: false },
  analyst: { inRead: false, inWrite: true, labeled: true },
  editor: { inRead: false, inWrite: true, labeled: false },
};
/** Each op sets one boolean. */
const EFFECT: Record<RoleOp, [keyof ShareState, boolean]> = {
  addLabel: ["labeled", true],
  removeLabel: ["labeled", false],
  grantRead: ["inRead", true],
  removeRead: ["inRead", false],
  grantWrite: ["inWrite", true],
  removeWrite: ["inWrite", false],
};
const OPS = Object.keys(EFFECT) as RoleOp[];
const apply = (s: ShareState, op: RoleOp) => {
  const [field, value] = EFFECT[op];
  s[field] = value;
};
const TARGETS: ShareLevel[] = ["none", "viewer", "analyst", "editor"];
const STATES: ShareState[] = [];
for (let b = 0; b < 8; b++) STATES.push({ inRead: !!(b & 1), inWrite: !!(b & 2), labeled: !!(b & 4) });

const fmt = (s: ShareState) => `{inRead:${s.inRead ? "T" : "F"} inWrite:${s.inWrite ? "T" : "F"} labeled:${s.labeled ? "T" : "F"}}`;
const fmtPlan = (p: readonly RoleStep[]) => p.map((s) => `${s.op}${s.must ? "(must)" : "(opt)"}`).join(" → ") || "(no steps)";
const failingIdx = (mask: number, len: number) => Array.from({ length: len }, (_, i) => i).filter((i) => mask & (1 << i));

// ── simulation harness: a fake ops object that mutates a ShareState ─────────────
type Run = {
  mask: number;
  calls: RoleOp[];
  result: RoleChangeResult;
  final: ShareState;
  rankViolations: string[];
  thrown: Map<number, Error>;
};
type Combo = { s0: ShareState; to: ShareLevel; plan: RoleStep[]; runs: Run[] };

async function simulate(s0: ShareState, to: ShareLevel, plan: readonly RoleStep[], mask: number): Promise<Run> {
  const st: ShareState = { ...s0 };
  const bound = Math.max(RANK[refLevel(s0)], RANK[to]);
  const calls: RoleOp[] = [];
  const rankViolations: string[] = [];
  const thrown = new Map<number, Error>();
  const make = (op: RoleOp) => async () => {
    const i = calls.length; // i-th executed step
    calls.push(op);
    await Promise.resolve(); // be genuinely asynchronous
    const fail = (mask & (1 << i)) !== 0;
    if (!fail) apply(st, op);
    const lvl = refLevel(st);
    if (RANK[lvl] > bound) {
      rankViolations.push(`after step #${i} ${op}${fail ? " (failed)" : ""}: level ${lvl} (rank ${RANK[lvl]}) > allowed rank ${bound}, state ${fmt(st)}`);
    }
    if (fail) {
      const e = new Error(`injected failure of step #${i} (${op})`);
      thrown.set(i, e);
      throw e;
    }
  };
  const ops = {} as RoleOps;
  for (const op of OPS) ops[op] = make(op);
  const result = await runRoleChange(plan, ops);
  return { mask, calls, result, final: { ...st }, rankViolations, thrown };
}

const cache = new Map<string, Promise<Combo>>();
function combo(s0: ShareState, to: ShareLevel): Promise<Combo> {
  const key = `${fmt(s0)}>${to}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const plan = planRoleChange({ ...s0 }, to);
      assert.ok(Array.isArray(plan), "planRoleChange must return an array");
      assert.ok(plan.length <= 12, `implausibly long plan: ${fmtPlan(plan)}`);
      const runs: Run[] = [];
      for (let mask = 0; mask < 1 << plan.length; mask++) runs.push(await simulate(s0, to, plan, mask));
      return { s0, to, plan, runs };
    })();
    cache.set(key, p);
  }
  return p;
}
const firstMustFailure = (plan: readonly RoleStep[], mask: number) => plan.findIndex((s, i) => s.must && (mask & (1 << i)) !== 0);
const where = (c: Combo, r: Run) => `fail=[${failingIdx(r.mask, c.plan.length).join(",")}]`;

// ── effectiveLevel / LEVEL_RANK ───────────────────────────────────────────────
describe("effectiveLevel & LEVEL_RANK", () => {
  test("LEVEL_RANK = none 0, viewer 1, analyst 2, editor 3", () => {
    assert.deepEqual({ ...LEVEL_RANK }, { none: 0, viewer: 1, analyst: 2, editor: 3 });
  });
  for (const s of STATES) {
    test(`effectiveLevel(${fmt(s)}) = ${refLevel(s)}`, () => {
      assert.equal(effectiveLevel(s), refLevel(s));
    });
  }
});

// ── planRoleChange: shape ─────────────────────────────────────────────────────
describe("planRoleChange — shape", () => {
  test("every step is {op: one of the six ops, must: boolean}, for all 32 transitions", () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        const plan = planRoleChange({ ...s0 }, to);
        for (const step of plan) {
          assert.ok(OPS.includes(step.op), `${fmt(s0)} → ${to}: unknown op ${String(step.op)}`);
          assert.equal(typeof step.must, "boolean", `${fmt(s0)} → ${to}: must must be boolean`);
        }
      }
    }
  });

  test("does not mutate the current state", () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        const frozen = Object.freeze({ ...s0 });
        planRoleChange(frozen, to);
        assert.deepEqual(frozen, s0);
      }
    }
  });

  test("(derived from (b)+(e)) already in the clean target state → no steps", () => {
    for (const to of TARGETS) {
      const plan = planRoleChange({ ...CLEAN[to] }, to);
      assert.deepEqual(plan, [], `${fmt(CLEAN[to])} → ${to}: ${fmtPlan(plan)}`);
    }
  });
});

// ── the required exhaustive property test ─────────────────────────────────────
const INV = {
  a: "(a) after every executed step: rank(level) ≤ max(rank(initial), rank(target))",
  b: "(b) no step fails → target reached, in the clean state",
  c: "(c) only non-must steps fail → target level reached",
  d: "(d) a must step fails → ok:false with that op (and its error); no later step ran",
  e: "(e) the plan contains no no-op operations",
  r: "runRoleChange bookkeeping: steps run in plan order; skipped = failed non-must ops; ok:true iff no must step failed",
};

describe("exhaustive: 8 initial states × 4 targets × every failure pattern", () => {
  describe(INV.a, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const v = c.runs.flatMap((r) => r.rankViolations.map((m) => `${where(c, r)}: ${m}`));
          assert.deepEqual(v, [], `plan: ${fmtPlan(c.plan)}`);
        });
      }
    }
  });

  describe(INV.b, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const r = c.runs[0]; // mask 0: nothing fails
          const msg = `plan: ${fmtPlan(c.plan)}; final ${fmt(r.final)}`;
          assert.equal(r.result.ok, true, msg);
          assert.equal(refLevel(r.final), to, msg);
          assert.deepEqual(r.final, CLEAN[to], msg);
        });
      }
    }
  });

  describe(INV.c, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const v: string[] = [];
          for (const r of c.runs) {
            if (r.mask === 0 || firstMustFailure(c.plan, r.mask) >= 0) continue;
            const lvl = refLevel(r.final);
            if (lvl !== to) v.push(`${where(c, r)}: final level ${lvl} ${fmt(r.final)} ≠ ${to}`);
          }
          assert.deepEqual(v, [], `plan: ${fmtPlan(c.plan)}`);
        });
      }
    }
  });

  describe(INV.d, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const v: string[] = [];
          for (const r of c.runs) {
            const j = firstMustFailure(c.plan, r.mask);
            if (j < 0) continue;
            const res = r.result as { ok: boolean; failedOp?: RoleOp; error?: unknown };
            if (res.ok !== false) v.push(`${where(c, r)}: expected ok:false, got ok:${String(res.ok)}`);
            else {
              if (res.failedOp !== c.plan[j].op) v.push(`${where(c, r)}: failedOp ${String(res.failedOp)} ≠ ${c.plan[j].op}`);
              if (res.error !== r.thrown.get(j)) v.push(`${where(c, r)}: error is not the error thrown by step #${j}`);
            }
            const expectedCalls = c.plan.slice(0, j + 1).map((s) => s.op);
            if (JSON.stringify(r.calls) !== JSON.stringify(expectedCalls)) {
              v.push(`${where(c, r)}: ran [${r.calls.join(",")}], expected exactly [${expectedCalls.join(",")}]`);
            }
          }
          assert.deepEqual(v, [], `plan: ${fmtPlan(c.plan)}`);
        });
      }
    }
  });

  describe(INV.e, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const st = { ...s0 };
          const v: string[] = [];
          c.plan.forEach((step, i) => {
            const [field, value] = EFFECT[step.op];
            if (st[field] === value) v.push(`step #${i} ${step.op} is a no-op (${field} is already ${value})`);
            apply(st, step.op);
          });
          assert.deepEqual(v, [], `plan: ${fmtPlan(c.plan)}`);
        });
      }
    }
  });

  describe(INV.r, () => {
    for (const s0 of STATES) {
      for (const to of TARGETS) {
        test(`${fmt(s0)} → ${to}`, async () => {
          const c = await combo(s0, to);
          const v: string[] = [];
          for (const r of c.runs) {
            const j = firstMustFailure(c.plan, r.mask);
            const ran = j < 0 ? c.plan : c.plan.slice(0, j + 1);
            if (JSON.stringify(r.calls) !== JSON.stringify(ran.map((s) => s.op))) {
              v.push(`${where(c, r)}: ran [${r.calls.join(",")}], expected [${ran.map((s) => s.op).join(",")}]`);
            }
            const expectedSkipped = ran.filter((_, i) => i !== j && (r.mask & (1 << i)) !== 0).map((s) => s.op);
            if (r.result.ok !== (j < 0)) v.push(`${where(c, r)}: ok=${String(r.result.ok)}, expected ${String(j < 0)}`);
            if (JSON.stringify(r.result.skipped) !== JSON.stringify(expectedSkipped)) {
              v.push(`${where(c, r)}: skipped ${JSON.stringify(r.result.skipped)} ≠ ${JSON.stringify(expectedSkipped)}`);
            }
          }
          assert.deepEqual(v, [], `plan: ${fmtPlan(c.plan)}`);
        });
      }
    }
  });
});

// ── runRoleChange: unit tests with hand-made steps ─────────────────────────────
describe("runRoleChange — unit", () => {
  const recorder = (failing: Partial<Record<RoleOp, unknown>> = {}) => {
    const calls: RoleOp[] = [];
    const ops = {} as RoleOps;
    for (const op of OPS) {
      ops[op] = async () => {
        calls.push(op);
        if (op in failing) throw failing[op];
      };
    }
    return { calls, ops };
  };

  test("no steps → {ok:true, skipped:[]}", async () => {
    const { calls, ops } = recorder();
    const res = await runRoleChange([], ops);
    assert.equal(res.ok, true);
    assert.deepEqual(res.skipped, []);
    assert.deepEqual(calls, []);
  });

  test("all steps succeed → ok:true, skipped [], every op run once, in order", async () => {
    const { calls, ops } = recorder();
    const steps: RoleStep[] = [
      { op: "addLabel", must: true },
      { op: "grantWrite", must: true },
      { op: "removeRead", must: false },
    ];
    const res = await runRoleChange(steps, ops);
    assert.equal(res.ok, true);
    assert.deepEqual(res.skipped, []);
    assert.deepEqual(calls, ["addLabel", "grantWrite", "removeRead"]);
  });

  test("failing non-must steps are recorded in skipped (in order) and execution continues", async () => {
    const { calls, ops } = recorder({ removeRead: new Error("r"), removeLabel: new Error("l") });
    const steps: RoleStep[] = [
      { op: "removeRead", must: false },
      { op: "grantWrite", must: true },
      { op: "removeLabel", must: false },
    ];
    const res = await runRoleChange(steps, ops);
    assert.equal(res.ok, true);
    assert.deepEqual(res.skipped, ["removeRead", "removeLabel"]);
    assert.deepEqual(calls, ["removeRead", "grantWrite", "removeLabel"]);
  });

  test("a failing must step stops: ok:false, failedOp, the thrown error, skipped so far; later steps never run", async () => {
    const boom = { status: 500, reason: "IAM down" };
    const { calls, ops } = recorder({ removeRead: new Error("opt"), grantWrite: boom });
    const steps: RoleStep[] = [
      { op: "removeRead", must: false },
      { op: "grantWrite", must: true },
      { op: "removeLabel", must: true },
      { op: "grantRead", must: false },
    ];
    const res = await runRoleChange(steps, ops);
    assert.equal(res.ok, false);
    if (res.ok === false) {
      assert.equal(res.failedOp, "grantWrite");
      assert.equal(res.error, boom);
      assert.deepEqual(res.skipped, ["removeRead"]);
    }
    assert.deepEqual(calls, ["removeRead", "grantWrite"]);
  });

  test("steps run sequentially: each starts only after the previous one settled", async () => {
    const log: string[] = [];
    const delay: Partial<Record<RoleOp, number>> = { grantRead: 25, grantWrite: 0, removeLabel: 10 };
    const ops = {} as RoleOps;
    for (const op of OPS) {
      ops[op] = () =>
        new Promise<void>((resolve, reject) => {
          log.push(`start:${op}`);
          setTimeout(() => {
            log.push(`end:${op}`);
            if (op === "removeLabel") reject(new Error("optional cleanup failed"));
            else resolve();
          }, delay[op] ?? 0);
        });
    }
    const res = await runRoleChange(
      [
        { op: "grantRead", must: true },
        { op: "removeLabel", must: false },
        { op: "grantWrite", must: true },
      ],
      ops,
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.skipped, ["removeLabel"]);
    assert.deepEqual(log, ["start:grantRead", "end:grantRead", "start:removeLabel", "end:removeLabel", "start:grantWrite", "end:grantWrite"]);
  });
});
