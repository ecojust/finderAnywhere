import { execSync, spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  chmodSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");

const PLATFORM_MAP = {
  "darwin,arm64": ["darwin", "arm64", "zip"],
  "darwin,x64": ["darwin", "x64", "zip"],
  "win32,x64": ["windows", "x64-baseline", "zip"],
  "win32,arm64": ["windows", "arm64", "zip"],
  "linux,x64": ["linux", "x64", "tar.gz"],
  "linux,arm64": ["linux", "arm64", "tar.gz"],
};

const GITHUB_RELEASE =
  "https://github.com/anomalyco/opencode/releases/download";

async function main() {
  const target = process.env.TARGET || guessTarget();
  console.log(
    `[sidecar] target=${target}, platform=${process.platform}, arch=${process.arch}`,
  );
  if (!target) {
    console.error(
      "[sidecar] unsupported platform:",
      process.platform,
      process.arch,
    );
    process.exit(1);
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const sidecarName = `opencode-${target}${ext}`;
  const dest = join(binariesDir, sidecarName);
  console.log(`[sidecar] destination: ${dest}`);

  if (existsSync(dest)) {
    if (isValidExecutable(dest, target)) {
      console.log(`[sidecar] already exists, skipping: ${sidecarName}`);
      return;
    }
    console.log(
      `[sidecar] existing file is invalid, replacing: ${sidecarName}`,
    );
  }

  mkdirSync(binariesDir, { recursive: true });

  const local = findLocalBinary(target);
  if (local) {
    console.log(`[sidecar] found locally at: ${local}, copying...`);
    copyFileSync(local, dest);
    console.log(`[sidecar] copied from local: ${local}`);
    return;
  }
  console.log("[sidecar] not found locally, will download from GitHub");

  const info = PLATFORM_MAP[`${process.platform},${process.arch}`];
  if (!info) {
    console.error(
      `[sidecar] no download info for ${process.platform} ${process.arch}`,
    );
    process.exit(1);
  }

  const [osName, archName, extName] = info;
  // const version = await getLatestVersion();
  const version = "1.17.0";
  console.log(`[sidecar] opencode version: v${version}`);
  await downloadAndExtract(osName, archName, extName, version, dest);
  console.log(`[sidecar] downloaded and installed opencode v${version}`);
}

function guessTarget() {
  const map = {
    "darwin,arm64": "aarch64-apple-darwin",
    "darwin,x64": "x86_64-apple-darwin",
    "win32,x64": "x86_64-pc-windows-msvc",
    "win32,arm64": "aarch64-pc-windows-msvc",
    "linux,x64": "x86_64-unknown-linux-gnu",
    "linux,arm64": "aarch64-unknown-linux-gnu",
  };
  return map[`${process.platform},${process.arch}`] || null;
}

function findLocalBinary(target) {
  const lookupCmd =
    process.platform === "win32" ? "where opencode.exe" : "which opencode";
  try {
    const out = execSync(lookupCmd, { encoding: "utf8" }).trim();
    for (const line of out.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate || !existsSync(candidate)) continue;
      if (isValidExecutable(candidate, target)) return candidate;
      console.log(`[sidecar] skipping non-native executable: ${candidate}`);
    }
  } catch {
    /* not found */
  }
  return null;
}

async function getLatestVersion() {
  try {
    console.log("[sidecar] fetching latest version from GitHub API...");
    const res = await fetch(
      "https://api.github.com/repos/anomalyco/opencode/releases/latest",
    );
    const data = await res.json();
    const ver = (data.tag_name || "v1.16.2").replace(/^v/, "");
    console.log(`[sidecar] latest version: v${ver}`);
    return ver;
  } catch (e) {
    console.log(
      `[sidecar] failed to fetch latest version, fallback to 1.16.2 (${e.message})`,
    );
    return "1.16.2";
  }
}

async function downloadAndExtract(osName, archName, extName, version, dest) {
  const archiveName = `opencode-${osName}-${archName}.${extName}`;
  const url = `${GITHUB_RELEASE}/v${version}/${archiveName}`;
  const tmpDir = join(binariesDir, ".tmp-dl");
  const extractDir = join(tmpDir, "extract");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  const archivePath = join(tmpDir, archiveName);

  console.log(`[sidecar] downloading ${url} ...`);

  let downloadResult;
  if (process.platform === "win32") {
    downloadResult = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Invoke-WebRequest -Uri '${url}' -OutFile '${archivePath}'`,
      ],
      { stdio: "inherit" },
    );
  } else {
    downloadResult = spawnSync("curl", ["-#L", "-o", archivePath, url], {
      stdio: "inherit",
    });
    if (downloadResult.status !== 0) {
      console.log("[sidecar] curl failed, trying wget...");
      downloadResult = spawnSync("wget", ["-q", "-O", archivePath, url], {
        stdio: "inherit",
      });
    }
  }

  if (downloadResult.status !== 0) throw new Error(`download failed: ${url}`);
  if (!existsSync(archivePath)) throw new Error(`download failed: ${url}`);
  if (!isValidArchive(archivePath, extName)) {
    throw new Error(`downloaded archive is invalid: ${url}`);
  }
  const size = statSync(archivePath).size;
  console.log(`[sidecar] download complete (${size} bytes), extracting...`);

  if (extName === "zip") {
    if (process.platform === "win32") {
      spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
        ],
        { stdio: "inherit" },
      );
    } else {
      spawnSync("unzip", ["-q", "-o", archivePath, "-d", extractDir], {
        stdio: "inherit",
      });
    }
  } else {
    spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
      stdio: "inherit",
    });
  }

  const found = findBinary(extractDir, dest);
  if (!found) throw new Error("opencode binary not found in archive");
  console.log(`[sidecar] extracted: ${found}`);

  copyFileSync(found, dest);
  if (process.platform !== "win32") {
    try {
      chmodSync(dest, 0o755);
    } catch {}
  }

  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[sidecar] installed to: ${dest}`);
}

function findBinary(dir, dest) {
  const target = dest.endsWith(".exe")
    ? dest.slice(0, -4).split("opencode-").pop()
    : dest.split("opencode-").pop();
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const found = findBinary(full, dest);
      if (found) return found;
    } else if (
      statSync(full).isFile() &&
      name.startsWith("opencode") &&
      isValidExecutable(full, target)
    ) {
      return full;
    }
  }
  return null;
}

function isValidArchive(path, extName) {
  const buf = readFileSync(path);
  if (extName === "zip") {
    return (
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      buf[2] === 0x03 &&
      buf[3] === 0x04
    );
  }
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function isValidExecutable(path, target) {
  const buf = readFileSync(path);
  if (target.includes("windows")) {
    if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
      return false;
    }
    const peOffset = buf.readUInt32LE(0x3c);
    return (
      peOffset + 4 <= buf.length &&
      buf[peOffset] === 0x50 &&
      buf[peOffset + 1] === 0x45 &&
      buf[peOffset + 2] === 0x00 &&
      buf[peOffset + 3] === 0x00
    );
  }
  if (target.includes("linux")) {
    return (
      buf.length >= 4 &&
      buf[0] === 0x7f &&
      buf[1] === 0x45 &&
      buf[2] === 0x4c &&
      buf[3] === 0x46
    );
  }
  if (target.includes("apple-darwin")) {
    if (buf.length < 4) return false;
    const magic = buf.subarray(0, 4).toString("hex");
    return [
      "feedface",
      "cefaedfe",
      "feedfacf",
      "cffaedfe",
      "cafebabe",
      "bebafeca",
      "cafebabf",
      "bfbafeca",
    ].includes(magic);
  }
  return false;
}

main().catch((err) => {
  console.error(`[sidecar] error: ${err.message}`);
  process.exit(1);
});
