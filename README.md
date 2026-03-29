# codecontainer

Isolated container environments for AI coding harnesses (Claude Code, OpenCode, Codex CLI, Gemini CLI).

The container image also includes browser automation tooling for agent-driven UI checks:
- Playwright with Chromium for deterministic headless E2E tests
- `agent-browser` for quick interactive smoke checks and debugging

Supports **Docker** and **Apple Container** (macOS 26+) with automatic runtime detection.

## Quickstart

### Prerequisites

- **Container Runtime** (one of):
  - **Apple Container** (macOS 26+, Apple Silicon) — [github.com/apple/container](https://github.com/apple/container) — auto-detected
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
codecontainer init             # Configure agents, certs, and permissions
codecontainer sync             # Re-sync config files from host
codecontainer list             # List all containers
codecontainer stop             # Stop current project's container
codecontainer remove           # Remove current project's container
codecontainer clean            # Remove all stopped containers
```

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
- **Linux / WSL / other**: Uses Docker

Override with `CODE_CONTAINER_RUNTIME` env var:
```bash
CODE_CONTAINER_RUNTIME=docker codecontainer          # Force Docker
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
