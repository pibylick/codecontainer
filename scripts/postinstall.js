#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const APPDATA_DIR = path.join(os.homedir(), ".code-container");
const CONFIGS_DIR = path.join(APPDATA_DIR, "configs");
const DOCKERFILE_PATH = path.join(APPDATA_DIR, "Dockerfile");
const EXTRA_PACKAGES_APT_PATH = path.join(APPDATA_DIR, "extra_packages.apt");
const FLAGS_PATH = path.join(APPDATA_DIR, "DOCKER_FLAGS.txt");
const CERTS_DIR = path.join(APPDATA_DIR, "certs");
const PACKAGED_DOCKERFILE = path.join(__dirname, "..", "Dockerfile");

if (!fs.existsSync(APPDATA_DIR)) {
  fs.mkdirSync(APPDATA_DIR, { recursive: true, mode: 0o700 });
}

if (!fs.existsSync(CONFIGS_DIR)) {
  fs.mkdirSync(CONFIGS_DIR, { recursive: true, mode: 0o700 });
}

// Always sync Dockerfile from package to pick up new features
fs.copyFileSync(PACKAGED_DOCKERFILE, DOCKERFILE_PATH);

if (!fs.existsSync(EXTRA_PACKAGES_APT_PATH)) {
  fs.writeFileSync(
    EXTRA_PACKAGES_APT_PATH,
    [
      "# One apt package per line.",
      "# Example:",
      "# postgresql-client",
      "# redis-tools",
      "",
    ].join("\n")
  );
}

if (!fs.existsSync(FLAGS_PATH)) {
  fs.writeFileSync(FLAGS_PATH, "# Add custom Docker flags here (one per line)\n# Example: -p 7777:7777\n");
}

// Ensure certs/ directory exists for custom CA certificates
if (!fs.existsSync(CERTS_DIR)) {
  fs.mkdirSync(CERTS_DIR, { recursive: true, mode: 0o755 });
}
