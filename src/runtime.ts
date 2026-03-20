import { spawnSync } from "child_process";
import * as os from "os";

export type Runtime = "docker" | "apple-container";

function detectRuntime(): Runtime {
  const override = process.env.CODE_CONTAINER_RUNTIME;
  if (override === "docker") return "docker";
  if (override === "apple-container") return "apple-container";

  if (process.platform === "darwin" && os.arch() === "arm64") {
    const result = spawnSync("container", ["system", "version"], {
      stdio: "pipe",
      timeout: 5000,
    });
    if (result.status === 0) return "apple-container";
  }

  return "docker";
}

export const runtime: Runtime = detectRuntime();

export const CLI_BIN: string =
  runtime === "apple-container" ? "container" : "docker";

export function isAppleContainer(): boolean {
  return runtime === "apple-container";
}

export function runtimeDisplayName(): string {
  return runtime === "apple-container" ? "Apple Container" : "Docker";
}
