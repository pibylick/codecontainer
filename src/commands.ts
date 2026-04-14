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
  promptInput,
  promptSecret,
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
  installStatusline,
  type Settings,
} from "./config";
import { AGENTS, applyPermissions } from "./agents";
import { selectAndExportCerts, hasCerts } from "./certs";
import { loadProjectConfig, hashProjectConfigFile, confirmProjectConfig } from "./project-config";
import { getContainerLabel, execInContainer } from "./docker";
import {
  type K8sOverrides,
  buildK8sImage as buildK8sImageRaw,
  pushK8sImage as pushK8sImageRaw,
  secretExists,
  createImagePullSecret,
  k8sPodExists,
  runK8sPod,
  execK8sLogin,
  execK8sRemote,
  listK8sPods,
  stopK8sPod,
  removeK8sPod,
} from "./k8s";

function selectedAgentNames(agentIds: string[]): string {
  return AGENTS
    .filter(a => agentIds.includes(a.id))
    .map(a => a.name)
    .join(", ");
}

async function resolveBuildInputs(agentIds?: string[], memoryMB?: number, k8s?: boolean): Promise<{ agentIds: string[]; memoryMB: number; cpu: string; settings: Settings }> {
  if (!agentIds) {
    printInfo("Select which agents to install in the container image:");
    agentIds = await promptAgentSelection(AGENTS);
    printInfo(`Agents to install: ${selectedAgentNames(agentIds)}`);
  }

  if (memoryMB === undefined) {
    const memChoice = await promptSelect("Memory limit:", [
      { label: "2 GB", value: "2048" },
      { label: "4 GB (recommended)", value: "4096" },
      { label: "6 GB", value: "6144" },
      { label: "8 GB", value: "8192" },
      { label: "16 GB", value: "16384" },
    ], 1);
    memoryMB = parseInt(memChoice, 10);
  }

  let cpu = "2";
  if (k8s) {
    cpu = await promptSelect("CPU limit:", [
      { label: "1 CPU", value: "1" },
      { label: "2 CPU (recommended)", value: "2" },
      { label: "3 CPU", value: "3" },
      { label: "4 CPU", value: "4" },
      { label: "8 CPU", value: "8" },
    ], 1);
    printInfo(`CPU limit: ${cpu}`);
  }

  const settings = loadSettings();
  settings.memoryMB = memoryMB;
  if (k8s) {
    settings.k8s.cpu = cpu;
    settings.k8s.memory = `${memoryMB / 1024}Gi`;
  }
  saveSettings(settings);
  printInfo(`Memory limit: ${memoryMB / 1024} GB`);
  return { agentIds, memoryMB, cpu, settings };
}

export async function buildImage(agentIds?: string[], memoryMB?: number): Promise<void> {
  const { agentIds: resolvedAgentIds, memoryMB: resolvedMemoryMB } = await resolveBuildInputs(agentIds, memoryMB);

  // Always offer to update CA certificates before building
  await selectAndExportCerts();

  printInfo(`Building ${runtimeDisplayName()} image: ${IMAGE_NAME}:${IMAGE_TAG}`);
  if (!buildImageRaw(resolvedAgentIds, resolvedMemoryMB)) {
    printError(`Failed to build ${runtimeDisplayName()} image`);
    process.exit(1);
  }
  printSuccess(`${runtimeDisplayName()} image built successfully`);
}

export async function buildK8sImage(overrides: K8sOverrides = {}, agentIds?: string[], memoryMB?: number): Promise<void> {
  const { agentIds: resolvedAgentIds, memoryMB: resolvedMemoryMB, settings } = await resolveBuildInputs(agentIds, memoryMB, true);

  if (!overrides.registry) {
    settings.k8s.registry = await promptInput("Image registry", settings.k8s.registry);
    saveSettings(settings);
  }

  await selectAndExportCerts();
  buildK8sImageRaw(settings, resolvedAgentIds, resolvedMemoryMB, overrides);
}

export function pushK8sImage(overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  pushK8sImageRaw(settings, overrides);
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

  // Statusline (Claude Code only)
  if (selectedAgents.includes("claude")) {
    printInfo("");
    printInfo("Enable status line for Claude Code inside the container?");
    printInfo("Shows git branch, context usage, token counts, and Anthropic usage stats.");
    printInfo("Requires 'claude login' inside the container for usage stats to work.");
    const enableStatusline = await promptYesNo("Enable status line?");
    settings.statusline = enableStatusline;
    if (enableStatusline) {
      installStatusline(selectedAgents);
      printSuccess("Status line scripts installed");
    }
  }

  printInfo("");
  printInfo("Kubernetes defaults for experimental remote pods:");
  settings.k8s.namespace = await promptInput("Kubernetes namespace", settings.k8s.namespace);
  settings.k8s.context = await promptInput("kubectl context (optional)", settings.k8s.context);
  settings.k8s.registry = await promptInput("Image registry for --k8s builds (optional)", settings.k8s.registry);
  settings.k8s.workspaceSize = await promptInput("Kubernetes PVC size", settings.k8s.workspaceSize);
  settings.k8s.cpu = await promptInput("Kubernetes CPU limit/request", settings.k8s.cpu);
  settings.k8s.memory = await promptInput("Kubernetes memory limit/request", settings.k8s.memory);

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
  if (settings.statusline) {
    installStatusline(settings.agents);
  }

  if (!imageExists()) {
    printWarning("Image not found. Building...");
    await buildImage(settings.agents, settings.memoryMB);
  }

  // Load per-project config
  let projectConfig = loadProjectConfig(projectPath);
  if (projectConfig) {
    projectConfig = await confirmProjectConfig(projectConfig, projectPath);
  }

  // Check for config drift on existing containers
  if (containerRunning(containerName) || containerExists(containerName)) {
    const driftResult = await checkConfigDrift(containerName, projectPath);
    if (driftResult === "recreate") {
      printInfo("Recreating container with updated config...");
      if (containerRunning(containerName)) {
        stopContainer(containerName);
      }
      removeContainer(containerName);
      // Fall through to create new container
    } else {
      // Attach to existing container
      if (!containerRunning(containerName)) {
        printInfo(`Starting existing container: ${containerName}`);
        startContainer(containerName);
        injectGitConfigIntoContainer(containerName);
      } else {
        printInfo(`Container '${containerName}' is already running`);
        printInfo("Attaching to container...");
      }
      execInteractive(containerName, projectName);
      stopContainerIfLastSession(containerName, projectName);
      return;
    }
  }

  printInfo(`Creating new container: ${containerName}`);
  printInfo(`Project: ${projectPath}`);

  if (!(await createNewContainer(containerName, projectName, projectPath, projectConfig))) {
    printError("Failed to create container");
    process.exit(1);
  }

  // Post-create: inject git config → install packages → run postCreateCommand
  injectGitConfigIntoContainer(containerName);

  if (projectConfig?.packages && projectConfig.packages.length > 0) {
    printInfo(`Installing project packages: ${projectConfig.packages.join(", ")}...`);
    const pkgResult = execInContainer(containerName, [
      "sh", "-c", `apt-get update && apt-get install -y ${projectConfig.packages.join(" ")}`
    ]);
    if (!pkgResult) {
      printWarning("Package installation failed, continuing without packages");
    }
  }

  if (projectConfig?.postCreateCommand) {
    printInfo(`Running postCreateCommand: ${projectConfig.postCreateCommand}`);
    const cmdResult = execInContainer(containerName, [
      "sh", "-c", projectConfig.postCreateCommand
    ]);
    if (!cmdResult) {
      printWarning("postCreateCommand failed, continuing");
    }
  }

  execInteractive(containerName, projectName);
  stopContainerIfLastSession(containerName, projectName);
  printSuccess("Container session ended");
}

export async function runK8sContainer(projectPath: string, overrides: K8sOverrides = {}): Promise<void> {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    printError(`Project directory does not exist or is not a directory: ${projectPath}`);
    process.exit(1);
  }

  const settings = loadSettings();

  if (!k8sPodExists(settings, projectPath, overrides)) {
    if (!overrides.workspaceSize) {
      const sizeChoice = await promptSelect("Workspace PVC size:", [
        { label: "10 Gi", value: "10Gi" },
        { label: "20 Gi (recommended)", value: "20Gi" },
        { label: "50 Gi", value: "50Gi" },
        { label: "100 Gi", value: "100Gi" },
      ], 1);
      settings.k8s.workspaceSize = sizeChoice;
      saveSettings(settings);
      printInfo(`Workspace size: ${sizeChoice}`);
    }
  }

  // Registry auth — offer to create imagePullSecret if registry is set and secret doesn't exist in cluster
  const registry = overrides.registry ?? settings.k8s.registry;
  const secretName = settings.k8s.imagePullSecret || "codecontainer-registry";
  if (registry && !secretExists(settings, secretName, overrides)) {
    const needsAuth = await promptYesNo("Does your registry require authentication?");
    if (needsAuth) {
      printInfo("For Harbor robot accounts, use the full name including robot$ prefix.");
      const username = await promptInput("Registry username");
      const password = await promptSecret("Registry password or token");
      // Docker auth uses just the hostname, not the full repo path
      const registryHost = registry.split("/")[0];
      if (!createImagePullSecret(settings, secretName, registryHost, username, password, overrides)) {
        printError("Failed to create imagePullSecret");
        process.exit(1);
      }
      settings.k8s.imagePullSecret = secretName;
      saveSettings(settings);
      printSuccess(`Created imagePullSecret: ${secretName}`);
    }
  }

  let projectConfig = loadProjectConfig(projectPath);
  if (projectConfig) {
    projectConfig = await confirmProjectConfig(projectConfig, projectPath);
  }

  runK8sPod(settings, projectPath, projectConfig, overrides);
}

export function loginK8s(projectPath: string, overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  execK8sLogin(settings, projectPath, overrides);
}

export function remoteK8s(projectPath: string, overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  execK8sRemote(settings, projectPath, overrides);
}

async function checkConfigDrift(
  containerName: string,
  projectPath: string
): Promise<"recreate" | "continue"> {
  const storedHash = getContainerLabel(containerName, "codecontainer.config-hash");
  const currentHash = hashProjectConfigFile(projectPath);

  // No stored hash and no current config: no drift (pre-feature container)
  if (!storedHash && !currentHash) {
    return "continue";
  }

  // New config on existing container without stored hash
  if (!storedHash && currentHash) {
    printWarning("New .codecontainer.json detected for existing container.");
    const recreate = await promptYesNo("Recreate container with project config?");
    return recreate ? "recreate" : "continue";
  }

  // Config removed since container creation
  if (storedHash && !currentHash) {
    printWarning(".codecontainer.json was removed since container was created.");
    const recreate = await promptYesNo("Recreate container without project config?");
    return recreate ? "recreate" : "continue";
  }

  // Config unchanged
  if (storedHash === currentHash) {
    return "continue";
  }

  // Config changed
  printWarning(".codecontainer.json has changed since container was created.");
  const recreate = await promptYesNo("Recreate container with updated config?");
  return recreate ? "recreate" : "continue";
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

export function listK8sContainers(overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  printInfo("Code Containers on Kubernetes:");
  listK8sPods(settings, overrides);
}

export function syncConfigs(): void {
  const settings = loadSettings();
  printInfo("Syncing config files to ~/.code-container/configs...");
  copyConfigs(settings.agents);
  if (settings.yolo) {
    applyPermissions(settings.agents);
  }
  if (settings.statusline) {
    installStatusline(settings.agents);
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

export function stopK8sContainerForProject(projectPath: string, overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  stopK8sPod(settings, projectPath, overrides);
}

export function removeK8sContainerForProject(projectPath: string, overrides: K8sOverrides = {}): void {
  const settings = loadSettings();
  removeK8sPod(settings, projectPath, overrides);
}
