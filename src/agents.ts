import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { CONFIGS_DIR } from "./paths";
import { printWarning } from "./utils";

export interface PermissionConfig {
  filePath: string;
  content: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  configSources: Array<{ src: string; dest: string; isDir: boolean }>;
  mounts: Array<{ hostDir: string; containerPath: string }>;
  permissionConfig: PermissionConfig;
}

export const AGENTS: AgentDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    configSources: [
      { src: path.join(os.homedir(), ".claude"), dest: ".claude", isDir: true },
      { src: path.join(os.homedir(), ".claude.json"), dest: ".claude.json", isDir: false },
    ],
    mounts: [
      { hostDir: ".claude", containerPath: "/root/.claude" },
      { hostDir: ".claude.json", containerPath: "/root/.claude.json" },
      { hostDir: ".local", containerPath: "/root/.local" },
    ],
    permissionConfig: {
      filePath: ".claude/settings.json",
      content: JSON.stringify({ permissions: { allow: ["*", "Bash"] } }, null, 2),
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    configSources: [
      { src: path.join(os.homedir(), ".config", "opencode"), dest: ".opencode", isDir: true },
    ],
    mounts: [
      { hostDir: ".opencode", containerPath: "/root/.config/opencode" },
    ],
    permissionConfig: {
      filePath: ".opencode/opencode.json",
      content: JSON.stringify({ permission: "allow" }, null, 2),
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    configSources: [
      { src: path.join(os.homedir(), ".codex"), dest: ".codex", isDir: true },
    ],
    mounts: [
      { hostDir: ".codex", containerPath: "/root/.codex" },
    ],
    permissionConfig: {
      filePath: ".codex/config.toml",
      content: 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n',
    },
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    configSources: [
      { src: path.join(os.homedir(), ".gemini"), dest: ".gemini", isDir: true },
    ],
    mounts: [
      { hostDir: ".gemini", containerPath: "/root/.gemini" },
    ],
    permissionConfig: {
      filePath: ".gemini/policies/rules.toml",
      content: '[[rule]]\ntoolName = ["run_shell_command", "write_file", "replace"]\ndecision = "allow"\npriority = 777\n',
    },
  },
];

export const ALL_AGENT_IDS = AGENTS.map(a => a.id);

export function getSelectedAgents(agentIds: string[]): AgentDefinition[] {
  return AGENTS.filter(a => agentIds.includes(a.id));
}

export function applyPermissions(selectedAgentIds: string[]): void {
  const agents = getSelectedAgents(selectedAgentIds);
  for (const agent of agents) {
    const filePath = path.join(CONFIGS_DIR, agent.permissionConfig.filePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    if (filePath.endsWith(".json") && fs.existsSync(filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const permissions = JSON.parse(agent.permissionConfig.content);
        // Deep merge: preserve existing keys, merge nested permission objects
        const merged = { ...existing };
        for (const [key, value] of Object.entries(permissions)) {
          if (typeof value === "object" && value !== null && !Array.isArray(value) &&
              typeof merged[key] === "object" && merged[key] !== null && !Array.isArray(merged[key])) {
            merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
          } else {
            merged[key] = value;
          }
        }
        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
      } catch {
        printWarning(`Could not parse existing ${agent.permissionConfig.filePath}, overwriting with permission config`);
        fs.writeFileSync(filePath, agent.permissionConfig.content, { mode: 0o600 });
      }
    } else {
      fs.writeFileSync(filePath, agent.permissionConfig.content, { mode: 0o600 });
    }
  }
}
