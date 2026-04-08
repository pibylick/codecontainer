import { spawnSync, SpawnSyncOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AGENTS, getSelectedAgents } from "./agents";
import type { Settings } from "./config";
import type { ProjectConfig } from "./project-config";
import { IMAGE_NAME, IMAGE_TAG, buildImageRaw, pushImageRaw } from "./docker";
import { CONFIGS_DIR } from "./paths";
import { printError, printInfo, printSuccess, printWarning } from "./utils";

export interface K8sOverrides {
  namespace?: string;
  context?: string;
  registry?: string;
  workspaceSize?: string;
  cpu?: string;
  memory?: string;
  remoteName?: string;
}

interface ResolvedK8sConfig {
  namespace: string;
  context: string;
  registry: string;
  imagePullSecret: string;
  workspaceSize: string;
  cpu: string;
  memory: string;
}

const K8S_IMAGE_NAME = `${IMAGE_NAME}-k8s`;

function resolveK8sConfig(settings: Settings, overrides: K8sOverrides = {}): ResolvedK8sConfig {
  return {
    namespace: overrides.namespace ?? settings.k8s.namespace,
    context: overrides.context ?? settings.k8s.context,
    registry: overrides.registry ?? settings.k8s.registry,
    imagePullSecret: settings.k8s.imagePullSecret,
    workspaceSize: overrides.workspaceSize ?? settings.k8s.workspaceSize,
    cpu: overrides.cpu ?? settings.k8s.cpu,
    memory: overrides.memory ?? settings.k8s.memory,
  };
}

function kubectlArgs(config: ResolvedK8sConfig): string[] {
  return config.context ? ["--context", config.context, "-n", config.namespace] : ["-n", config.namespace];
}

function spawnKubectl(config: ResolvedK8sConfig, args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync("kubectl", [...kubectlArgs(config), ...args], options);
}

export function secretExists(
  settings: Settings,
  secretName: string,
  overrides: K8sOverrides = {},
): boolean {
  const config = resolveK8sConfig(settings, overrides);
  const result = spawnKubectl(config, ["get", "secret", secretName], { stdio: "pipe" });
  return result.status === 0;
}

export function createImagePullSecret(
  settings: Settings,
  secretName: string,
  server: string,
  username: string,
  password: string,
  overrides: K8sOverrides = {},
): boolean {
  const config = resolveK8sConfig(settings, overrides);
  // Delete existing secret if present (ignore errors)
  spawnKubectl(config, ["delete", "secret", secretName, "--ignore-not-found"], { stdio: "pipe" });
  const result = spawnKubectl(config, [
    "create", "secret", "docker-registry", secretName,
    `--docker-server=${server}`,
    `--docker-username=${username}`,
    `--docker-password=${password}`,
  ], { stdio: "inherit" });
  return result.status === 0;
}

function resourceHash(projectPath: string): string {
  return crypto.createHash("sha1").update(projectPath).digest("hex").slice(0, 8);
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function generateK8sResourceName(projectPath: string): string {
  const base = sanitizeName(path.basename(projectPath)) || "project";
  const name = `codecontainer-${base}-${resourceHash(projectPath)}`;
  return name.slice(0, 63).replace(/-$/, "");
}

function generatePvcName(projectPath: string): string {
  return `${generateK8sResourceName(projectPath)}-data`;
}

export function getK8sImageRef(settings: Settings, overrides: K8sOverrides = {}): string {
  const config = resolveK8sConfig(settings, overrides);
  if (!config.registry) {
    return `${K8S_IMAGE_NAME}:${IMAGE_TAG}`;
  }
  return `${config.registry.replace(/\/$/, "")}/${K8S_IMAGE_NAME}:${IMAGE_TAG}`;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function startupScript(settings: Settings): string {
  const selectedAgents = getSelectedAgents(settings.agents);
  const mountMetadata = selectedAgents.flatMap((agent) =>
    agent.mounts.map((mount) => ({
      ...mount,
      isFile: agent.configSources.some((source) => !source.isDir && source.dest === mount.hostDir),
    })),
  );

  const lines = [
    "set -e",
    "mkdir -p /root/persist /root/persist/workspace /root/.config",
    "ln -sfn /root/persist/workspace /workspace",
    "touch /root/persist/.gitconfig",
    "ln -sfn /root/persist/.gitconfig /root/.gitconfig",
  ];

  for (const mount of mountMetadata) {
    const persistentPath = `/root/persist/${mount.hostDir}`;
    const parentDir = path.posix.dirname(mount.containerPath);
    lines.push(`mkdir -p ${shellEscape(path.posix.dirname(persistentPath))}`);
    if (mount.isFile) {
      lines.push(`touch ${shellEscape(persistentPath)}`);
    } else {
      lines.push(`mkdir -p ${shellEscape(persistentPath)}`);
    }
    lines.push(`mkdir -p ${shellEscape(parentDir)}`);
    lines.push(`rm -rf ${shellEscape(mount.containerPath)}`);
    lines.push(`ln -sfn ${shellEscape(persistentPath)} ${shellEscape(mount.containerPath)}`);
  }

  if (settings.yolo) {
    for (const agent of selectedAgents) {
      const persistentFile = `/root/persist/${agent.permissionConfig.filePath}`;
      const encoded = Buffer.from(agent.permissionConfig.content, "utf8").toString("base64");
      lines.push(`mkdir -p ${shellEscape(path.posix.dirname(persistentFile))}`);
      lines.push(`printf %s ${shellEscape(encoded)} | base64 -d > ${shellEscape(persistentFile)}`);
    }
  }

  lines.push("cd /workspace");
  lines.push("sleep infinity");
  return lines.join("\n");
}

function podManifest(projectPath: string, settings: Settings, projectConfig: ProjectConfig | null, overrides: K8sOverrides = {}): string {
  const config = resolveK8sConfig(settings, overrides);
  const name = generateK8sResourceName(projectPath);
  const pvcName = generatePvcName(projectPath);
  const imageRef = getK8sImageRef(settings, overrides);
  const imagePullPolicy = config.registry ? "Always" : "IfNotPresent";
  const envEntries = Object.entries(projectConfig?.containerEnv ?? {})
    .map(([key, value]) => `        - name: ${key}\n          value: ${JSON.stringify(value)}`)
    .join("\n");
  const hostname = projectConfig?.name ? `  hostname: ${sanitizeName(projectConfig.name).slice(0, 63)}\n` : "";
  const imagePullSecrets = config.imagePullSecret
    ? `  imagePullSecrets:\n    - name: ${config.imagePullSecret}\n`
    : "";

  return `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvcName}
  labels:
    app.kubernetes.io/managed-by: codecontainer
    app.kubernetes.io/part-of: codecontainer
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: ${config.workspaceSize}
---
apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/managed-by: codecontainer
    app.kubernetes.io/part-of: codecontainer
spec:
${hostname}${imagePullSecrets}  restartPolicy: Always
  containers:
    - name: codecontainer
      image: ${imageRef}
      imagePullPolicy: ${imagePullPolicy}
      workingDir: /workspace
      stdin: true
      tty: true
      env:
        - name: TERM
          value: xterm-256color
${envEntries ? `${envEntries}\n` : ""}      command:
        - /bin/bash
        - -lc
        - |
${indentBlock(startupScript(settings), 10)}
      resources:
        requests:
          cpu: ${config.cpu}
          memory: ${config.memory}
        limits:
          cpu: ${config.cpu}
          memory: ${config.memory}
      volumeMounts:
        - name: data
          mountPath: /root/persist
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${pvcName}
`;
}

function indentBlock(content: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return content
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function checkKubectlAvailable(): void {
  const result = spawnSync("kubectl", ["version", "--client"], { stdio: "pipe" });
  if (result.status !== 0) {
    printError("kubectl is not available. Please install kubectl and configure cluster access.");
    process.exit(1);
  }
}

function ensureNamespace(settings: Settings, overrides: K8sOverrides = {}): ResolvedK8sConfig {
  checkKubectlAvailable();
  const config = resolveK8sConfig(settings, overrides);
  const getResult = spawnSync("kubectl", config.context ? ["--context", config.context, "get", "namespace", config.namespace] : ["get", "namespace", config.namespace], { stdio: "pipe" });
  if (getResult.status === 0) {
    return config;
  }

  printInfo(`Creating namespace: ${config.namespace}`);
  const createResult = spawnSync("kubectl", config.context ? ["--context", config.context, "create", "namespace", config.namespace] : ["create", "namespace", config.namespace], { stdio: "inherit" });
  if (createResult.status !== 0) {
    printError(`Failed to create namespace: ${config.namespace}`);
    process.exit(1);
  }
  return config;
}

function ensurePodRunning(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): ResolvedK8sConfig {
  const config = ensureNamespace(settings, overrides);
  const podName = generateK8sResourceName(projectPath);
  const waitResult = spawnKubectl(config, ["wait", "--for=condition=Ready", `pod/${podName}`, "--timeout=180s"], { stdio: "inherit" });
  if (waitResult.status !== 0) {
    printError(`Pod is not ready: ${podName}`);
    process.exit(1);
  }
  return config;
}

export function buildK8sImage(settings: Settings, agentIds?: string[], memoryMB?: number, overrides: K8sOverrides = {}): void {
  const imageRef = getK8sImageRef(settings, overrides);
  printInfo(`Building Kubernetes image: ${imageRef} (linux/amd64)`);
  if (!buildImageRaw(agentIds, memoryMB, imageRef, "amd64")) {
    printError("Failed to build Kubernetes image");
    process.exit(1);
  }

  const config = resolveK8sConfig(settings, overrides);
  if (!config.registry) {
    printWarning("No Kubernetes registry configured. Built image locally only.");
    return;
  }

  pushK8sImage(settings, overrides);
}

export function pushK8sImage(settings: Settings, overrides: K8sOverrides = {}): void {
  const config = resolveK8sConfig(settings, overrides);
  if (!config.registry) {
    printError("No Kubernetes registry configured. Set registry with: codecontainer init");
    process.exit(1);
  }

  const imageRef = getK8sImageRef(settings, overrides);
  printInfo(`Pushing Kubernetes image: ${imageRef}`);
  if (!pushImageRaw(imageRef)) {
    printError("Failed to push Kubernetes image");
    process.exit(1);
  }

  printSuccess("Kubernetes image pushed successfully");
}

export function k8sPodExists(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): boolean {
  const config = ensureNamespace(settings, overrides);
  const podName = generateK8sResourceName(projectPath);
  const result = spawnKubectl(config, ["get", "pod", podName], { stdio: "pipe" });
  return result.status === 0;
}

function remoteProjectPath(projectPath: string): string {
  return `/workspace/${path.basename(projectPath)}`;
}

function kubectlCp(config: ResolvedK8sConfig, localPath: string, podName: string, remotePath: string): boolean {
  const dest = `${config.namespace}/${podName}:${remotePath}`;
  const args = config.context
    ? ["--context", config.context, "cp", localPath, dest]
    : ["cp", localPath, dest];
  return spawnSync("kubectl", args, { stdio: "pipe" }).status === 0;
}

function copyClaudeConfigsToPod(config: ResolvedK8sConfig, podName: string): void {
  const home = process.env.HOME || "/root";
  const claudeDir = path.join(home, ".claude");

  // CLAUDE.md — global instructions
  const claudeMd = path.join(claudeDir, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    spawnKubectl(config, ["exec", podName, "--", "mkdir", "-p", "/root/.claude/plugins"], { stdio: "pipe" });
    if (kubectlCp(config, claudeMd, podName, "/root/.claude/CLAUDE.md")) {
      printInfo("Copied CLAUDE.md to pod");
    }
  }

  // known_marketplaces.json — marketplace registry with paths rewritten for container
  const marketplaces = path.join(claudeDir, "plugins", "known_marketplaces.json");
  if (fs.existsSync(marketplaces)) {
    spawnKubectl(config, ["exec", podName, "--", "mkdir", "-p", "/root/.claude/plugins"], { stdio: "pipe" });
    const raw = fs.readFileSync(marketplaces, "utf-8");
    const data = JSON.parse(raw);
    for (const key of Object.keys(data)) {
      if (data[key].installLocation) {
        data[key].installLocation = data[key].installLocation.replace(
          /^.*?\/\.claude\//,
          "/root/.claude/",
        );
      }
    }
    const rewritten = JSON.stringify(data, null, 2);
    const encoded = Buffer.from(rewritten, "utf-8").toString("base64");
    const writeResult = spawnKubectl(config, [
      "exec", podName, "--", "sh", "-c",
      `printf '%s' '${encoded}' | base64 -d > /root/.claude/plugins/known_marketplaces.json`,
    ], { stdio: "inherit" });
    if (writeResult.status === 0) {
      printInfo("Copied marketplace registry to pod (paths rewritten)");
    }
  }

  // Install user-scoped plugins from host's installed_plugins.json
  const installedPlugins = path.join(claudeDir, "plugins", "installed_plugins.json");
  if (fs.existsSync(installedPlugins)) {
    const pluginsRaw = fs.readFileSync(installedPlugins, "utf-8");
    const pluginsData = JSON.parse(pluginsRaw);
    const plugins: Record<string, any[]> = pluginsData.plugins ?? {};
    const userPlugins: string[] = [];
    for (const [key, installs] of Object.entries(plugins)) {
      const hasUserScope = installs.some((i: any) => i.scope === "user");
      if (hasUserScope) {
        // key format: "plugin-name@marketplace-name"
        userPlugins.push(key);
      }
    }
    if (userPlugins.length > 0) {
      printInfo(`Installing ${userPlugins.length} plugin(s) in pod...`);
      for (const plugin of userPlugins) {
        const [pluginName, marketplace] = plugin.split("@");
        const installCmd = `claude plugin install "${pluginName}" --marketplace "${marketplace}" -y 2>/dev/null || true`;
        spawnKubectl(config, ["exec", podName, "--", "sh", "-c", installCmd], { stdio: "inherit" });
      }
    }
  }
}

function copyProjectToPod(config: ResolvedK8sConfig, projectPath: string): void {
  const podName = generateK8sResourceName(projectPath);
  const remotePath = remoteProjectPath(projectPath);
  const existsResult = spawnKubectl(config, ["exec", podName, "--", "test", "-d", remotePath], { stdio: "pipe" });
  if (existsResult.status === 0) {
    return;
  }

  printInfo(`Copying local project into pod workspace: ${path.basename(projectPath)}`);
  const mkdirResult = spawnKubectl(config, ["exec", podName, "--", "mkdir", "-p", remotePath], { stdio: "inherit" });
  if (mkdirResult.status !== 0) {
    printError("Failed to prepare workspace directory inside pod");
    process.exit(1);
  }

  const cpArgs = config.context
    ? ["--context", config.context, "cp", `${projectPath}/.`, `${config.namespace}/${podName}:${remotePath}`]
    : ["cp", `${projectPath}/.`, `${config.namespace}/${podName}:${remotePath}`];
  const copyResult = spawnSync("kubectl", cpArgs, { stdio: "inherit" });
  if (copyResult.status !== 0) {
    printError("Failed to copy project into pod workspace");
    process.exit(1);
  }
}

function warnUnsupportedProjectConfig(projectConfig: ProjectConfig | null): void {
  if (!projectConfig) return;
  if (projectConfig.mounts && projectConfig.mounts.length > 0) {
    printWarning("Project mounts are not supported in Kubernetes mode and will be ignored.");
  }
  if (projectConfig.runArgs && projectConfig.runArgs.length > 0) {
    printWarning("Project runArgs are not supported in Kubernetes mode and will be ignored.");
  }
}

export function runK8sPod(settings: Settings, projectPath: string, projectConfig: ProjectConfig | null, overrides: K8sOverrides = {}): void {
  const config = ensureNamespace(settings, overrides);
  const podName = generateK8sResourceName(projectPath);

  warnUnsupportedProjectConfig(projectConfig);

  if (!k8sPodExists(settings, projectPath, overrides)) {
    const manifest = podManifest(projectPath, settings, projectConfig, overrides);
    printInfo(`Creating Kubernetes pod: ${podName}`);
    const applyResult = spawnSync("kubectl", config.context ? ["--context", config.context, "apply", "-n", config.namespace, "-f", "-"] : ["apply", "-n", config.namespace, "-f", "-"], {
      stdio: ["pipe", "inherit", "inherit"],
      input: manifest,
      encoding: "utf8",
    });
    if (applyResult.status !== 0) {
      printError("Failed to apply Kubernetes manifest");
      process.exit(1);
    }
  } else {
    printInfo(`Kubernetes pod already exists: ${podName}`);
  }

  ensurePodRunning(settings, projectPath, overrides);
  copyClaudeConfigsToPod(config, podName);
  copyProjectToPod(config, projectPath);

  if (projectConfig?.packages && projectConfig.packages.length > 0) {
    printInfo(`Installing project packages in pod: ${projectConfig.packages.join(", ")}`);
    const pkgResult = spawnKubectl(config, ["exec", podName, "--", "sh", "-c", `apt-get update && apt-get install -y ${projectConfig.packages.join(" ")}`], { stdio: "inherit" });
    if (pkgResult.status !== 0) {
      printWarning("Package installation failed, continuing");
    }
  }

  if (projectConfig?.postCreateCommand) {
    printInfo(`Running postCreateCommand in pod: ${projectConfig.postCreateCommand}`);
    const cmdResult = spawnKubectl(config, ["exec", podName, "--", "sh", "-lc", `cd ${shellEscape(remoteProjectPath(projectPath))} && ${projectConfig.postCreateCommand}`], { stdio: "inherit" });
    if (cmdResult.status !== 0) {
      printWarning("postCreateCommand failed, continuing");
    }
  }

  execK8sShell(settings, projectPath, overrides);
}

export function execK8sShell(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensurePodRunning(settings, projectPath, overrides);
  const podName = generateK8sResourceName(projectPath);
  const workdir = remoteProjectPath(projectPath);
  spawnKubectl(config, ["exec", "-it", podName, "--", "bash", "-lc", `cd ${shellEscape(workdir)} && exec /bin/bash`], { stdio: "inherit" });
}

export function execK8sLogin(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensurePodRunning(settings, projectPath, overrides);
  const podName = generateK8sResourceName(projectPath);
  printInfo("Opening interactive shell in pod. Run: claude auth login");
  spawnKubectl(config, ["exec", "-it", podName, "--", "/bin/bash"], { stdio: "inherit" });
}

export function execK8sRemote(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensurePodRunning(settings, projectPath, overrides);
  const podName = generateK8sResourceName(projectPath);

  let remoteCmd = "claude remote-control";
  if (overrides.remoteName) {
    remoteCmd += ` --name ${shellEscape(overrides.remoteName)}`;
  }

  const tmuxSession = "remote-control";

  // Kill existing tmux session if present
  spawnKubectl(config, ["exec", podName, "--", "tmux", "kill-session", "-t", tmuxSession], { stdio: "pipe" });

  // Start in tmux and attach so user can confirm the interactive prompt, then detach with Ctrl+B, D
  printInfo("Starting Remote Control in tmux. After confirming, press Ctrl+B then D to detach.");
  spawnKubectl(config, ["exec", "-it", podName, "--", "tmux", "new-session", "-s", tmuxSession, remoteCmd], { stdio: "inherit" });

  printInfo(`To reattach: codecontainer login --k8s, then: tmux attach -t ${tmuxSession}`);
}

export function listK8sPods(settings: Settings, overrides: K8sOverrides = {}): void {
  const config = ensureNamespace(settings, overrides);
  spawnKubectl(config, ["get", "pods", "-l", "app.kubernetes.io/managed-by=codecontainer"], { stdio: "inherit" });
}

export function stopK8sPod(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensureNamespace(settings, overrides);
  const podName = generateK8sResourceName(projectPath);
  const deleteResult = spawnKubectl(config, ["delete", "pod", podName, "--ignore-not-found=true"], { stdio: "inherit" });
  if (deleteResult.status !== 0) {
    printError(`Failed to stop Kubernetes pod: ${podName}`);
    process.exit(1);
  }
  printSuccess("Kubernetes pod stopped");
}

export function removeK8sPod(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensureNamespace(settings, overrides);
  const podName = generateK8sResourceName(projectPath);
  const pvcName = generatePvcName(projectPath);
  const podResult = spawnKubectl(config, ["delete", "pod", podName, "--ignore-not-found=true"], { stdio: "inherit" });
  if (podResult.status !== 0) {
    printError(`Failed to delete Kubernetes pod: ${podName}`);
    process.exit(1);
  }
  const pvcResult = spawnKubectl(config, ["delete", "pvc", pvcName, "--ignore-not-found=true"], { stdio: "inherit" });
  if (pvcResult.status !== 0) {
    printError(`Failed to delete Kubernetes PVC: ${pvcName}`);
    process.exit(1);
  }
  printSuccess("Kubernetes pod and PVC removed");
}

export function podManifestForTests(projectPath: string, settings: Settings, projectConfig: ProjectConfig | null, overrides: K8sOverrides = {}): string {
  return podManifest(projectPath, settings, projectConfig, overrides);
}
