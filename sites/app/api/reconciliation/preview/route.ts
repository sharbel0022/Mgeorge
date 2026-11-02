import {identity,readWorkspace,response,failure} from '@/lib/server';
import {readReconciliationPreview} from '@/lib/reconciliation-preview';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const user = await identity(), parameters = new URL(req.url).searchParams, transactionId = parameters.get('transactionId') || '';
    if ([...parameters.keys()].some(key => key !== 'transactionId') || parameters.getAll('transactionId').length !== 1) return response({error:'Ange endast en bankhändelse för förhandsgranskningen.'},400);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(transactionId)) return response({error:'Välj en giltig bankhändelse.'},400);
    const {state,revision} = await readWorkspace(user.userId);
    if (!state.transactions.some(row => row.id === transactionId)) return response({error:'Bankhändelsen finns inte för ditt konto.'},404);
    // The reviewed C1 policy provider is an explicit integration dependency.
    // Until it is wired here, missing server policy keeps proposals blocked.
    const preview = await readReconciliationPreview(user.userId,state,revision,transactionId);
    const current = await readWorkspace(user.userId);
    if (current.revision !== revision) return response({error:'Uppgifterna ändrades under kontrollen. Läs en ny förhandsgranskning.',mode:'preview',changed:false,writesAllowed:false},409);
    return response(preview);
  } catch (error) { return failure(error); }
}
