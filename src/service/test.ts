  static async send_message(message: string, options: SendMessageOptions = {}) {
    const modelSettings = await resolveModelSettings();
    const messageWindow = Opencode.createMessageWindow(message);
    const resolvedOptions: SendMessageOptions = {
      onThinking: (text, part) => {
        messageWindow.push({ status: "thinking", text });
        options.onThinking?.(text, part);
      },
      onText: (text, part) => {
        messageWindow.push({ status: "text", text });
        options.onText?.(text, part);
      },
      onEvent: (event) => {
        const status = Opencode.getEventStatus(event);

        if (
          status !== "event" &&
          status !== "thinking" &&
          status !== "text" &&
          !Opencode.isMessagePartStreamEvent(event)
        ) {
          messageWindow.push({
            status,
            text: Opencode.getEventText(event),
          });
        }

        options.onEvent?.(event);
      },
    };
    const abortController = new AbortController();
    const partTextMap = new Map<string, string>();
    const partTypeMap = new Map<string, string>();
    const shouldSubscribeEvents =
      resolvedOptions.onThinking ||
      resolvedOptions.onText ||
      resolvedOptions.onEvent;
    let markEventReady = () => {};
    const eventReady = shouldSubscribeEvents
      ? new Promise<void>((resolve) => {
          markEventReady = resolve;
        })
      : Promise.resolve();
    const eventPromise = shouldSubscribeEvents
      ? RequestService.subscribeSse({
          url: "http://127.0.0.1:4096/event",
          signal: abortController.signal,
          onOpen: markEventReady,
          onEvent: (event) => {
            Opencode.handleMessageEvent(
              event.data,
              Opencode.sessionId,
              partTextMap,
              partTypeMap,
              resolvedOptions,
            );
          },
        }).catch((error) => {
          if (!abortController.signal.aborted) {
            console.log("opencode event subscribe failed", error);
          }

          markEventReady();
        })
      : Promise.resolve();

    try {
      await Promise.race([eventReady, sleep(1000)]);

      const result = await RequestService.postBody({
        url: `http://127.0.0.1:4096/session/${Opencode.sessionId}/message`,
        data: {
          agent: "build",
          model: {
            modelID: modelSettings.modelID,
            providerID: modelSettings.providerID,
          },
          parts: [
            {
              type: "text",
              text: message,
            },
          ],
        },
      });

      // 播放成功音效
      Opencode.playSuccessSound();

      messageWindow.push({ status: "done", text: "opencode 执行完成" });

      return (
        result?.parts?.find((part: any) => part.type == "text")?.text || ""
      );
    } catch (error: any) {
      messageWindow.push({
        status: "error",
        text: error?.message || "opencode 请求失败",
      });
      throw error;
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
    const payload = data?.payload || data;

    if (!payload || payload.properties?.sessionID !== sessionId) {
      return;
    }

    options.onEvent?.(payload);

    if (payload.type === "message.part.updated") {
      const part = payload.properties.part;

      if (!part?.id || typeof part.text !== "string") {
        return;
      }

      partTextMap.set(part.id, part.text);
      partTypeMap.set(part.id, part.type);

      if (part.type === "reasoning") {
        options.onThinking?.(part.text, part);
      } else if (part.type === "text") {
        options.onText?.(part.text, part);
      }
    } else if (payload.type === "message.part.delta") {
      const { partID, field, delta } = payload.properties;

      if (!partID || typeof delta !== "string") {
        return;
      }

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

  private static createMessageWindow(message: string): MessageWindow {
    if (typeof document === "undefined") {
      return {
        push: () => {},
        close: () => {},
      };
    }

    Opencode.activeMessageWindow?.close();

    const root = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("div");
    const closeButton = document.createElement("button");
    const list = document.createElement("div");
    const meta = document.createElement("div");

    root.id = "opencode-message-window";
    root.style.cssText = [
      "position: fixed",
      "top: 0",
      "right: 0",
      "width: 720px",
      "height: 100vh",
      "box-sizing: border-box",
      "z-index: 2147483647",
      "display: flex",
      "flex-direction: column",
      "padding: 12px",
      "border-left: 1px solid rgba(31, 41, 55, 0.14)",
      "background: rgba(255, 255, 255, 0.98)",
      "box-shadow: -12px 0 32px rgba(15, 23, 42, 0.16)",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      "color: #111827",
      "overflow: hidden",
    ].join(";");
    header.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px;";
    title.style.cssText =
      "min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; line-height: 18px;";
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.style.cssText = [
      "border: 1px solid rgba(31, 41, 55, 0.16)",
      "background: #ffffff",
      "color: #374151",
      "border-radius: 6px",
      "padding: 3px 8px",
      "font-size: 12px",
      "line-height: 16px",
      "flex: 0 0 auto",
      "cursor: pointer",
    ].join(";");
    list.style.cssText = [
      "font-size: 13px",
      "line-height: 20px",
      "flex: 1 1 auto",
      "min-height: 0",
      "overflow: auto",
      "color: #374151",
    ].join(";");
    meta.style.cssText =
      "flex: 0 0 auto; font-size: 12px; line-height: 16px; color: #6b7280; margin-top: 8px;";

    header.appendChild(title);
    header.appendChild(closeButton);
    root.appendChild(header);
    root.appendChild(list);
    root.appendChild(meta);
    document.body.appendChild(root);

    let lastRecord:
      | {
          status: string;
          text: string;
          header: HTMLDivElement;
          body: HTMLDivElement;
        }
      | undefined;

    const messageWindow: MessageWindow = {
      push: ({ status, text }) => {
        const view = Opencode.getMessageWindowView(status);
        const time = new Date().toLocaleTimeString();
        const rawText = text || view.defaultText;
        const bodyText = Opencode.truncateMessageText(rawText);
        const previousRecord = lastRecord;
        const shouldUpdateLast =
          previousRecord?.status === status &&
          rawText.includes(previousRecord.text);

        title.textContent = "opencode message history";
        root.style.borderLeft = `4px solid ${view.color}`;

        if (shouldUpdateLast && previousRecord) {
          previousRecord.header.textContent = `${view.title} · ${time}`;
          previousRecord.text = rawText;
          previousRecord.body.textContent = bodyText;
          list.scrollTop = list.scrollHeight;
          return;
        }

        const item = document.createElement("div");
        const itemHeader = document.createElement("div");
        const itemBody = document.createElement("div");

        item.style.cssText = [
          `border-left: 3px solid ${view.color}`,
          "padding: 8px 10px",
          "margin-bottom: 8px",
          "background: rgba(249, 250, 251, 0.92)",
          "border-radius: 6px",
        ].join(";");
        itemHeader.style.cssText =
          "font-size: 12px; line-height: 16px; font-weight: 700; color: #111827; margin-bottom: 4px;";
        itemBody.style.cssText =
          "white-space: pre-wrap; word-break: break-word; color: #374151;";
        itemHeader.textContent = `${view.title} · ${time}`;
        itemBody.textContent = bodyText;

        item.appendChild(itemHeader);
        item.appendChild(itemBody);
        list.appendChild(item);
        lastRecord = {
          status,
          text: rawText,
          header: itemHeader,
          body: itemBody,
        };
        meta.textContent = `Prompt: ${Opencode.truncateMessageText(message, 120)}`;
        list.scrollTop = list.scrollHeight;
      },
      close: (delay = 0) => {
        window.setTimeout(() => {
          root.remove();

          if (Opencode.activeMessageWindow === messageWindow) {
            Opencode.activeMessageWindow = null;
          }
        }, delay);
      },
    };

    closeButton.addEventListener("click", () => messageWindow.close());
    Opencode.activeMessageWindow = messageWindow;
    messageWindow.push({ status: "start", text: "正在发送消息给 opencode" });

    return messageWindow;
  }

  private static getMessageWindowView(status: string) {
    const views: Record<
      string,
      { title: string; color: string; defaultText: string }
    > = {
      start: {
        title: "opencode: sending",
        color: "#2563eb",
        defaultText: "正在发送消息给 opencode",
      },
      thinking: {
        title: "opencode: thinking",
        color: "#7c3aed",
        defaultText: "正在思考",
      },
      text: {
        title: "opencode: replying",
        color: "#059669",
        defaultText: "正在生成回复",
      },
      tool: {
        title: "opencode: running tool",
        color: "#d97706",
        defaultText: "正在执行工具",
      },
      event: {
        title: "opencode: event",
        color: "#475569",
        defaultText: "收到 opencode 事件",
      },
      done: {
        title: "opencode: done",
        color: "#16a34a",
        defaultText: "opencode 执行完成",
      },
      error: {
        title: "opencode: error",
        color: "#dc2626",
        defaultText: "opencode 请求失败",
      },
    };

    return views[status] || views.event;
  }