#!/bin/bash
# Rollback NIVEL 2: volver a publicar el código de la v0.8.7 (commit 96d20b5, la
# última sin el rol Analista) con una versión NUEVA (AppEngine pide una versión
# mayor que la instalada). Corre en ESTA carpeta: aquí vive la sesión de dt-app.
#
# ANTES (si la app sigue funcionando): pasar a «Solo lectura» a los analistas
# (ver README.md). La v0.8.7 no entiende las labels y los vería como editores.
#
#   ./rollback/volver-v087.sh 0.9.3            → publica en prod y hace commit
#   ./rollback/volver-v087.sh 0.9.3 --probar   → solo compila; deja todo como estaba
set -euo pipefail
NUEVA="${1:?Falta la versión nueva (mayor que la instalada). Ej.: 0.9.3}"
MODO="${2:-}"
BASE=96d20b5
cd "$(dirname "$0")/.."

[ -z "$(git status --porcelain -- ui app.config.json)" ] || {
  echo "Hay cambios sin commit en ui/ o app.config.json: resuélvelos antes."; exit 1; }

# Código de la v0.8.7: ui/ y app.config.json tal cual estaban…
git checkout "$BASE" -- ui app.config.json
# …y fuera los archivos que no existían entonces (p. ej. analystRole.ts).
for f in $(git diff --name-only --diff-filter=A "$BASE" HEAD -- ui); do rm -f "$f"; done
sed -i '' -E "s/\"version\": \"[^\"]+\"/\"version\": \"$NUEVA\"/" app.config.json
grep -q "\"version\": \"$NUEVA\"" app.config.json

npx tsc --noEmit -p ui

if [ "$MODO" = "--probar" ]; then
  npx dt-app build > /dev/null
  git checkout HEAD -- ui app.config.json
  echo "OK (prueba): el código de la v0.8.7 compila como $NUEVA. No se publicó nada."
else
  npx dt-app deploy
  git add -A ui app.config.json
  git commit -q -m "Rollback nivel 2: código de la v0.8.7 publicado como $NUEVA (sin el rol Analista)"
  echo "Publicado: código de la v0.8.7 como $NUEVA. Falta: git push y verificar la app."
fi
