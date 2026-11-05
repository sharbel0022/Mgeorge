import { onboardingCompanies } from '@/lib/onboarding/directory-server';
import { onboardingFailure } from '@/lib/onboarding/failure';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { try { return await onboardingCompanies(request); } catch (error) { return onboardingFailure(error); } }
export const POST = GET;
