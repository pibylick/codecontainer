import * as path from "path";
import * as fs from "fs";
import {
  printInfo,
  printSuccess,
  printWarning,
  printError,
  promptYesNo,
  promptAgentSelection,
  promptSelect,
} from "./utils";
import {
  generateContainerName,
  imageExists,
  buildImageRaw,
  containerExists,
  containerRunning,
  stopContainer,
  startContainer,
  removeContainer,
  createNewContainer,
  execInteractive,
  stopContainerIfLastSession,
  listContainersRaw,
  getStoppedContainerIds,
  removeContainersById,
  IMAGE_NAME,
  IMAGE_TAG,
} from "./docker";
import { injectGitConfigIntoContainer } from "./mounts";
import { runtimeDisplayName } from "./runtime";
import {
  loadSettings,
  saveSettings,
  copyConfigs,
  configsExist,
} from "./config";
import { AGENTS, applyPermissions } from "./agents";
import { selectAndExportCerts, hasCerts } from "./certs";

export async function buildImage(agentIds?: string[], memoryMB?: number): Promise<void> {
  if (!agentIds) {
    printInfo("Select which agents to install in the container image:");
    agentIds = await promptAgentSelection(AGENTS);
    const agentNames = AGENTS
      .filter(a => agentIds!.includes(a.id))
      .map(a => a.name)
      .join(", ");
    printInfo(`Agents to install: ${agentNames}`);
  }

  if (memoryMB === undefined) {
    const memChoice = await promptSelect("Container memory limit:", [
      { label: "2 GB", value: "2048" },
      { label: "4 GB (recommended)", value: "4096" },
      { label: "6 GB", value: "6144" },
      { label: "8 GB", value: "8192" },
      { label: "16 GB", value: "16384" },
    ], 1);
    memoryMB = parseInt(memChoice, 10);
  }

  const settings = loadSettings();
  settings.memoryMB = memoryMB;
  saveSettings(settings);
  printInfo(`Memory limit: ${memoryMB / 1024} GB`);

  printInfo(`Building ${runtimeDisplayName()} image: ${IMAGE_NAME}:${IMAGE_TAG}`);
  if (!buildImageRaw(agentIds, memoryMB)) {
    printError(`Failed to build ${runtimeDisplayName()} image`);
    process.exit(1);
  }
  printSuccess(`${runtimeDisplayName()} image built successfully`);
}

export async function init(isStartup: boolean = false): Promise<void> {
  const settings = loadSettings();

  // On startup, skip if already initialized
  if (isStartup && settings.completedInit) {
    return;
  }

  // On explicit init with existing config, confirm overwrite
  if (!isStartup && settings.completedInit) {
    printWarning(
      "Config files already exist. This operation will re-configure agents and overwrite existing config files."
    );
    if (!await promptYesNo("Continue?")) {
      return;
    }
  }

  // Agent selection
  if (isStartup) {
    printInfo("First run detected. Let's configure your container environment.");
  }
  const selectedAgents = await promptAgentSelection(AGENTS);
  settings.agents = selectedAgents;

  const agentNames = AGENTS
    .filter(a => selectedAgents.includes(a.id))
    .map(a => a.name)
    .join(", ");
  printInfo(`Selected agents: ${agentNames}`);

  // Config copying
  if (isStartup) {
    printInfo(
      "Would you like to copy config files for the selected agents to ~/.code-container/configs for mounting?"
    );
    printInfo(
      "If you choose to not copy config files, you can still setup your harness once inside the container."
    );
    const shouldCopy = await promptYesNo("Copy config files?");
    if (shouldCopy) {
      copyConfigs(selectedAgents);
      printSuccess("Config files copied successfully");
    } else {
      printInfo("Ignoring copy. Run `codecontainer init` to copy.");
    }
  } else {
    printInfo("Copying config files to ~/.code-container/configs...");
    copyConfigs(selectedAgents);
    printSuccess("Config files copied successfully");
  }

  // Yolo mode
  printInfo("");
  printInfo("Enable full permissions for selected agents inside the container? (yolo mode)");
  printInfo("This allows agents to execute commands without permission prompts.");
  printInfo("Only affects the container environment, not your host system.");
  const enableYolo = await promptYesNo("Enable yolo mode?");
  settings.yolo = enableYolo;
  if (enableYolo) {
    applyPermissions(selectedAgents);
    printSuccess("Full permissions configured for selected agents");
  }

  // CA certificates
  if (!hasCerts()) {
    await selectAndExportCerts();
  }

  settings.completedInit = true;
  saveSettings(settings);
}

export async function runContainer(projectPath: string): Promise<void> {
  const containerName = generateContainerName(projectPath);
  const projectName = path.basename(projectPath);

  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    printError(
      `Project directory does not exist or is not a directory: ${projectPath}`
    );
    process.exit(1);
  }

  const settings = loadSettings();
  if (!configsExist(settings.agents)) {
    printInfo("Config files not found. Copying...");
    copyConfigs(settings.agents);
  }

  if (!imageExists()) {
    printWarning("Image not found. Building...");
    await buildImage(settings.agents, settings.memoryMB);
  }

  if (containerRunning(containerName)) {
    printInfo(`Container '${containerName}' is already running`);
    printInfo("Attaching to container...");
    execInteractive(containerName, projectName);
    stopContainerIfLastSession(containerName, projectName);
    return;
  }

  if (containerExists(containerName)) {
    printInfo(`Starting existing container: ${containerName}`);
    startContainer(containerName);
    injectGitConfigIntoContainer(containerName);
    execInteractive(containerName, projectName);
    stopContainerIfLastSession(containerName, projectName);
    return;
  }

  printInfo(`Creating new container: ${containerName}`);
  printInfo(`Project: ${projectPath}`);

  if (!createNewContainer(containerName, projectName, projectPath)) {
    printError("Failed to create container");
    process.exit(1);
  }

  injectGitConfigIntoContainer(containerName);
  execInteractive(containerName, projectName);
  stopContainerIfLastSession(containerName, projectName);
  printSuccess("Container session ended");
}

export function stopContainerForProject(projectPath: string): void {
  const containerName = generateContainerName(projectPath);

  if (!containerExists(containerName)) {
    printError(`Container does not exist: ${containerName}`);
    process.exit(1);
  }

  if (containerRunning(containerName)) {
    printInfo(`Stopping container: ${containerName}`);
    stopContainer(containerName);
    printSuccess("Container stopped");
  } else {
    printWarning(`Container is not running: ${containerName}`);
  }
}

export function removeContainerForProject(projectPath: string): void {
  const containerName = generateContainerName(projectPath);

  if (!containerExists(containerName)) {
    printError(`Container does not exist: ${containerName}`);
    process.exit(1);
  }

  if (containerRunning(containerName)) {
    printInfo(`Stopping container: ${containerName}`);
    stopContainer(containerName);
  }

  printInfo(`Removing container: ${containerName}`);
  removeContainer(containerName);
  printSuccess("Container removed");
}

export function listContainers(): void {
  printInfo("Code Containers:");
  listContainersRaw();
}

export function syncConfigs(): void {
  const settings = loadSettings();
  printInfo("Syncing config files to ~/.code-container/configs...");
  copyConfigs(settings.agents);
  if (settings.yolo) {
    applyPermissions(settings.agents);
  }
  printSuccess("Config files synced successfully");
}

export function cleanContainers(): void {
  printInfo("Removing all stopped Code containers...");
  const containerIds = getStoppedContainerIds();

  if (containerIds.length === 0) {
    printInfo("No stopped Code containers to remove");
    return;
  }

  removeContainersById(containerIds);
  printSuccess("Cleanup complete");
}
