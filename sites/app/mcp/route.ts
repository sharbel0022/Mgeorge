import { bankRpc } from '@/lib/banking/mcp';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
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
