import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { z } from "zod";
import { APPDATA_DIR, CONFIGS_DIR, SETTINGS_PATH } from "./paths";
import { AGENTS, ALL_AGENT_IDS, getSelectedAgents } from "./agents";

export { APPDATA_DIR, CONFIGS_DIR, SETTINGS_PATH } from "./paths";
export { DOCKERFILE_PATH, EXTRA_PACKAGES_APT_PATH, MOUNTS_PATH, FLAGS_PATH } from "./paths";

const SettingsSchema = z.object({
  completedInit: z.boolean().default(false),
  acceptedTos: z.boolean().default(false),
  agents: z.array(z.enum(ALL_AGENT_IDS as [string, ...string[]])).default(ALL_AGENT_IDS),
  yolo: z.boolean().default(false),
  memoryMB: z.number().optional(),
  acceptedProjectConfigs: z.record(z.string(), z.string()).default({}),
  k8s: z.object({
    namespace: z.string().default("codecontainer"),
    context: z.string().default(""),
    registry: z.string().default(""),
    workspaceSize: z.string().default("20Gi"),
    cpu: z.string().default("2"),
    memory: z.string().default("8Gi"),
  }).default({
    namespace: "codecontainer",
    context: "",
    registry: "",
    workspaceSize: "20Gi",
    cpu: "2",
    memory: "8Gi",
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = {
  completedInit: false,
  acceptedTos: false,
  agents: ALL_AGENT_IDS,
  yolo: false,
  memoryMB: undefined,
  acceptedProjectConfigs: {},
  k8s: {
    namespace: "codecontainer",
    context: "",
    registry: "",
    workspaceSize: "20Gi",
    cpu: "2",
    memory: "8Gi",
  },
};

export function ensureAppdataDir(): void {
  if (!fs.existsSync(APPDATA_DIR)) {
    fs.mkdirSync(APPDATA_DIR, { recursive: true, mode: 0o700 });
  } else {
    fs.chmodSync(APPDATA_DIR, 0o700);
  }
}

export function loadSettings(): Settings {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return DEFAULT_SETTINGS;
  }
  const content = fs.readFileSync(SETTINGS_PATH, "utf-8");
  return SettingsSchema.parse(JSON.parse(content));
}

export function saveSettings(settings: Settings): void {
  ensureAppdataDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    mode: 0o600,
  });
}

// Directories inside ~/.claude that are not needed inside the container
const SKIP_DIRS = new Set(["projects", "usage-data", "telemetry", ".git"]);

export function configsExist(selectedAgentIds: string[]): boolean {
  const agents = getSelectedAgents(selectedAgentIds);
  for (const agent of agents) {
    for (const { dest, isDir } of agent.configSources) {
      const destPath = path.join(CONFIGS_DIR, dest);
      if (!fs.existsSync(destPath)) return false;
      if (isDir) {
        // Check directory is not empty
        try {
          const entries = fs.readdirSync(destPath);
          if (entries.length === 0) return false;
        } catch {
          return false;
        }
      }
    }
  }
  return true;
}

export function copyConfigs(selectedAgentIds: string[]): void {
  ensureConfigDir(selectedAgentIds);
  cleanStaleAgentConfigs(selectedAgentIds);

  const agents = getSelectedAgents(selectedAgentIds);
  for (const agent of agents) {
    for (const { src, dest, isDir } of agent.configSources) {
      const destPath = path.join(CONFIGS_DIR, dest);
      if (fs.existsSync(src)) {
        if (isDir) {
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true });
          }
          fs.cpSync(src, destPath, {
            recursive: true,
            filter: (source) => {
              const rel = path.relative(src, source);
              const topDir = rel.split(path.sep)[0];
              return !SKIP_DIRS.has(topDir);
            },
          });
        } else {
          fs.copyFileSync(src, destPath);
        }
      }
    }
  }

  rewriteHostPaths(selectedAgentIds);
}

/**
 * Rewrite absolute host home paths to container home (/root) in copied config files.
 * Plugins store installPath / installLocation with the host homedir baked in;
 * inside the container these must point to /root instead.
 */
const CONTAINER_HOME = "/root";
const PLUGIN_CONFIG_FILES = [
  "plugins/installed_plugins.json",
  "plugins/known_marketplaces.json",
];

function rewriteHostPaths(selectedAgentIds: string[]): void {
  const hostHome = os.homedir();
  if (hostHome === CONTAINER_HOME) return; // already matches, nothing to do

  const agents = getSelectedAgents(selectedAgentIds);
  for (const agent of agents) {
    for (const { dest, isDir } of agent.configSources) {
      if (!isDir) continue;
      for (const relPath of PLUGIN_CONFIG_FILES) {
        const filePath = path.join(CONFIGS_DIR, dest, relPath);
        if (!fs.existsSync(filePath)) continue;
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const rewritten = content.split(hostHome).join(CONTAINER_HOME);
          if (rewritten !== content) {
            fs.writeFileSync(filePath, rewritten, { mode: 0o600 });
          }
        } catch {
          // Non-critical — skip if file can't be read/written
        }
      }
    }
  }
}

function cleanStaleAgentConfigs(selectedAgentIds: string[]): void {
  const selected = getSelectedAgents(selectedAgentIds);
  const deselected = AGENTS.filter(a => !selectedAgentIds.includes(a.id));

  // Collect all paths owned by selected agents so we never remove them
  const selectedPaths = new Set<string>();
  for (const agent of selected) {
    for (const { dest } of agent.configSources) {
      selectedPaths.add(dest);
    }
    for (const mount of agent.mounts) {
      selectedPaths.add(mount.hostDir);
    }
  }

  for (const agent of deselected) {
    const paths = [
      ...agent.configSources.map(cs => cs.dest),
      ...agent.mounts.map(m => m.hostDir),
    ];
    for (const rel of paths) {
      if (selectedPaths.has(rel)) continue; // shared with a selected agent
      const fullPath = path.join(CONFIGS_DIR, rel);
      if (!fs.existsSync(fullPath)) continue;
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

export function ensureConfigDir(selectedAgentIds?: string[]): void {
  ensureAppdataDir();

  if (!fs.existsSync(CONFIGS_DIR)) {
    fs.mkdirSync(CONFIGS_DIR, { recursive: true, mode: 0o700 });
  } else {
    fs.chmodSync(CONFIGS_DIR, 0o700);
  }

  const agentIds = selectedAgentIds ?? ALL_AGENT_IDS;
  const agents = getSelectedAgents(agentIds);
  // Create config directories for selected agents (derived from configSources)
  for (const agent of agents) {
    for (const { dest, isDir } of agent.configSources) {
      if (isDir) {
        const fullPath = path.join(CONFIGS_DIR, dest);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true, mode: 0o700 });
        }
      }
    }
    // Also create mount-only dirs (e.g., .local for Claude Code)
    for (const mount of agent.mounts) {
      const isFileMount = agent.configSources.some(cs => !cs.isDir && cs.dest === mount.hostDir);
      if (!isFileMount) {
        const fullPath = path.join(CONFIGS_DIR, mount.hostDir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true, mode: 0o700 });
        }
      }
    }
  }

  // Ensure .claude.json exists if Claude is selected
  if (agentIds.includes("claude")) {
    const claudeJsonPath = path.join(CONFIGS_DIR, ".claude.json");
    if (!fs.existsSync(claudeJsonPath)) {
      fs.writeFileSync(claudeJsonPath, "{}", { mode: 0o600 });
    }
  }
}
