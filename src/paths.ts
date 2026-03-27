import * as path from "path";
import * as os from "os";

export const APPDATA_DIR = path.join(os.homedir(), ".code-container");
export const CONFIGS_DIR = path.join(APPDATA_DIR, "configs");
export const DOCKERFILE_PATH = path.join(APPDATA_DIR, "Dockerfile");
export const EXTRA_PACKAGES_APT_PATH = path.join(APPDATA_DIR, "extra_packages.apt");
export const SETTINGS_PATH = path.join(APPDATA_DIR, "settings.json");
export const MOUNTS_PATH = path.join(APPDATA_DIR, "MOUNTS.txt");
export const FLAGS_PATH = path.join(APPDATA_DIR, "DOCKER_FLAGS.txt");

/** Path inside Apple Container where git config is injected (writable mount) */
export const APPLE_GIT_INJECT_PATH = "/root/.git-inject";
