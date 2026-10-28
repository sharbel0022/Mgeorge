import { status, bankFailure } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { return await status(request); } catch (error) { return bankFailure(error); }
}
