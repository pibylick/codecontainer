import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { printInfo, printError } from "./utils";
import { APPDATA_DIR, DOCKERFILE_PATH } from "./config";
import { loadMounts } from "./mounts";
import { loadFlags } from "./flags";
import { CLI_BIN, isAppleContainer, runtimeDisplayName } from "./runtime";

export const IMAGE_NAME = "code-container";
export const IMAGE_TAG = "latest";
const PACKAGED_DOCKERFILE = path.resolve(__dirname, "..", "Dockerfile");
const CONTAINER_PREFIX = "container";

export function checkRuntime(): void {
  if (isAppleContainer()) {
    const result = spawnSync(CLI_BIN, ["system", "version"], { stdio: "pipe" });
    if (result.status !== 0) {
      printInfo("Apple Container system not running. Starting...");
      const startResult = spawnSync(CLI_BIN, ["system", "start"], {
        stdio: "inherit",
        timeout: 30000,
      });
      if (startResult.status !== 0) {
        printError(
          "Apple Container is not available. Please install it: https://github.com/apple/container"
        );
        process.exit(1);
      }
    }
  } else {
    const result = spawnSync(CLI_BIN, ["info"], { stdio: "pipe" });
    if (result.status !== 0) {
      printError(
        "Docker is not available. Please install Docker: https://docs.docker.com/get-docker/"
      );
      process.exit(1);
    }
  }
}

export function getMounts(projectPath: string, projectName: string): string[] {
  const mounts: string[] = [];
  mounts.push(`${projectPath}:/root/${projectName}`);
  const fileMounts = loadMounts();
  mounts.push(...fileMounts);
  return mounts;
}

export function generateContainerName(projectPath: string): string {
  const normalizedPath = projectPath.replace(/\/$/, "");
  const projectName = path.basename(normalizedPath);
  const pathHash = crypto
    .createHash("sha1")
    .update(normalizedPath)
    .digest("hex")
    .substring(0, 8);
  return `${CONTAINER_PREFIX}-${projectName}-${pathHash}`;
}

export function imageExists(): boolean {
  const result = spawnSync(
    CLI_BIN,
    ["image", "inspect", `${IMAGE_NAME}:${IMAGE_TAG}`],
    { stdio: "pipe" }
  );
  return result.status === 0;
}

export function ensureDockerfile(): void {
  if (!fs.existsSync(DOCKERFILE_PATH)) {
    if (fs.existsSync(PACKAGED_DOCKERFILE)) {
      printInfo(
        `Dockerfile not found at ${DOCKERFILE_PATH}, copying from package...`
      );
      fs.copyFileSync(PACKAGED_DOCKERFILE, DOCKERFILE_PATH);
    } else {
      throw new Error(
        `Dockerfile not found at ${DOCKERFILE_PATH} and no packaged Dockerfile available`
      );
    }
  }
}

export function buildImageRaw(): boolean {
  ensureDockerfile();
  const result = spawnSync(
    CLI_BIN,
    ["build", "-t", `${IMAGE_NAME}:${IMAGE_TAG}`, APPDATA_DIR],
    { stdio: "inherit" }
  );
  return result.status === 0;
}

export function containerExists(containerName: string): boolean {
  if (isAppleContainer()) {
    const result = spawnSync(CLI_BIN, ["inspect", containerName], {
      stdio: "pipe",
    });
    return result.status === 0;
  }
  const result = spawnSync(CLI_BIN, ["container", "inspect", containerName], {
    stdio: "pipe",
  });
  return result.status === 0;
}

export function containerRunning(containerName: string): boolean {
  if (isAppleContainer()) {
    const result = spawnSync(
      CLI_BIN,
      ["inspect", "--format", "json", containerName],
      { stdio: "pipe" }
    );
    if (result.status !== 0) return false;
    try {
      const data = JSON.parse(result.stdout.toString());
      const status = Array.isArray(data) ? data[0]?.State?.Status : data?.State?.Status;
      return status === "running";
    } catch {
      return false;
    }
  }
  const result = spawnSync(
    CLI_BIN,
    ["container", "inspect", "-f", "{{.State.Running}}", containerName],
    { stdio: "pipe" }
  );
  return result.status === 0 && result.stdout.toString().trim() === "true";
}

export function stopContainer(containerName: string): void {
  if (isAppleContainer()) {
    spawnSync(CLI_BIN, ["stop", "--time", "3", containerName], { stdio: "inherit" });
  } else {
    spawnSync(CLI_BIN, ["stop", "--timeout", "3", containerName], { stdio: "inherit" });
  }
}

export function startContainer(containerName: string): void {
  spawnSync(CLI_BIN, ["start", containerName], { stdio: "inherit" });
}

export function removeContainer(containerName: string): void {
  if (isAppleContainer()) {
    spawnSync(CLI_BIN, ["delete", containerName], { stdio: "inherit" });
  } else {
    spawnSync(CLI_BIN, ["rm", containerName], { stdio: "inherit" });
  }
}

export function createNewContainer(
  containerName: string,
  projectName: string,
  projectPath: string
): boolean {
  const mounts = getMounts(projectPath, projectName);
  const args = ["run", "-d", "--name", containerName];

  args.push("-e", "TERM=xterm-256color");
  args.push("-w", `/root/${projectName}`);

  for (const mount of mounts) {
    args.push("-v", mount);
  }

  if (!isAppleContainer()) {
    const flags = loadFlags();
    args.push(...flags);
  }

  args.push(`${IMAGE_NAME}:${IMAGE_TAG}`, "sleep", "infinity");

  const result = spawnSync(CLI_BIN, args, { stdio: "inherit" });
  return result.status === 0;
}

export function execInteractive(
  containerName: string,
  projectName: string
): void {
  spawnSync(
    CLI_BIN,
    [
      "exec",
      "-it",
      "-e",
      "TERM=xterm-256color",
      "-w",
      `/root/${projectName}`,
      containerName,
      "/bin/bash",
    ],
    { stdio: "inherit" }
  );
}

export function getOtherSessionCount(
  containerName: string,
  projectName: string
): number {
  const result = spawnSync("ps", ["ax", "-o", "command="], {
    encoding: "utf-8",
  });
  if (result.status !== 0) return 0;

  const execCmd = isAppleContainer() ? "container exec" : "docker exec";
  const lines = result.stdout.split("\n");
  let count = 0;

  for (const line of lines) {
    const hasExec = line.includes(execCmd);
    const hasIt = line.includes("-it");
    const hasContainerName = line.includes(containerName);
    const hasBash = line.includes("/bin/bash");
    const hasWorkdir = line.includes(`-w /root/${projectName}`);

    if (hasExec && hasIt && hasContainerName && hasBash && hasWorkdir) {
      count++;
    }
  }

  return count;
}

export function stopContainerIfLastSession(
  containerName: string,
  projectName: string
): void {
  const otherSessions = getOtherSessionCount(containerName, projectName);
  if (otherSessions === 0) {
    stopContainer(containerName);
  } else {
    printInfo(
      `Skipping stop; ${otherSessions} other terminal(s) still attached`
    );
  }
}

export function listContainersRaw(): void {
  if (isAppleContainer()) {
    const result = spawnSync(CLI_BIN, ["list", "--format", "json"], {
      encoding: "utf8",
    });
    if (result.status !== 0 || !result.stdout.trim()) return;
    try {
      const containers = JSON.parse(result.stdout);
      const filtered = (Array.isArray(containers) ? containers : []).filter(
        (c: { Name?: string; Names?: string }) => {
          const name = c.Name || c.Names || "";
          return name.startsWith(`${CONTAINER_PREFIX}-`);
        }
      );
      if (filtered.length === 0) return;
      console.log("NAMES\tSTATUS\tCREATED");
      for (const c of filtered) {
        const name = c.Name || c.Names || "";
        const status = c.Status || c.State || "";
        const created = c.CreatedAt || c.Created || "";
        console.log(`${name}\t${status}\t${created}`);
      }
    } catch {
      spawnSync(CLI_BIN, ["list"], { stdio: "inherit" });
    }
  } else {
    spawnSync(
      CLI_BIN,
      [
        "ps",
        "-a",
        "--filter",
        `name=${CONTAINER_PREFIX}-`,
        "--format",
        "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}",
      ],
      { stdio: "inherit" }
    );
  }
}

export function getStoppedContainerIds(): string[] {
  if (isAppleContainer()) {
    const result = spawnSync(CLI_BIN, ["list", "--format", "json"], {
      encoding: "utf8",
    });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    try {
      const containers = JSON.parse(result.stdout);
      return (Array.isArray(containers) ? containers : [])
        .filter((c: { Name?: string; Names?: string; Status?: string; State?: string }) => {
          const name = c.Name || c.Names || "";
          const status = (c.Status || c.State || "").toLowerCase();
          return (
            name.startsWith(`${CONTAINER_PREFIX}-`) &&
            (status === "exited" || status === "stopped")
          );
        })
        .map((c: { Name?: string; Names?: string; Id?: string; ID?: string }) => c.Id || c.ID || c.Name || c.Names || "");
    } catch {
      return [];
    }
  }

  const result = spawnSync(
    CLI_BIN,
    [
      "ps",
      "-a",
      "--filter",
      `name=${CONTAINER_PREFIX}-`,
      "--filter",
      "status=exited",
      "--quiet",
    ],
    { encoding: "utf8" }
  );

  const containerIds = result.stdout.trim();
  if (!containerIds) return [];

  return containerIds.split("\n");
}

export function removeContainersById(ids: string[]): void {
  if (isAppleContainer()) {
    spawnSync(CLI_BIN, ["delete", ...ids], { stdio: "inherit" });
  } else {
    spawnSync(CLI_BIN, ["rm", ...ids], { stdio: "inherit" });
  }
}
