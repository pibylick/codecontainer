---
title: "feat: Add agent selection with per-agent config copying and auto-permissions"
type: feat
status: completed
date: 2026-03-20
---

# feat: Add agent selection with per-agent config copying and auto-permissions

## Overview

Allow users to select which AI coding agent(s) to use in their container. Only copy configuration files and mount directories for the selected agent(s). Additionally, offer a "yolo" mode that auto-configures full permissions for selected agents so they run without permission prompts inside the container. The Dockerfile continues installing all agents (keeping image builds simple); selection only affects runtime config and mounts.

## Problem Statement / Motivation

Currently, `codecontainer` installs all 4 agents (Claude Code, OpenCode, Codex CLI, Gemini CLI) and copies/mounts configs for all of them. Users who only use one agent have unnecessary config files copied and mounted. Adding agent selection:

- Reduces confusion (only relevant configs are managed)
- Prevents accidental credential exposure for unused agents
- Enables a cleaner first-run experience with a focused setup

## Proposed Solution

**Runtime-only selection approach**: Keep all agents installed in the Docker image. Agent selection only controls which configs are copied from host and which directories are mounted into the container.

This avoids:
- Dockerfile generation/templating complexity
- Image invalidation when selection changes
- Apple Container build-arg compatibility issues
- Need for container rebuild on selection change

### Agent Registry

Define a central registry of supported agents in a new `src/agents.ts` module:

```typescript
// src/agents.ts
export interface AgentDefinition {
  id: string;
  name: string;
  configSources: Array<{ src: string; dest: string; isDir: boolean }>;
  mounts: Array<{ hostDir: string; containerPath: string }>;
  sharedDirs: string[];
  permissionConfig: PermissionConfig;
}

export interface PermissionConfig {
  filePath: string;          // relative to configs dir
  content: string;           // file content to write
  format: "json" | "toml";  // for merge strategy
}

export const AGENTS: AgentDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    configSources: [
      { src: "~/.claude", dest: ".claude", isDir: true },
      { src: "~/.claude.json", dest: ".claude.json", isDir: false },
    ],
    mounts: [
      { hostDir: ".claude", containerPath: "/root/.claude" },
      { hostDir: ".claude.json", containerPath: "/root/.claude.json" },
      { hostDir: ".local", containerPath: "/root/.local" },
    ],
    sharedDirs: [".claude", ".local"],
    permissionConfig: {
      filePath: ".claude/settings.json",
      content: '{"permissions":{"allow":["*","Bash"]}}',
      format: "json",
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    configSources: [
      { src: "~/.config/opencode", dest: ".opencode", isDir: true },
    ],
    mounts: [
      { hostDir: ".opencode", containerPath: "/root/.config/opencode" },
    ],
    sharedDirs: [".opencode"],
    permissionConfig: {
      filePath: ".opencode/opencode.json",
      content: '{"permission":"allow"}',
      format: "json",
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    configSources: [
      { src: "~/.codex", dest: ".codex", isDir: true },
    ],
    mounts: [
      { hostDir: ".codex", containerPath: "/root/.codex" },
    ],
    sharedDirs: [".codex"],
    permissionConfig: {
      filePath: ".codex/config.toml",
      content: 'approval_policy = "never"\nsandbox_mode = "danger-full-access"',
      format: "toml",
    },
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    configSources: [
      { src: "~/.gemini", dest: ".gemini", isDir: true },
    ],
    mounts: [
      { hostDir: ".gemini", containerPath: "/root/.gemini" },
    ],
    sharedDirs: [".gemini"],
    permissionConfig: {
      filePath: ".gemini/policies/rules.toml",
      content: '[[rule]]\ntoolName = ["run_shell_command", "write_file", "replace"]\ndecision = "allow"\npriority = 777',
      format: "toml",
    },
  },
];
```

### Settings Schema Update

Add `agents` field to `settings.json` via `src/config.ts`:

```typescript
const SettingsSchema = z.object({
  completedInit: z.boolean().default(false),
  acceptedTos: z.boolean().default(false),
  agents: z.array(z.string()).default(["claude", "opencode", "codex", "gemini"]),
});
```

Default: all agents selected (backward compatible).

### Agent Selection Prompt

During `init` (first run or explicit), present an interactive multi-select prompt:

```
Which agents would you like to use?
  [1] Claude Code
  [2] OpenCode
  [3] Codex CLI
  [4] Gemini CLI
  [a] All agents (default)

Enter numbers separated by commas (e.g., 1,3) or 'a' for all:
```

### Separate Core Mounts from User Mounts

**Critical change**: Split `MOUNTS.txt` into computed core mounts (agent-dependent) and user-defined custom mounts.

Current problem: `getCoreMounts()` in `mounts.ts` returns hardcoded agent mounts, and `ensureMountsFile()` writes them ALL into `MOUNTS.txt` once. Changing agent selection doesn't update these.

Solution:
- `MOUNTS.txt` stores ONLY user-defined mounts (custom paths, SSH, gitconfig)
- Core agent mounts are computed at runtime from agent selection + registry
- `getMounts()` in `docker.ts` combines: computed agent mounts + user MOUNTS.txt entries

```typescript
// mounts.ts - updated
export function getAgentMounts(selectedAgents: string[]): string[] {
  return AGENTS
    .filter(a => selectedAgents.includes(a.id))
    .flatMap(a => a.mounts.map(m =>
      `${CONFIGS_DIR}/${m.hostDir}:${m.containerPath}`
    ));
}

export function getCommonMounts(): string[] {
  const home = os.homedir();
  return [`${home}/.gitconfig:/root/.gitconfig:ro`];
}
```

### Auto-Permissions ("Yolo" Mode)

After agent selection, prompt the user whether to enable full permissions for each selected agent inside the container. This writes the appropriate permission config files to `~/.code-container/configs/` so agents run without permission prompts.

```
Enable full permissions for selected agents inside the container? (yolo mode)
This allows agents to execute commands without permission prompts.
Only affects the container environment, not your host system. [Y/n]
```

When enabled, `applyPermissions()` writes permission config files for each selected agent:

```typescript
// src/agents.ts
export function applyPermissions(selectedAgents: string[]): void {
  const agentDefs = AGENTS.filter(a => selectedAgents.includes(a.id));
  for (const agent of agentDefs) {
    const filePath = path.join(CONFIGS_DIR, agent.permissionConfig.filePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    if (agent.permissionConfig.format === "json" && fs.existsSync(filePath)) {
      // Merge with existing JSON config to avoid overwriting user settings
      const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const permissions = JSON.parse(agent.permissionConfig.content);
      const merged = { ...existing, ...permissions };
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    } else {
      // TOML or new file: write directly
      fs.writeFileSync(filePath, agent.permissionConfig.content, { mode: 0o600 });
    }
  }
}
```

Per-agent permission configs (from `Permissions.md`):

| Agent | Config File | Content |
|-------|------------|---------|
| Claude Code | `.claude/settings.json` | `{"permissions":{"allow":["*","Bash"]}}` |
| OpenCode | `.opencode/opencode.json` | `{"permission":"allow"}` |
| Codex CLI | `.codex/config.toml` | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` |
| Gemini CLI | `.gemini/policies/rules.toml` | `[[rule]]` with `decision = "allow"` |

Settings schema stores the choice:

```typescript
const SettingsSchema = z.object({
  completedInit: z.boolean().default(false),
  acceptedTos: z.boolean().default(false),
  agents: z.array(z.string()).default(["claude", "opencode", "codex", "gemini"]),
  yolo: z.boolean().default(false),
});
```

### Config Copying Update

`copyConfigs()` and `ensureConfigDir()` in `config.ts` are updated to accept selected agents:

```typescript
export function copyConfigs(selectedAgents: string[]): void {
  ensureConfigDir(selectedAgents);
  const agentDefs = AGENTS.filter(a => selectedAgents.includes(a.id));
  for (const agent of agentDefs) {
    for (const { src, dest, isDir } of agent.configSources) {
      const resolvedSrc = src.replace("~", os.homedir());
      const destPath = path.join(CONFIGS_DIR, dest);
      if (fs.existsSync(resolvedSrc)) {
        if (isDir) {
          fs.cpSync(resolvedSrc, destPath, { recursive: true });
        } else {
          fs.copyFileSync(resolvedSrc, destPath);
        }
      }
    }
  }
}
```

## Technical Considerations

- **Backward compatibility**: Default `agents: ["claude", "opencode", "codex", "gemini"]` means existing users see no change
- **MOUNTS.txt migration**: Existing `MOUNTS.txt` files contain hardcoded agent mounts. Migration needed to strip agent-specific mounts and keep only user-defined ones (SSH, gitconfig, custom)
- **Image unchanged**: Dockerfile is NOT modified — all agents remain installed. This avoids rebuild on selection change
- **Apple Container parity**: No impact since selection is runtime-only (config + mounts)

## System-Wide Impact

- **`config.ts`**: `SHARED_DIRS`, `CONFIG_SOURCES`, `copyConfigs()`, `ensureConfigDir()` all become agent-selection-aware
- **`mounts.ts`**: `getCoreMounts()` replaced by `getAgentMounts()` + `getCommonMounts()`. `ensureMountsFile()` no longer writes agent mounts
- **`docker.ts`**: `getMounts()` updated to use new mount functions with agent selection from settings
- **`commands.ts`**: `init()` gets agent selection prompt. `runContainer()` passes selection to config/mount functions
- **`main.ts`**: No direct changes needed (flows through commands.ts)

## Acceptance Criteria

- [ ] New `src/agents.ts` module with agent registry (`AgentDefinition` interface + `AGENTS` array)
- [ ] `settings.json` schema extended with `agents: string[]` field (default: all agents)
- [ ] Interactive agent selection prompt during `codecontainer init` (first run and explicit)
- [ ] `copyConfigs()` only copies configs for selected agents
- [ ] `ensureConfigDir()` only creates directories for selected agents
- [ ] Core agent mounts computed at runtime from selection (not stored in MOUNTS.txt)
- [ ] `MOUNTS.txt` only contains user-defined mounts (gitconfig, SSH, custom)
- [ ] Migration: existing `MOUNTS.txt` files cleaned of agent-specific mounts on upgrade
- [ ] Backward compatible: existing users with no `agents` field get all agents (current behavior)
- [ ] `codecontainer init` allows re-selecting agents (updates settings + re-copies configs)
- [ ] "Yolo" mode prompt during init — auto-configures full permissions for selected agents
- [ ] `applyPermissions()` writes correct permission files for each agent (Claude: JSON, OpenCode: JSON, Codex: TOML, Gemini: TOML)
- [ ] JSON permission configs are merged (not overwritten) to preserve existing user settings
- [ ] `yolo` boolean persisted in `settings.json`
- [ ] Unit tests for agent registry, config filtering, mount computation, permissions, and migration

## Dependencies & Risks

- **Risk**: Users who manually edited `MOUNTS.txt` agent lines may lose customizations during migration → mitigate by backing up before migration
- **Risk**: `ensureMountsFile()` currently prompts for SSH interactively; must preserve this flow
- **No external dependencies** needed (no new npm packages)

## Implementation Phases

### Phase 1: Agent Registry + Settings (src/agents.ts, src/config.ts)

1. Create `src/agents.ts` with `AgentDefinition` interface and `AGENTS` constant
2. Add `agents` field to `SettingsSchema` in `config.ts`
3. Refactor `SHARED_DIRS` and `CONFIG_SOURCES` to use agent registry
4. Update `copyConfigs()` and `ensureConfigDir()` to accept agent selection

### Phase 2: Agent Selection + Yolo Prompt (src/utils.ts, src/commands.ts)

1. Add `promptAgentSelection()` to `src/utils.ts`
2. Add `promptYolo()` to `src/utils.ts` (simple yes/no for auto-permissions)
3. Integrate both prompts into `init()` flow in `commands.ts`
4. Save agent selection and yolo flag to `settings.json`
5. When yolo enabled: call `applyPermissions()` for selected agents after config copying

### Phase 3: Mount System Refactor (src/mounts.ts, src/docker.ts)

1. Replace `getCoreMounts()` with `getAgentMounts(selectedAgents)` + `getCommonMounts()`
2. Update `ensureMountsFile()` to only write user mounts (gitconfig, SSH)
3. Update `getMounts()` in `docker.ts` to compose: agent mounts + common mounts + user mounts
4. Add migration logic for existing `MOUNTS.txt` files

### Phase 4: Tests + AGENTS.md Update

1. Add unit tests for all new/changed functions
2. Update `AGENTS.md` project index with new file
3. Update `internal/ConsumerGuide.md` if needed

## Sources & References

- Similar pattern: current `config.ts:51-57` CONFIG_SOURCES array
- Mount system: `mounts.ts:6-17` getCoreMounts
- Settings schema: `config.ts:21-24` SettingsSchema
- SpecFlow analysis: `docs/agent-selection-flow-analysis.md`
