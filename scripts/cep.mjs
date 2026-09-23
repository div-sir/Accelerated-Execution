#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { discoverFfmpeg } from "../sidecar/ffmpeg.mjs";

const execute = promisify(execFile);
const extensionId = "com.milifix.acceleratedexecution";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionSource = path.join(repoRoot, "extension");

export function cepExtensionsDirectory({
  platform = process.platform,
  home = os.homedir(),
  environment = process.env,
} = {}) {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions");
  if (platform === "win32") {
    const appData = environment.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Adobe", "CEP", "extensions");
  }
  return path.join(home, ".local", "share", "Adobe", "CEP", "extensions");
}

export function extensionTarget(options) {
  return path.join(cepExtensionsDirectory(options), extensionId);
}

export function parseCsxsDomains(value) {
  const matches = String(value).match(/com\.adobe\.CSXS\.\d+/g) || [];
  return [...new Set(matches)].sort((left, right) => {
    return Number(left.split(".").at(-1)) - Number(right.split(".").at(-1));
  });
}

async function csxsDomains() {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execute("defaults", ["domains"]);
      const domains = parseCsxsDomains(stdout);
      if (domains.length) return domains;
    } catch (error) {
      // Fall through to the supported defaults.
    }
  }
  if (process.platform === "win32") {
    const domains = [];
    for (let version = 9; version <= 15; version += 1) {
      try {
        await execute("reg", ["query", `HKCU\\Software\\Adobe\\CSXS.${version}`]);
        domains.push(`com.adobe.CSXS.${version}`);
      } catch (error) {
        // This CSXS preference key is not present.
      }
    }
    if (domains.length) return domains;
  }
  return ["com.adobe.CSXS.11", "com.adobe.CSXS.12"];
}

async function debugMode() {
  const domains = await csxsDomains();
  const results = [];
  for (const domain of domains) {
    let ready = false;
    try {
      if (process.platform === "darwin") {
        const { stdout } = await execute("defaults", ["read", domain, "PlayerDebugMode"]);
        ready = stdout.trim() === "1";
      } else if (process.platform === "win32") {
        const version = domain.split(".").at(-1);
        const { stdout } = await execute("reg", ["query", `HKCU\\Software\\Adobe\\CSXS.${version}`, "/v", "PlayerDebugMode"]);
        ready = /PlayerDebugMode\s+REG_SZ\s+1/i.test(stdout);
      }
    } catch (error) {
      ready = false;
    }
    results.push({ domain, ready });
  }
  return { ready: results.length > 0 && results.every((result) => result.ready), domains: results };
}

async function enableDebugMode() {
  const domains = await csxsDomains();
  for (const domain of domains) {
    if (process.platform === "darwin") {
      await execute("defaults", ["write", domain, "PlayerDebugMode", "1"]);
    } else if (process.platform === "win32") {
      const version = domain.split(".").at(-1);
      await execute("reg", ["add", `HKCU\\Software\\Adobe\\CSXS.${version}`, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"]);
    } else {
      throw new Error("Automatic CEP debug-mode setup supports macOS and Windows only.");
    }
  }
  console.log(`Enabled CEP PlayerDebugMode for ${domains.join(", ")}. Restart After Effects.`);
}

async function install() {
  const target = extensionTarget();
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await fs.lstat(target);
    if (!existing.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink path: ${target}`);
    const [actual, expected] = await Promise.all([fs.realpath(target), fs.realpath(extensionSource)]);
    if (actual !== expected) throw new Error(`Refusing to replace symlink to another location: ${target} -> ${actual}`);
    console.log(`CEP development extension is already installed: ${target}`);
    return target;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.symlink(extensionSource, target, process.platform === "win32" ? "junction" : "dir");
  console.log(`Installed CEP development symlink: ${target} -> ${extensionSource}`);
  return target;
}

async function packageExtension() {
  const packageDirectory = path.join(repoRoot, "dist", extensionId);
  if (!packageDirectory.startsWith(path.join(repoRoot, "dist") + path.sep)) {
    throw new Error("Refusing to package outside the repository dist directory.");
  }
  await fs.rm(packageDirectory, { recursive: true, force: true });
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.cp(extensionSource, packageDirectory, { recursive: true });
  await fs.cp(path.join(repoRoot, "sidecar"), path.join(packageDirectory, "sidecar"), { recursive: true });
  await fs.cp(path.join(repoRoot, "core"), path.join(packageDirectory, "core"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "README.md"), path.join(packageDirectory, "README.md"));
  console.log(`Packaged unsigned CEP extension: ${packageDirectory}`);
  return packageDirectory;
}

async function doctor() {
  const target = extensionTarget();
  let installation = { target, installed: false, source: null };
  try {
    const stat = await fs.lstat(target);
    installation.installed = stat.isDirectory() || stat.isSymbolicLink();
    if (stat.isSymbolicLink()) installation.source = await fs.realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const [ffmpeg, debug] = await Promise.all([discoverFfmpeg(), debugMode()]);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const report = {
    ready: nodeMajor >= 20 && ffmpeg.ready && installation.installed && debug.ready,
    node: { ready: nodeMajor >= 20, version: process.version, executable: process.execPath },
    ffmpeg,
    extension: installation,
    playerDebugMode: debug,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ready ? 0 : 1;
}

async function main() {
  const command = process.argv[2];
  if (command === "doctor") return doctor();
  if (command === "install") return install();
  if (command === "package") return packageExtension();
  if (command === "enable-debug") return enableDebugMode();
  console.log("Usage: node scripts/cep.mjs <doctor|install|package|enable-debug>");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
