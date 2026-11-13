# Mapas de Servicios V2 — User guide
A Dynatrace app (`my.mapaservicios.v2`) for drawing **curated service maps**: diagrams of the architecture
*as the business understands it*, where every node and connection lights up live according to the real
state of the environment.
This guide assumes you already know Dynatrace (Smartscape, Davis, DQL, Notebooks).

---

## Contents
1. [What is this app for?](#1-what-is-this-app-for)
2. [Concepts in 1 minute](#2-concepts-in-1-minute)
3. [Managing maps](#3-managing-maps)
4. [Nodes: create and edit](#4-nodes-create-and-edit)
5. [Node status: Smartscape entity vs DQL](#5-node-status-smartscape-entity-vs-dql)
6. [Connections and their status](#6-connections-between-nodes-and-their-status)
7. [Real topology: Related entities and Suggest connections](#7-real-topology-related-entities-and-suggest-connections)
8. [The "Why is it like this?" bubble](#8-the-why-is-it-like-this-bubble)
   - [Map root cause analysis](#map-root-cause-analysis)
9. [Sharing, URLs and version history](#9-sharing-urls-and-version-history)
10. [Settings, appearance and languages](#10-settings-appearance-and-languages)
11. [Grail consumption (cost)](#11-grail-consumption-cost)
12. [End-to-end scenarios](#12-end-to-end-scenarios)
13. [FAQ](#13-faq)

---

## 1. What is this app for?
Smartscape shows **all** the automatically discovered topology, and users can't change it. This app
solves the opposite case: a map **drawn by hand, tailored to the business** (for example, the flow of a
channel, a payments chain, the architecture of a domain), where:
- Each node represents whatever YOU decide (a service, a host, a database, a third party, a business
  concept) with the icon and name the business recognizes.
- The **color of each node is real, live status**: green (ok), yellow (warning), red (error), derived
  from active Davis problems or from your own DQL query.
- Connections can also have their own status or inherit the status of the source node.
- The map stays **aligned with the real Smartscape topology** without becoming automatic: the app
  suggests which connections are missing or extra, and you decide.

In short: **a curated war room board, with Dynatrace data behind every shape.**

## 2. Concepts in 1 minute
| Concept | What it is |
|---|---|
| **Map** | A canvas with nodes and connections. You can have many; each one saves itself (autosave). |
| **Status node** | A shape with icon + title, colored by its status (0 ok · 1 warning · 2 error). |
| **Text node** | A free Markdown text block (headings, lists, bold) to annotate the canvas. |
| **Smartscape entity** | A node can be "bound" to a real Dynatrace entity (service, host, etc.). Its status then follows Davis problems automatically and the whole topology feature set is enabled. |
| **Connection** | A directed line between two nodes. It can have its own DQL, inherit the source status, or have no status. |
| **Edit / view mode** | The lock in the toolbar switches between editing and view only. |
| **Parent map** | A map type that, besides nodes and connections, embeds Service maps as nodes (see §3). |
| **Sub-map node** | A node that represents a Service map embedded in a Parent map, with its health percentage. |

## 3. Managing maps
- **Sidebar**: list of maps. Create (`+`), rename, **duplicate**, delete.
- **Delete = trash**: deleted maps go to the Dynatrace trash for **30 days** and can be restored from
  the trash dialog.
- **Autosave**: every change saves itself (with a short delay to group edits). The cloud icon in the
  toolbar confirms the save state.
- **Undo / redo**: toolbar buttons (or the usual shortcuts), with history per map.
- **Remembered view per map**: the browser remembers the pan and zoom of **each** map, so you come back
  right where you left off. A map opened without a remembered view fits itself to show all its content.
- **Export / import**: each map can be exported to JSON and imported again (manual backup, or to move it
  between environments). The JSON keeps the map type. **Only maps downloaded from the app can be
  imported**: if the file doesn't have the app's format (for example, one built outside the app), it is
  not imported and the notice **"The map content is not valid"** appears with the reason. If a saved map
  doesn't have the format, it doesn't open: the same notice appears instead, and the map can be sent to
  the trash from the ⋮ menu in the list.

### Map types
When you create a map, a dialog asks for its type:
- **Service map**: the regular map, with nodes and connections.
- **Parent map**: everything a Service map has, plus it can embed Service maps as nodes.

The type is chosen at creation. In the sidebar each map shows the icon of its type, and the Parent map
icon uses the accent color so it stands out at a glance.

A Service map can be **converted into a Parent map** after it's created: the **"Convert to Parent map"**
option is in the map's ⋮ menu (both in the title bar and in the sidebar). The conversion is **one-way
and can't be undone** (not even by restoring an earlier version from the history); the map keeps its
URL, its sharing permissions and its version history. If the map was embedded as a sub-map in another
Parent map, that node stops working (a Parent map can't be embedded).

### Parent map: maps inside a map
A Parent map brings several Service maps together on one canvas using **sub-map nodes**:
- **Add a sub-map**: drag the map from the sidebar onto the canvas, or open a node's editor and choose
  the **"Embedded service map"** status source.
- **Hierarchy rules**: a given map can be embedded only once; a Parent map can't embed another Parent
  map (the hierarchy has at most two levels); a Service map doesn't accept sub-maps.
- **What the node shows**: a **pill with the health percentage** of the embedded map, and the node name
  as a link that opens that map in a new tab. If you don't have access to the embedded map, the node
  says so instead of showing a made-up status.

#### Sub-map node color rules
The color of a sub-map node is defined by **color rules** (up to 3 rows), each with a severity color +
operator + value. They are evaluated in order and the first one that matches wins; if none applies, the
node stays neutral.
- The metric is configurable: **"% of healthy nodes"** (default) or **"Affected nodes"**.
- Defaults: green = 100, yellow ≥ 50, red < 50.

#### Parent map refresh
The refresh interval is set in **Settings**: every **10 minutes** (default), every **5 minutes** or
**Manual**. The bar shows "Updated X ago" and the refresh button is always available. The DQL queries
of the embedded maps run at that interval, so it also defines their Grail consumption (see §11).

## 4. Nodes: create and edit
**Create**: the `+` button in the toolbar → choose the type:
- **Status node** (the regular one): icon + title + status.
- **Square**: a shape variant to group things visually.
- **Text**: an editable Markdown block on the canvas (Notebooks style). When selected, the bar shows
  **A−** / **A+** to scale the WHOLE block (50 % to 300 %, in 25 % steps) without touching the Markdown:
  a `# Title` at 200 % works as a large section label. The size is saved per block.
- **Image**: upload an image (≤ 5 MB) as a shape or as the **map background**.
- **Group**: a container frame to gather nodes (see below).

### The Group: nodes inside a frame
A **Group** is a frame that contains status nodes and takes the **worst status of its members** (soft
border and background; with no members it stays neutral). It doesn't run any query of its own: the color
comes from the statuses the map already computes.
- **Put a node in**: drag it into the frame. While you hold it over the frame, the whole frame is
  highlighted to show it will receive it; when you drop it, the frame flashes and arranges its members
  in a grid (growing if needed).
- **Take a node out**: drag it outside. There is a **threshold**: if you push it only a little, the frame
  **brings it back with an animation** to the nearest point inside (meanwhile the border looks solid, in
  the accent color); if you push it past the threshold (the frame border turns dashed), it is released
  when you drop it. A node never ends up sitting on the frame's line: it ends fully inside or clear
  outside.
- **Moving the frame** moves all its members. The **handle in the bottom-right corner** (shown on hover
  or when selected) resizes it freely, height and width separately; never below the space its members
  take.
- **Name**: double-click the title pill to rename it. It can be **empty** (the pill disappears and a `+`
  chip remains to add it back).
- **Connections**: the frame accepts connections like any node (including inheriting its status, which
  is the worst of its members). A node's connections do NOT change when it is moved in or out of the
  frame, and a member can't be connected to its own frame.
- **Delete** (trash icon in the frame's top-right corner): ONLY the frame goes away; the nodes stay loose
  where they are.
- Groups can't be nested, and Text and Image nodes can't be grouped.

**Edit**: click a node → the **Edit** button appears → the editor opens with two tabs:
- **Content**: the node **name** and **subtitle**, the **status source** (chosen with segmented
  buttons, see §5), the **block for that source** (the entity picker or the DQL editor, depending on your
  choice) and the **Notes** (free text that unfolds from an icon on the node, visible only in edit mode).
  Each item has its own section, in that order.
- **Links & appearance**: the **node links** (see below), the **icon** (Dynatrace icon gallery + logos
  of well-known brands), the **shape** and the **size**, each in its own row.

**Connection health** is not a tab: it's a **checkbox** (with its threshold) inside the **Smartscape
entity** block, and it only shows up when that is the status source (see §5).

### Node links
A node can have **several links** (each with its title and URL), managed in the "Links & appearance"
tab: you type the **title** and the **link** on the same line and the `+` button adds it to the list;
each added link shows an **✕** on the right to remove it.
- With **one** link, the node title becomes a (blue) link that opens it directly in a new tab.
- With **two or more**, clicking the title opens a **popup** with the list of titles: tap one and it
  opens in a new tab while the popup closes itself (it also closes when you click outside).
- It works the same in edit mode and in view/shared mode.
- Nodes that had the single URL from earlier versions see it converted automatically into the **first
  link** of the list when the editor opens (the title stays editable).

## 5. Node status: Smartscape entity vs DQL
Each status node picks **one** of two sources, with the segmented buttons in the "Content" tab:

### Option A — Smartscape entity (recommended)
In the node editor, search for and select a real entity from the environment. Supported types:
**service, host, process group, process instance, application, Kubernetes cluster, cloud application
and database service**.
- **How search works**: you pick the type, type in the search bar and results appear in a **floating
  dropdown** below the bar, filtered live as you type. Once you pick one, the bound entity shows as a
  **chip** with its name and **ID**, plus an **"Open in Dynatrace"** button to see it isolated in
  Smartscape.
- **Services with the same name**: for the **service** type, each result has three columns:
  **name | context | ID**. The context is the Kubernetes `namespace / workload` where the service runs
  (if it isn't on Kubernetes, its process group or host), and the ID is the Dynatrace `SERVICE-…`. This
  tells apart services with the same name (for example, dozens of `AutorecoveringChannel$2`). If the
  dropdown is narrow, the context is hidden and name and ID remain. On the map, hovering a node bound to
  an entity shows its ID.
- **Search also matches by context and ID** (services only): type the namespace, the workload, part of
  the process group or the last characters of the `SERVICE-…` and the list narrows down to those. That's
  how you pick one among hundreds of services with the same name. The list shows up to **200** results;
  if there are more, the header says *"Showing 200 of N — refine your search"*.
- The status comes from the **active Davis problems** on that entity: availability or error problems →
  **red**; the rest (slowdown, resources, custom) → **yellow**; no problems → **green**.
- The entity's **live name** is resolved automatically (if it's renamed in Dynatrace, you'll see it), and
  if the entity **disappears from the environment** (decommissioned), the node is marked as *retired*.
- You don't write a single line of DQL, and the topology/metadata queries **don't consume Grail** (the
  only one with a cost is the Davis problems query, a single one per map, not per node).

### Option B — Advanced DQL
Write a DQL query whose result meets the **status contract**: the first row must have a field with
value `0` (ok), `1` (warning) or `2` (error). Typical example:
```dql
timeseries errors = sum(dt.service.request.failure_count),
  filter: { dt.entity.service == "SERVICE-XXXX" }
| fields status = if(arrayLast(errors) > 100, 2, else: if(arrayLast(errors) > 10, 1, else: 0))
```
It works for anything Davis doesn't cover: business thresholds, logs, business events, custom metrics,
lookups, etc. **Note**: the DQL runs with exactly the timeframe you write in the query.

> A single map can mix both options without any problem.
> A Parent map also has the **"Embedded service map"** source, used by sub-map nodes (see §3).

### Connection health (pill above the node)
For nodes with a **Smartscape entity** source (option A), the entity block in the editor lets you turn
on a **pill above the node** with the health percentage of its **real Smartscape** connections (who
calls it and whom it calls), whether or not they are drawn on the map. If the entity has 100
connections and 20 of them have an active Davis problem, the pill shows **80%**.
- It's **off by default**; you turn it on with a checkbox per node, next to the entity picker. With a DQL
  source the block doesn't appear (the data only exists with a bound entity).
- **Red threshold (%)** (default 80): if health reaches that percentage or less, the **node turns red by
  the rule** (and so do its connections that inherit status). Opening the "?" bubble explains that the
  red comes from the **connection health rule**, with the exact figures. In that case neither Davis nor
  the AI is queried.
- No connections in Smartscape → gray **"N.A."** pill; while computing → "…". If the connections query
  fails, the pill stays at "…" and the tooltip says so (it retries on the next refresh): "N.A." always
  means **zero `calls` relationships in Smartscape**, never an error.
- **Conditions to see a percentage**: the entity must exist in the new Smartscape (a process group isn't
  a node there → "N.A.") and have at least one `calls` relationship in either direction; neighbors
  without a classic ID don't count. Entities with no traffic in the topology window give a legitimate
  "N.A.".
- **Click the pill** → opens the entity **isolated in Smartscape** (new tab) to see those connections;
  the tooltip shows the detail (how many have active problems).
- Connections are read from Smartscape (queries that don't consume Grail); the health of the neighbors
  takes **one** additional batched Davis problems query per map (see §11).

## 6. Connections between nodes and their status
- **Create**: in edit mode, drag from a node's edge to another node. Connections are floating: they
  pick the best anchoring side on their own, avoid passing over nodes and spread into lanes when there
  are several between the same nodes.
- **Direction**: the small arrows on the connection show the direction; the **Reverse direction** button in the
  editor changes it.
- **Connection status** (click the connection → Edit):
  - **Inherit from the source node** (default, on): the connection takes the same color as the node it
    comes from. It doesn't run any additional query.
  - **Own DQL**: same 0/1/2 contract as nodes, for when the connection has its own meaning (for example,
    the state of a queue between two systems). It's easy to spot: the connection carries an inline
    **`DQL`** label right where it leaves the node.
  - No status: neutral connection.
- **Value computed by DQL** (chip in the middle of the connection): in the editor, turn on **"Show a
  value calculated by DQL"** (off by default). A second DQL appears, independent of the status, whose
  result is drawn in a chip with the color of the connection status: for example latency or
  transactions per minute between two systems.
  - **Contract**: the query must return **a single number**: the first row and its `value` field (or the
    first numeric field). If it's a series (`timeseries`), the **last point** is used. Example:
    `timeseries value = avg(dt.service.request.response_time) | fieldsAdd value = arrayLast(value)`.
  - **Value name** and **Suffix** (`ms`, `%`, `req/s`): the suffix goes with the number; the name goes in
    the chip tooltip and, only if you turn on **"Show the name inside the chip"**, inside it too.
  - **Test** shows the chip exactly as it will look. Clicking the chip opens the connection editor.
  - Each active value adds one query per cycle (it shows up in the consumption legend, see §11).
- **Auto-Arrange**: the toolbar button lays out the map automatically in layers (source → target), even
  with cycles.

## 7. Real topology: Related entities and Suggest connections
### Related entities (per node)
Select a node **bound to an entity** → topology button next to "Edit" → the **Related entities** panel
opens. It compares the real relationships (Smartscape `calls`) with what is drawn and shows these lists:
1. **Related and already connected**: nothing to do (they're implicit and not listed).
2. **Related, on the map but not connected** → the **`+`** button creates the connection in the right
   direction (who calls whom), with status inheritance on.
3. **Related and NOT on the map** → the **`+`** button creates the node (already bound to that entity,
   with Davis status) **and** the connection, in a single action.
4. **Unbacked connections**: a connection you drew that the real topology doesn't confirm → you can
   **Ignore** it (it's intentional, it won't warn again) or **Remove** it (delete the connection).

Each entity in the list also has an icon to **open it in the new Smartscape, isolated with its
relationships**, in another tab.

### Suggest connections (global)
Toolbar button (shown when there are bound nodes): it checks **the whole map** and suggests the
connections that exist between your bound nodes but aren't drawn. The ones you accept are created with
status inheritance.

> **Typical scenario**: a new microservice is deployed in the chain. Instead of someone having to
> "remember" to update the diagram, you open the neighboring node → Related entities → the new service
> shows up in the list → one click and it's on the map, already monitored by Davis.

## 8. The "Why is it like this?" bubble
When a node is yellow or red, it shows a **(?)** icon. When opened, the bubble shows:
- The **node status** (which severity it has and where it comes from).
- The **list of related active Davis problems**, scrollable: for each one you see the **ID**, the
  **title**, the **category** as a chip and an **icon to open it in Dynatrace**.
  - **It shows up to 12 problems** and the counter shows the **real total**: for example *"(179, showing
    12)"*.
  - **It doesn't include duplicate problems.** When Davis merges several problems into one (for example,
    a *"Multiple service problems"*), the individual problems are marked as duplicates: they're already
    contained in the main one, so they aren't listed and don't color nodes.
  - **On nodes whose DQL queries Davis problems** (`fetch dt.davis.problems…`), the list comes from **that
    same DQL**: you see exactly the problems that DQL would return in a notebook.
- A **row of actions** at the end: **"Analyze with Dynatrace Assist"** and **"Open the entity in
  Dynatrace"** (the latter on nodes with a Smartscape entity).

### Link with the root cause analysis
- If the map has a saved **root cause analysis**, each problem in the bubble shows its role:
  **"🔴 Root cause N"** or **"🔗 Effect of N"**. Tapping it opens that analysis.
- If the map has no analysis yet and you're an editor, the bubble offers **"Analyze the map's root
  cause"**.
- The **AI analysis inside the bubble (Davis CoPilot)** works the same: it's turned on in Settings and
  coexists with the root cause analysis. The **Dynatrace Assist** buttons ("Analyze with Dynatrace
  Assist" and the ✨ on each problem) are also still available: all AI features coexist with the root
  cause analysis.

### AI analysis inside the bubble
The **"AI analysis in the bubble"** setting (Settings → General, **on for every map**) changes who does
the analysis:
- **Off**: the bubble shows the status, the problems and the Dynatrace Assist buttons, and **doesn't
  call the AI** on its own.
- **On**: in addition, **Davis CoPilot** writes the cause analysis inside the bubble itself and enables
  **"Investigate deeper"** (it generates an investigation DQL query ready to run).
- The **Dynatrace Assist** buttons ("Analyze with Dynatrace Assist" and the ✨ on each problem) and
  **"Analyze the map's root cause"** are **always** available, with the setting on or off.

Other cases:
- If the node is red because of the **connection health rule** (see §5), the bubble shows that
  explanation with the rule's figures, without querying Davis or the AI.
- On nodes with **their own DQL**, the bubble finds related problems in two ways: by the **entity IDs**
  that appear in the query or in its rows, and by the **DQL's own filters** on `entity_tags`,
  `event.name`, `event.category`, `event.description` and `k8s.namespace.name` (`matchesValue`,
  `matchesPhrase`, `in` or `==` equality). The filters are reused with the same logic: if they're joined
  with `or` in the DQL (for example, two alternative tags), the bubble also combines them with `or`.
  With those filters there's no need to put any ID in the query: the bubble lists the active problems of
  **the same population** the status DQL is counting. All the DQL filters are honored, including those
  that come after a `| fields …`.
- In the list, problems that affect **several entities** come first (they're usually the ones Davis
  correlates as a common cause); within each group, the most recent on top.

The **AI analysis in the bubble** requires generative AI capabilities (Davis CoPilot) to be enabled in
the tenant.

### Map root cause analysis
With one click, **Dynatrace Intelligence** reviews the map's problems (the active ones and those closed in
the **last 15 minutes**) and separates them into **root causes**, which are independent of each other,
and **effects**, so you know what to fix first.

**How to use it**
1. On a map with yellow or red nodes (Service map or Parent map), press **✨ Root cause** in the bar.
2. The analysis takes one or two minutes and you can keep using the map meanwhile.
3. When it finishes you get:
   - The **"Root causes"** legend at the top right. Tapping a cause takes the map to its node and opens
     the analysis.
   - A **red number** on the node of each root cause. If a node has several, the first 3 are shown plus
     **"+N"** for the rest (for example, **1·2·3 +4**); hovering shows all of them.
   - The dashed **"Effect of N"** mark on nodes whose problems are a consequence of cause N. If the
     effect's problem is already closed, the mark turns green as **"✓ Effect of N"**, so the relationship
     stays visible.
4. Root causes are numbered **from most to least severe** (severity, then category: availability and
   error first, then affected nodes and entities, then the oldest). The effects of each cause follow the
   same order, and so does the bubble's problem list.
5. The analysis of each cause shows, in this order: the **verdict** in one sentence, **why it's a root
   cause**, **what to do**, the **effects it explains** (each with a link to the problem and a "Go to
   node" button) and the evidence (collapsed).

**On a Parent map** the analysis reviews the parent's own nodes **and also the nodes of each child map**
(one level). Child nodes show up with their path, for example **"Payments › gw-payments"**, in the
legend, the analysis and the comments. On the parent, the number or effect mark appears on the
**sub-map node** that contains the problem. With **"Go to node"** on a child node, the app **opens that
child map** and travels to the node; at the top left the notice *"Viewing the root cause analysis of «…»"*
appears with **"← Back to the parent map"**. Those marks on the child are only for the visit: they don't
change the child map or its own analysis.

**The analysis stays up to date.** The saved analysis is a snapshot of the moment it ran, but the map
checks whether its problems are still active (every 2 minutes; every 15 if the analysis is more than a
day old): a resolved cause moves to the end of the legend as **"✅ Resolved"** and its node shows a green
✓; a resolved effect becomes **"✓ Effect of N"** in green. If red nodes show up that weren't in the
analysis, the legend says so, so you can analyze again.

**When everything is over, the map cleans itself.** If **all** the problems in the analysis are closed,
the nodes are left **without marks** and the legend says so ("the map no longer shows marks"); the analysis
is still available in the legend in case you want to review it. To remove it completely, editors and
analysts have the **"Clear"** button at the bottom of the legend: it deletes the analysis and its marks
for everyone (if an editor clears it, it can be undone with ↶). Comments already published in *Problems*
are kept.

**Calculated confidence.** The confidence is not the one the AI gives itself. For each cause → effect
relationship, six verifiable signals are checked: Smartscape relationship, order in time, root according
to Davis, shared events, same cluster or host, and a map connection. With 4 or more the confidence is
**High**, with 2 or 3 **Medium** and with 1 or fewer **Low**. If the cause started after the effect, it's
**Low**.

**Comments on problems.** The analysis is also posted as a comment in the **Problems** app, under
*Comments and insights*: "⏳ in progress" while it runs, and then **🔴 Root cause**, **🔗 Effect** (with a
link to its cause), **⚪ Unclassified** or **⚠️ no result**. There is one comment per problem and per
map, and each analysis updates it. Each comment starts with **who requested the analysis** and when
(👤 *Requested by*), and that name also appears next to the map in the comment's "via…".

**Conditions of use**
- **Editors** and **analysts** run the analysis (see §9); people with view-only access see the last
  saved one.
- It applies to **Service maps** and **Parent maps** (on the parent, with one level of children; children
  the person analyzing can't access don't contribute problems).
- It analyzes **Davis problems without duplicates**, **active or closed in the last 15 minutes**, from
  nodes bound to an entity or with a DQL on `dt.davis.problems`. Closed ones are included because a
  short problem that closed just before the analysis may be the cause or the effect of another one that
  is still active. A node that is red because of a metrics DQL doesn't contribute problems.
- **Map connections** count as a dependency hint (A → B means A depends on B).
- Up to 60 problems per analysis: if the map has more, **the most severe** are analyzed (active ones
  first; then severity, category, nodes touched, affected entities and age) and the legend says "N of M
  were analyzed". The result can vary between runs; that's why the last one is saved.
- All times are in UTC-5 (configurable in the workflow). IPs, emails and URLs are masked before data is
  sent to the AI; in the analysis and in the comments, node names are shown in full.
- Users need the `automation:workflows:run` and `automation:workflows:read` permissions.

## 9. Sharing, URLs and version history
- **Share**: the "Share" button → choose the role (**View only**, **Analyst** or **Can edit**) → search
  for a **person** (by name or email) or a Dynatrace **group** (by name; it shows up with the "Group"
  label). When you share with a group, the map appears in the list for **all its members**. Under the
  hood it uses Dynatrace's native document permissions; you can also see and revoke existing access. For
  the group search to return results, the person sharing needs permission to view the account's groups
  (set by the Dynatrace administrator). The ℹ️ icon next to "People with access" explains what each role
  does.
- **Who can share**: the map owner and anyone with **Can edit** can share it, with any role.
- **Analyst role**: the same as *View only*, but can run the **root cause analysis** (§8), run it again
  and clear it. Their analysis is saved in the map and everyone sees it, so nobody has to repeat it. They
  can't modify the map or share it. It's assigned to **people** (not groups), up to **50 per map**.
- **What someone with view-only access sees**: the map in **view** mode. They can zoom, pan, see live
  statuses and the "Why is it like this?" bubble, but nothing else: no "+", no dragging or connecting, no
  "Edit" popup, no node editor (nor its DQL), no ⋮ menu (rename, duplicate, download, convert, delete),
  no Share and no history. The app knows it as soon as the map opens (lock in the bar), not when trying
  to save.
- **What an analyst sees**: the same as view only, plus the **✨ Root cause** button in the bar and
  "Clear" in the analysis legend. Hovering the lock in the bar shows "Analyst".
- **URL per map**: each map has its own URL (`…/map/<id>`). Share it and, if the person has access, it
  opens that map directly; if not, they see a clear notice (access is granted with "Share").
- **Version history**: the app takes **automatic snapshots every ~3 minutes** while you edit (and you
  can create a manual one with a name). From the history menu you can see the list, **preview** a version
  and **restore** it. It's the safety net for "someone broke the map".

## 10. Settings, appearance and languages
The **Settings** dialog (per map) has **two tabs**, with the label on the left and the control on the
right in each row:

**General**
- **Refresh cadence** (Parent map refresh interval, on maps of that type): every 10 minutes, every 5
  minutes or Manual.
- **AI analysis in the bubble**: on for every map; it can be turned off per map (see §8).
- **Dynatrace Assist prompt**: the template of the question copied when you use "Analyze with Dynatrace
  Assist". It supports the variables **`{problems}`** (the detected problems), **`{name}`** (the node
  name), **`{entity}`** (the Dynatrace entity) and **`{state}`** (the status). The text you write is
  saved in the map document and **takes precedence over the UI language**; the **"Restore the default
  prompt"** button sets it back to the text of the active language. It can always be edited, because the
  Assist buttons show with or without "AI analysis in the bubble".

**Appearance**
- **State glow**: animated halo around nodes according to their status.
- **Brand logos in color**: color or monochrome icons.
- **Show estimated consumption**: the Grail consumption legend (see §11).
- **Interface language**: Spanish, English, French or German (applies to the whole UI).

Other controls:
- **Background image** of the canvas (from the toolbar menu).
- **View mode** (lock): the map is read only for you (shared without edit access). All editing is
  blocked: the editing toolbar is hidden and nodes don't open the editor (see §9).
- **Bar on narrow screens**: buttons are always shown in full. If the window gets narrow, the "Updated
  …ago" text (Parent map) and the map name are trimmed first; if they still don't fit, the bar shows
  icons only and the refresh time moves to the "Refresh" tooltip.
- **About**: app version.

## 11. Grail consumption (cost)
The app is deliberately frugal with Grail:
- Queries to **Smartscape** (entity search, live names, relationships, suggestions).
- **Davis** status: a single batched query to `dt.davis.problems` per map (with a cost, but one, not one
  per node), refreshed every ~90 s.
- **Connection health** (if enabled on any node): one additional batched query to `dt.davis.problems`
  per map for the neighbors, separate from the main one.
- **Own DQL queries** on nodes/connections: they cost whatever each query costs, with its own timeframe.
- On a **Parent map**, the DQL queries of the embedded maps run at the refresh interval set in Settings
  (10 min, 5 min or Manual), so that interval governs their consumption.
- Connections with **status inheritance** don't run any query.

The **consumption legend** (bottom corner) shows the real hourly consumption of the map's DQL queries,
read from Grail's own query execution events, not an estimate. Use it to decide whether an expensive DQL
is worth optimizing or replacing with an entity binding.

## 12. End-to-end scenarios
### A) Board for a channel flow (daily monitoring)
1. Create the "Channel X" map and add the nodes of the flow with the icon of each technology.
2. Bind each node to its real service/host → Davis status, no DQL.
3. Connect with "Suggest connections" and adjust by hand what's missing (third parties, business
   concepts).
4. Turn on the glow, set the lock to view mode and show it on the team's screen.

### B) Incident triage
1. A node turns red → click the **(?)** bubble.
2. Check the list of active problems and open the relevant one in Dynatrace; if you want the cause
   analysis, use **"Analyze with Dynatrace Assist"** (or turn on "AI analysis in the bubble" in Settings
   so Davis CoPilot writes it right there).
3. If the impact comes from a dependency, the inheriting connections show where it propagates.

### C) The architecture changed
1. Open the node of the service that changed → **Related entities**.
2. Connect what's new (`+`), remove or mark as intentional what is **unbacked**.
3. The map reflects reality again, without losing the curation.

### D) Business status
1. A "Loan approval" node with no entity: use **your own DQL** on business events with business
   thresholds (0/1/2 contract).
2. Check in the Grail legend how much that query costs per hour and adjust the timeframe if needed.

### E) Handing the map over to another team
1. "Share" → the team's group (or people one by one), with *View only*, *Analyst* or *Can edit* as
   needed (the Analyst role is assigned per person).
2. Send them the **map URL**.
3. To go back to another version, restore it from the **version history**; if the map is deleted, recover
   it from the **trash** (30 days).

## 13. FAQ

**Can I mix nodes bound to entities and nodes with DQL in the same map?**
Yes, that's the expected use: entities for the technical side, DQL for the business side.

**What happens if a bound entity is decommissioned?**
The node is marked as *retired*; it doesn't turn falsely green or disappear. You decide whether to remove
it or bind it again.

**The node shows gray / "unknown".**
The first result of its query hasn't arrived yet (or it's paused because the tab was in the background).
This is intentional: the app never shows green without evidence.

**"No entities found" when searching in the picker.**
Check that you're searching the right type and that the term matches part of the name (search is by
content, case-insensitive).

**Does the app change anything in Dynatrace?**
Only three things: its own documents (the maps), the sharing permissions of those maps, and, when a root
cause analysis runs, the comments it posts on the analyzed problems. Every other permission on the
environment is **read** only.
