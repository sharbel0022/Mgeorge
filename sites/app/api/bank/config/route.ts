import { saveConfig, bankFailure, removeConfig } from '@/lib/banking/service';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return await saveConfig(request); } catch (error) { return bankFailure(error); }
}
export async function DELETE(request: Request) {
  try { return await removeConfig(request); } catch (error) { return bankFailure(error); }
}
