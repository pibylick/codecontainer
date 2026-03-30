import { spawnSync } from "child_process";
import * as os from "os";

export type Runtime = "docker" | "podman" | "apple-container";

function commandAvailable(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    timeout: 5000,
  });
  return result.status === 0;
}

function detectRuntime(): Runtime {
  const override = process.env.CODE_CONTAINER_RUNTIME;
  if (override === "docker") return "docker";
  if (override === "podman") return "podman";
  if (override === "apple-container") return "apple-container";

  if (process.platform === "darwin" && os.arch() === "arm64") {
    if (commandAvailable("container", ["system", "version"])) {
      return "apple-container";
    }
  }

  if (process.platform === "linux") {
    if (commandAvailable("podman", ["info"])) {
      return "podman";
    }
  }

  return "docker";
}

export const runtime: Runtime = detectRuntime();

export const CLI_BIN: string =
  runtime === "apple-container"
    ? "container"
    : runtime === "podman"
      ? "podman"
      : "docker";

export function isAppleContainer(): boolean {
  return runtime === "apple-container";
}

export function isPodman(): boolean {
  return runtime === "podman";
}

export function runtimeDisplayName(): string {
  if (runtime === "apple-container") return "Apple Container";
  if (runtime === "podman") return "Podman";
  return "Docker";
}
