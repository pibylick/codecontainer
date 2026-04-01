import { describe, it, expect } from "vitest";
import type { Settings } from "../config";
import { generateK8sResourceName, getK8sImageRef, podManifestForTests } from "../k8s";

function baseSettings(): Settings {
  return {
    completedInit: true,
    acceptedTos: true,
    agents: ["claude"],
    yolo: true,
    memoryMB: 4096,
    acceptedProjectConfigs: {},
    k8s: {
      namespace: "codecontainer",
      context: "",
      registry: "ghcr.io/pibylick",
      workspaceSize: "20Gi",
      cpu: "2",
      memory: "8Gi",
    },
  };
}

describe("generateK8sResourceName", () => {
  it("creates stable DNS-compatible names", () => {
    const name = generateK8sResourceName("/tmp/My Project");
    expect(name).toMatch(/^codecontainer-my-project-[a-f0-9]{8}$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

describe("getK8sImageRef", () => {
  it("uses registry when configured", () => {
    expect(getK8sImageRef(baseSettings())).toBe("ghcr.io/pibylick/code-container-k8s:latest");
  });

  it("falls back to local image ref when registry is empty", () => {
    const settings = baseSettings();
    settings.k8s.registry = "";
    expect(getK8sImageRef(settings)).toBe("code-container-k8s:latest");
  });
});

describe("podManifestForTests", () => {
  it("renders a pod manifest with pvc, image ref, and persisted claude config", () => {
    const manifest = podManifestForTests("/tmp/demo-app", baseSettings(), {
      name: "demo-app",
      containerEnv: { NODE_ENV: "development" },
    });

    expect(manifest).toContain("kind: PersistentVolumeClaim");
    expect(manifest).toContain("ghcr.io/pibylick/code-container-k8s:latest");
    expect(manifest).toContain("storage: 20Gi");
    expect(manifest).toContain("mountPath: /root/persist");
    expect(manifest).toContain("ln -sfn '/root/persist/.claude' '/root/.claude'");
    expect(manifest).toContain("value: \"development\"");
    expect(manifest).toContain("printf %s");
  });
});
