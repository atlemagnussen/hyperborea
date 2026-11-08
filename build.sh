#!/usr/bin/env bash

# Usage: ./build.sh [version]   (defaults to VERSION below)
set -euo pipefail

VERSION="${1:-0.3}"
IMAGE="hyperborea"

# build context is the folder of this script, wherever it is called from
cd "$(dirname "$0")"

echo "Building $IMAGE:$VERSION"
docker build -f build/Containerfile --build-arg HYPERBOREA_VERSION="$VERSION" -t "$IMAGE:$VERSION" -t "$IMAGE:latest" .

docker push "$IMAGE:$VERSION"
docker push "$IMAGE:latest"

echo "Pushed $IMAGE:$VERSION and $IMAGE:latest"
