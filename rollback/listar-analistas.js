// Lista los mapas que tienen ANALISTAS (labels «an:<sso>;<sso>»). SOLO LECTURA.
// Uso: pegar en la consola del navegador en una página del tenant
// (https://lqy04258.apps.dynatrace.com/…), con la sesión iniciada.
// Cambiar ADMIN a true para ver TODOS los mapas del tenant (usa admin-access:
// requiere document:documents:admin). Con false, solo los que la persona ve.
(async (ADMIN = false) => {
  const base = "/platform/document/v1/documents";
  const filter = "type == 'mapa-servicios-v2' or type == 'mapa-servicios-v2.parent'";
  const out = [];
  let pageKey;
  do {
    const q = new URLSearchParams(pageKey ? { "page-key": pageKey } : { filter, "add-fields": "labels", "page-size": "1000" });
    if (ADMIN) q.set("admin-access", "true");
    const r = await fetch(`${base}?${q}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    for (const d of j.documents ?? []) {
      const ids = (d.labels ?? [])
        .filter((l) => l.startsWith("an:"))
        .flatMap((l) => l.slice(3).split(";"))
        .filter(Boolean);
      if (ids.length) out.push({ mapa: d.name, id: d.id, dueño: d.owner, analistas: ids.join(", ") });
    }
    pageKey = j.nextPageKey;
  } while (pageKey);
  console.table(out);
  return out;
})();
