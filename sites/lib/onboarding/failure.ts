import { response } from '../server';
export function onboardingFailure(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  const status = e?.message === 'AUTH_REQUIRED' ? 401 : [400,401,403,404,409,413,429,503].includes(e?.status ?? 0) ? e.status! : 503;
  return response({ error: status === 401 ? 'Logga in för att fortsätta.' : status === 403 ? 'Du saknar behörighet för åtgärden.' : status === 409 ? 'Uppgifterna har ändrats. Läs in aktuell status.' : 'Åtgärden kunde inte bekräftas. Läs in aktuell status.', code: status === 409 ? 'ONBOARDING_CONFLICT' : 'ONBOARDING_UNAVAILABLE' }, status);
}
