import {xmlPath as path,xmlChildren as children,xmlValue as value} from './camt-xml.js';
import {normalizePayerEvidence,payerField} from './payer-evidence.js';
export function camtPayerEvidence(tx,incoming=true){
 const role=incoming?'Dbtr':'Cdtr',party=path(tx,'RltdPties',role),node=path(party,'Pty')||party;
 if(path(party,'Pty')&&party.children.some(n=>n.name!=='Pty'))throw Error('Tvetydig blandad direkt och omsluten betalaridentitet i XML.');
 const field=n=>n?payerField(n.text,n.sourcePath):null,identifiers=[],org=path(node,'Id','OrgId');
 for(const other of children(org,'Othr')){
  const id=path(other,'Id');if(!id)continue;
  const scheme=value(other,'SchmeNm','Cd')||value(other,'SchmeNm','Prtry');
  identifiers.push({...field(id),scheme,issuer:value(other,'Issr'),kind:scheme==='COID'?'organization':scheme==='CUST'?'customer':scheme==='BANK'?'bank_relationship':scheme==='TXID'?'tax':'other'});
 }
 for(const key of ['AnyBIC','BICOrBEI','LEI']){const id=path(org,key);if(id)identifiers.push({...field(id),scheme:key,issuer:'',kind:key==='LEI'?'lei':'bic'});}
 const leaves=n=>n.children.length?n.children.flatMap(leaves):[field(n)];
 const postal=path(node,'PstlAdr'),address=postal?{fields:leaves(postal)}:null;
 return normalizePayerEvidence({role:incoming?'debtor':'creditor',name:field(path(node,'Nm')),identifiers,address,namespace:tx.namespace});
}
