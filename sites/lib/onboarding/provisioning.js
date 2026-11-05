import { companyDirectory, provisionCompany } from '../company-storage.js';
import { onboardingCsrf } from './directory-adapter.ts';
export async function createOnboardingCompany(database, actorId, body, idempotencyKey) {
  const companyId = 'onboarding-' + await onboardingCsrf(actorId, idempotencyKey);
  const existing = async () => (await companyDirectory(database, actorId)).companies.find(company => company.id === companyId);
  let company = await existing();
  if (!company) {
    try { await provisionCompany(database, { id: companyId, name: body.name.trim(), actorId: actorId, verifiedBy: actorId, verificationEvidence: 'Authenticated creation of a separate empty company. No legal entity, bank authority or legacy ownership is asserted.' }); }
    catch (error) { if (!(await existing())) throw error; }
    company = await existing();
  }
  if (!company || company.name !== body.name.trim()) throw Object.assign(Error('IDEMPOTENCY_CONFLICT'), { status: 409 });
  return company;
}
