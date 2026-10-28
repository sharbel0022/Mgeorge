import { automaticSync, bankFailure } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await automaticSync(request); } catch (error) { return bankFailure(error); }
}
