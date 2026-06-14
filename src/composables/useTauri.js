import { invoke } from "@tauri-apps/api/core";

export function useTauri() {
  return {
    listModules: (root) => invoke("list_modules", { root }),
    listDirectory: (root, path) => invoke("list_directory", { root, path }),
    shareInfo: (root, lockedPort) => invoke("share_info", { root, lockedPort }),
    fileUrl: (path) => invoke("file_url", { path }),
    previewUrl: (path, size) => invoke("preview_url", { path, size }),
    openExternal: (path) => invoke("open_external", { path }),
    appConfig: () => invoke("app_config"),
    setSharePortConfig: (port, locked) =>
      invoke("set_share_port_config", { port, locked }),
    setOcserverModelConfig: (provider, model) =>
      invoke("set_ocserver_model_config", { provider, model }),
    chooseRoot: () => invoke("choose_root"),
    startOcserver: (path) => invoke("start_ocserver", { path }),
    stopOcserver: () => invoke("stop_ocserver"),
    ocserverVersion: () => invoke("ocserver_version"),
    ocserverModels: () => invoke("ocserver_models"),
  };
}
