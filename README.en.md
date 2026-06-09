# oFinder

A Tauri-based local file browser and LAN sharing tool.

## Preview

| Local Browsing-Desktop      | LAN Sharing-PC              | LAN Sharing-Mobile          |
| --------------------------- | --------------------------- | --------------------------- |
| ![local](preview/local.png) | ![share](preview/share.png) | ![share](preview/share.jpg) |

## Features

### File Browsing

- Browse local filesystem directories
- Directories first, alphabetically sorted
- Grid / List view toggle
- Breadcrumb navigation
- Forward / Back history
- File search filtering

### File Preview

- **Images** — Thumbnail generation (`image` crate), supports jpeg/png/bmp/tiff/webp, click for fullscreen, touch swipe to navigate
- **Audio** — Built-in APlayer with playlist, previous/next track, fullscreen player on mobile
- **Video** — Native `<video>` player
- **PDF** — Inline iframe preview
- **Text** — File content display (up to 2MB)

### LAN Sharing

- Built-in HTTP server, share current directory to LAN with one click
- Mobile-responsive layout
- Fullscreen image lightbox (desktop + mobile)
- Fullscreen audio player on mobile
- Port locking, persists configuration after restart

### Installation Notes

- **Apple Silicon (M-series)** — The app may show "damaged" when first opened because it is not signed by Apple. Run the following command in terminal to remove the quarantine attribute and allow it to run: `sudo xattr -cr /Applications/oFinder.app`
- **Intel Mac** — The Intel version works normally, but running it on Apple Silicon Macs may show a compatibility warning. Apple may eventually stop supporting Intel apps on M-series Macs.

### Cross-platform

- Supports macOS and Windows
- Configuration stored in system standard config directory (`oFinder/config.json`)
- Image cache stored in system cache directory

## Tech Stack

- **Frontend**: Vanilla JS, Vite, APlayer
- **Backend**: Rust, Tauri 2
- **Image Processing**: `image` crate
- **File Icons**: Inline SVG
