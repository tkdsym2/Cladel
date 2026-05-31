#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`release:check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function getCargoVersion() {
  const cargo = readText("src-tauri/Cargo.toml");
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

const pkg = readJson("package.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const cargoVersion = getCargoVersion();

const versions = [
  ["package.json", pkg.version],
  ["src-tauri/tauri.conf.json", tauri.version],
  ["src-tauri/Cargo.toml", cargoVersion],
];

const missingVersion = versions.find(([, version]) => !version);
if (missingVersion) {
  fail(`${missingVersion[0]} does not declare a version`);
}

const uniqueVersions = new Set(versions.map(([, version]) => version));
if (uniqueVersions.size !== 1) {
  fail(`version mismatch: ${versions.map(([file, version]) => `${file}=${version}`).join(", ")}`);
}

const appVersion = tauri.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
  fail(`app version must be valid SemVer without a leading v: ${appVersion}`);
}

const tag = process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG;
if (tag) {
  const tagVersion = tag.replace(/^v/, "");
  if (tagVersion !== appVersion) {
    fail(`release tag ${tag} does not match app version ${appVersion}`);
  }
}

if (tauri.bundle?.createUpdaterArtifacts !== true) {
  fail("src-tauri/tauri.conf.json must set bundle.createUpdaterArtifacts to true");
}

const updater = tauri.plugins?.updater;
if (!updater?.pubkey || typeof updater.pubkey !== "string") {
  fail("src-tauri/tauri.conf.json must set plugins.updater.pubkey");
}

const endpoints = updater?.endpoints;
if (!Array.isArray(endpoints) || endpoints.length === 0) {
  fail("src-tauri/tauri.conf.json must set plugins.updater.endpoints");
} else {
  for (const endpoint of endpoints) {
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      fail(`updater endpoint must use https: ${endpoint}`);
    }
    if (endpoint.includes("github.com") && !endpoint.endsWith("/latest.json")) {
      fail(`GitHub updater endpoint should point to latest.json: ${endpoint}`);
    }
  }
}

const repository = process.env.GITHUB_REPOSITORY;
if (repository && Array.isArray(endpoints)) {
  const expected = `https://github.com/${repository}/releases/latest/download/latest.json`;
  if (!endpoints.includes(expected)) {
    fail(`updater endpoint must match this GitHub repository: ${expected}`);
  }
}

for (const name of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
  if (process.env.CI && !process.env[name]) {
    fail(`GitHub Actions secret/env ${name} is missing`);
  }
}

if (!process.exitCode) {
  console.log(`release:check ok for v${appVersion}`);
}
