#!/bin/bash
# Rollback NIVEL 1: apagar la opción «Analista» en Compartir (estado de la v0.9.0).
# Nadie puede asignar analistas nuevos; los que ya existan siguen protegidos
# (solo lectura + causa raíz), porque esa protección no depende del interruptor.
#
#   ./rollback/apagar-analista.sh 0.9.3            → publica en prod y hace commit
#   ./rollback/apagar-analista.sh 0.9.3 --probar   → compila y prueba; deja todo como estaba
#
# La versión debe ser MAYOR que la instalada (ver "version" en app.config.json).
set -euo pipefail
NUEVA="${1:?Falta la versión nueva (mayor que la instalada). Ej.: 0.9.3}"
MODO="${2:-}"
cd "$(dirname "$0")/.."
F=ui/app/components/analystRole.ts

[ -z "$(git status --porcelain -- ui app.config.json)" ] || {
  echo "Hay cambios sin commit en ui/ o app.config.json: resuélvelos antes."; exit 1; }

sed -i '' 's/^export const ANALYST_ROLE_ENABLED = true;/export const ANALYST_ROLE_ENABLED = false;/' "$F"
grep -q '^export const ANALYST_ROLE_ENABLED = false;' "$F"
sed -i '' -E "s/\"version\": \"[^\"]+\"/\"version\": \"$NUEVA\"/" app.config.json
grep -q "\"version\": \"$NUEVA\"" app.config.json

npx tsc --noEmit -p ui
node --no-warnings --test tests/ > /dev/null

if [ "$MODO" = "--probar" ]; then
  npx dt-app build > /dev/null
  git checkout HEAD -- "$F" app.config.json
  echo "OK (prueba): con la opción apagada compila y pasan las pruebas. No se publicó nada."
else
  npx dt-app deploy
  git add "$F" app.config.json
  git commit -q -m "Rollback nivel 1: opción «Analista» apagada ($NUEVA)"
  echo "Publicado $NUEVA con la opción «Analista» apagada. Falta: git push y verificar la app."
fi
