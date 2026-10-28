import GmailWorkspace from '@/components/gmail-workspace';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
export const metadata={title:'Gmail | MG Fakturakoll',referrer:'no-referrer'};
export default async function GmailPage({searchParams}:{searchParams:Promise<{document?:string}>}){await requireChatGPTUser('/gmail');const params=await searchParams;return <GmailWorkspace initialDocumentId={params.document||''}/>;}
