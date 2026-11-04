import {companyProviderRoute} from '@/lib/banking/company-provider-service';
export const dynamic='force-dynamic';
export const GET=companyProviderRoute('list');
export const POST=companyProviderRoute('start');
