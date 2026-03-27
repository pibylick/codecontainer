import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CONFIGS_DIR, MOUNTS_PATH, APPLE_GIT_INJECT_PATH } from "./paths";
import { ensureAppdataDir } from "./config";
import { printInfo, printWarning, promptYesNo } from "./utils";
import { AGENTS, getSelectedAgents } from "./agents";
import { CLI_BIN, isAppleContainer } from "./runtime";

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

// macOS-native credential helpers that won't work inside a Linux container
const HOST_ONLY_HELPERS = ["osxkeychain", "manager", "manager-core"];

/**
 * Prepare a container-safe copy of ~/.gitconfig.
 * If the host uses a credential helper that cannot run inside the container
 * (e.g. osxkeychain), the copy is patched to use the file-based "store" helper
 * so that git operations inside the container still work.
 */
function prepareGitconfig(): string {
  const home = os.homedir();
  const hostGitconfig = path.join(home, ".gitconfig");
  const containerGitconfig = path.join(CONFIGS_DIR, ".gitconfig");

  if (!fs.existsSync(hostGitconfig)) {
    return hostGitconfig; // nothing to copy — mount will simply be missing
  }

  let content = fs.readFileSync(hostGitconfig, "utf-8");

  // Detect host-only credential helpers and replace with "store"
  const helperRegex = /^(\s*helper\s*=\s*)(.+)$/gm;
  let patched = false;
  content = content.replace(helperRegex, (_match, prefix: string, value: string) => {
    const trimmed = value.trim();
    if (HOST_ONLY_HELPERS.some(h => trimmed === h || trimmed.endsWith(`/${h}`) || trimmed.includes(`credential-${h}`))) {
      patched = true;
      return `${prefix}store`;
    }
    return _match;
  });

  if (patched) {
    printInfo("Detected host-only git credential helper — using 'store' helper inside container.");
  }

  // Ensure configs dir exists before writing
  if (!fs.existsSync(CONFIGS_DIR)) {
    fs.mkdirSync(CONFIGS_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(containerGitconfig, content, { mode: 0o644 });

  return containerGitconfig;
}

export function getCommonMounts(): string[] {
  const home = os.homedir();
  const gitconfigPath = prepareGitconfig();
  const mounts: string[] = [];

  if (isAppleContainer()) {
    // Apple Container VMs have a read-only root filesystem, so we cannot
    // bind-mount or write to /root/.gitconfig directly.  Instead, mount a
    // writable directory and point Git at it via GIT_CONFIG_GLOBAL env var.
    const injectDir = path.join(CONFIGS_DIR, ".git-inject");
    if (!fs.existsSync(injectDir)) {
      fs.mkdirSync(injectDir, { recursive: true, mode: 0o700 });
    }

    // Write prepared gitconfig into the inject dir, patching credential
    // store path to the writable mount location.
    if (fs.existsSync(gitconfigPath)) {
      let content = fs.readFileSync(gitconfigPath, "utf-8");
      content = content.replace(
        /^(\s*helper\s*=\s*)store\s*$/gm,
        `$1store --file=${APPLE_GIT_INJECT_PATH}/.git-credentials`
      );
      fs.writeFileSync(path.join(injectDir, ".gitconfig"), content, { mode: 0o644 });
    }

    // Copy git-credentials into the inject dir
    const gitCredentials = path.join(home, ".git-credentials");
    if (fs.existsSync(gitCredentials)) {
      fs.copyFileSync(gitCredentials, path.join(injectDir, ".git-credentials"));
    } else {
      fs.writeFileSync(path.join(injectDir, ".git-credentials"), "", { mode: 0o600 });
    }

    mounts.push(`${injectDir}:${APPLE_GIT_INJECT_PATH}`);
  } else {
    if (fs.existsSync(gitconfigPath)) {
      stripExtendedAttributes(gitconfigPath);
      mounts.push(`${gitconfigPath}:/root/.gitconfig`);
    }

    // Mount git-credentials file if it exists (needed for "store" helper)
    const gitCredentials = path.join(home, ".git-credentials");
    if (fs.existsSync(gitCredentials)) {
      mounts.push(`${gitCredentials}:/root/.git-credentials`);
    }
  }

  return mounts;
}

/**
 * Inject git config files into an Apple Container via exec.
 * Apple Container VMs have a read-only root filesystem, so we write into
 * the mounted .git-inject directory instead of /root/.gitconfig directly.
 */
export function injectGitConfigIntoContainer(containerName: string): void {
  if (!isAppleContainer()) return;

  const gitconfigPath = prepareGitconfig();
  if (fs.existsSync(gitconfigPath)) {
    let content = fs.readFileSync(gitconfigPath, "utf-8");
    // Patch credential store path to the writable inject directory
    content = content.replace(
      /^(\s*helper\s*=\s*)store\s*$/gm,
      `$1store --file=${APPLE_GIT_INJECT_PATH}/.git-credentials`
    );
    spawnSync(CLI_BIN, ["exec", containerName, "sh", "-c", `cat > ${APPLE_GIT_INJECT_PATH}/.gitconfig`], {
      input: content,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }

  const home = os.homedir();
  const gitCredentials = path.join(home, ".git-credentials");
  if (fs.existsSync(gitCredentials)) {
    const content = fs.readFileSync(gitCredentials, "utf-8");
    spawnSync(CLI_BIN, ["exec", containerName, "sh", "-c", `cat > ${APPLE_GIT_INJECT_PATH}/.git-credentials`], {
      input: content,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}

/**
 * Strip macOS extended attributes (e.g. com.apple.provenance) from a file.
 * These attributes cause "Permission denied" when the file is mounted
 * into Apple Container VMs.
 *
 * com.apple.provenance cannot be removed with xattr -c/-d, so we
 * recreate the file: write to a temp file (which has no provenance),
 * then rename it over the original.
 */
function stripExtendedAttributes(filePath: string): void {
  // First try the simple approach
  spawnSync("xattr", ["-c", filePath], { stdio: "pipe" });

  // Check if stubborn attributes (like com.apple.provenance) remain
  const result = spawnSync("xattr", [filePath], { stdio: "pipe" });
  const remaining = result.stdout?.toString().trim();
  if (remaining) {
    // Recreate the file — new files don't inherit provenance
    const content = fs.readFileSync(filePath);
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, { mode: 0o644 });
    fs.renameSync(tmpPath, filePath);
  }
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

  // Offer to mount git credentials for HTTPS-based git operations
  const gitCredentials = path.join(home, ".git-credentials");
  if (!mountSsh || fs.existsSync(gitCredentials)) {
    printInfo("");
    printInfo("Would you like to mount ~/.git-credentials?");
    printInfo(
      "  Pros: Enables HTTPS-based git push/pull inside the container."
    );
    printInfo(
      "  Risks: Exposes stored git credentials. Only enable if you trust the code running in your containers."
    );
    printInfo(
      "  Note: If your host uses osxkeychain or credential-manager, you need to first populate ~/.git-credentials."
    );
    printInfo(
      "  Hint: Run 'git credential-store store' or set credential.helper=store temporarily and do a git fetch."
    );

    const mountCreds = await promptYesNo("Mount ~/.git-credentials?");
    if (mountCreds) {
      // Create the file if it doesn't exist so the mount doesn't fail
      if (!fs.existsSync(gitCredentials)) {
        fs.writeFileSync(gitCredentials, "", { mode: 0o600 });
        printInfo(`Created empty ${gitCredentials} — populate it with your credentials.`);
      }
      mounts.push(`${gitCredentials}:/root/.git-credentials`);
    }
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
