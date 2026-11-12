// Paridad de Compartir: con el rol Analista, los roles que ya existían (Solo
// lectura, Edición, Quitar acceso) deben hacer LAS MISMAS llamadas de antes.
// Antes (v0.10.70):
//   • Solo lectura → grant(read) y luego quitar del cubo de edición (obligatorio).
//   • Edición      → grant(read-write) y luego quitar del cubo de lectura (limpieza).
//   • Quitar       → quitar de los dos cubos (ambos obligatorios). Ahora va primero
//                    el de EDICIÓN (cambio intencional: lo más sensible primero).
// Lo único nuevo para ellos: quitar la label de analista SI la persona la tiene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRoleChange, shareStartState } from "../ui/app/components/analystRole.ts";
import type { ShareLevel } from "../ui/app/components/analystRole.ts";

const plan = (to: ShareLevel, labeled: boolean) =>
  planRoleChange(shareStartState(to, labeled), to).map((s) => `${s.op}${s.must ? "!" : "~"}`);

test("Solo lectura (sin label): mismas llamadas de antes", () => {
  assert.deepEqual(plan("viewer", false), ["grantRead!", "removeWrite!"]);
});

test("Edición (sin label): mismas llamadas de antes", () => {
  assert.deepEqual(plan("editor", false), ["grantWrite!", "removeRead~"]);
});

test("Quitar acceso (sin label): los dos cubos, obligatorios", () => {
  assert.deepEqual(plan("none", false), ["removeWrite!", "removeRead!"]);
});

test("Con label de analista: se agrega SOLO quitar la label", () => {
  assert.deepEqual(plan("viewer", true), ["grantRead!", "removeWrite!", "removeLabel~"]);
  // A Edición la label se quita PRIMERO y es obligatoria: si fallara, la persona
  // queda como Analista (más restringida), nunca con más permisos.
  assert.deepEqual(plan("editor", true), ["removeLabel!", "grantWrite!", "removeRead~"]);
  assert.deepEqual(plan("none", true), ["removeWrite!", "removeRead!", "removeLabel~"]);
});

test("Analista: primero la label, después el permiso", () => {
  assert.deepEqual(plan("analyst", false), ["addLabel!", "grantWrite!", "removeRead~"]);
  assert.deepEqual(plan("analyst", true), ["grantWrite!", "removeRead~"]);
});
