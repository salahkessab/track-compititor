export async function readGenerationResponse(response: Response, onPartial: (url: string) => void) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Generation failed");
    return data;
  }
  if (!response.body) throw new Error("No generation response received");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "Generation failed");
    if (event.type === "partial") onPartial(event.imageUrl);
    if (event.type === "result") result = event.data;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!result) throw new Error("Generation interrupted before the final result. Check provider usage before retrying.");
  return result;
}
