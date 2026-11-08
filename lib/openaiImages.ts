import { validateImageSettings, type OpenAIImageSettings } from "./openaiImageSettings";

export type PartialImageHandler = (dataUrl: string) => void;
export type OpenAIImageResult = {
  dataUrl: string;
  usage?: unknown;
  size?: string;
  quality?: string;
  partialImages: number;
};

// Direct HTTP keeps the image API independent of the older text SDK's model types.
// Never retry a paid image request automatically.
export async function generateOpenAIImage(args: {
  model: string; prompt: string; settings?: OpenAIImageSettings;
  references?: string[]; onPartial?: PartialImageHandler; signal?: AbortSignal;
}): Promise<OpenAIImageResult> {
  const settings = validateImageSettings(args.model, args.settings);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY. Configure it on the server.");
  if (!args.prompt || args.prompt.length > 32000) throw new Error("Image prompt must contain 1 to 32000 characters");
  const refs = args.references ?? [];
  if (refs.length > 5) throw new Error("Use at most five reference images");
  const stream = settings.partial_images > 0;
  const { partial_images, complexity, ...options } = settings;
  const parameters = { model: args.model, prompt: args.prompt, n: 1, ...options,
    ...(complexity && complexity !== "default" ? { complexity } : {}),
    ...(stream ? { stream: true, partial_images } : {}) };
  let body: BodyInit;
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (refs.length) {
    const form = new FormData();
    Object.entries(parameters).forEach(([key, value]) => form.append(key, String(value)));
    refs.forEach((ref, index) => {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(ref);
      if (!match || match[2].length > 28_000_000) throw new Error("Invalid or oversized reference image");
      form.append("image[]", new Blob([Buffer.from(match[2], "base64")], { type: `image/${match[1]}` }), `reference-${index}.${match[1]}`);
    });
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(parameters);
  }
  const signal = AbortSignal.any([AbortSignal.timeout(240_000), ...(args.signal ? [args.signal] : [])]);
  const response = await fetch(`https://api.openai.com/v1/images/${refs.length ? "edits" : "generations"}`, {
    method: "POST", headers, body, signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `OpenAI image request failed (${response.status})`);
  }
  const dataUrl = (b64: string, format = settings.output_format) => `data:image/${format};base64,${b64}`;
  if (!stream) {
    const result = await response.json();
    if (!result.data?.[0]?.b64_json) throw new Error("OpenAI returned no image");
    return { dataUrl: dataUrl(result.data[0].b64_json, result.output_format || settings.output_format),
      usage: result.usage, size: result.size, quality: result.quality, partialImages: 0 };
  }
  if (!response.body) throw new Error("OpenAI returned no image stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalImage: OpenAIImageResult | undefined;
  let partialImages = 0;
  const consume = (event: string) => {
    const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const item = JSON.parse(data);
    if (item.type === "error" || item.error) throw new Error(item.error?.message || item.message || "OpenAI image stream failed");
    if (item.type?.endsWith(".partial_image") && item.b64_json) {
      partialImages++;
      args.onPartial?.(dataUrl(item.b64_json, item.output_format || settings.output_format));
    }
    if (item.type?.endsWith(".completed") && item.b64_json) finalImage = {
      dataUrl: dataUrl(item.b64_json, item.output_format || settings.output_format),
      usage: item.usage, size: item.size, quality: item.quality, partialImages,
    };
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!finalImage) throw new Error("Image stream ended before the final image arrived");
  return finalImage;
}
