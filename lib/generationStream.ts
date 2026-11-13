// Keep long provider calls connected through the public proxy. Heartbeats carry
// no images and never retry work. The existing JSON response remains authoritative.
export function streamGeneration(request: Request, run: (phase: (value: 'generating' | 'preparing') => void) => Promise<Response>): Promise<Response> | Response {
  if (!request.headers.get('accept')?.includes('application/x-ndjson')) return run(() => {});
  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
      try {
        send({ type: 'status', phase: 'generating' });
        const response = await run(phase => send({ type: 'status', phase }));
        const data = await response.json();
        send(response.ok ? { type: 'result', data, status: response.status } : { ...data, type: 'error', status: response.status });
      } catch (error) {
        send({ type: 'error', status: 500, error: error instanceof Error ? error.message : 'Generation failed' });
      } finally {
        clearInterval(heartbeat);
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
