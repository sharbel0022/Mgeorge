import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { companyDirectory } from '../company-storage.js';
import { createOnboardingCompany } from './provisioning.js';
import { response } from '../server';
import { assertOnboardingMutation, csrfCookieName, onboardingCookie, onboardingCsrf, onboardingDirectory } from './directory-adapter';
export async function onboardingCompanies(request: Request) {
  const user = await getChatGPTUser(); if (!user) throw Error('AUTH_REQUIRED');
  const database = env.DB;
  if (!database) throw Object.assign(Error('DATABASE_UNAVAILABLE'), { status: 503 });
  if (request.method === 'GET') {
    const cookie = onboardingCookie(request) ?? Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('');
    const result = response(onboardingDirectory(await companyDirectory(database, user.userId), await onboardingCsrf(user.userId, cookie)));
    result.headers.set('Set-Cookie', `${csrfCookieName}=${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`);
    return result;
  }
  await assertOnboardingMutation(request, user.userId);
  const raw = await request.text(); if (raw.length > 10000) throw Object.assign(Error('ONBOARDING_REQUEST_TOO_LARGE'), { status: 413 });
  const body = JSON.parse(raw);
  if (!body || body.confirmEmptyCompany !== true || typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 200 || Object.keys(body).some(key => !['name', 'confirmEmptyCompany'].includes(key))) throw Object.assign(Error('COMPANY_PROVISIONING_INVALID'), { status: 400 });
  // Deterministic resource identity provides restart-safe idempotency using the
  // existing unique company key and atomic foundation provisioning transaction.
  const company = await createOnboardingCompany(database, user.userId, body, request.headers.get('idempotency-key')!);
  return response({ version: 1, company: { id: company.id, name: company.name, organizationNumber: null, role: company.role } }, 201);
}
