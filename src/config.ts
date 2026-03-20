import * as path from "path";
import * as fs from "fs";
import { z } from "zod";
import { APPDATA_DIR, CONFIGS_DIR, SETTINGS_PATH } from "./paths";
import { ALL_AGENT_IDS, getSelectedAgents } from "./agents";

export { APPDATA_DIR, CONFIGS_DIR, SETTINGS_PATH } from "./paths";
export { DOCKERFILE_PATH, MOUNTS_PATH, FLAGS_PATH } from "./paths";

const SettingsSchema = z.object({
  completedInit: z.boolean().default(false),
  acceptedTos: z.boolean().default(false),
  agents: z.array(z.enum(ALL_AGENT_IDS as [string, ...string[]])).default(ALL_AGENT_IDS),
  yolo: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function ensureAppdataDir(): void {
  if (!fs.existsSync(APPDATA_DIR)) {
    fs.mkdirSync(APPDATA_DIR, { recursive: true, mode: 0o700 });
  } else {
    fs.chmodSync(APPDATA_DIR, 0o700);
  }
}

export function loadSettings(): Settings {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { completedInit: false, acceptedTos: false, agents: ALL_AGENT_IDS, yolo: false };
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

export function copyConfigs(selectedAgentIds: string[]): void {
  ensureConfigDir(selectedAgentIds);

  const agents = getSelectedAgents(selectedAgentIds);
  for (const agent of agents) {
    for (const { src, dest, isDir } of agent.configSources) {
      const destPath = path.join(CONFIGS_DIR, dest);
      if (fs.existsSync(src)) {
        if (isDir) {
          fs.cpSync(src, destPath, { recursive: true });
        } else {
          fs.copyFileSync(src, destPath);
        }
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
