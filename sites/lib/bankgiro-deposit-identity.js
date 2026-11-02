/**
 * ELIN deposit reservation, separate from the report content fingerprint.
 * Bankgirot scopes the deposit sequence to recipient Bankgiro and year.
 * Formatting and changed report details must not permit a second reservation.
 * This key never proves that a report belongs to an AIS entry or a payer.
 * https://www.bankgirot.se/globalassets/dokument/tekniska-manualer/bankgiroinbetalningar_tekniskmanual_sv.pdf
 */
export function bankgiroDepositIdentity(report,fallbackDate=''){
 if(!report||report.profile!=='Swedbank Bankgiro XLSX')return '';
 const giro=typeof report.recipientBankgiro==='string'?report.recipientBankgiro.replace(/[\s-]/g,''):'';
 const rawSequence=report.sequence||report.reportId,sequence=typeof rawSequence==='string'?rawSequence.trim():'';
 const date=report.reportDate||fallbackDate;
 if(!/^\d{7,8}$/.test(giro)||!/^\d{1,10}$/.test(sequence)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
 const timestamp=Date.parse(date+'T12:00:00Z');
 if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date)return '';
 // Bankgirot represents recipient Bankgiro as a right-aligned, zero-filled
 // 10-digit numeric field. Keep raw report text intact; only this key is padded.
 return 'elin-xlsx-v1:'+giro.padStart(10,'0')+':'+date.slice(0,4)+':'+sequence.replace(/^0+(?=\d)/,'');
}
