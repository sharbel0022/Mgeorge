import { revalidateConsent, bankFailure } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await revalidateConsent(request); } catch (error) { return bankFailure(error); }
}
