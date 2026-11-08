# Agent Guidelines for genericClient (Hyperborea)

A POC "Bruno-lite" for querying data from any API described by an OpenAPI spec, focused on
reads (GET), with write operations available too.
See `README.md` for the original idea. This file records the decisions made so far.

## Agreed decisions

### Architecture

- **Single Vite + Lit app** (TypeScript). No monorepo/workspaces like demoClient.
- The html pages (`index.html`, `popup.html`, `callback.html`, `silent-renew.html`) live in `src/`,
  which is Vite's `root`, so they are still served at `/`, `/popup.html`, ... (the redirect urls on
  the auth server). `public/`, `dist/` and the `.env` files stay in the project folder, set in
  `vite.config.ts` (`publicDir`, `build.outDir`, `envDir`).
- Runs on **http://localhost:8000** (the auth server accepts this origin; 8080 also allowed).
- **Client side routes with real paths** (no hash), `@lit-labs/router` in `src/components/appRoot.ts`:
  `/` the workbench (`workbenchPage.ts`), `/chart/{id}` a published chart (`chartPage.ts`), else a
  "nothing here" page. Each page is a lazily loaded chunk. Works because nginx (`try_files $uri
/index.html`) and the Vite dev server answer unknown paths with `index.html`; so `index.html`
  must load its script with an absolute path (`/main.ts`). Same-origin links without `target` are
  navigated by the router; open the others (spec link, new tab) with `target`.
- **No code generation** from the OpenAPI spec. The spec is fetched and **inspected at runtime**,
  so pointing the client at another environment/API only requires a different spec URL.
  - The spec document itself is typed with `openapi-types` (`OpenAPIV3.Document`); responses are
    treated as untyped "rows of unknown fields".
  - Local `$ref`s (`#/components/...`) are resolved by a small hand-written resolver. It must cope
    with `oneOf` / `allOf` (the union spec uses `oneOf` heavily, e.g. nullable wrappers).
  - Parsed spec is cached in memory per environment; a refresh action refetches it.
  - The schema is a **guide for building queries, not a guarantee** of the response shape
    (`$select` / `$apply` change it). Always render whatever comes back.
- **Installable PWA, manifest only** (`public/manifest.webmanifest`, icons rendered from
  `favicon.svg`). No service worker on purpose: nothing is cached offline, so frequent deploys show
  up on the next load. Add one only if offline use or caching becomes a need.
- The build version (`./build.sh 0.6` → build arg `HYPERBOREA_VERSION` → `__APP_VERSION__`) shows
  on the logo tooltip and the welcome page; `dev` outside a container build.

### Environment

One environment per deployment, configured by environment variables (see `src/environment.ts`):

| Variable                              |                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `HYPERBOREA_ENV_NAME`                 | Optional, currently not shown (badge removed, kept for later use)                                       |
| `HYPERBOREA_SPEC_URL`                 | Optional: predefined OpenAPI spec urls, comma separated; users can add more in the app                 |
| `HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT` | Optional: client id prefilled in the Authorization Code login dialog, e.g. `webclient` (not in OpenAPI) |

Strictly generic: the auth server and API base url come from the spec only (security schemes;
`servers` entry or the spec url's origin). `HYPERBOREA_AUTH_URL` and
`HYPERBOREA_API_BASE_URL` were removed on purpose; re-add only if it becomes valuable.

- **Development**: Vite reads `.env.development` (committed defaults) and
  `.env.development.local` (git ignored overrides).
- **Container**: the same variables are read at container start and written to `/config.js`
  (`window.__HYPERBOREA_ENV__`), which wins over build time values. Nothing from the `.env`
  files is baked into the production build.
- Missing required settings are shown as an error instead of the app (none are required now).
- **Added specs**: the header selector always shows (configured urls first, then added ones) with
  a + button: `addSpecDialog.ts` loads the spec before saving it, so a bad url or missing CORS is
  reported in the dialog. Added urls live in IndexedDB (`specs` store, `src/storage/specs.ts`),
  per browser; a trash button removes the selected one (configured ones cannot be removed). With
  no specs at all the main area asks for one, so a public demo can run without any configured.
- IndexedDB setup is shared in `src/storage/db.ts` (version 2 added the `specs` store).
- **Several specs**: `HYPERBOREA_SPEC_URL` may hold a comma separated list (an env value is
  always a string; commas do not occur in spec urls). The header shows a
  selector (urls as labels, they are self explanatory); the choice is remembered per browser
  (localStorage), loaded specs are cached. Switching resets the selected endpoint/saved query and
  sets up login from the new spec. Saved queries of another spec show as disabled.

### Auth

Login options are read from the spec's `securitySchemes` (`src/spec/security.ts`):

- **Authorization Code** (+ PKCE, `oidc-client-ts`; a user logs in) from an `openIdConnect` scheme
  (authority = discovery url) or an oauth2 `authorizationCode` flow (endpoints passed as metadata).
  Specs without such a scheme offer no Authorization Code login. Same dialog as Client Credentials
  (`loginDialog.ts`):
  client id (not part of OpenAPI; prefilled with the remembered one for this authority, else
  `HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT`) and scopes (see the scope rule below; `openid` is
  always required here, for the id token). Submitting opens the auth server's
  login. Errors the auth server reports back are shown in the dialog; a closed popup keeps it open.
- **Client Credentials** (a client logs in) from an oauth2 `clientCredentials` flow: dialog with
  client id, secret and scopes (see the scope rule below; with none selected there is no `scope`
  parameter, so the token gets all scopes the client is allowed; requesting a scope the client
  lacks fails the whole request), POST to the flow's `tokenUrl` (the auth server must allow CORS for the
  origin; Duende does when the origin is in any client's `AllowedCorsOrigins`).
  **The secret is never stored**, and the token is kept **in memory only**: after expiry or a page
  reload the client logs in again (decided for now; refresh later).
- The last client id that logged in successfully is remembered in localStorage per kind and auth
  server (`hyperborea.clientIds`, not sensitive), so one instance can switch between APIs.
- **Scope rule** (both flows): the dialog lists **only the scopes the scheme's flow defines**
  (`securitySchemes` flow `scopes`; strict, a scope only named in a `security` requirement is
  ignored) and **selects those the root `security` requirements name** for that scheme (all
  alternatives together). Authorization Code always offers and selects `openid`, so an
  `openIdConnect` scheme (no scope list) offers just `openid`. Operation level `security` is not read.
- Both offered: "Log in" is a menu (Authorization Code / Client Credentials). Header shows the identity (user or robot
  icon); the token dialog works for both.
- Resolved Authorization Code settings (authority, client id, scope; no secrets) are kept in sessionStorage
  so `callback.html` and `silent-renew.html`, which do not load the spec, use the same settings.
  On load or spec switch the stored login is restored when its authority matches the spec's.
- Authorization Code login and logout run in a **popup** (`popup.html`, like demoClient), so the app is not left.
  `popupAbortOnClose` is needed, otherwise oidc-client-ts never settles when the popup is closed or
  blocked. A blocked popup (detected when `window.open` returns nothing) falls back to the full
  page redirect (`callback.html`). Logout always removes the user locally, also when the popup
  is closed or the auth server does not return to `popup.html`.
- Redirect urls (same as demoClient, must be whitelisted for the client on the auth server):
  `/popup.html` (login and logout popup), `/callback.html` (redirect fallback),
  `/silent-renew.html` (silent renew), origin (logout redirect).
- **Silent renew** (`automaticSilentRenew`) for Authorization Code; on startup an expired stored token is
  renewed silently.

### Scope of features

- **All methods** (GET, POST, PUT, PATCH, DELETE) are listed; an operation's key is
  `"METHOD /path"` (`operationKey`). Saved queries from before hold the bare path and are read as
  GET (`listQueries`).
- **Reads come first**: everything about querying rows (OData editors and autocomplete, value
  actions, Next page, the `$count` default, auto send, and later list/chart views) is for GET only,
  gated by `isQuery(operation)` in `src/spec/openapi.ts`. New GET-only features use the same check.
- **Writes** (POST/PUT/PATCH/DELETE): path/query parameters as for GET, plus a JSON **body editor**
  (`src/components/bodyEditor.ts`, CodeMirror) when the spec has a JSON request body
  (`application/json` preferred, else another `…json` type). It starts with an example built from
  the schema (`src/spec/example.ts`: example/default values, else empty values per type, read only
  fields left out, nested arrays empty, self references null), checks the JSON as you type, and has
  Format and Example (reset) buttons. The body text lives in the parameter values under `body`, so
  it is remembered per operation and saved with a query. Invalid JSON is not sent; other body types
  (e.g. multipart) show a warning and are sent without a body.
  **A write is never sent automatically** (endpoint or saved query selected): only Send sends it,
  and the Auto switch is hidden. The response is shown in the same JSON view as for GET.
- The response schema is the 200 response, else the first other 2xx (201, …), else `default`.
- **OData** must be supported (all GETs in the OpenAPI spec declare `$filter`, `$select`, `$top`,
  `$skip`, `$orderby`, `$expand`, `$count`, `$search`, `$skiptoken`) but not required: any GET
  endpoint with plain query/path parameters must work too.
- **Show the full request URL** (with the method) at all times, with copy (and later copy-as-curl).
- **Paging**: a response with `@odata.nextLink` shows a "Next page" button. The link's query
  parameters replace the form's query values (it is the complete next request; path parameters
  are kept) and the request is sent, so the url bar always shows the real request. The link's
  host is ignored (servers behind a proxy may return an internal host). Parameters the endpoint
  does not declare become custom parameters. No "previous" yet ($skiptoken cannot go back).
- Response normalisation: turn any response into "an array of rows"
  (`{ value: [...] }` pagination wrappers, plain arrays from `$apply`, single objects).
- **Saved queries** (POC): stored in the browser's IndexedDB (`src/storage/savedQueries.ts`),
  so per browser and per origin (deployment), not shared between users or devices. A saved query
  is a name, the endpoint (operation key), all parameter values and the spec url.
  - Save button next to Send; the name defaults to the operationId (e.g. `GetGroups`). A query
    loaded from the list can be updated or saved as new.
  - Left column has tabs **Endpoints** / **Saved**; clicking a saved query opens its endpoint
    with the values filled in. Queries whose endpoint is missing from the spec are disabled.
  - Row actions live in a **⋯ menu** (`wa-dropdown`, shown on the hovered/selected row, always on
    touch screens; add new actions to `onMenu`). For now only "Delete…", confirmed inline.

### UI

- **Terms**: login code and UI use the OAuth flow names "Authorization Code" and "Client
  Credentials" (`LoginFlow` = `authorizationCode` | `clientCredentials`, as in OpenAPI), not
  user/client login; this is a developer tool.
- Branded **Hyperborea** (header, page title, start screen); folder, package, `HYPERBOREA_*`
  variables and browser storage (`hyperborea.*` keys, `hyperborea` IndexedDB) use the name too.
  `src/storage/migrate.ts` and `moveLegacyQueries` move storage from the former `genericClient`
  name once; remove them when no longer needed. The container image keeps the generic name.
- Start screen (no endpoint selected): `public/hyperborea.webp`, the circular map cut from
  Mercator's _Septentrionalium Terrarum descriptio_ (1595, public domain, Wikimedia Commons).
- Header logo: `public/logo.webp` (128 px), a circle around the yellow island (Hyperborea) from
  the same map: smallest circle enclosing the island, shifted 60 px south-east for some
  surroundings (centre 1666,1526, radius 621 on the 3261x3025 Commons original).
- Favicon: `public/favicon.svg` (3 KB), a simplified vector of the logo: the island coast traced
  from the map (polar scan from the pole, smoothed), the central sea and four rivers clipped to
  the coast, in cleaned-up map colours.
- Start screen background: `public/background.webp`, pre-blurred and compressed (28 kB from a
  6 MB Unsplash original), dimmed per theme with `--welcome-background-dim` (`src/styles.css`).
  Tried as whole-app background first, which was too much.
- [WebAwesome](https://webawesome.com/docs/components) (`wa-*`) components instead of plain HTML
  form/UI elements. Components are imported individually from `@awesome.me/webawesome`
  in `src/webawesome.ts`; a `wa-*` tag used for the first time must be added there.
- [Highcharts](https://www.highcharts.com/) for graphs.
- Exception: **CodeMirror 6** for the OData expression editor (`src/components/odataEditor.ts`),
  since WebAwesome has no autocomplete/editor component. It is styled with WebAwesome tokens.

### Endpoint tree

- Levels: folder → tag → endpoint (`src/spec/grouping.ts`, rendered by `operationBrowser.ts`).
- **Folder rule**: tags whose endpoints share the first path segment after version prefixes
  (`v1`, `v2`, `api`) form a folder named after that segment, when 2 or more tags share it
  (`/v2/checklists/...` → `checklists`). Single-tag resources stay at the top level.
  Chosen over tag-name prefixes, which are API specific and mis-group (DataSources vs DataLists).
- A spec with the `x-tagGroups` extension (Redoc) is grouped by that instead.
- Structure is computed from all endpoints, then filtered, so folders stay stable while typing.
- Expanded state is set imperatively in `updated()` (wa-tree resets `expanded` on items created
  inside an existing branch): a filter change opens all matches, or only the path to the
  selected endpoint when cleared.

### Parameter chips (hidden optional parameters)

- Only **pinned** parameters are always shown: path, required, `$filter` and `$count`. Every other
  query parameter (OData or not) is a **chip** until used. A parameter is shown while its key
  exists in the values, even with an empty value, so no extra state is stored: saved queries,
  value actions and next links bring their fields back by having values.
- Clicking a chip adds an empty value and focuses the field. An **empty unpinned field folds back
  into its chip on blur** (checked once focus settles, and after a click ends, so the chips do not
  move under the pointer).
- **Custom parameters**: values may hold query keys the spec does not declare (undocumented
  parameters). `buildUrl` sends them after the declared ones (`customQueryNames`). Added with
  the `Custom…` chip (name input, Enter); labelled "(not in spec)". Editors are chosen by name, so
  a custom `$expand` still gets autocomplete.
- OData reads also offer the **known OData options the spec does not declare** (`$apply`,
  `$compute`, ...) as plain chips. Declared hidden parameters are outlined chips.
- One chip row: at the bottom of the OData section when the endpoint has one, else in the Query
  parameters group (shown even without parameters, so `Custom…` is always reachable).

### Insert from token

- **Right-click** a text parameter field (path, query, OData editors; not selects) opens an
  "Insert from token" menu at the pointer with claims of the access token (`insertableClaims` in
  `src/auth/claims.ts`: `sub`, `email`, `preferred_username`, `username`, `name`, `client_id`;
  only those the token has). For a user, claims the access token lacks (often `email`) come from
  the id token. The menu always opens, also with nothing to insert: then a disabled item says
  why (not logged in, opaque token, none of the claims; `noInsertableReason`), so it never fails
  silently. **Shift+right-click** keeps the browser's menu (copy/paste is Ctrl+C/V anyway).
- The value replaces the selection / goes in at the cursor (in the OData editors a right-click
  outside the selection moves the cursor there first). In OData editors it is written as a
  literal (`literalAtCursor` in `src/odata/valueActions.ts`): inside an open `'…'` only quotes are
  doubled, else guids bare and the rest `'text'`. Plain fields get the raw value.
- An empty optional field does not fold into its chip while the menu is open; it gets focus back
  when the menu closes.

### OData form layout

- **No hint lines**: every parameter description (and the editors' help texts) is hover text
  (`title`), to get the response up the page. Placeholders stay in the fields.
- The rules below apply to the fields that are shown (see Parameter chips).
- First row: `$search`, `$orderby`, then the **compact** fields (every number or true/false
  parameter: `$top`, `$skip`, `$count`, `$pageSize`, ...), then `$skiptoken`. Text fields share the
  rest (`min-width: 0`, else WebAwesome inputs refuse to shrink); narrow windows wrap the row.
- The OData editors are as tall as a WebAwesome input (one line, growing when the text wraps)
  and use the same label spacing, so rows line up.
- Then `$filter` (full width) and any other parameters, then `$select` (left) and `$expand`
  (right) sharing a row 50/50; top aligned, so each grows downwards on its own when it wraps.
  Goal: get the response up the page (open OData section went from 716 to ~334 px).

### Response view

- JSON responses are shown in a read only **CodeMirror** (`src/components/jsonView.ts`, like
  Bruno): fold arrows on every object/array, line numbers, Ctrl+F search, syntax colors shared
  with the OData editor (`src/codemirror/highlight.ts`). CodeMirror renders only visible lines,
  so large pages stay fast. Toolbar: Expand all, Show depth 1/2/3 (depth 1 keeps the top object
  open with its children collapsed; CodeMirror's own foldAll would collapse the whole document).
- **Value actions** (POC): clicking a value (or its property name) shows an action bar above it
  (CodeMirror tooltip): `= filter`, `≠ filter`, `↑/↓ sort`, `+ select`, `copy`. The JSON view only
  reports the path and value (`src/codemirror/jsonTarget.ts`); the request editor decides the
  actions with the spec's row model (`src/odata/valueActions.ts`): path `value[n].parent.name` →
  `parent/name`, literal by field type (`'text'` with `''` escaping, enums quoted, numbers/bools/
  null bare, dates and guids unquoted). Filters are appended with `and` (an existing `or` is
  wrapped in parentheses); sort replaces `$orderby`; select/sort only for top level fields.
  A new filter or sort clears `$skip`/`$skiptoken`. Then the query is sent automatically (see
  Auto send).
  Not yet: values inside collections (`users[0].role`, needs `any()`), drill down to `{id}`.
- Chosen over tree viewers (`@andypf/json-viewer`, `@alenaksu/json-viewer`, `vanilla-jsoneditor`):
  CodeMirror is already in the bundle, renders large responses virtually and keeps text selection.
  Non JSON responses stay a plain `<pre>`.

### Auto send (experiment)

- Queries are sent automatically **only when logged in** (any flow) and the **Auto** switch in
  the url bar is on (default on, remembered in localStorage `hyperborea.autoSend`, `src/autoSend.ts`).
- Triggers: selecting an endpoint, selecting a saved query (OData options collapse), value actions,
  a parameter's clear button (also `odata-editor`, which emits `clear`).
  Not on typing in parameters or after login.
- Selecting an endpoint with missing required parameters (e.g. `{id}`) silently does not send;
  only Send reports them. Logged out or switched off, a selected saved query is only loaded.

### Model tab (documentation)

- The request editor has two tabs: **Query** (default: url, parameters, response) and **Model**.
- `src/components/modelView.ts` shows what a write takes (Request body section: type, fields,
  required) and what the endpoint returns (`getResponseModel` in
  `src/spec/fields.ts`): list or single item, schema names, and a field table (type, nullable,
  enum values, description). Related types (navigation / collections) expand inline, recursively.
  Polymorphic (`oneOf`) responses list each type, expandable.
- A **paged response object** is shown as it is (OData `{ value, @odata.count, @odata.nextLink }`,
  or e.g. `{ total, page, values }` of APIs without OData) with its list field expanded. Rule
  (`findListField`): exactly one collection of objects, all other fields numbers or `@` annotations,
  so an entity with one collection (`{ id, title, elements }`) is not mistaken for a page.
- **No depth limits** on expanding related types (Model tab, `$expand`): rendering is lazy, and
  the API enforces its own `MaxExpansionDepth` with a 400 error. Instead a **↻ marker** flags a
  back-reference: a related type that already appears further up via another type
  (Group → users: UserGroup → group: Group). Direct self-references like `parent` are a
  hierarchy and not marked. Rule: `isBackReference` in `src/spec/fields.ts`, used by the Model
  tab and the `$expand` suggestions.

### OData autocomplete

- `src/spec/fields.ts`: fields of a response row from the spec (type, format, enum, single
  navigation like `parent`, collections like `users`). Field names are camelCase, as the API expects.
- `src/odata/filterCompletion.ts`: pure, editor independent completion rules for `$filter`. It
  tokenizes the text before the cursor and decides what comes next: operand (fields, `nav/`,
  functions, `not`, `(`), operator (by type), value (enum values, true/false, dates, `'…'`),
  connector (`and`/`or`/`)`, or `,`/`)` inside calls and `in (...)` lists).
- Accepting a suggestion opens the next suggestions. Functions insert snippets, Tab moves
  between placeholders. Enter accepts a suggestion, or sends the request when none is open.
- `src/odata/selectCompletion.ts`: `$select` suggests the row's own fields, skipping ones
  already selected. Fields of related entities are selected in `$expand`
  (`$expand=parent($select=name)`), so navigation/collection fields are not offered.

- `src/odata/expandCompletion.ts`: `$expand` suggests navigation fields (single and collection)
  and `*`; inside `name(...)` the nested options (`$select`, `$expand`, and for collections also
  `$filter`, `$orderby`, `$top`, `$skip`, `$count`, separated by `;`). Option values reuse the
  `$select` / `$filter` rules on the related entity's fields; nested `$expand` is recursive.
  Also holds `completeOrderby` (field, then `asc`/`desc`), used for nested `$orderby`.

- `src/odata/applyCompletion.ts`: `$apply` (often undeclared in the spec, added from the chip;
  the row type is the same, so the response schema drives it). Transformations separated by `/`:
  `filter(...)` and `compute(...)` expressions reuse the `$filter` rules; `groupby((fields),
aggregate(...))` and `aggregate(field with method as alias, $count as alias)` step through
  field, `with`, method (sum/average only for numbers), `as`. Each step changes the rows, so later
  steps complete on the grouped fields plus the aliases defined so far.

#### Known limitations (accepted for now)

- `$filter`: no `any`/`all` lambdas, so collection fields (e.g. `users`, `boards`) are not
  suggested. Only single navigation (`parent/name`) is supported.
- `$filter`: suggestions only, no validation (unknown fields or wrong types are not marked).
  Function list covers the common OData functions, not all (no `cast`, `isof`, geo functions).
- Value suggestions are generic (enum values, true/false, today's date, `'…'`); no lookups of
  real values from the API.
- Field info comes only from the OpenAPI spec (no OData `$metadata` endpoint exists). Fields
  missing from the response schema cannot be suggested.
- No autocomplete yet for top level `$orderby` (rules exist, only used nested).
- `$apply`: only `filter`, `groupby`, `aggregate` and `compute` (what ASP.NET Core OData
  supports); no `topcount`, `concat`, ... Types of `compute` aliases are unknown.
- Suggestions open ~100 ms after typing; pressing Enter before that sends the request.
- Bundle size is not a priority: the app is meant to replace heavy desktop tools like Bruno.
  CodeMirror adds ~330 kB (~105 kB gzipped).

### Chart view

- A **Chart** switch in the response status row (shown when the body holds rows: a plain array or
  `{ value: [...] }`) replaces the JSON view with `src/components/chartView.ts`; it stays on for
  the next responses.
- Columns come from the **rows that came back**, not the schema (`$select` / `$apply` change the
  shape): nested objects flatten to paths (`parent/name`), annotations and arrays are skipped
  (`src/chart/rows.ts`). Kinds: number, date (ISO strings), text.
- **Chart types** (`chartSpecs` in `src/chart/rows.ts`: which controls each type shows and what
  they are called; `fitType` makes the config valid when switching type). Options are built per
  type in `src/chart/options.ts`, the view (`chartView.ts`) only renders controls and draws.
  - Column / Bar / Line / Area: X, Y (several numbers or "Number of rows"), Split by, Stacking
    (none, stacked, 100% with % axis and tooltip; not line), Sort (X order, largest/smallest first
    by the category total). **Line/Area with a date X get a time axis** (gaps spaced in time, no
    Sort); dates are "wall clock as UTC" (`toTime`) since Highcharts shows UTC.
  - Heatmap: X, Y (= the split field, required), Value. One blue sequential ramp (own light and
    dark steps), values in the cells up to 150 cells, Sort orders both axes by totals.
  - Pareto: Category, Value; largest first with the running total. Bars show each category's
    **share**, so the running total fits the same 0-100% axis (no second axis), 80% line; the
    tooltip has the values.
  - Treemap: Group, Size, optional Subgroup (nested; click a group to zoom in). Groups get the
    categorical colors, max 8 (the smallest fold into Other).
  - Scatter: X (number or date), Y (number), Color by; one dot per row, named by the row's text
    fields (the grouped fields of an `$apply`). Max 3 colors (all pairs must stay apart).
- Defaults: first
  text column (not an id) on X, the **last** number on Y (`$apply` puts aggregates last). The
  config is remembered per set of columns while the app is open.
- Rows sharing an X (and split) value are summed, with a note. Max 8 series: the smallest split
  values fold into "Other" (summed), with a note. Number/date X is sorted, text X keeps the
  response order (`$orderby`).
- Highcharts (`highcharts/esm`, plus the heatmap, treemap and accessibility modules) is **loaded on first use**, its
  own chunk. Colors: the validated default categorical palette (fixed order, light and dark
  steps; the main product's `--dl-chart-*` palette fails the color vision checks). Chrome (text,
  grid, tooltip) from WebAwesome tokens; redrawn when the theme class on `<html>` changes.
- Legend only with 2+ series (one series is named by the Y axis title). Shared tooltip.
- **One row** with numbers (e.g. `aggregate(...)` without `groupby`) shows big figures (one tile
  per number column, text columns as a context line) instead of a chart.

### Published charts

- **Publish** in the chart view (reads only) opens a dialog with a title, then saves the request
  **as it is now** (values) with `chart: { title, config, auth, publishedAt }` on the saved query
  (`PublishedChart` in `src/storage/savedQueries.ts`; an optional field, same store, no version
  bump). A loaded saved query is updated, else a new one is saved, named by the title. The dialog
  shows the link `/chart/{id}` (copy, open). "Update" in the save dialog keeps the chart, "Save as
  new" starts without one.
- Loading a saved query with a chart switches the response to the chart with its settings
  (`chartPreset`). The saved list marks published queries with a chart icon; their ⋯ menu has
  "Open chart" (new tab) and "Unpublish chart".
- `/chart/{id}` (`chartPage.ts`): loads the saved query and its spec, logs in, sends the request
  and shows only the chart (`chart-view readonly`), title, "updated" time, refresh, auto refresh
  (off / 1 / 5 / 15 / 60 min, kept in the url as `?refresh=5` for screens; skipped while the tab is
  hidden). Only the first page of the response; a note says so when there is a next link.
- **Login on the chart page**: login state is per tab (`sessionStorage`), so a new tab has none.
  The chart stores the Authorization Code login it was published with (authority, client id,
  scopes; no secrets, `currentAuthorizationCodeConfig`). `loginSilently` restores this tab's
  login or tries `signinSilent` (hidden iframe, works while the auth server session lives and the
  browser sends its cookie to the auth server from the iframe). Otherwise a **Log in** button
  (popup with the stored client; the login dialog when the chart has no stored login, e.g.
  published while logged in with Client Credentials only). Client Credentials logins are not
  restored (secret in memory only): published charts are for user logins.
- POC limit: saved in IndexedDB, so a link only works **in the browser that published it**.
  Sharing needs server side storage.

## Roadmap

1. ✅ Load spec, list operations grouped by tag, edit parameters, show/copy full URL,
   execute, show raw JSON.
2. Schema-driven query builder: `$select` checkboxes, `$orderby` field + direction,
   `$filter` rows (field / type-aware operator / value), raw text still available.
3. List/table view of rows with sorting.
4. ✅ Highcharts view with field mapping (X, Y(s), series/group-by, chart type), works nicely with
   `$apply` (`groupby` / `aggregate`). First version: see Chart view.
5. Later: query state in URL hash, copy-as-curl, Client Credentials, shared (server side) saved queries.

## Commands

- `npm install`
- `npm run dev` – dev server on port 8000
- `npm run build` – type-check (`tsc --noEmit`) and production build
- `npm run typecheck`

```sh
podman build -f build/Containerfile -t generic-client .
podman run -p 8080:8080 \
  -e HYPERBOREA_SPEC_URL=https://petstore3.swagger.io/api/v3/openapi.json \
  generic-client
```

- `build/30-write-runtime-config.sh` writes every `HYPERBOREA_*` variable to `config.js` on
  start, so a new variable needs no change there.
- `build/security-headers.conf` holds CSP and security headers. `connect-src` is open because
  spec, API and auth urls are runtime config; `data:` is needed for WebAwesome icons.
  `frame-src 'self' https:` for the silent renew iframe, since the auth server comes from the spec.

## Code style

- Double quotes, no semicolons, 2-space indent, 100 char lines (same as demoClient).
- TypeScript strict mode; avoid `any`.
- Lit legacy decorators (`experimentalDecorators: true`, `useDefineForClassFields: false`).
