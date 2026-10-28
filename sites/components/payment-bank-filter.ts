import type {Transaction} from '@/lib/domain';
/** Bank source verification does not establish invoice identity. */
export function needsPaymentIdentification(transaction:Transaction,remaining:number,group:string){return !transaction.ignored&&remaining>0&&(group==='incoming'||!!transaction.duplicateOf);}
