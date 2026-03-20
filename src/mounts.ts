import * as fs from "fs";
import * as os from "os";
import { CONFIGS_DIR, MOUNTS_PATH } from "./paths";
import { ensureAppdataDir } from "./config";
import { printInfo, printWarning, promptYesNo } from "./utils";
import { AGENTS, getSelectedAgents } from "./agents";

// Derive migration patterns from agent registry (single source of truth)
const AGENT_MOUNT_PATTERNS = AGENTS.flatMap(a =>
  a.mounts.map(m => `/${m.hostDir}:`)
);

export function getAgentMounts(selectedAgentIds: string[]): string[] {
  const agents = getSelectedAgents(selectedAgentIds);
  return agents.flatMap(a =>
    a.mounts.map(m => `${CONFIGS_DIR}/${m.hostDir}:${m.containerPath}`)
  );
}

export function getCommonMounts(): string[] {
  const home = os.homedir();
  return [`${home}/.gitconfig:/root/.gitconfig:ro`];
}

export async function ensureMountsFile(): Promise<void> {
  if (fs.existsSync(MOUNTS_PATH)) {
    migrateExistingMountsFile();
    return;
  }

  ensureAppdataDir();
  const home = os.homedir();
  const mounts: string[] = [];

  printInfo("");
  printInfo("MOUNTS.txt not found. Setting up custom mount points.");
  printInfo("");
  printInfo("Would you like to mount ~/.ssh (read-only)?");
  printInfo(
    "  Pros: Enables SSH-based git operations and remote server access inside the container. (E.g.: git push, git pull)"
  );
  printInfo(
    "  Risks: Exposes your SSH private keys. Only enable if you trust the code running in your containers."
  );
  printInfo(
    "  Note: This configuration is global. You may modify your mounts at any time by editing ~/.code-container/MOUNTS.txt."
  );

  const mountSsh = await promptYesNo("Mount ~/.ssh?");
  if (mountSsh) {
    mounts.push(`${home}/.ssh:/root/.ssh:ro`);
  }

  const header = "# Custom mount points (agent mounts are managed automatically)\n";
  fs.writeFileSync(MOUNTS_PATH, header + mounts.join("\n") + "\n", { mode: 0o600 });
  printInfo("");
  printInfo(`Created ${MOUNTS_PATH}`);
  printInfo("You can edit this file to customize mount points.");
}

function migrateExistingMountsFile(): void {
  try {
    const content = fs.readFileSync(MOUNTS_PATH, "utf-8");
    const lines = content.split("\n");

    const userLines: string[] = [];
    let migrated = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        userLines.push(line);
        continue;
      }

      const isAgentMount = AGENT_MOUNT_PATTERNS.some(pattern => trimmed.includes(pattern));
      if (isAgentMount) {
        migrated = true;
        continue;
      }

      userLines.push(line);
    }

    if (migrated) {
      printInfo("Migrated MOUNTS.txt: removed agent-specific mounts (now managed automatically).");
      const header = userLines[0]?.startsWith("#") ? "" : "# Custom mount points (agent mounts are managed automatically)\n";
      fs.writeFileSync(MOUNTS_PATH, header + userLines.join("\n"), { mode: 0o600 });
    }
  } catch {
    printWarning("Could not migrate MOUNTS.txt, skipping migration.");
  }
}

export function loadUserMounts(): string[] {
  if (!fs.existsSync(MOUNTS_PATH)) {
    return [];
  }
  const content = fs.readFileSync(MOUNTS_PATH, "utf-8");
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}
