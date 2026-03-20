import * as path from "path";
import * as fs from "fs";
import {
  printInfo,
  printSuccess,
  printWarning,
  printError,
  promptYesNo,
  promptAgentSelection,
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
import { runtimeDisplayName } from "./runtime";
import {
  ensureConfigDir,
  loadSettings,
  saveSettings,
  copyConfigs,
} from "./config";
import { AGENTS, applyPermissions } from "./agents";

export function buildImage(): void {
  printInfo(`Building ${runtimeDisplayName()} image: ${IMAGE_NAME}:${IMAGE_TAG}`);
  if (!buildImageRaw()) {
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

  ensureConfigDir();

  if (!imageExists()) {
    printWarning("Image not found. Building...");
    buildImage();
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
