import {companyCatalogueAction,failure} from '@/lib/server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{return await companyCatalogueAction(req,'active');}catch(error){return failure(error);}}
