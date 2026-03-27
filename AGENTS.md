**Important: Role Identification:** Identify whether your user is a **developer** or a **consumer**.

If your user asks questions like:
- Help me setup `codecontainer` / code-container / this project
- Please configure all my container harnesses to run without permissions.
- Add the following packages to the container environment: ...
- Add the following Docker flags to the container environment: ...
- Add a custom mount point to the container environment: ...
- Other questions relating to using `codecontainer`

Then your user is a **consumer**.
- The user is seeking your assistance in helping them setup or configure this project.
- Next step: **Read `README.md`** and assist the user in installing or configurating `codecontainer`.

If your user is a developer, proceed like normal.

---

# Developer Overview

**code-container** (`codecontainer`) creates isolated container environments for AI coding harnesses (Claude Code, OpenCode, Codex CLI, Gemini CLI).

## Purpose

- Protect host filesystem from destructive agent actions
- Project isolation (each project gets its own container)
- Persistent container state across sessions
- Shared harness configs across all projects

## Key Features

- **Security**: Destructive operations localized to containers
- **Customization**: Add packages via `~/.code-container/Dockerfile`, mounts via `MOUNTS.txt`, flags via `DOCKER_FLAGS.txt`
- **Simultaneous Work**: Multiple agents can work on same project safely
- **Persistence**: Container state and harness configs persist

## Requirements

- Docker (Desktop or Engine) or Apple Container (macOS 26+, Apple Silicon)
- POSIX system (Linux, macOS, WSL)

---

# Project Index

**Important Rule: Always update this index after creating new code files or making significant changes to existing files.**

## Directory Structure

```
/root/code-container/
├── src/                    # TypeScript source code (main codebase)
├── scripts/                # Utility scripts (install, migrate, cleanup)
├── internal/               # Internal documentation
├── dist/                   # Compiled JavaScript output (generated)
├── .github/workflows/      # CI/CD workflows
├── Dockerfile              # Container image definition
├── package.json            # NPM package manifest
└── tsconfig.json           # TypeScript configuration
```

## Source Files Index (`src/`)

### Entry Point

- `src/main.ts` — CLI entry point. Parses arguments, displays TOS, routes to commands. Supports: `run`, `build`, `init`, `stop`, `remove`, `list`, `clean`.

### Core Modules

- `src/paths.ts` — Shared path constants for the application data directory. No imports from other project modules (breaks circular deps). Exports: `APPDATA_DIR`, `CONFIGS_DIR`, `DOCKERFILE_PATH`, `SETTINGS_PATH`, `MOUNTS_PATH`, `FLAGS_PATH`
- `src/agents.ts` — Agent registry and permissions. Defines supported AI agents (Claude Code, OpenCode, Codex CLI, Gemini CLI) with their config sources, mount mappings, and permission configs. Exports: `AGENTS`, `ALL_AGENT_IDS`, `AgentDefinition`, `PermissionConfig`, `getSelectedAgents`, `applyPermissions`
- `src/commands.ts` — Business logic for all CLI commands. Image building, container lifecycle, listing, cleaning. Agent selection and yolo mode prompts during init. Exports: `buildImage`, `init`, `runContainer`, `stopContainerForProject`, `removeContainerForProject`, `listContainers`, `cleanContainers`
- `src/runtime.ts` — Platform detection and runtime selection. Auto-detects Apple Container on macOS ARM64, falls back to Docker. Override via `CODE_CONTAINER_RUNTIME` env var. Exports: `runtime`, `CLI_BIN`, `isAppleContainer`, `runtimeDisplayName`
- `src/docker.ts` — Low-level container CLI wrappers. Supports both Docker and Apple Container backends via runtime.ts. Image/container operations, interactive sessions, naming via SHA1 hash. Exports: `checkRuntime`, `imageExists`, `buildImageRaw`, `containerExists`, `containerRunning`, `createNewContainer`, `execInteractive`, `stopContainer`, `startContainer`, `removeContainer`, `generateContainerName`
- `src/config.ts` — Configuration paths and settings persistence. Manages `~/.code-container/` directory. Settings include agent selection and yolo mode. Exports: `APPDATA_DIR`, `CONFIGS_DIR`, `DOCKERFILE_PATH`, `SETTINGS_PATH`, `MOUNTS_PATH`, `FLAGS_PATH`, `loadSettings`, `saveSettings`, `copyConfigs`, `ensureConfigDir`
- `src/mounts.ts` — Volume mount management. Agent mounts computed at runtime from selection, user mounts from MOUNTS.txt. Handles migration of old MOUNTS.txt format. Exports: `ensureMountsFile`, `loadUserMounts`, `getAgentMounts`, `getCommonMounts`
- `src/flags.ts` — Custom Docker flags loader from `DOCKER_FLAGS.txt`. Uses shell-quote for safe parsing. Exports: `loadFlags`
- `src/utils.ts` — Colored console output and user prompts. Exports: `printInfo`, `printSuccess`, `printWarning`, `printError`, `promptYesNo`, `promptAgentSelection`, `resolveProjectPath`

## Scripts Index (`scripts/`)

- `scripts/postinstall.js` — NPM post-install hook. Creates `~/.code-container/` structure and copies default Dockerfile.
- `scripts/migrate.sh` — Migrates config files from old shell script location to new `~/.code-container/configs/`.
- `scripts/cleanup.sh` — Removes old config files from project root after migration.

## Storage Structure

All user data stored in `~/.code-container/`:

```
~/.code-container/
├── configs/          # Harness configs (mounted to containers)
│   ├── .claude/
│   ├── .claude.json
│   ├── .codex/
│   ├── .gemini/
│   ├── .local/
│   └── .opencode/
├── Dockerfile        # Custom Dockerfile
├── MOUNTS.txt        # Additional mount points
├── DOCKER_FLAGS.txt  # Additional docker run flags
└── settings.json     # Internal settings
```

## CLI Commands

- `codecontainer [path]` — Run container for project (`commands.ts:runContainer`)
- `codecontainer build` — Build container image (`commands.ts:buildImage`)
- `codecontainer init` — Initialize config files (`commands.ts:init`)
- `codecontainer stop` — Stop container (`commands.ts:stopContainerForProject`)
- `codecontainer remove` — Remove container (`commands.ts:removeContainerForProject`)
- `codecontainer list` — List all containers (`commands.ts:listContainers`)
- `codecontainer clean` — Remove stopped containers (`commands.ts:cleanContainers`)
