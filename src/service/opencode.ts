import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import RequestService from "@/service/request";
import { resolveModelSettings, setModel } from "@/service/modelSettings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getFileName = (p: string) => p.split("/").pop()?.split("\\").pop() || p;
const hasModelSettings = (modelSettings: {
  modelID?: string;
  providerID?: string;
}) => Boolean(modelSettings.modelID && modelSettings.providerID);
const getTextFromResponse = (result: any) =>
  result?.parts?.find((part: any) => part.type === "text")?.text || "";

export type SendMessageOptions = {
  onThinking?: (text: string, part: any) => void;
  onText?: (text: string, part: any) => void;
  onEvent?: (event: any) => void;
};

export default class Opencode {
  static worksapce: string = "";
  static sessionId: string = "";

  static getBaseUrl() {
    return "http://127.0.0.1:4096";
  }

  static async initialize_workspace_serve(workspace: string, baseUrl?: string) {
    await Opencode.create_workspace(workspace);
    await sleep(1000);
    await Opencode.execute_opencode_serve(workspace);
    await sleep(3000);
    await Opencode.new_session(baseUrl);
  }

  static async new_session(baseUrl?: string) {
    const url = baseUrl || Opencode.getBaseUrl();
    const result = await RequestService.postBody({
      url: `${url}/session`,
    });
    Opencode.sessionId = result.id || "";
  }

  static async send_message(
    message: string,
    options: SendMessageOptions = {},
    baseUrl?: string,
    model?: any,
  ) {
    const url = baseUrl || Opencode.getBaseUrl();
    const abortController = new AbortController();
    const partTextMap = new Map<string, string>();
    const partTypeMap = new Map<string, string>();
    const shouldSubscribeEvents =
      options.onThinking || options.onText || options.onEvent;
    let markEventReady = () => {};
    const eventReady = shouldSubscribeEvents
      ? new Promise<void>((resolve) => {
          markEventReady = resolve;
        })
      : Promise.resolve();

    const eventPromise = shouldSubscribeEvents
      ? RequestService.subscribeSse({
          url: `${url}/event`,
          signal: abortController.signal,
          onOpen: markEventReady,
          onEvent: (event) => {
            Opencode.handleMessageEvent(
              event.data,
              Opencode.sessionId,
              partTextMap,
              partTypeMap,
              options,
            );
          },
        }).catch(() => {})
      : Promise.resolve();

    await Promise.race([eventReady, sleep(1000)]);

    setModel(model);
    const modelSettings = await resolveModelSettings();
    const data: Record<string, any> = {
      agent: "build",
      parts: [{ type: "text", text: message }],
    };
    if (hasModelSettings(modelSettings)) {
      data.model = {
        modelID: modelSettings.modelID,
        providerID: modelSettings.providerID,
      };
    }

    try {
      const result = await RequestService.postBody({
        url: `${url}/session/${Opencode.sessionId}/message`,
        data,
      });

      return getTextFromResponse(result);
    } finally {
      abortController.abort();
      await eventPromise;
    }
  }

  private static handleMessageEvent(
    data: any,
    sessionId: string,
    partTextMap: Map<string, string>,
    partTypeMap: Map<string, string>,
    options: SendMessageOptions,
  ) {
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    const payload = data?.payload || data;
    if (!payload || payload.properties?.sessionID !== sessionId) return;

    options.onEvent?.(payload);

    if (payload.type === "message.part.updated") {
      const part = payload.properties.part;
      if (!part?.id || typeof part.text !== "string") return;
      partTextMap.set(part.id, part.text);
      partTypeMap.set(part.id, part.type);
      if (part.type === "reasoning") {
        options.onThinking?.(part.text, part);
      } else if (part.type === "text") {
        options.onText?.(part.text, part);
      }
    } else if (payload.type === "message.part.delta") {
      const { partID, field, delta } = payload.properties || {};
      if (!partID || typeof delta !== "string") return;
      const text = `${partTextMap.get(partID) || ""}${delta}`;
      partTextMap.set(partID, text);
      const partType = partTypeMap.get(partID);
      if (partType === "reasoning") {
        options.onThinking?.(text, payload.properties);
      } else if (partType === "text") {
        options.onText?.(text, payload.properties);
      } else if (field === "reasoning" || field === "reasoningText") {
        options.onThinking?.(text, payload.properties);
      } else if (field === "text") {
        options.onText?.(text, payload.properties);
      }
    }
  }

  static async execute_opencode_serve(workspace: string) {
    Opencode.worksapce = "";
    const result = await invoke("execute_opencode_serve", { workspace });
    Opencode.worksapce = workspace;
    return result;
  }

  static async create_workspace(workspace: string) {
    return invoke("create_workspace", { workspace });
  }

  static async read_workspace_file_content(
    workspace: string,
    filename: string,
  ) {
    return invoke("read_workspace_file_content", { workspace, filename });
  }

  static async write_workspace_file_content(
    workspace: string,
    filename: string,
    content: string,
  ) {
    return invoke("write_workspace_file_content", {
      workspace,
      filename,
      content,
    });
  }

  static async copy_file_to_workspace(
    workspace: string,
    sourcepath: string,
    targetfilename: string,
  ) {
    return invoke("copy_file_to_workspace", {
      workspace,
      sourcepath,
      targetfilename,
    });
  }

  static async scan_worksapce_file(
    workspace: string,
    payload: { path: string; postfix: string | string[] },
  ) {
    let result: any[] = await invoke("scan_worksapce_file", {
      workspace,
      ...payload,
    });
    if (result instanceof Array) {
      result = result.map((item, index) => {
        const filePath = item[0];
        const fileUrl = convertFileSrc(filePath);
        const title = getFileName(filePath) || `本地图片 ${index + 1}`;
        return {
          title,
          path: filePath,
          url: fileUrl,
          time: item[1],
          size: item[2],
          type: title.split(".").pop(),
        };
      });
      if (payload.postfix instanceof Array) {
        result = result.filter((r: any) => payload.postfix.includes(r.type));
      } else {
        result = result.filter(
          (r: any) => r.type == (payload.postfix || "html"),
        );
        result.sort(
          (a: any, b: any) =>
            new Date(b.time).getTime() - new Date(a.time).getTime(),
        );
      }
    }
    return result;
  }

  static async scan_worksapce_skills(
    workspace: string,
    payload: { path: string },
  ) {
    let result = await invoke("scan_worksapce_folder", {
      workspace,
      ...payload,
    });
    if (result instanceof Array) {
      result = result.map((folderPath: string) => getFileName(folderPath));
      result = result.filter(
        (name: string) => !name.toUpperCase().includes("MACOSX"),
      );
    }
    return result;
  }

  static async export_workspace_file(
    workspace: string,
    payload: { filePath: string; targetPath: string },
  ) {
    return invoke("export_workspace_file", {
      workspace,
      filepath: payload.filePath,
      targetpath: payload.targetPath,
    });
  }

  static async export_workspace_skill(
    workspace: string,
    payload: { skill: string; targetpath: string },
  ) {
    return invoke("export_workspace_skill", { workspace, ...payload });
  }

  static async delete_workspace_skill(workspace: string, skill: string) {
    return invoke("delete_workspace_skill", { workspace, skill });
  }

  static async delete_workspace_folder(workspace: string, folderPath: string) {
    return invoke("delete_workspace_folder", { workspace, folderPath });
  }
}
