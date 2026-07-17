#!/usr/bin/env python3
"""Arma el JSON del workflow "Análisis de causa raíz" desde las fuentes de esta carpeta.
Uso: python3 build-workflow.py staging|prod  → escribe causa-raiz.<amb>.workflow.json
"""
import json, sys, pathlib

AMB = sys.argv[1] if len(sys.argv) > 1 else "staging"
# Opcionales: --id <uuid> (para actualizar con `dtctl apply`) y --action <id de acción de IA>.
ARGS = dict(zip(sys.argv[2::2], sys.argv[3::2]))
ACTION_IA = ARGS.get("--action", "dynatrace.davis.workflow.actions:prompt-agentic-ai")
assert AMB in ("staging", "prod"), "ambiente: staging | prod"
D = pathlib.Path(__file__).parent
TITULO = {"staging": "Mapas de Servicios V2 Staging - Causa raíz",
          "prod": "Mapas de Servicios V2 - Causa raíz"}[AMB]

# Herramientas del agente: SOLO lectura y relevantes para causa raíz.
TOOLS = ["create-dql::2", "execute-dql::3", "find-troubleshooting-guides::6", "get-entity-id::9",
         "get-entity-name::10", "get-events-for-kubernetes-cluster::11", "get-problem-by-id::12",
         "log-pattern-extractor::15", "query-problems::16"]

wf = {
    "title": TITULO,
    "description": "Lo ejecuta la app Mapas de Servicios V2 (botón «Causa raíz»). Separa los problemas activos del mapa en causas raíz y efectos con Dynatrace Intelligence. Solo lectura.",
    "isPrivate": False,
    "type": "STANDARD",
    "schemaVersion": 4,
    "trigger": {},
    "tasks": {
        "contexto": {
            "name": "contexto",
            "description": "Arma el contexto: detalle de los problemas del mapa, sus eventos y las conexiones.",
            "action": "dynatrace.automations:run-javascript",
            "input": {"script": (D / "contexto.js").read_text()},
            "position": {"x": 0, "y": 1},
            "predecessors": [],
            "timeout": 300,
        },
        "analisis": {
            "name": "analisis",
            "description": "Dynatrace Intelligence (agéntica) separa causas raíz y efectos.",
            "action": ACTION_IA,
            "input": {
                "prompt": (D / "prompt.md").read_text(),
                "instruction": "Responde únicamente con JSON válido en español que cumpla el esquema de salida. Sin texto adicional.",
                "supplementary": "Contexto (JSON):\n{{ result(\"contexto\")[\"contextJson\"] }}",
                "outputFormat": (D / "output-schema.json").read_text(),
                "conversationId": "",
                "selectedServers": [{"name": "dynatrace-mcp", "type": "dtp-mcp-gateway"}],
                "selectedTools": {t: True for t in TOOLS},
            },
            "position": {"x": 0, "y": 2},
            "predecessors": ["contexto"],
            "conditions": {"states": {"contexto": "OK"}, "custom": "{{ result(\"contexto\")[\"ok\"] }}", "else": "STOP"},
            "timeout": 900,
        },
        "resultado": {
            "name": "resultado",
            "description": "Valida la respuesta (solo ids del contexto) y devuelve lo que pinta la app.",
            "action": "dynatrace.automations:run-javascript",
            "input": {"script": (D / "resultado.js").read_text()},
            "position": {"x": 0, "y": 3},
            "predecessors": ["analisis"],
            # ANY: corre aunque la IA falle, para devolver el motivo (y comentarlo).
            "conditions": {"states": {"analisis": "ANY"}},
            "timeout": 120,
        },
        "progreso_items": {
            "name": "progreso_items",
            "description": "Arma el comentario «⏳ Análisis en curso» para cada problema del mapa.",
            "action": "dynatrace.automations:run-javascript",
            "input": {"script": (D / "progreso.js").read_text()},
            "position": {"x": 1, "y": 2},
            "predecessors": ["contexto"],
            "timeout": 120,
        },
        "progreso": {
            "name": "progreso",
            "description": "Publica el comentario de progreso (luego lo reemplaza el resultado).",
            "action": "dynatrace.davis.problems:annotate-and-link",
            "input": {
                "problemId": "{{ _.item.problemId }}",
                "annotationId": "{{ _.item.annotationId }}",
                "annotationSource": "{{ _.item.source }}",
                "eventName": "Comment on problem",
                "eventDescription": "{{ _.item.text }}",
            },
            "withItems": "item in {{ result(\"progreso_items\")[\"lista\"] }}",
            "concurrency": 1,
            "position": {"x": 1, "y": 3},
            "predecessors": ["progreso_items"],
            "conditions": {"states": {"progreso_items": "OK"}, "custom": "{{ result(\"progreso_items\")[\"lista\"] | length > 0 }}", "else": "SKIP"},
            "timeout": 300,
        },
        "comentar": {
            "name": "comentar",
            "description": "Deja el pre-análisis como comentario en cada problema (causa raíz y efectos). Solo si la app lo pide.",
            "action": "dynatrace.automations:run-javascript",
            "input": {"script": (D / "comentar.js").read_text()},
            "position": {"x": 0, "y": 4},
            "predecessors": ["resultado"],
            "timeout": 300,
        },
        "anotar": {
            "name": "anotar",
            "description": "Publica cada comentario en su problema con la acción oficial «Annotate & Link» de la app Problems.",
            "action": "dynatrace.davis.problems:annotate-and-link",
            "input": {
                "problemId": "{{ _.item.problemId }}",
                "annotationId": "{{ _.item.annotationId }}",
                "annotationSource": "{{ _.item.source }}",
                "eventName": "Comment on problem",
                "eventDescription": "{{ _.item.text }}",
            },
            "withItems": "item in {{ result(\"comentar\")[\"lista\"] }}",
            "concurrency": 1,
            "position": {"x": 0, "y": 5},
            "predecessors": ["comentar"],
            "conditions": {"states": {"comentar": "OK"}, "custom": "{{ result(\"comentar\")[\"lista\"] | length > 0 }}", "else": "SKIP"},
            "timeout": 300,
        },
    },
}
# Id del workflow ya creado en el tenant por ambiente (así `dtctl apply` ACTUALIZA
# en vez de crear otro). Prod: se llena al crearlo. `--id` lo reemplaza.
IDS = {"staging": "aa1df053-2598-473f-968c-79bc0fe32b0f", "prod": "22a757f2-fdae-4a59-8dcb-78bad4b98d94"}
WF_ID = ARGS.get("--id") or IDS.get(AMB)
if WF_ID:
    wf = {"id": WF_ID, **wf}
out = D / f"causa-raiz.{AMB}.workflow.json"
out.write_text(json.dumps(wf, ensure_ascii=False, indent=2))
print(out)
