import { spawnSync, SpawnSyncOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { AGENTS, getSelectedAgents } from "./agents";
import type { Settings } from "./config";
import type { ProjectConfig } from "./project-config";
import { IMAGE_NAME, IMAGE_TAG, buildImageRaw, pushImageRaw } from "./docker";
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
${hostname}  restartPolicy: Always
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
  printInfo(`Building Kubernetes image: ${imageRef}`);
  if (!buildImageRaw(agentIds, memoryMB, imageRef)) {
    printError("Failed to build Kubernetes image");
    process.exit(1);
  }

  const config = resolveK8sConfig(settings, overrides);
  if (!config.registry) {
    printWarning("No Kubernetes registry configured. Built image locally only.");
    return;
  }

  printInfo(`Pushing Kubernetes image: ${imageRef}`);
  if (!pushImageRaw(imageRef)) {
    printError("Failed to push Kubernetes image");
    process.exit(1);
  }

  printSuccess("Kubernetes image built and pushed successfully");
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
  spawnKubectl(config, ["exec", "-it", podName, "--", "claude", "auth", "login"], { stdio: "inherit" });
}

export function execK8sRemote(settings: Settings, projectPath: string, overrides: K8sOverrides = {}): void {
  const config = ensurePodRunning(settings, projectPath, overrides);
  const podName = generateK8sResourceName(projectPath);
  const args = ["exec", "-it", podName, "--", "claude", "remote-control"];
  if (overrides.remoteName) {
    args.push("--name", overrides.remoteName);
  }
  spawnKubectl(config, args, { stdio: "inherit" });
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
