import type { CompanyDirectory } from '../company-storage.js';
import type { Directory } from './contract';
/** Translate the authoritative catalogue without claiming legal-entity verification. */
export function onboardingDirectory(directory: CompanyDirectory, csrfToken: string): Directory {
  return { version: 1, csrfToken, canCreate: !directory.context || ['owner', 'admin'].includes(directory.context.role), activeCompanyId: directory.activeCompanyId,
    contextVersion: directory.contextVersion, legacy: directory.legacy === true,
    companies: directory.companies.map(company => ({ id: company.id, name: company.name,
      organizationNumber: null, role: company.role })) };
}
export const csrfCookieName = '__Host-mg-onboarding';
export function onboardingCookie(request: Request): string | null {
  const matches = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(csrfCookieName + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(csrfCookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export async function onboardingCsrf(actorId: string, cookie: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorId + '\0' + cookie)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function assertOnboardingMutation(request: Request, actorId: string) {
  const cookie = onboardingCookie(request);
  if (request.headers.get('origin') !== new URL(request.url).origin || !cookie || request.headers.get('x-csrf-token') !== await onboardingCsrf(actorId, cookie)) throw Object.assign(Error('ONBOARDING_CSRF_DENIED'), { status: 403 });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '') || !/^[A-Za-z0-9_-]{16,128}$/.test(request.headers.get('idempotency-key') || '')) throw Object.assign(Error('ONBOARDING_REQUEST_INVALID'), { status: 400 });
}
