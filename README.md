# Hyperborea

**A query workbench for any API described by an [OpenAPI](https://www.openapis.org/) spec.**

Point it at a spec URL and you get a browsable endpoint tree, login from the spec's security
schemes, schema-aware editors for parameters and request bodies, and a response view you can
filter, sort and chart. It reads the spec at runtime, so there is no code to generate:
pointing it at another API only takes another URL.

## How it differs from Swagger UI

[Swagger UI](https://swagger.io/tools/swagger-ui/) is API _documentation_ with a "Try it out"
button. Hyperborea is for _working with the data_ behind the API, closer to Postman or Bruno, but
driven entirely by the spec:

| | Swagger UI | Hyperborea |
| --- | --- | --- |
| Main purpose | Reference docs | Querying and exploring data |
| Query parameters | Plain text fields | OData editors with autocomplete from the response model (`$filter`, `$select`, `$expand`, `$orderby`, `$apply`) |
| Responses | Raw JSON | Foldable, searchable JSON. Click a value to filter, sort or select by it |
| Visualisation | None | Charts from the rows that come back, publishable as an auto-refreshing link |
| Request bodies | Example JSON | Example JSON plus autocomplete from the schema |
| Saving work | None | Saved queries |
| Login | Paste a token, or authorize | Authorization Code + PKCE (popup, silent renew) and Client Credentials, both read from `securitySchemes` |

OData is supported but not required: any endpoint with plain path and query parameters works.

## Features

- **Endpoint tree**: grouped by tag, and into folders by path. Uses `x-tagGroups` when the spec
  has it. Filter as you type, or show reads (GET) only.
- **OData autocomplete**: suggests fields, operators, functions and enum values from the schema.
  Steps through `$apply` pipelines (`filter`, `groupby`, `aggregate`, `compute`).
- **Value actions**: click a value in the response to `= filter`, `≠ filter`, sort, select or
  copy. The query is updated and re-sent.
- **Paging**: follows `@odata.nextLink`.
- **Charts**: column, bar, line, area, heatmap, Pareto, treemap and scatter, made from the
  response rows. Works well with `$apply` aggregations. Publish a chart as a `/chart/{id}` link
  with auto refresh, for wall screens.
- **Model tab**: the request and response models as field tables, with related types expanding
  inline.
- **Writes**: POST, PUT, PATCH and DELETE, with a JSON body editor that starts from an example
  built from the schema. Writes are only sent when you press Send.
- **Any API**: add a spec URL in the app (remembered in the browser), or predefine them per
  deployment, and switch between them.
- **Insert from token**: right-click a parameter field to insert a claim from your access token
  (`sub`, `email`, ...).
- Light and dark theme. Installable as a PWA.

## Run it

```sh
docker build -f ./build/Containerfile -t hyperborea:latest .

docker run --name hyperborea-app -d --rm -p 8080:8080 \
  -e "HYPERBOREA_ENV_NAME=Test" \
  -e "HYPERBOREA_SPEC_URL=https://petstore3.swagger.io/api/v3/openapi.json" \
  hyperborea:latest
```

Then open http://localhost:8080.

### Configuration

Set as environment variables on the container. They are read when the container starts, so one
image serves any API.

| Variable | |
| --- | --- |
| `HYPERBOREA_SPEC_URL` | Optional. Predefined OpenAPI spec URLs, comma separated. Users can always add their own in the app |
| `HYPERBOREA_ENV_NAME` | Optional name of the environment |
| `HYPERBOREA_DEFAULT_AUTH_CODE_CLIENT` | Optional client id prefilled in the Authorization Code login |

The auth server and API base URL come from the spec itself (`securitySchemes`, `servers`).
The API and auth server must allow CORS from Hyperborea's origin. For Authorization Code login,
register `/popup.html`, `/callback.html` and `/silent-renew.html` as redirect URLs for the client.

### Develop

```sh
npm install
npm run dev   # http://localhost:8000
```

`.env` holds reference values. Put your own in `.env.development`, which git ignores.

## Limitations

- Saved queries and published charts live in the browser (IndexedDB). A chart link only works in
  the browser that published it.
- Only local `$ref`s (`#/components/...`) are resolved.
- No `any`/`all` lambdas in `$filter` yet.

## Credits

The name and artwork come from Gerardus Mercator's map of the North Pole,
_Septentrionalium Terrarum descriptio_ (1595, public domain), which shows the mythical island of
Hyperborea.
