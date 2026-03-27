#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const APPDATA_DIR = path.join(os.homedir(), ".code-container");
const CONFIGS_DIR = path.join(APPDATA_DIR, "configs");
const DOCKERFILE_PATH = path.join(APPDATA_DIR, "Dockerfile");
const FLAGS_PATH = path.join(APPDATA_DIR, "DOCKER_FLAGS.txt");
const PACKAGED_DOCKERFILE = path.join(__dirname, "..", "Dockerfile");

if (!fs.existsSync(APPDATA_DIR)) {
  fs.mkdirSync(APPDATA_DIR, { recursive: true, mode: 0o700 });
}

if (!fs.existsSync(CONFIGS_DIR)) {
  fs.mkdirSync(CONFIGS_DIR, { recursive: true, mode: 0o700 });
}

// Always sync Dockerfile from package to pick up new features
fs.copyFileSync(PACKAGED_DOCKERFILE, DOCKERFILE_PATH);

if (!fs.existsSync(FLAGS_PATH)) {
  fs.writeFileSync(FLAGS_PATH, "# Add custom Docker flags here (one per line)\n# Example: -p 7777:7777\n");
}

// Copy bundled CA certificate if present
const CERT_NAME = "AssecoBS-CA-G3.crt";
const PACKAGED_CERT = path.join(__dirname, "..", CERT_NAME);
const CERT_DEST = path.join(APPDATA_DIR, CERT_NAME);
if (fs.existsSync(PACKAGED_CERT)) {
  fs.copyFileSync(PACKAGED_CERT, CERT_DEST);
}
