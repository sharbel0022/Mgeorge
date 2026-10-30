import { bankRpc } from '@/lib/banking/mcp';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const reject = (message: string, status: number, headers: Record<string, string> = {}) =>
    new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
  if (request.method !== 'POST') return reject('Method not allowed', 405, { Allow: 'POST' });
  // Browser calls must come from this site. Server/OAuth callers may omit
  // Origin, but still need JSON and the authenticated identity checked by RPC.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return reject('Origin denied', 403);
  const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return reject('JSON content type required', 415);
  const reader = request.body?.getReader();
  if (!reader) return new Response('JSON required', { status: 400 });
  let text = '', bytes = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); return new Response('Request too large', { status: 413 }); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    let body: unknown; try { body = JSON.parse(text); } catch { return new Response('Invalid JSON', { status: 400 }); }
    return await bankRpc(body);
  } finally { reader.releaseLock(); }
}
