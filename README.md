# The generic client

A OpenAPI spec client

- inspect models
- Run queries if authentication is set up
- OData aware with autocomplete when typing expressions
- autocomplete in JSON body based on the model

## build and run

```sh

docker build -f ./build/Containerfile -t hyperborea:latest .

docker run --name hyperborea-app -d --rm -p 8080:8080 \
  -e "HYPERBOREA_ENV_NAME=Test" \
  -e "HYPERBOREA_SPEC_URL=https://petstore3.swagger.io/api/v3/openapi.json" \
  hyperborea:latest

```
