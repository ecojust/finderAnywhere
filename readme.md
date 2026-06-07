# Finder Anywhere

## 页面入口说明

### 客户端页面

客户端页面是 Tauri 应用窗口里打开的本地前端页面。

- 页面入口文件：`index.html`
- 页面逻辑文件：`src/main.js`
- 页面样式文件：`src/styles.css`

也就是说，应用启动后看到的文件选择、文件列表、右侧预览、端口锁定、局域网地址复制等功能，主要由 `index.html` + `src/main.js` + `src/styles.css` 实现。

端口锁定配置会写入系统应用配置目录下的 `Finder Anywhere/config.json`，不会只保存在浏览器 `localStorage` 中，因此软件更新后仍会保留。

### 对外共享页面

共享给局域网其他设备访问的页面不是单独的 HTML 文件。

它由 Rust 后端在运行时动态生成，代码位置是：

- 共享 HTTP 服务：`src-tauri/src/lib.rs`
- 共享页面外壳模板：`src-tauri/templates/share_shell.html`
- 共享页面样式：`src-tauri/src/lib.rs` 里的 `shared_styles`
- 共享目录页面：`src-tauri/src/lib.rs` 里的 `shared_page`
- 共享预览页面：`src-tauri/src/lib.rs` 里的 `shared_preview`
- 共享图片全屏脚本：`src-tauri/src/lib.rs` 里的 `render_share_script`

用户在客户端顶部看到的 `192.168.x.x:端口` 地址，访问的就是这个 Rust 内置 HTTP 服务生成的共享页面。
