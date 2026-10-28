# Rollback — rol «Analista» (v0.9.x)

| Situación | Qué hacer |
|---|---|
| Falla algo **solo del rol Analista** (asignarlo en Compartir, guardar su análisis) | **Nivel 1:** `./rollback/apagar-analista.sh <versión>` |
| La app falla **para todos** | **Nivel 2:** `./rollback/volver-v087.sh <versión>` |

- `<versión>` debe ser **mayor que la instalada** (ver `"version"` en `app.config.json`; si está `0.9.1`, usar `0.9.2`).
- Los dos scripts se pueden **ensayar** con `--probar` al final: compilan y dejan todo como estaba, sin publicar nada.
- Corren en esta carpeta, porque aquí está la sesión de `dt-app`. Hacen commit, pero **no** push.

## Nivel 1: apagar la opción
Vuelve al estado de la v0.9.0: nadie puede asignar analistas nuevos. Los que ya existen siguen protegidos (solo lectura + causa raíz).

## Nivel 2: volver al código de la v0.8.7
La v0.8.7 no entiende las labels de analista, así que vería a los analistas como **editores**. Por eso, antes de publicar:

1. **Listar los mapas con analistas.**
   - Pegar `rollback/listar-analistas.js` en la consola del navegador, en una página del tenant con la sesión iniciada.
   - Con `ADMIN = true` ve todos los mapas (requiere permiso de admin de documentos); si no, solo los que ve la persona.
2. **Pasar a esas personas a «Solo lectura».** Lo hace el dueño de cada mapa, desde Compartir (en la v0.9.x salen como «Analista»).
   - Si la app está caída para todos: publicar primero (paso 3) y hacer este paso después; en la v0.8.7 salen como «Edición».
3. **Publicar:** `./rollback/volver-v087.sh <versión>`.

## Después de cualquier nivel
- `git push`.
- Verificar: abrir la app, confirmar la versión (`_dt_appVersion` en el iframe) y abrir un mapa.
- Las labels `an:` pueden quedarse. La v0.8.7 las ignora; si se vuelve a la versión nueva, quien tenga label pero solo lectura queda como lector.
