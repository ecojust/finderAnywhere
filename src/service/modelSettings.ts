let currentModel: { modelID: string; providerID: string } = { modelID: "", providerID: "" };

export function setModel(model: any) {
  const name = typeof model === "string" ? model : (model?.modelID || model?.name || "");
  const idx = name.indexOf("/");
  if (idx > 0) {
    currentModel = { providerID: name.slice(0, idx), modelID: name.slice(idx + 1) };
  } else {
    currentModel = { providerID: "", modelID: name };
  }
}

export async function resolveModelSettings() {
  return currentModel;
}
