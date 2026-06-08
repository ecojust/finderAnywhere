import { execSync, spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const binariesDir = join(projectRoot, 'src-tauri', 'binaries');

const PLATFORM_MAP = {
  'darwin,arm64':  ['darwin',  'arm64', 'zip'],
  'darwin,x64':    ['darwin',  'x64',   'zip'],
  'win32,x64':     ['windows', 'x64',   'zip'],
  'win32,arm64':   ['windows', 'arm64', 'zip'],
  'linux,x64':     ['linux',   'x64',   'tar.gz'],
  'linux,arm64':   ['linux',   'arm64', 'tar.gz'],
};

const GITHUB_RELEASE = 'https://github.com/anomalyco/opencode/releases/download';

async function main() {
  const target = process.env.TARGET || guessTarget();
  if (!target) {
    console.error('Unsupported platform:', process.platform, process.arch);
    process.exit(1);
  }

  const ext = process.platform === 'win32' ? '.exe' : '';
  const sidecarName = `opencode-${target}${ext}`;
  const dest = join(binariesDir, sidecarName);

  if (existsSync(dest)) {
    console.log(`sidecar already exists: ${sidecarName}`);
    return;
  }

  mkdirSync(binariesDir, { recursive: true });

  const local = findLocalBinary();
  if (local) {
    copyFileSync(local, dest);
    console.log(`copied opencode from local: ${local}`);
    return;
  }

  const info = PLATFORM_MAP[`${process.platform},${process.arch}`];
  if (!info) {
    console.error(`No download info for ${process.platform} ${process.arch}`);
    process.exit(1);
  }

  const [osName, archName, extName] = info;
  const version = await getLatestVersion();
  await downloadAndExtract(osName, archName, extName, version, dest);
  console.log(`downloaded opencode sidecar v${version}`);
}

function guessTarget() {
  const map = {
    'darwin,arm64': 'aarch64-apple-darwin',
    'darwin,x64':   'x86_64-apple-darwin',
    'win32,x64':    'x86_64-pc-windows-msvc',
    'win32,arm64':  'aarch64-pc-windows-msvc',
    'linux,x64':    'x86_64-unknown-linux-gnu',
    'linux,arm64':  'aarch64-unknown-linux-gnu',
  };
  return map[`${process.platform},${process.arch}`] || null;
}

function findLocalBinary() {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execSync(`${whichCmd} opencode`, { encoding: 'utf8' }).trim();
    const first = out.split('\n')[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* not found */ }
  return null;
}

async function getLatestVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/anomalyco/opencode/releases/latest');
    const data = await res.json();
    return (data.tag_name || 'v1.16.2').replace(/^v/, '');
  } catch {
    return '1.16.2';
  }
}

async function downloadAndExtract(osName, archName, extName, version, dest) {
  const archiveName = `opencode-${osName}-${archName}.${extName}`;
  const url = `${GITHUB_RELEASE}/v${version}/${archiveName}`;
  const tmpDir = join(binariesDir, '.tmp-dl');
  mkdirSync(tmpDir, { recursive: true });
  const archivePath = join(tmpDir, archiveName);

  console.log(`downloading ${url}...`);

  if (process.platform === 'win32') {
    spawnSync('powershell', [
      '-NoProfile', '-Command',
      `Invoke-WebRequest -Uri '${url}' -OutFile '${archivePath}'`
    ], { stdio: 'inherit' });
  } else {
    const r = spawnSync('curl', ['-#L', '-o', archivePath, url], { stdio: 'inherit' });
    if (r.status !== 0) {
      spawnSync('wget', ['-q', '-O', archivePath, url], { stdio: 'inherit' });
    }
  }

  if (!existsSync(archivePath)) throw new Error(`download failed: ${url}`);

  if (extName === 'zip') {
    if (process.platform === 'win32') {
      spawnSync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`
      ], { stdio: 'inherit' });
    } else {
      spawnSync('unzip', ['-q', '-o', archivePath, '-d', tmpDir], { stdio: 'inherit' });
    }
  } else {
    spawnSync('tar', ['-xzf', archivePath, '-C', tmpDir], { stdio: 'inherit' });
  }

  const found = findBinary(tmpDir);
  if (!found) throw new Error('opencode binary not found in archive');

  copyFileSync(found, dest);
  if (process.platform !== 'win32') {
    try { chmodSync(dest, 0o755); } catch {}
  }

  rmSync(tmpDir, { recursive: true, force: true });
}

function findBinary(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const found = findBinary(full);
      if (found) return found;
    } else if (statSync(full).isFile() && (name === 'opencode' || name === 'opencode.exe' || name.startsWith('opencode'))) {
      return full;
    }
  }
  return null;
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
