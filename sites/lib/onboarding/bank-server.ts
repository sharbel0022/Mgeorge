import { onboardingFailure } from './failure';
import {onboardingBankSnapshot,runOnboardingBankSync} from './snapshot-server';
import { companyCatalogueAction, currentCompanyContext, identity, response, withCompanyOwner, withCompanyRequest } from '../server';
import { assertCompanyPermission } from '../company-contract.js';
import { assertOnboardingMutation } from './directory-adapter';
import { activeConsent, parseAuthorization, parseSnapshot } from './contract';
import { saasBankSnapshot, saasBankStart, saasBankRenew, saasBankSelect, saasBankRevoke, saasBankRedirect, saasBankCallback } from '../banking/saas-runtime';
function fail(code: string, status: number): never { throw Object.assign(Error(code), { code, status }); }
export function onboardingBankRoute(action: 'snapshot'|'connect'|'renew'|'accounts'|'disconnect'|'sync'|'redirect'|'callback') {
  const handler = withCompanyRequest(async (request: Request, route: { params: Promise<{ companyId: string; authorizationId?: string }> }) => {
    try {
      const { companyId, authorizationId } = await route.params;
      const user = await identity(request), context = currentCompanyContext();
      if (!context || context.companyId !== companyId) fail('COMPANY_FORBIDDEN', 403);
      if (action === 'snapshot') return response(await onboardingBankSnapshot(request, companyId));
      assertCompanyPermission(context.role, 'manage_integrations');
      if (action === 'redirect') return await saasBankRedirect(request, companyId, authorizationId ?? '');
      if (action === 'callback') {
        const snapshot = parseSnapshot(await saasBankCallback(request, companyId), companyId);
        const result = activeConsent(snapshot) && snapshot.authorization?.state === 'completed' ? 'connected' : 'failed';
        return new Response(null, { status: 303, headers: { Location: '/bank?company=' + encodeURIComponent(companyId) + '&result=' + result, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
      }
      await assertOnboardingMutation(request, user.actorId);
      const raw = await request.text(); if (raw.length > 16000) fail('ONBOARDING_REQUEST_TOO_LARGE', 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail('ONBOARDING_REQUEST_INVALID', 400);
      return await withCompanyOwner(user.userId, 'manage_integrations', async () => {
        if (action === 'connect' || action === 'renew') return response(parseAuthorization(await (action === 'connect' ? saasBankStart : saasBankRenew)(request, companyId, body), companyId));
        if (action === 'accounts') await saasBankSelect(request, companyId, body);
        else if (action === 'disconnect') await saasBankRevoke(request, companyId, body);
        else if(action==='sync')return response(await runOnboardingBankSync(request,companyId,body));
        else fail('ONBOARDING_REQUEST_INVALID',400);
        return response({ version: 1, companyId, accepted: true });
      });
    } catch (error) { return onboardingFailure(error); }
  });
  return async (request: Request, route: { params: Promise<{ companyId: string; authorizationId?: string }> }) => {
    try {
      if (action === 'redirect' || action === 'callback') {
        // Browser navigation cannot attach the fetch boundary headers. Re-read
        // the authenticated selection; URL company identity grants no access.
        const directory = await (await companyCatalogueAction(request, 'list')).json() as { context?: { companyId: string; contextVersion: number } };
        const selected = directory.context, params = await route.params;
        if (!selected || selected.companyId !== params.companyId) fail('COMPANY_FORBIDDEN', 403);
        const headers = new Headers(request.headers); headers.set('X-Company-Id', selected.companyId); headers.set('X-Company-Context-Version', String(selected.contextVersion));
        request = new Request(request, { headers });
      }
      return await handler(request, route);
    } catch (error) { return onboardingFailure(error); }
  };
}
