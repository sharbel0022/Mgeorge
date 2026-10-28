/** Only expose the selected payment's evidence, even in a multi-payment audit event. */
type Context={parentId?:string;allocations?:{id:string;invoiceId:string;amount:number;effect:string}[];invoices?:{id:string;number:string}[]};
export function paymentHistoryEntry(row:{id:string;action:string;detail:string;created_at:string},transactionId:string,context:Context={}){
 let detail:any;try{detail=JSON.parse(row.detail);}catch{return null;}
 if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;
 const command=detail.command||{},text=(value:unknown)=>typeof value==='string'?value.slice(0,1000):'';
 const decisions=[...(Array.isArray(detail.automatic)?detail.automatic:[]),...(Array.isArray(detail.decisions)?detail.decisions:[])].filter(d=>d?.transaction_id===transactionId||Array.isArray(d?.child_ids)&&d.child_ids.includes(transactionId));
 const labels:Record<string,string>={'transaction.verify':'Betalningsuppgifter manuellt verifierade','transaction.unverify':'Öppnad för ny granskning','transaction.ignore':'Undantag ändrat','transaction.split':'Samlingsbetalning uppdelad manuellt','transaction.unsplit':'Uppdelning återtagen','match.create':'Fakturakoppling bekräftad','match.undo':'Fakturakoppling återtagen','bank.details':'Bankens detaljsvar sparat','bank.sync':'Bankunderlag hämtat','automatic.reconciliation':'Automatisk avstämning'};
 const related=row.action.startsWith('transaction.')&&command.id===transactionId||['transaction.split','transaction.unsplit'].includes(row.action)&&!!context.parentId&&command.id===context.parentId||row.action==='match.create'&&command.transactionId===transactionId||row.action==='match.undo'&&context.allocations?.some(a=>a.id===command.id);
 const allocation=row.action==='match.undo'?context.allocations?.find(a=>a.id===command.id):null;
 const invoiceId=related&&['match.create','match.undo'].includes(row.action)?(allocation?.invoiceId||command.invoiceId):'',amount=allocation?.amount||command.amount;
 const settlement=invoiceId&&Number.isSafeInteger(amount)&&amount>0?{invoice:context.invoices?.find(i=>i.id===invoiceId)?.number||invoiceId,amount,effect:allocation?.effect||(command.effect==='refund'?'refund':'')}:null;
 const action=decisions.length&&!related?'automatic.reconciliation':row.action;
 return {id:row.id,at:row.created_at,label:labels[action]||'Bankunderlag behandlat',actor:action.startsWith('automatic.')||action==='bank.sync'?'Systemet':'Inloggad administratör',note:related?text(command.note):'',payer:related&&action==='transaction.verify'?text(command.party):'',reference:related&&action==='transaction.verify'?text(command.payerReference):'',settlement,decisions:decisions.map(d=>({reason:text(d.reason),rule:text(d.rule_version)}))};
}
export type PaymentHistoryEntry=NonNullable<ReturnType<typeof paymentHistoryEntry>>;
