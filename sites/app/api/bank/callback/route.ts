import { callback } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return await callback(request); }
  catch { return new Response(null, { status: 303, headers: { Location: '/bank?result=failed', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } }); }
}
