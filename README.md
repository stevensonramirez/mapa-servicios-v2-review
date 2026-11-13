# Mapas de Servicios V2

App de Dynatrace AppEngine para dibujar mapas curados de servicios con estado en vivo, análisis de causa
raíz por workflow y colaboración por roles. Versión 0.9.2.

Dynatrace AppEngine app for curated service maps with live status, workflow-based root cause analysis
and role-based collaboration. Version 0.9.2.

**[Español](#español)** · **[English](#english)**

---

## Español

### Qué es

Cada mapa es un diagrama de la arquitectura tal como la entiende el negocio. Cada nodo y cada conexión
toma su estado de una entidad de Smartscape, de los problemas de Davis o de un DQL propio. Sobre eso, la
app ofrece:

- **Topología real:** entidades relacionadas y sugerencia de conexiones desde Smartscape.
- **«¿Por qué está así?»:** evidencia del estado de un nodo, con análisis de Davis CoPilot.
- **Análisis de causa raíz del mapa:** un workflow de Dynatrace Intelligence separa causas raíz y efectos.
  El resultado queda guardado en el mapa y, opcionalmente, como comentario en cada problema.
- **Mapas Padre:** mapas que contienen otros mapas.
- **Compartir con tres roles:** Solo lectura, Analista (lectura + causa raíz) y Edición.
- Historial de versiones, papelera, exportar e importar en JSON, interfaz en español, inglés, francés y alemán.

### Contenido del repositorio

| Ruta | Contenido |
|---|---|
| `app.config.json` | Manifiesto de la app: tenant destino, id, versión y scopes |
| `ui/` | Código de la app (React + TypeScript + Strato) |
| `workflow/` | Fuentes del workflow de causa raíz y el script que arma su JSON |
| `tests/` | Pruebas unitarias del núcleo de roles y guardado (`node --test`) |
| `examples/` | Mapas de ejemplo para importar (funcionan en cualquier tenant) |
| `GUIA-USUARIO.md` / `USER-GUIDE.md` | Guía de usuario (español / inglés) |
| `DOCUMENTACION-TECNICA.md` | Documentación técnica para quien mantiene la app |
| `ARQUITECTURA.md` | Decisiones de arquitectura, escalabilidad, seguridad y límites |

### Requisitos

| Para | Se necesita |
|---|---|
| Desplegar la app | Tenant SaaS de Dynatrace con AppEngine, permiso IAM `app-engine:apps:install`, Node.js 24 y npm. El CLI (`dt-app` 1.10.2) viene en las dependencias de desarrollo |
| Análisis de causa raíz | Python 3, [dtctl](https://github.com/dynatrace-oss/dtctl) con un contexto hacia el tenant, IA generativa habilitada en el tenant (acción de workflow «Prompt agentic AI») y la app Problems (acción «Annotate & Link») |
| Análisis con Davis CoPilot en la burbuja | IA generativa habilitada en el tenant |

La app no tiene backend propio ni dependencias externas: todo corre con los SDKs de Dynatrace y DQL.

### Despliegue

**1. Clonar e instalar**

```bash
git clone <url-del-repo> mapa-servicios-v2
cd mapa-servicios-v2
npm install
```

**2. Configurar `app.config.json`**

| Campo | Valor |
|---|---|
| `environmentUrl` | URL del tenant, por ejemplo `https://abc12345.apps.dynatrace.com/` |
| `app.id` | Debe empezar por `my.`. Define la URL de la app; cambiarlo si en el tenant ya existe una app con ese id |
| `app.version` | Versión semver. Cada despliegue necesita una versión mayor que la instalada |

**3. Verificar**

```bash
npx tsc --noEmit -p ui/tsconfig.json
node --no-warnings --test tests/
```

**4. Desplegar**

```bash
npm run deploy
```

La primera vez se abre el inicio de sesión SSO en el navegador. Al abrir la app, cada usuario acepta los
scopes una vez.

Para instalar sin el CLI en el tenant destino: `npx dt-app deploy --dry-run` deja el paquete en
`out/artifact.zip`, que se sube en **Manage apps → Upload app**.

**5. Crear el workflow de causa raíz**

Sin este paso la app funciona completa, salvo el botón «Causa raíz», que avisa que el workflow no está
configurado.

```bash
python3 workflow/build-workflow.py prod
dtctl apply -f workflow/causa-raiz.prod.workflow.json --context <contexto>
```

`dtctl apply` devuelve el id del workflow nuevo. Con ese id:

1. Ponerlo en `RC_WORKFLOW_ID`, en `ui/app/components/rootCause.ts`.
2. Ponerlo en `IDS["prod"]`, en `workflow/build-workflow.py`, para que los siguientes `apply` actualicen
   el mismo workflow.
3. Subir la versión en `app.config.json` y volver a desplegar (`npm run deploy`).

El workflow corre con la identidad de su actor, y los comentarios en los problemas salen a su nombre. Se
recomienda que el dueño sea un grupo y el actor un usuario de servicio con permisos para:

- leer problemas, eventos y Smartscape en Grail;
- usar Dynatrace Intelligence;
- comentar problemas.

**6. Permisos de los usuarios**

La app solo puede hacer lo que el usuario también tiene permitido: sus políticas IAM deben incluir los
permisos de cada función que vaya a usar.

| Función | Permisos IAM |
|---|---|
| Abrir la app | `app-engine:apps:run` |
| Crear, guardar, borrar y restaurar mapas | `document:documents:read`, `document:documents:write`, `document:documents:delete`, `document:trash.documents:read`, `document:trash.documents:restore` |
| Compartir mapas | `document:direct-shares:read`, `document:direct-shares:write`, `document:direct-shares:delete`, `iam:users:read`, `iam:groups:read` |
| Estado de los nodos | Los `storage:*:read` de los datos que consulte cada mapa (lista completa en `app.config.json`) |
| Burbuja con Davis CoPilot e «Investigar a fondo» | `davis-copilot:conversations:execute`, `davis-copilot:nl2dql:execute` |
| Análisis de causa raíz | `automation:workflows:run`, `automation:workflows:read` |

Si a un usuario le falta un permiso, solo falla la función correspondiente.

**7. Comprobar**

1. Abrir la app e importar `examples/salud-del-ambiente.es.json` (botón **Importar**, junto a **Nuevo mapa**). Cada
   nodo muestra los problemas activos de Davis de una capa: frontend, servicios, procesos, Kubernetes y hosts.
2. Agregar un nodo atado a una entidad de Smartscape y confirmar que toma color.
3. Compartir el mapa con otra persona como Solo lectura.
4. En un mapa con un nodo en rojo, ejecutar «Causa raíz»: tarda alrededor de un minuto y muestra la
   leyenda con las causas.

### Configuración

| Qué | Dónde | Valor actual |
|---|---|---|
| Ventana de problemas cerrados que entran al análisis | `RC_CLOSED_WINDOW_MIN`, `ui/app/components/rootCause.ts` | 15 minutos |
| Comentar el análisis en cada problema | `RC_COMMENT_PROBLEMS`, `ui/app/components/rootCause.ts` | Encendido |
| Opción «Analista» en Compartir | `ANALYST_ROLE_ENABLED`, `ui/app/components/analystRole.ts` | Encendida |
| Zona horaria del análisis y los comentarios | `America/Bogota` en `workflow/contexto.js`, `progreso.js` y `comentar.js`; UTC-5 en `resultado.js`; texto en `prompt.md` | UTC-5 |
| Idioma del análisis y los comentarios | `workflow/prompt.md` | Español |

Los cambios en `ui/` necesitan un despliegue nuevo de la app. Los cambios en `workflow/` necesitan volver
a armar y aplicar el workflow:

```bash
python3 workflow/build-workflow.py prod --id <id-del-workflow>
dtctl apply -f workflow/causa-raiz.prod.workflow.json --context <contexto>
```

### Actualizar

1. Subir `app.version` en `app.config.json`.
2. `npm run deploy`.
3. Si cambiaron los scopes, cada usuario debe volver a autorizar la app al abrirla.

Los mapas son documentos del tenant: no se pierden al actualizar. Para moverlos a otro tenant, usar
Exportar e Importar JSON desde la app.

### Limitaciones conocidas

- El rol Analista tiene permiso de edición en el documento; la app lo trata como solo lectura. La
  protección es de la app, no de la plataforma.
- Máximo 50 analistas por mapa, y solo personas (no grupos).
- Los comentarios en los problemas salen a nombre del actor del workflow.

### Documentación

- [Guía de usuario](GUIA-USUARIO.md) · [User guide](USER-GUIDE.md)
- [Documentación técnica](DOCUMENTACION-TECNICA.md)
- [Arquitectura](ARQUITECTURA.md)
- [Workflow de causa raíz](workflow/README.md)

La guía de usuario está en español y en inglés; los demás documentos, en español.

---

## English

### What it is

Each map is a diagram of the architecture as the business understands it. Every node and connection
takes its status from a Smartscape entity, from Davis problems or from its own DQL. On top of that, the
app provides:

- **Real topology:** related entities and suggested connections from Smartscape.
- **"Why is it like this?":** evidence behind a node's status, with Davis CoPilot analysis.
- **Map root cause analysis:** a Dynatrace Intelligence workflow separates root causes from effects. The
  result is saved in the map and, optionally, as a comment on each problem.
- **Parent maps:** maps that contain other maps.
- **Sharing with three roles:** View only, Analyst (view + root cause) and Can edit.
- Version history, trash, JSON export and import, UI in Spanish, English, French and German.

### Repository contents

| Path | Contents |
|---|---|
| `app.config.json` | App manifest: target tenant, id, version and scopes |
| `ui/` | App source code (React + TypeScript + Strato) |
| `workflow/` | Root cause workflow sources and the script that builds its JSON |
| `tests/` | Unit tests for the role and save logic (`node --test`) |
| `examples/` | Example maps to import (they work on any tenant) |
| `GUIA-USUARIO.md` / `USER-GUIDE.md` | User guide (Spanish / English) |
| `DOCUMENTACION-TECNICA.md` | Technical documentation for maintainers |
| `ARQUITECTURA.md` | Architecture decisions, scalability, security and limits |

### Requirements

| For | You need |
|---|---|
| Deploying the app | A Dynatrace SaaS tenant with AppEngine, IAM permission `app-engine:apps:install`, Node.js 24 and npm. The CLI (`dt-app` 1.10.2) is included in the dev dependencies |
| Root cause analysis | Python 3, [dtctl](https://github.com/dynatrace-oss/dtctl) with a context for the tenant, generative AI enabled in the tenant ("Prompt agentic AI" workflow action) and the Problems app ("Annotate & Link" action) |
| Davis CoPilot analysis in the bubble | Generative AI enabled in the tenant |

The app has no backend of its own and no external dependencies: everything runs on Dynatrace SDKs and DQL.

### Deployment

**1. Clone and install**

```bash
git clone <repo-url> mapa-servicios-v2
cd mapa-servicios-v2
npm install
```

**2. Configure `app.config.json`**

| Field | Value |
|---|---|
| `environmentUrl` | Tenant URL, for example `https://abc12345.apps.dynatrace.com/` |
| `app.id` | Must start with `my.`. It defines the app URL; change it if the tenant already has an app with that id |
| `app.version` | Semver version. Every deployment needs a version higher than the installed one |

**3. Verify**

```bash
npx tsc --noEmit -p ui/tsconfig.json
node --no-warnings --test tests/
```

**4. Deploy**

```bash
npm run deploy
```

The first time, the SSO login opens in the browser. When opening the app, each user accepts the scopes
once.

To install without the CLI on the target tenant: `npx dt-app deploy --dry-run` writes the package to
`out/artifact.zip`, which you upload in **Manage apps → Upload app**.

**5. Create the root cause workflow**

Without this step the app works fully, except for the "Root cause" button, which reports that the
workflow is not configured.

```bash
python3 workflow/build-workflow.py prod
dtctl apply -f workflow/causa-raiz.prod.workflow.json --context <context>
```

`dtctl apply` returns the id of the new workflow. With that id:

1. Set it in `RC_WORKFLOW_ID`, in `ui/app/components/rootCause.ts`.
2. Set it in `IDS["prod"]`, in `workflow/build-workflow.py`, so later `apply` runs update the same
   workflow.
3. Bump the version in `app.config.json` and deploy again (`npm run deploy`).

The workflow runs as its actor, and comments on problems are posted under the actor's name. We recommend
a group as owner and a service user as actor, with permissions to:

- read problems, events and Smartscape in Grail;
- use Dynatrace Intelligence;
- comment on problems.

**6. User permissions**

The app can only do what the user is also allowed to do: their IAM policies must include the permissions
for each feature they will use.

| Feature | IAM permissions |
|---|---|
| Open the app | `app-engine:apps:run` |
| Create, save, delete and restore maps | `document:documents:read`, `document:documents:write`, `document:documents:delete`, `document:trash.documents:read`, `document:trash.documents:restore` |
| Share maps | `document:direct-shares:read`, `document:direct-shares:write`, `document:direct-shares:delete`, `iam:users:read`, `iam:groups:read` |
| Node status | The `storage:*:read` permissions for the data each map queries (full list in `app.config.json`) |
| Bubble with Davis CoPilot and "Investigate deeper" | `davis-copilot:conversations:execute`, `davis-copilot:nl2dql:execute` |
| Root cause analysis | `automation:workflows:run`, `automation:workflows:read` |

If a user lacks a permission, only the related feature fails.

**7. Check**

1. Open the app and import `examples/environment-health.en.json` (**Import** button, next to **New map**). Each node shows
   the active Davis problems of one layer: frontend, services, processes, Kubernetes and hosts.
2. Add a node bound to a Smartscape entity and confirm it gets a color.
3. Share the map with another person as View only.
4. On a map with a red node, run "Root cause": it takes about a minute and shows the legend with the
   causes.

### Configuration

| What | Where | Current value |
|---|---|---|
| Window of closed problems included in the analysis | `RC_CLOSED_WINDOW_MIN`, `ui/app/components/rootCause.ts` | 15 minutes |
| Post the analysis as a comment on each problem | `RC_COMMENT_PROBLEMS`, `ui/app/components/rootCause.ts` | On |
| "Analyst" option in Share | `ANALYST_ROLE_ENABLED`, `ui/app/components/analystRole.ts` | On |
| Time zone of the analysis and comments | `America/Bogota` in `workflow/contexto.js`, `progreso.js` and `comentar.js`; UTC-5 in `resultado.js`; wording in `prompt.md` | UTC-5 |
| Language of the analysis and comments | `workflow/prompt.md` | Spanish |

Changes in `ui/` need a new app deployment. Changes in `workflow/` need the workflow to be rebuilt and
applied again:

```bash
python3 workflow/build-workflow.py prod --id <workflow-id>
dtctl apply -f workflow/causa-raiz.prod.workflow.json --context <context>
```

### Updating

1. Bump `app.version` in `app.config.json`.
2. `npm run deploy`.
3. If the scopes changed, each user must authorize the app again when opening it.

Maps are tenant documents: they are kept across updates. To move them to another tenant, use JSON
Export and Import in the app.

### Known limitations

- The Analyst role has edit permission on the document; the app treats it as view only. The protection
  is enforced by the app, not by the platform.
- Up to 50 analysts per map, and only individual users (not groups).
- Comments on problems are posted under the workflow actor's name.

### Documentation

- [User guide](USER-GUIDE.md) · [Guía de usuario](GUIA-USUARIO.md)
- [Technical documentation](DOCUMENTACION-TECNICA.md)
- [Architecture](ARQUITECTURA.md)
- [Root cause workflow](workflow/README.md)

The user guide is available in English and Spanish; the other documents are in Spanish.
