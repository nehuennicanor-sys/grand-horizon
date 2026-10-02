export type ImageConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  format: "openai" | "gemini-chat" | "generate-content";
};

export function generateImage(config: ImageConfig, prompt: string, stream = true, signal?: AbortSignal) {
  const input =
    config.format === "openai"
      ? { prompt, ...(stream ? { partial_images: 1 } : {}) }
      : config.format === "generate-content"
        ? {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }
        : {
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          };
  return fetch(`${config.baseURL}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.model, ...input, ...(stream ? { stream: true } : {}) }),
    signal: signal ?? null,
  });
}

export async function editImage(config: ImageConfig, form: FormData, signal?: AbortSignal) {
  const streaming = form.get("stream") !== "false";
  if (config.format === "openai") {
    form.set("model", config.model);
    if (streaming) {
      form.set("stream", "true");
      if (!form.has("partial_images")) form.set("partial_images", "1");
    } else {
      form.delete("stream");
      form.delete("partial_images");
    }
    return fetch(`${config.baseURL}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: signal ?? null,
    });
  }

  const prompt = form.get("prompt");
  const images = [...form.entries()]
    .filter(([name, value]) => (name === "image" || name === "image[]") && value instanceof File)
    .map(([, value]) => value as File);
  if (typeof prompt !== "string" || !prompt.trim() || images.length === 0) {
    return new Response("An image and edit instruction are required", { status: 400 });
  }
  const imageParts = await Promise.all(
    images.map(async (image) => {
      const bytes = new Uint8Array(await image.arrayBuffer());
      const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
      return config.format === "generate-content"
        ? { inlineData: { mimeType: image.type, data } }
        : { type: "image_url", image_url: { url: `data:${image.type};base64,${data}` } };
    }),
  );
  const input =
    config.format === "generate-content"
      ? {
          contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }
      : {
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...imageParts] }],
          modalities: ["image", "text"],
        };
  return fetch(`${config.baseURL}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.model, ...input, ...(streaming ? { stream: true } : {}) }),
    signal: signal ?? null,
  });
}

export const imageSettings: Omit<ImageConfig, "apiKey"> = {
  baseURL: "https://ai.gateway.lovable.dev",
  model: "openai/gpt-image-2.5-sunburst",
  format: "openai",
};
