import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadProjectConfig,
  hashProjectConfigFile,
  hasSecuritySensitiveFields,
  ProjectConfig,
} from "../project-config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codecontainer-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: string): void {
  fs.writeFileSync(path.join(tmpDir, ".codecontainer.json"), content);
}

describe("loadProjectConfig", () => {
  it("parses valid config with all fields", () => {
    writeConfig(JSON.stringify({
      name: "test-project",
      forwardPorts: [3000, 5432],
      containerEnv: { NODE_ENV: "dev" },
      packages: ["postgresql-client"],
      mounts: ["~/data:/root/data:ro"],
      runArgs: ["--cpus=4"],
      postCreateCommand: "npm install",
    }));

    const config = loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.name).toBe("test-project");
    expect(config!.forwardPorts).toEqual([3000, 5432]);
    expect(config!.containerEnv).toEqual({ NODE_ENV: "dev" });
    expect(config!.packages).toEqual(["postgresql-client"]);
    expect(config!.mounts).toEqual(["~/data:/root/data:ro"]);
    expect(config!.runArgs).toEqual(["--cpus=4"]);
    expect(config!.postCreateCommand).toBe("npm install");
  });

  it("parses valid config with subset of fields", () => {
    writeConfig(JSON.stringify({ forwardPorts: [8080] }));
    const config = loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.forwardPorts).toEqual([8080]);
    expect(config!.name).toBeUndefined();
    expect(config!.packages).toBeUndefined();
  });

  it("returns null when file is missing", () => {
    const config = loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("returns null for empty file with warning", () => {
    writeConfig("");
    const config = loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("returns null for invalid JSON with warning", () => {
    writeConfig("{ not valid json }");
    const config = loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("returns null for valid JSON failing Zod validation", () => {
    writeConfig(JSON.stringify({ forwardPorts: "not-array" }));
    const config = loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("rejects runArgs entry with shell operator", () => {
    writeConfig(JSON.stringify({ runArgs: ["; rm -rf /"] }));
    const config = loadProjectConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("accepts empty config object", () => {
    writeConfig("{}");
    const config = loadProjectConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config).toEqual({});
  });
});

describe("hashProjectConfigFile", () => {
  it("returns deterministic hash for same content", () => {
    writeConfig(JSON.stringify({ name: "test" }));
    const hash1 = hashProjectConfigFile(tmpDir);
    const hash2 = hashProjectConfigFile(tmpDir);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns null when file is missing", () => {
    expect(hashProjectConfigFile(tmpDir)).toBeNull();
  });

  it("returns different hash for different content", () => {
    writeConfig(JSON.stringify({ name: "a" }));
    const hash1 = hashProjectConfigFile(tmpDir);

    writeConfig(JSON.stringify({ name: "b" }));
    const hash2 = hashProjectConfigFile(tmpDir);

    expect(hash1).not.toBe(hash2);
  });
});

describe("hasSecuritySensitiveFields", () => {
  it("returns false for config with only name and forwardPorts", () => {
    const config: ProjectConfig = { name: "test", forwardPorts: [3000] };
    expect(hasSecuritySensitiveFields(config)).toBe(false);
  });

  it("returns true for config with packages", () => {
    const config: ProjectConfig = { packages: ["curl"] };
    expect(hasSecuritySensitiveFields(config)).toBe(true);
  });

  it("returns true for config with runArgs", () => {
    const config: ProjectConfig = { runArgs: ["--cpus=2"] };
    expect(hasSecuritySensitiveFields(config)).toBe(true);
  });

  it("returns true for config with mounts", () => {
    const config: ProjectConfig = { mounts: ["/tmp:/tmp"] };
    expect(hasSecuritySensitiveFields(config)).toBe(true);
  });

  it("returns true for config with containerEnv", () => {
    const config: ProjectConfig = { containerEnv: { FOO: "bar" } };
    expect(hasSecuritySensitiveFields(config)).toBe(true);
  });

  it("returns true for config with postCreateCommand", () => {
    const config: ProjectConfig = { postCreateCommand: "echo hello" };
    expect(hasSecuritySensitiveFields(config)).toBe(true);
  });

  it("returns false for empty config", () => {
    const config: ProjectConfig = {};
    expect(hasSecuritySensitiveFields(config)).toBe(false);
  });

  it("returns false for config with empty arrays", () => {
    const config: ProjectConfig = { packages: [], runArgs: [], mounts: [] };
    expect(hasSecuritySensitiveFields(config)).toBe(false);
  });

  it("returns false for config with empty containerEnv", () => {
    const config: ProjectConfig = { containerEnv: {} };
    expect(hasSecuritySensitiveFields(config)).toBe(false);
  });
});
