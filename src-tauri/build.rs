use std::path::PathBuf;
use std::process::Command;

fn target_arch_name(target: &str) -> Option<(&str, &str, &str)> {
    if target.ends_with("apple-darwin") {
        if target.starts_with("aarch64") {
            Some(("darwin", "arm64", "zip"))
        } else if target.starts_with("x86_64") {
            Some(("darwin", "x64", "zip"))
        } else {
            None
        }
    } else if target.ends_with("windows-msvc") {
        if target.starts_with("x86_64") {
            Some(("windows", "x64", "zip"))
        } else if target.starts_with("aarch64") {
            Some(("windows", "arm64", "zip"))
        } else {
            None
        }
    } else if target.ends_with("linux-gnu") || target.ends_with("linux-musl") {
        if target.starts_with("x86_64") {
            Some(("linux", "x64", "tar.gz"))
        } else if target.starts_with("aarch64") {
            Some(("linux", "arm64", "tar.gz"))
        } else {
            None
        }
    } else {
        None
    }
}

fn sidecar_path(binaries_dir: &PathBuf, target: &str) -> PathBuf {
    if target.contains("windows") {
        binaries_dir.join(format!("opencode-{target}.exe"))
    } else {
        binaries_dir.join(format!("opencode-{target}"))
    }
}

fn copy_from_local(binaries_dir: &PathBuf, target: &str) -> bool {
    let search_cmds: &[(&str, &str)] = if cfg!(target_os = "windows") {
        &[("where", "opencode.exe")]
    } else {
        &[("which", "opencode")]
    };

    for &(cmd, arg) in search_cmds {
        if let Ok(output) = Command::new(cmd).arg(arg).output() {
            let found = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if let Some(src) = found {
                let src_path = PathBuf::from(&src);
                if src_path.exists() {
                    let dest = sidecar_path(binaries_dir, target);
                    std::fs::copy(&src_path, &dest).ok();
                    return true;
                }
            }
        }
    }
    false
}

fn download_from_github(binaries_dir: &PathBuf, target: &str) -> bool {
    let (os, arch, ext) = match target_arch_name(target) {
        Some(v) => v,
        None => {
            println!("cargo:warning=unsupported target for download: {target}");
            return false;
        }
    };

    let version = "v1.16.2";
    let archive_name = format!("opencode-{os}-{arch}.{ext}");
    let url = format!(
        "https://github.com/anomalyco/opencode/releases/download/{version}/{archive_name}"
    );

    let temp_dir = std::env::temp_dir().join("finder-anywhere-sidecar");
    std::fs::create_dir_all(&temp_dir).ok();
    let archive_path = temp_dir.join(&archive_name);

    // Download
    let download_ok = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Invoke-WebRequest -Uri '{}' -OutFile '{}'",
                    url,
                    archive_path.display()
                ),
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("curl")
            .args(["-sL", "-o", &archive_path.to_string_lossy(), &url])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
            || Command::new("wget")
                .args(["-q", "-O", &archive_path.to_string_lossy(), &url])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
    };

    if !download_ok || !archive_path.exists() {
        println!("cargo:warning=failed to download opencode from {url}");
        return false;
    }

    // Extract
    let extract_ok = if ext == "zip" {
        if cfg!(target_os = "windows") {
            Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                        archive_path.display(),
                        temp_dir.display()
                    ),
                ])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            Command::new("unzip")
                .args(["-q", "-o", &archive_path.to_string_lossy(), "-d", &temp_dir.to_string_lossy()])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
    } else {
        Command::new("tar")
            .args(["-xzf", &archive_path.to_string_lossy(), "-C", &temp_dir.to_string_lossy()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    if !extract_ok {
        println!("cargo:warning=failed to extract opencode archive");
        return false;
    }

    // Find binary in extracted files
    let binary_name = if target.contains("windows") {
        "opencode.exe"
    } else {
        "opencode"
    };

    let found = walk_extracted(&temp_dir, binary_name);
    if let Some(src) = found {
        let dest = sidecar_path(binaries_dir, target);
        std::fs::copy(&src, &dest).ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
        }
        println!("cargo:info=downloaded opencode sidecar from GitHub");
        // Cleanup
        let _ = std::fs::remove_dir_all(&temp_dir);
        return true;
    }

    println!("cargo:warning=opencode binary not found in extracted archive");
    let _ = std::fs::remove_dir_all(&temp_dir);
    false
}

fn walk_extracted(dir: &PathBuf, target: &str) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name == target || name.starts_with("opencode") {
                        return Some(path);
                    }
                }
            } else if path.is_dir() {
                if let Some(found) = walk_extracted(&path, target) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn main() {
    // Only re-run build.rs if this file itself changes
    println!("cargo:rerun-if-changed=build.rs");

    let target = std::env::var("TARGET").unwrap_or_default();
    if target.is_empty() {
        tauri_build::build();
        return;
    }

    let binaries_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("binaries");
    let dest = sidecar_path(&binaries_dir, &target);

    // Strategy 1: already exists → skip
    if dest.exists() {
        tauri_build::build();
        return;
    }

    std::fs::create_dir_all(&binaries_dir).ok();

    // Strategy 2: copy from local system PATH
    if copy_from_local(&binaries_dir, &target) {
        tauri_build::build();
        return;
    }

    // Strategy 3: download from GitHub releases
    if download_from_github(&binaries_dir, &target) {
        tauri_build::build();
        return;
    }

    println!("cargo:warning=opencode binary not found and download failed");
    println!("cargo:warning=install opencode with: npm install -g opencode-ai");
    println!("cargo:warning=or place the binary manually at: {}", dest.display());

    tauri_build::build();
}
