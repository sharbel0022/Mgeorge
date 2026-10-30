import Dashboard from './dashboard';
import {readWorkspaceLocation} from '@/lib/workspace-location';
export const dynamic='force-dynamic';
export default async function Home({searchParams}:{searchParams:Promise<{view?:string|string[];import?:string|string[]}>}){
 const location=readWorkspaceLocation(await searchParams);
 return <Dashboard initialView={location.view} openBankImport={location.openBankImport}/>;
}
