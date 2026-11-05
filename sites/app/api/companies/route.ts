import {companyCatalogueAction,failure} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{return await companyCatalogueAction(req,'list');}catch(error){return failure(error);}}
export async function POST(req:Request){try{return await companyCatalogueAction(req,'create');}catch(error){return failure(error);}}
