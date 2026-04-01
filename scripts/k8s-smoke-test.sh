#!/bin/bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODECONTAINER_BIN="${CODECONTAINER_BIN:-node \"$REPO_ROOT/dist/main.js\"}"
PROJECT_PATH="${1:-$REPO_ROOT}"
NAMESPACE="${CODECONTAINER_K8S_NAMESPACE:-}"
CONTEXT="${CODECONTAINER_K8S_CONTEXT:-}"
REGISTRY="${CODECONTAINER_K8S_REGISTRY:-}"
KEEP_RESOURCES="${KEEP_RESOURCES:-0}"
RUN_LOGIN="${RUN_LOGIN:-0}"
RUN_REMOTE="${RUN_REMOTE:-0}"

if [ ! -f "$REPO_ROOT/dist/main.js" ]; then
  echo "dist/main.js not found. Run 'npm run build' first."
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required for the Kubernetes smoke test."
  exit 1
fi

run_codecontainer() {
  local args=()
  while [ "$#" -gt 0 ]; do
    args+=("$1")
    shift
  done

  local cmd=(node "$REPO_ROOT/dist/main.js")
  cmd+=("${args[@]}")
  if [ -n "$NAMESPACE" ]; then
    cmd+=("--namespace" "$NAMESPACE")
  fi
  if [ -n "$CONTEXT" ]; then
    cmd+=("--context" "$CONTEXT")
  fi
  if [ -n "$REGISTRY" ]; then
    cmd+=("--registry" "$REGISTRY")
  fi

  "${cmd[@]}"
}

kubectl_base() {
  local cmd=(kubectl)
  if [ -n "$CONTEXT" ]; then
    cmd+=(--context "$CONTEXT")
  fi
  if [ -n "$NAMESPACE" ]; then
    cmd+=(-n "$NAMESPACE")
  fi
  "${cmd[@]}" "$@"
}

resource_name() {
  node -e '
    const crypto = require("crypto");
    const path = require("path");
    const projectPath = process.argv[1];
    const base = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
    const hash = crypto.createHash("sha1").update(projectPath).digest("hex").slice(0, 8);
    const name = `codecontainer-${base}-${hash}`.slice(0, 63).replace(/-$/, "");
    process.stdout.write(name);
  ' "$PROJECT_PATH"
}

POD_NAME="$(resource_name)"
PVC_NAME="${POD_NAME}-data"
PROJECT_BASENAME="$(basename "$PROJECT_PATH")"
REMOTE_PATH="/workspace/$PROJECT_BASENAME"
MARKER_PATH="/root/persist/.codecontainer-k8s-smoke-marker"
MARKER_VALUE="ok-$(date +%s)"

cleanup() {
  if [ "$KEEP_RESOURCES" = "1" ]; then
    echo "Keeping Kubernetes resources for inspection."
    return
  fi

  echo "Cleaning up Kubernetes pod and PVC..."
  run_codecontainer remove --k8s "$PROJECT_PATH" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "==> Building Kubernetes image"
run_codecontainer build --k8s

echo "==> Starting Kubernetes pod"
run_codecontainer run --k8s "$PROJECT_PATH"

echo "==> Verifying pod and PVC exist"
kubectl_base get pod "$POD_NAME" >/dev/null
kubectl_base get pvc "$PVC_NAME" >/dev/null

echo "==> Verifying required tools and workspace"
kubectl_base exec "$POD_NAME" -- bash -lc "command -v git && command -v claude && test -d '$REMOTE_PATH'"

echo "==> Verifying PVC persistence marker"
kubectl_base exec "$POD_NAME" -- bash -lc "printf %s '$MARKER_VALUE' > '$MARKER_PATH'"
run_codecontainer stop --k8s "$PROJECT_PATH"
run_codecontainer run --k8s "$PROJECT_PATH"
kubectl_base exec "$POD_NAME" -- bash -lc "test \"\$(cat '$MARKER_PATH')\" = '$MARKER_VALUE'"

if [ "$RUN_LOGIN" = "1" ]; then
  echo "==> Running interactive Claude login"
  run_codecontainer login --k8s "$PROJECT_PATH"
fi

if [ "$RUN_REMOTE" = "1" ]; then
  echo "==> Starting interactive Claude Remote Control"
  run_codecontainer remote --k8s "$PROJECT_PATH"
fi

echo "Smoke test passed."
