// Bank observations only. Invoice customers and manual relationships never enter this model.
export const PAYER_EVIDENCE_VERSION='bank-payer-2026-11-01.1';
const text=value=>typeof value==='string'?value:'';
export const payerField=(rawValue,source)=>({value:text(rawValue).trim(),rawValue:text(rawValue),source});
export function normalizePayerEvidence({role='debtor',scope='individual',name=null,identifiers=[],address=null,namespace=''}){
 const names=name?.value||'';
 if(/^(?:bankgiro(?:t)?(?:\s+ab)?|swedbank(?:\s+ab)?|bg)$/i.test(names))scope='collective';
 const organizations=identifiers.filter(id=>id.kind==='organization'&&id.scheme==='COID'&&/^SE$/i.test(id.issuer||'')&&/^\d{6}-?\d{4}$/.test(id.value)).map(id=>id.value.replace('-',''));
 const distinct=[...new Set(organizations)],recognized=identifiers.filter(id=>id.kind==='organization'&&id.scheme==='COID');
 const conflict=new Set(recognized.map(id=>`${id.issuer||''}:${id.value.replace(/[- ]/g,'')}`)).size>1;
 return {version:PAYER_EVIDENCE_VERSION,origin:'bank_original',role,scope,namespace,name,identifiers,address,conflict,organizationNumber:scope==='individual'&&!conflict?distinct[0]||'':'',warnings:conflict?['Bankoriginalet innehåller motstridiga organisationsidentifierare. Granska originalet.']:[]};
}
export function apiPayerEvidence(raw,incoming=true,{collective=false}={}){
 const side=incoming?'debtor':'creditor',party=raw?.[side],base=`$.${side}`,identifiers=[];
 const id=party?.organisation_id;
 for(const [index,item]of (Array.isArray(id)?id:id?[id]:[]).entries())if(item&&typeof item.identification==='string'){
  const scheme=text(item.scheme_name),field=payerField(item.identification,base+'.organisation_id'+(Array.isArray(id)?`[${index}]`:'')+'.identification');
  identifiers.push({...field,scheme,issuer:text(item.issuer),kind:scheme==='COID'?'organization':scheme==='CUST'?'customer':scheme==='BANK'?'bank_relationship':scheme==='TXID'?'tax':'other'});
 }
 const address=party?.postal_address&&typeof party.postal_address==='object'?{fields:Object.entries(party.postal_address).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).map((v,n)=>payerField(v,base+'.postal_address.'+key+(Array.isArray(value)?`[${n}]`:''))).filter(f=>f.rawValue))}:null;
 return normalizePayerEvidence({role:side,scope:collective?'collective':'individual',name:typeof party?.name==='string'?payerField(party.name,base+'.name'):null,identifiers,address});
}
export function csvPayerEvidence(headers,row,index,organizationIndex=-1){
 const source=i=>`$.columns[${i}].${headers[i]}`;
 const identifiers=organizationIndex>=0&&row[organizationIndex]? [{...payerField(row[organizationIndex],source(organizationIndex)),scheme:'COID',issuer:'SE',kind:'organization'}]:[];
 return normalizePayerEvidence({name:index>=0?payerField(row[index],source(index)):null,identifiers});
}
/** Compare observations by semantic identifier type, independent of file/path formatting. */
export function payerEvidenceConflict(previous,incoming){
 if(!incoming)return false;
 if(incoming.conflict&&!previous?.conflict)return true;
 const ids=e=>{const groups=new Map();for(const id of e?.identifiers||[]){const key=[id.kind,id.scheme,id.issuer||''].join(':'),value=id.scheme==='COID'?id.value.replace(/[- ]/g,''):id.value.trim();if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(value);}return groups;};
 const before=ids(previous),after=ids(incoming);
 return [...after].some(([key,values])=>before.has(key)&&(before.get(key).size!==values.size||[...values].some(value=>!before.get(key).has(value))));
}
