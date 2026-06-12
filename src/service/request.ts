export type SseEvent = {
  event?: string;
  id?: string;
  retry?: number;
  data?: any;
};

type SseSubscribeOption = {
  url: string;
  signal?: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: SseEvent) => void;
};

export default class RequestService {
  static async postBody(option: { url: string; data?: Object }) {
    const response = await fetch(option.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(option.data || {}),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`POST ${option.url} 失败(${response.status}): ${body.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  static async get(option: { url: string }) {
    const response = await fetch(option.url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GET ${option.url} 失败(${response.status}): ${body.slice(0, 300)}`);
    }
    return response.json();
  }

  static async subscribeSse(option: SseSubscribeOption) {
    try {
      const response = await fetch(option.url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: option.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("SSE response body is empty");
      }

      option.onOpen?.();

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        chunks.forEach((chunk) => {
          const event = RequestService.parseSseChunk(chunk);
          if (event) option.onEvent(event);
        });
      }
    } catch (error: any) {
      if (option.signal?.aborted || error?.message === "Request cancelled") {
        return;
      }
      throw error;
    }
  }

  private static parseSseChunk(chunk: string): SseEvent | null {
    const event: SseEvent = {};
    const dataLines: string[] = [];
    chunk.split("\n").forEach((line) => {
      if (line.startsWith("data:")) {
        dataLines.push(line.replace(/^data:\s*/, ""));
      } else if (line.startsWith("event:")) {
        event.event = line.replace(/^event:\s*/, "");
      } else if (line.startsWith("id:")) {
        event.id = line.replace(/^id:\s*/, "");
      } else if (line.startsWith("retry:")) {
        const retry = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
        if (!Number.isNaN(retry)) event.retry = retry;
      }
    });
    if (!dataLines.length) return null;
    const data = dataLines.join("\n");
    try { event.data = JSON.parse(data); } catch { event.data = data; }
    return event;
  }
}
