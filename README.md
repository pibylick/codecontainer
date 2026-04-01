# codecontainer

AI Development Environment for Coding Agents

Run Claude Code, Codex CLI, Gemini CLI, and OpenCode in isolated project containers.

`codecontainer` gives you a local AI development environment with safer defaults, persistent per-project containers, and built-in support for Docker, Podman, and Apple Container.

Use it when you want local AI coding, containerized development, and a practical sandbox for AI agents without building your own workflow from scratch.

The container image also includes browser automation tooling for agent-driven UI checks:
- Playwright with Chromium for deterministic headless E2E tests
- `agent-browser` for quick interactive smoke checks and debugging

Supports **Docker**, **Podman** (Linux), and **Apple Container** (macOS 26+) with automatic runtime detection.

## Why This Exists

Running AI coding agents directly on your host machine gets risky quickly:
- they can modify the wrong files
- they can break local toolchains and dependencies
- they can access secrets and config you did not mean to expose

`codecontainer` solves this by creating a containerized development environment for each project, so AI agents can work locally with better isolation, repeatability, and safety.

## Why Not Docker Alone?

Docker gives you containers, but it does not give you an opinionated local AI coding setup.

`codecontainer` adds the missing layer for AI-assisted development:
- per-project persistent containers
- agent-specific setup for Claude, Codex, Gemini, and OpenCode
- shared harness configs across projects
- optional yolo mode contained inside the sandbox
- browser testing tools available in the default image

## How It Works

```text
Host machine
  -> codecontainer
  -> Project container
  -> AI coding agent
  -> Your codebase
```

This makes `codecontainer` useful both as an AI agents sandbox and as a repeatable AI development environment for local coding workflows.

## Use Cases

- Run Claude Code, Codex CLI, Gemini CLI, or OpenCode in an isolated container
- Create a containerized dev environment for local AI coding
- Keep project dependencies and agent state separate across repositories
- Test AI-generated UI changes with Playwright or `agent-browser`

## FAQ

### What is codecontainer?

`codecontainer` is a CLI that creates a local AI development environment inside containers. It is designed for developers who want to run AI coding agents locally with better isolation and repeatable project setup.

### Which AI coding agents does it support?

It supports Claude Code, Codex CLI, Gemini CLI, and OpenCode. You select which agents to install during setup.

### Why use codecontainer instead of Docker alone?

Docker gives you raw containers. `codecontainer` adds agent-aware setup, per-project persistence, shared harness configs, permission choices, browser tooling, and a workflow designed specifically for local AI coding.

### Is this a good fit for local AI coding?

Yes. If you want a local AI coding setup that reduces risk to your host machine while keeping your workflow fast, this is the main use case.

### Does it work as an AI agents sandbox?

Yes. Each project runs in its own container, which makes `codecontainer` useful as an AI agents sandbox for experimenting with code changes, tool installs, and agent-driven browser testing.

### Which container runtimes are supported?

`codecontainer` supports Docker, Podman on Linux, and Apple Container on macOS 26+ with Apple Silicon. Runtime detection is automatic, but you can override it with an environment variable.

### Can I use it as a containerized development environment even without AI?

You can, but the product is optimized for AI-assisted development. The main value is the combination of containerized development and agent-specific setup for Claude, Codex, Gemini, and OpenCode.

## Quickstart

### Prerequisites

- **Container Runtime** (one of):
  - **Apple Container** (macOS 26+, Apple Silicon) — [github.com/apple/container](https://github.com/apple/container) — auto-detected
  - **Podman** (Linux) — [podman.io](https://podman.io/) — auto-detected on Linux when available
  - **Docker** — [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine
- **Node.js** 18+

### Installation

```bash
npm install -g @pibylick/codecontainer
```

### Setup

```bash
codecontainer init    # Select agents, configure certs, copy configs
codecontainer build   # Build container image
```

During `init`, you will:
1. Choose which AI agents to install (Claude Code, OpenCode, Codex CLI, Gemini CLI)
2. Copy harness configs from `~/` to `~/.code-container/configs/`
3. Enable/disable yolo mode (full permissions inside container)
4. Select CA certificates from your system keystore to include in the image
5. Configure experimental Kubernetes defaults for `--k8s` commands

### Usage

```bash
cd /path/to/your/project
codecontainer              # Enter container for current directory
```

Inside the container, start your harness and develop as normal. Container state persists across sessions.

### Commands

```bash
codecontainer                  # Enter the container
codecontainer run /path/to     # Enter container for specific project
codecontainer build            # Build container image
codecontainer build --k8s      # Build Kubernetes image variant
codecontainer login --k8s      # Run Claude login flow in Kubernetes
codecontainer remote --k8s     # Start Claude Remote Control in Kubernetes
codecontainer init             # Configure agents, certs, and permissions
codecontainer sync             # Re-sync config files from host
codecontainer list             # List all containers
codecontainer stop             # Stop current project's container
codecontainer remove           # Remove current project's container
codecontainer clean            # Remove all stopped containers
```

## Experimental Kubernetes Mode

`codecontainer` also includes an experimental Kubernetes backend for persistent remote pods. The K8s image uses the same Dockerfile and selected CA certificates as the local image, but is tagged separately so you can work locally and on Kubernetes without image drift.

Kubernetes mode currently focuses on a simple Claude Remote Control workflow:

```bash
codecontainer build --k8s
codecontainer run --k8s
codecontainer login --k8s
codecontainer remote --k8s
```

What it does:
- builds a Kubernetes-tagged image from the same base Dockerfile
- creates a pod plus PVC for persistent agent state and workspace data
- keeps Claude config and login state on the PVC
- opens official `claude auth login` inside the pod, without storing your Claude token in `codecontainer`
- starts `claude remote-control` inside the pod through a wrapper command

Current limitations:
- Kubernetes mode requires `kubectl` access to a cluster
- local project files are copied into the pod on first run instead of being bind-mounted
- `.codecontainer.json` mounts and `runArgs` are ignored in Kubernetes mode
- `clean` is still local-only

## Features

### Agent Selection

Choose which AI coding agents to install during `init` and `build`. Only selected agents are installed in the container image, keeping it lean.

### CA Certificate Management

During `init`, codecontainer extracts CA certificates from your OS trust store and lets you pick which to include:

- **macOS**: Reads from System Keychain (`/Library/Keychains/System.keychain`)
- **Windows**: Reads from Certificate Store (`Cert:\LocalMachine\Root`)
- **Linux**: Place `.crt` files manually in `~/.code-container/certs/`

### Customization

**Adding tools/packages**: Edit `~/.code-container/extra_packages.apt` and rebuild. These packages are installed in the final build layer:

```text
postgresql-client
redis-tools
```

**Adding mount points**: Edit `~/.code-container/MOUNTS.txt`:

```
/absolute/path/on/host:/path/in/container
/absolute/path/on/host:/path/in/container:ro
```

**Adding Docker flags**: Edit `~/.code-container/DOCKER_FLAGS.txt`:

```
-p 3000:3000
--network host
--gpus all
```

### Per-Project Configuration

Add a `.codecontainer.json` file to any project root to declare container settings per-project:

```json
{
  "name": "my-project",
  "forwardPorts": [3000, 5432],
  "containerEnv": {
    "DATABASE_URL": "postgres://localhost:5432/mydb",
    "NODE_ENV": "development"
  },
  "packages": ["postgresql-client", "redis-tools"],
  "mounts": ["~/.aws:/root/.aws:ro"],
  "runArgs": ["--cpus=4"],
  "postCreateCommand": "npm install"
}
```

All fields are optional. Per-project config merges additively with global settings — global mounts and flags are always preserved.

| Field | Description |
|-------|-------------|
| `name` | Display name and container hostname |
| `forwardPorts` | Ports to map from container to host (replaces default port 3000) |
| `containerEnv` | Environment variables set inside the container |
| `packages` | Apt packages installed at runtime on first container creation |
| `mounts` | Additional volume mounts (additive with global mounts) |
| `runArgs` | Extra Docker/Podman run flags (skipped on Apple Container) |
| `postCreateCommand` | Command run after container creation (after packages) |

**Security:** Fields that execute as root or expose host resources (`runArgs`, `packages`, `postCreateCommand`, `mounts`, `containerEnv`) require user confirmation on first use. Acceptance is stored per config hash — if the file changes, you are prompted again.

**Config drift:** If `.codecontainer.json` changes between sessions, you are prompted to recreate the container.

### Browser Testing

The default image ships with:

- `@playwright/test`
- Playwright-managed `chromium`
- `agent-browser`

Typical workflow inside the container:

```bash
# Start your app first, then run headless E2E
npx playwright test

# Quick smoke/debug session driven by an agent
agent-browser open http://host.docker.internal:3000
agent-browser snapshot -i
```

If your app is running on the host and you use Docker, add host access in `~/.code-container/DOCKER_FLAGS.txt` if needed:

```text
--add-host=host.docker.internal:host-gateway
```

For stable regression coverage, prefer Playwright tests committed to the repo. Use `agent-browser` mainly for exploratory checks, reproductions, and fast validation while coding.

### Runtime Detection

Automatic detection of the best container runtime:

- **macOS (Apple Silicon)**: Uses Apple Container if installed, falls back to Docker
- **Linux**: Uses Podman if installed, falls back to Docker
- **WSL / other**: Uses Docker

Override with `CODE_CONTAINER_RUNTIME` env var:
```bash
CODE_CONTAINER_RUNTIME=docker codecontainer          # Force Docker
CODE_CONTAINER_RUNTIME=podman codecontainer          # Force Podman
CODE_CONTAINER_RUNTIME=apple-container codecontainer  # Force Apple Container
```

### Security

- Host filesystem protected — destructive operations only affect the container
- Project isolation prevents cross-contamination
- Git config and SSH keys mounted read-only
- Yolo mode (full agent permissions) only affects the container, not your host

> **Note:** Network access is available inside containers. Do not work with unverified software. Sensitive information (OAuth tokens, API keys, SSH keys) may be exposed to code running inside the container.

### Simultaneous Work

Multiple agents/terminals can work on the same project simultaneously. Container stops automatically when the last session exits.

## Uninstalling

```bash
npm uninstall -g @pibylick/codecontainer
rm -rf ~/.code-container
```

## License

MIT — see [LICENSE](LICENSE).

Based on [code-container](https://github.com/kevinMEH/code-container) by Kevin Liao.
