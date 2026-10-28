import Dashboard from './dashboard';
export const dynamic='force-dynamic';
export default async function Home({searchParams}:{searchParams:Promise<{view?:string|string[];import?:string|string[]}>}){
 const params=await searchParams;
 return <Dashboard initialView={params.view==='bank'?'bank':'overview'} openBankImport={params.view==='bank'&&params.import==='1'}/>;
}
