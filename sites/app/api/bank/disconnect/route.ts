import { disconnect, bankFailure } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await disconnect(request); } catch (error) { return bankFailure(error); }
}
