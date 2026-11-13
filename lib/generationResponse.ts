import { resolveImageResponse } from './preparedImageClient';
export async function readGenerationResponse(response: Response, onPartial: (url: string) => void) {
  const result = await readGenerationPayload(response, onPartial);
  return resolveImageResponse(result.response, result.data);
}

// Preserve error status, billing outcome and retry metadata for every consumer.
export async function readGenerationPayload(response: Response, onStatus: (phase: string) => void = () => {}) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    return { response, data };
  }
  if (!response.body) throw new Error("No generation response received");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { response: Response; data: any } | undefined;
  const consume = async (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") result = { response: new Response(null, { status: Number.isInteger(event.status) && event.status >= 400 && event.status <= 599 ? event.status : 422 }), data: event };
    if (event.type === 'status') onStatus(event.phase === 'preparing' ? 'Preparing image…' : 'Generating image…');
    if (event.type === "result") result = { response, data: event.data };
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) { await consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
      if (done) break;
    }
    if (buffer.trim()) await consume(buffer);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!result) throw new Error("Generation interrupted before the final result. Check provider usage before retrying.");
  return result;
}
