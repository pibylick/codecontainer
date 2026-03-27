import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { APPDATA_DIR } from "./paths";
import { printInfo, printWarning, promptMultiSelect } from "./utils";

export interface SystemCert {
  id: string;
  name: string;
  pem: string;
}

const CERTS_DIR = path.join(APPDATA_DIR, "certs");

export function ensureCertsDir(): void {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true, mode: 0o755 });
  }
}

/**
 * Extract individual certificates from the macOS System Keychain.
 * Returns parsed cert objects with subject name and PEM content.
 */
function getMacOSSystemCerts(): SystemCert[] {
  const result = spawnSync("security", [
    "find-certificate", "-a", "-p",
    "/Library/Keychains/System.keychain",
  ], { stdio: "pipe", timeout: 10000 });

  if (result.status !== 0 || !result.stdout?.length) return [];

  const raw = result.stdout.toString();
  const certs: SystemCert[] = [];
  const pemBlocks = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!pemBlocks) return [];

  for (const pem of pemBlocks) {
    const name = getCertSubject(pem);
    if (name) {
      certs.push({ id: name, name, pem });
    }
  }

  return certs;
}

/**
 * Extract individual certificates from the Windows LocalMachine\Root store.
 */
function getWindowsSystemCerts(): SystemCert[] {
  const psScript = `
    Get-ChildItem Cert:\\LocalMachine\\Root |
    Where-Object { $_.NotAfter -gt (Get-Date) } |
    ForEach-Object {
      $name = $_.Subject -replace '^CN=([^,]*).*','$1'
      $b64 = [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')
      "===CERT_START==="
      "NAME:$name"
      "-----BEGIN CERTIFICATE-----"
      $b64
      "-----END CERTIFICATE-----"
    }
  `;
  const result = spawnSync("powershell", [
    "-NoProfile", "-NonInteractive", "-Command", psScript,
  ], { stdio: "pipe", timeout: 15000 });

  if (result.status !== 0 || !result.stdout?.length) return [];

  const raw = result.stdout.toString();
  const certs: SystemCert[] = [];
  const blocks = raw.split("===CERT_START===").filter(b => b.trim());

  for (const block of blocks) {
    const nameMatch = block.match(/^NAME:(.+)$/m);
    const pemMatch = block.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
    if (nameMatch && pemMatch) {
      const name = nameMatch[1].trim();
      certs.push({ id: name, name, pem: pemMatch[0] });
    }
  }

  return certs;
}

/**
 * Get the subject CN from a PEM certificate using openssl.
 */
function getCertSubject(pem: string): string | null {
  const result = spawnSync("openssl", [
    "x509", "-noout", "-subject", "-nameopt", "utf8,sep_comma_plus",
  ], { input: pem, stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });

  if (result.status !== 0) return null;

  const output = result.stdout.toString().trim();
  // Parse "subject= CN=Some Name,O=Some Org" → "Some Name"
  const cnMatch = output.match(/CN\s*=\s*([^,]+)/);
  return cnMatch ? cnMatch[1].trim() : output.replace(/^subject\s*=\s*/, "").trim();
}

/**
 * List system certificates available for import.
 */
export function getSystemCerts(): SystemCert[] {
  if (process.platform === "darwin") {
    return getMacOSSystemCerts();
  } else if (process.platform === "win32") {
    return getWindowsSystemCerts();
  }
  return [];
}

/**
 * Interactive: let the user pick which system CA certs to include in the container.
 * Writes selected certs to ~/.code-container/certs/.
 */
export async function selectAndExportCerts(): Promise<void> {
  ensureCertsDir();

  const certs = getSystemCerts();
  if (certs.length === 0) {
    if (process.platform === "linux") {
      printInfo("On Linux, place custom CA certificates in ~/.code-container/certs/ manually.");
    } else {
      printWarning("No certificates found in system keystore.");
    }
    return;
  }

  printInfo("");
  printInfo("Found system CA certificates. Select which to include in the container:");

  const selectedIds = await promptMultiSelect(
    "Which CA certificates to include?",
    certs,
    false,
  );

  if (selectedIds.length === 0) {
    printInfo("No certificates selected.");
    return;
  }

  // Write each selected cert as an individual .crt file
  for (const cert of certs) {
    if (!selectedIds.includes(cert.id)) continue;
    const safeName = cert.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destFile = path.join(CERTS_DIR, `${safeName}.crt`);
    fs.writeFileSync(destFile, cert.pem + "\n", { mode: 0o644 });
  }

  printInfo(`Exported ${selectedIds.length} certificate(s) to ~/.code-container/certs/`);
}

/**
 * Check if any certs have been configured.
 */
export function hasCerts(): boolean {
  if (!fs.existsSync(CERTS_DIR)) return false;
  const files = fs.readdirSync(CERTS_DIR).filter(f => f.endsWith(".crt"));
  return files.length > 0;
}
