// Frozen synthetic originals and independent expected values for before/after measurement.
import {syntheticCamt,account} from '../sites/tests/helpers/camt-integrity.mjs';
// The helper above registers tests; the standalone runner only uses its fixture.
const base=syntheticCamt;
const remit=xml=>base.replace(/<RmtInf>[\s\S]*?<\/RmtInf>/,xml);
const party=xml=>base.replace('<Dbtr><Nm>Syntetisk Kund AB</Nm></Dbtr>',xml);
const ref=(value,type='OCR')=>`<Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>${type}</Prtry></CdOrPrtry></Tp><Ref>${value}</Ref></CdtrRefInf></Strd>`;
const doc=value=>`<Strd><RfrdDocInf><Nb>${value}</Nb></RfrdDocInf></Strd>`;
const xml=(id,input,expected={})=>({id,format:'xml',input,expected:{payer:'Syntetisk Kund AB',organization:'',ocr:['000018'],invoice:[],...expected}});
const csv=(id,header,values,expected)=>({id,format:'csv',input:`Datum;Belopp;Avsändare;${header};Valuta;Konto\n2026-10-26;625,00;Syntetisk Kund AB;${values};SEK;${account}`,expected:{payer:'Syntetisk Kund AB',organization:'',...expected}});
const api=(id,extra,expected)=>({id,format:'api',input:{status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:'625.00',currency:'SEK'},entry_reference:'SYNTHETIC-ENTRY',debtor:{name:'Syntetisk Kund AB'},...extra},expected:{payer:'Syntetisk Kund AB',organization:'',...expected}});
export const corpus=[
 xml('01-correct',base),
 xml('02-no-ocr',remit(''),{ocr:[]}),
 xml('03-no-payer',party('<Dbtr/>'),{payer:''}),
 xml('04-document-zero',remit('<RmtInf>'+doc('0594')+'</RmtInf>'),{ocr:[],invoice:['0594']}),
 xml('05-two-ocr',remit('<RmtInf>'+ref('000018')+ref('1234567897')+'</RmtInf>'),{ocr:['000018','1234567897']}),
 xml('06-invalid-checksum',remit('<RmtInf>'+ref('000019')+'</RmtInf>'),{ocr:['000019']}),
 xml('07-multiple-invoices',remit('<RmtInf>'+doc('0594')+doc('0599')+'</RmtInf>'),{ocr:[],invoice:['0594','0599']}),
 xml('08-mixed-reference',remit('<RmtInf>'+ref('000018')+doc('0594')+'</RmtInf>'),{invoice:['0594']}),
 xml('09-org-coid',party('<Dbtr><Nm>Syntetisk Kund AB</Nm><Id><OrgId><Othr><Id>556000-0001</Id><SchmeNm><Cd>COID</Cd></SchmeNm></Othr></OrgId></Id></Dbtr>'),{organization:'5560000001'}),
 xml('10-bic-is-not-org',party('<Dbtr><Nm>Syntetisk Kund AB</Nm><Id><OrgId><AnyBIC>TESTSESSXXX</AnyBIC></OrgId></Id></Dbtr>')),
 xml('11-customer-id-not-org',party('<Dbtr><Nm>Syntetisk Kund AB</Nm><Id><OrgId><Othr><Id>1234567890</Id><SchmeNm><Cd>CUST</Cd></SchmeNm></Othr></OrgId></Id></Dbtr>')),
 xml('12-unknown-id-not-org',party('<Dbtr><Nm>Syntetisk Kund AB</Nm><Id><OrgId><Othr><Id>1234567890</Id></Othr></OrgId></Id></Dbtr>')),
 xml('13-wrapped-party',party('<Dbtr><Pty><Nm>Syntetisk Kund AB</Nm></Pty></Dbtr>')),
 xml('14-ultimate-is-not-payer',party('<UltmtDbtr><Nm>Fakturakund AB</Nm></UltmtDbtr>'),{payer:''}),
 xml('15-message-invoice',remit('<RmtInf><Ustrd>Faktura: 0599</Ustrd></RmtInf>'),{ocr:[],invoice:['0599']}),
 xml('16-raw-reference',remit('<RmtInf>'+ref('  000018  ')+'</RmtInf>')),
 xml('17-foreign-name-not-payer',party('<Cdtr><Nm>Mottagare AB</Nm></Cdtr>'),{payer:''}),
 xml('18-camt053',base.replaceAll('054.001.02','053.001.02').replaceAll('BkToCstmrDbtCdtNtfctn','BkToCstmrStmt').replaceAll('Ntfctn','Stmt')),
 csv('19-csv-ocr','OCR','000018',{ocr:['000018'],invoice:[]}),
 csv('20-csv-invoice','Fakturanummer','0594',{ocr:[],invoice:['0594']}),
 csv('21-csv-both','OCR;Fakturanummer','000018;0594',{ocr:['000018'],invoice:['0594']}),
 csv('22-csv-generic','Betalningsreferens','0599',{ocr:[],invoice:[]}),
 api('23-api-sebg',{reference_number:'000018',reference_number_schema:'SEBG'},{ocr:['000018'],invoice:[]}),
 api('24-api-unknown',{reference_number:'000018',reference_number_schema:'SEPG'},{ocr:[],invoice:[]}),
 api('25-api-missing-individual',{debtor:null,transaction_id:'000018'},{payer:'',ocr:[],invoice:[]}),
];
export {account};
