import CustomerMessages from '@/components/customer-messages';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
export const metadata={title:'Kundmeddelanden | MG Fakturakoll',referrer:'no-referrer'};
export default async function CustomerMessagesPage(){await requireChatGPTUser('/kundmeddelanden');return <CustomerMessages/>;}
