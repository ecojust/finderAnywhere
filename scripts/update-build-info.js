#!/usr/bin/env node
import fs from "fs";
// const fs = require("fs");
// const path = require("path");

const paths = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  tauriConf: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  buildInfo: "src/build.ts",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getVersionArg() {
  const buildInfoContent = fs.readFileSync(paths.buildInfo, "utf8");
  const versionMatch = buildInfoContent.match(
    /\bversion\s*:\s*["']([^"']+)["']/,
  );

  if (!versionMatch) {
    throw new Error(`无法从 ${paths.buildInfo} 中读取 version 定义`);
  }

  return versionMatch[1];
}

function validateVersion(version) {
  const semverPattern =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  if (!semverPattern.test(version)) {
    throw new Error(`版本号格式不合法: ${version}`);
  }
}

function syncPackageLockVersion(version) {
  if (!fs.existsSync(paths.packageLock)) {
    return false;
  }

  const packageLock = readJson(paths.packageLock);
  let updated = false;

  if (packageLock.version !== version) {
    packageLock.version = version;
    updated = true;
  }

  if (
    packageLock.packages &&
    packageLock.packages[""] &&
    packageLock.packages[""].version !== version
  ) {
    packageLock.packages[""].version = version;
    updated = true;
  }

  if (updated) {
    writeJson(paths.packageLock, packageLock);
  }

  return updated;
}

function syncCargoTomlVersion(version) {
  const cargoToml = fs.readFileSync(paths.cargoToml, "utf8");
  const packageSectionStart = cargoToml.indexOf("[package]");

  if (packageSectionStart === -1) {
    throw new Error(`无法从 ${paths.cargoToml} 中找到 [package] 配置段`);
  }

  const nextSectionPattern = /\n\[[^\]]+\]/g;
  nextSectionPattern.lastIndex = packageSectionStart + "[package]".length;
  const nextSectionMatch = nextSectionPattern.exec(cargoToml);
  const packageSectionEnd = nextSectionMatch
    ? nextSectionMatch.index
    : cargoToml.length;
  const beforePackageSection = cargoToml.slice(0, packageSectionStart);
  const packageSection = cargoToml.slice(
    packageSectionStart,
    packageSectionEnd,
  );
  const rest = cargoToml.slice(packageSectionEnd);
  let updated = false;

  const updatedPackageSection = packageSection.replace(
    /^version\s*=\s*"([^"]+)"/m,
    (match, currentVersion) => {
      if (currentVersion === version) {
        return match;
      }

      updated = true;
      return `version = "${version}"`;
    },
  );

  if (!/^version\s*=/m.test(packageSection)) {
    throw new Error(
      `无法从 ${paths.cargoToml} 的 [package] 配置段中找到 version 定义`,
    );
  }

  if (!updated) {
    return false;
  }

  fs.writeFileSync(
    paths.cargoToml,
    `${beforePackageSection}${updatedPackageSection}${rest}`,
    "utf8",
  );
  return true;
}

// 获取当前时间
const now = new Date();
const buildTime = now
  .toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    // hour: "2-digit",
    // minute: "2-digit",
    // second: "2-digit",
    // hour12: false,
  })
  .replace(/\//g, "-");

const packageJson = readJson(paths.packageJson);
const tauriConf = readJson(paths.tauriConf);
const version = getVersionArg();
const updatedFiles = [];

validateVersion(version);

if (packageJson.version !== version) {
  packageJson.version = version;
  writeJson(paths.packageJson, packageJson);
  updatedFiles.push(paths.packageJson);
}

if (syncPackageLockVersion(version)) {
  updatedFiles.push(paths.packageLock);
}

if (tauriConf.version !== version) {
  tauriConf.version = version;
  writeJson(paths.tauriConf, tauriConf);
  updatedFiles.push(paths.tauriConf);
}

if (syncCargoTomlVersion(version)) {
  updatedFiles.push(paths.cargoToml);
}

// 生成构建号（基于时间戳）
const buildNumber = Math.floor(now.getTime() / 1000).toString();

// 生成新的 build.ts 内容
const buildContent = `// 构建版本信息
export const BUILD_INFO = {
  version: "${version}",
  buildTime: "${buildTime}",
  buildNumber: "${buildNumber}",
};`;

// 写入 build.ts 文件
fs.writeFileSync(paths.buildInfo, buildContent, "utf8");

console.log(`✅ 构建信息已更新:`);
console.log(`   版本: ${version}`);
console.log(`   构建时间: ${buildTime}`);
console.log(`   构建号: ${buildNumber}`);
if (updatedFiles.length > 0) {
  console.log(`   同步文件: ${updatedFiles.join(", ")}`);
}
