import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const moduleUrl=new URL('../lib/banking/account-evidence-contract.ts',import.meta.url);
const contract=existsSync(moduleUrl)?await import(moduleUrl.href):{};
const project=value=>{
 assert.equal(typeof contract.projectBankAccountEvidence,'function','The typed bank account evidence projection must be exported');
 return contract.projectBankAccountEvidence(value);
};
const checkedAt='2026-11-02T12:30:45.000Z';
const matchedRow=(index=0,scheme='BBAN',sourcePath='all_account_ids[0].identification')=>({rowIndex:index,status:'matched',matched:true,ambiguous:false,scheme,sourcePath,sourceScope:'current_owned_ais_consent',reportSourcePath:`rows[${index}].account`});
const current=()=>({changed:false,providerContacted:true,checkedAt,transactionId:'synthetic-transaction',documentId:'synthetic-original',revision:7,sourceScope:'current_owned_ais_consent',sourcePath:'GET /accounts/{consent-account}/details',resourcesTotal:1,resourcesRead:1,resourceReadLimit:5,reportRowCount:1,reportRowLimit:50,originalIntegrity:'passed',reportSourceScope:'owned_retained_original',originalAuthenticityProved:false,relationshipProved:false,status:'matched',snapshotCurrent:true,resourcesComplete:true,accountMatch:true,complete:true,ambiguous:false,rows:[matchedRow()]});
const blocked=value=>{
 const evidence=project(value);
 assert.equal(evidence.status,'blocked');
 assert.deepEqual(evidence.aliases,[]);
 assert.deepEqual(evidence.bankgiroMapping,{status:'blocked',reasonCode:'PROVIDER_MAPPING_UNAVAILABLE'});
 assert.equal(evidence.paymentReconciliationAllowed,false);
 return evidence;
};

test('complete live bank aliases verify only recipient account identity',()=>{
 const input=current(),before=structuredClone(input),out=project(input);
 assert.deepEqual(out,{
  schemaVersion:'1.0.0',scope:'recipient_account_identity',status:'verified',checkedAt,
  transactionId:'synthetic-transaction',documentId:'synthetic-original',workspaceRevision:7,
  reasonCode:'ACCOUNT_IDENTITY_VERIFIED',source:'enable_banking',
  aliases:[{reportRowIndex:0,scheme:'BBAN',sourcePath:'all_account_ids[0].identification',reportSourcePath:'rows[0].account'}],
  bankgiroMapping:{status:'blocked',reasonCode:'PROVIDER_MAPPING_UNAVAILABLE'},paymentReconciliationAllowed:false
 });
 assert.deepEqual(input,before,'Projection must not change the legacy result');
});

test('the reader limits permit the entire five-account census and fifty report rows',()=>{
 const input=current();Object.assign(input,{resourcesTotal:5,resourcesRead:5,reportRowCount:50,rows:Array.from({length:50},(_,i)=>matchedRow(i,'CPAN','all_account_ids[49].identification'))});
 const out=project(input);assert.equal(out.status,'verified');assert.equal(out.aliases.length,50);
 assert.deepEqual(out.aliases[49],{reportRowIndex:49,scheme:'CPAN',sourcePath:'all_account_ids[49].identification',reportSourcePath:'rows[49].account'});
});

test('only documented account identifier locations and their schemes produce aliases',()=>{
 const input=current();input.rows=[matchedRow(0,'IBAN','account_id.iban'),matchedRow(1,'BBAN','account_id.other.identification'),matchedRow(2,'CPAN','all_account_ids[0].identification')];input.reportRowCount=3;
 assert.deepEqual(project(input).aliases,[
  {reportRowIndex:0,scheme:'IBAN',sourcePath:'account_id.iban',reportSourcePath:'rows[0].account'},
  {reportRowIndex:1,scheme:'BBAN',sourcePath:'account_id.other.identification',reportSourcePath:'rows[1].account'},
  {reportRowIndex:2,scheme:'CPAN',sourcePath:'all_account_ids[0].identification',reportSourcePath:'rows[2].account'}
 ]);
});

for(const [field,value] of [
 ['changed',true],['providerContacted',false],['snapshotCurrent',false],['resourcesComplete',false],
 ['accountMatch',false],['complete',false],['ambiguous',true],['sourceScope','saved_account_alias'],
 ['sourcePath','GET /sessions/{owned-session}'],['originalIntegrity','failed'],['reportSourceScope','client_upload'],
 ['originalAuthenticityProved',true],['relationshipProved',true],['resourceReadLimit',6],['reportRowLimit',51]
])test(`a conflicting ${field} cannot verify an account`,()=>{
 const input=current();input[field]=value;blocked(input);
});

for(const field of ['changed','providerContacted','checkedAt','transactionId','documentId','revision','snapshotCurrent','resourcesComplete','accountMatch','complete','ambiguous','sourceScope','sourcePath','originalIntegrity','reportSourceScope','originalAuthenticityProved','relationshipProved','resourceReadLimit','reportRowLimit','reportRowCount','resourcesRead','resourcesTotal','rows','status'])test(`missing ${field} cannot verify an account`,()=>{
 const input=current();delete input[field];blocked(input);
});

for(const [status,reasonCode]of [
 ['missing','ACCOUNT_ALIAS_MISSING'],['stale','EVIDENCE_STALE'],['ambiguous','EVIDENCE_AMBIGUOUS'],
 ['incomplete','EVIDENCE_INCOMPLETE'],['blocked','PROVIDER_EVIDENCE_UNAVAILABLE'],['error','PROVIDER_EVIDENCE_UNAVAILABLE'],
 ['mismatch','INVALID_ACCOUNT_EVIDENCE'],['review','INVALID_ACCOUNT_EVIDENCE'],['verified','INVALID_ACCOUNT_EVIDENCE'],['','INVALID_ACCOUNT_EVIDENCE']
])test(`legacy ${JSON.stringify(status)} remains blocked with bounded provenance`,()=>{
 const input=current();input.status=status;input.reason='SYNTHETIC_PRIVATE_REASON';input.errorCode='SYNTHETIC_PRIVATE_ERROR';
 const out=blocked(input);assert.equal(out.reasonCode,reasonCode);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE/);
});

for(const [field,values]of [
 ['resourcesRead',[0,-1,1.5,6,NaN,Infinity,'1']],['resourcesTotal',[0,2,6,100,NaN,'1']],
 ['reportRowCount',[0,-1,1.5,2,51,NaN,'1']],['revision',[-1,0.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'7']]
])for(const value of values)test(`invalid ${field} ${String(value)} cannot establish complete evidence`,()=>{
 const input=current();input[field]=value;blocked(input);
});

for(const rows of [[],null,{},[null],[[]],[{}],[matchedRow(1)],[matchedRow(0),matchedRow(0)],new Array(1)])test('malformed or inconsistent report rows remain blocked',()=>{
 const input=current();input.rows=rows;blocked(input);
});

for(const [field,value]of [['rowIndex',-1],['rowIndex','0'],['status','missing'],['matched',false],['ambiguous',true],['sourceScope','saved_alias'],['scheme','BGNR'],['scheme','bban'],['scheme',null],['reportSourcePath','rows[1].account'],['reportSourcePath','rows[0].account.value'],['reportSourcePath','rows[0].account\nSYNTHETIC_PRIVATE_ACCOUNT']])test(`invalid row ${field} cannot produce positive evidence`,()=>{
 const input=current();input.rows[0][field]=value;blocked(input);
});

for(const sourcePath of ['account_id','account_id.iban.value','account_id.other','all_account_ids[-1].identification','all_account_ids[00].identification','all_account_ids[50].identification','all_account_ids[999999999].identification','all_account_ids[0].identification.value','account_id.iban\nSYNTHETIC_PRIVATE_ACCOUNT','__proto__.identification','constructor.prototype','SYNTHETIC_PRIVATE_ACCOUNT'])test(`unrecognized source path ${JSON.stringify(sourcePath)} cannot become an alias`,()=>{
 const input=current();input.rows[0].sourcePath=sourcePath;const out=blocked(input);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE_ACCOUNT/);
});

test('an IBAN field cannot claim BBAN or CPAN provenance',()=>{
 for(const scheme of ['BBAN','CPAN']){const input=current();input.rows[0]=matchedRow(0,scheme,'account_id.iban');blocked(input);}
});

test('partial aliases and manual relationship claims never promote missing evidence',()=>{
 const input=current();Object.assign(input,{status:'missing',accountMatch:false,reportRowCount:2,manualRelationship:{status:'verified',confirmed:true}});
 input.rows.push({rowIndex:1,status:'missing',matched:false,ambiguous:false,scheme:null,sourcePath:null,sourceScope:'current_owned_ais_consent',reportSourcePath:'rows[1].account'});
 assert.equal(blocked(input).reasonCode,'ACCOUNT_ALIAS_MISSING');
});

test('only bounded identifiers, a canonical timestamp and a safe revision are retained',()=>{
 const input=current();Object.assign(input,{transactionId:'SYNTHETIC_PRIVATE/<account>',documentId:'x'.repeat(101),checkedAt:'2026-02-30T12:30:45.000Z',revision:Number.MAX_SAFE_INTEGER+1});
 const out=blocked(input);assert.equal(out.transactionId,null);assert.equal(out.documentId,null);assert.equal(out.checkedAt,null);assert.equal(out.workspaceRevision,null);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE/);
 const zero=current();zero.revision=0;assert.equal(project(zero).workspaceRevision,0);assert.equal(project(zero).status,'verified');
});

test('timestamp coercion, ambiguous timestamps and identifier coercion cannot verify',()=>{
 for(const checkedAt of [null,0,'2026-11-02','2026-11-02T12:30:45Z','2026-11-02T12:30:45.000+00:00','2026-11-02T25:30:45.000Z']){const input=current();input.checkedAt=checkedAt;assert.equal(blocked(input).checkedAt,null);}
 for(const field of ['transactionId','documentId'])for(const value of [0,null,{},'', ' id','id\n','../private']){const input=current();input[field]=value;assert.equal(blocked(input)[field],null);}
});

test('full account numbers, leading-zero references, UIDs, raw resources and mapping claims never leave the projection',()=>{
 const input=current();Object.assign(input,{account:'0000123400005678',payerReference:'000018',uid:'11111111-1111-4111-8111-111111111111',rawResources:{account:'0000123400005678'},bankgiroMapping:{status:'verified',number:'987-6543'},paymentReconciliationAllowed:true});
 Object.assign(input.rows[0],{account:'0000123400005678',value:'0000123400005678',identification:'0000123400005678',payerReference:'000018',uid:'11111111-1111-4111-8111-111111111111'});
 const before=structuredClone(input),out=project(input);assert.equal(out.status,'verified');assert.deepEqual(input,before);
 assert.doesNotMatch(JSON.stringify(out),/0000123400005678|000018|11111111-1111|987-6543|rawResources|payerReference|"identification":|"uid"/);
 assert.equal(out.paymentReconciliationAllowed,false);assert.equal(out.bankgiroMapping.status,'blocked');
});

test('malformed outer inputs fail closed without throwing or coercing them',()=>{
 for(const input of [undefined,null,true,7,'matched',[],()=>current(),Object.create(current()),new Date()])blocked(input);
 const input=Object.assign(Object.create(null),current());assert.equal(project(input).status,'verified');
});

test('accessors at the result, row and array boundaries are never invoked',()=>{
 let reads=0;const getter=()=>{reads++;throw Error('SYNTHETIC_PRIVATE_GETTER');};
 const outer=current();Object.defineProperty(outer,'status',{get:getter});blocked(outer);
 const row=current();Object.defineProperty(row.rows[0],'scheme',{get:getter});blocked(row);
 const array=current();Object.defineProperty(array.rows,'0',{get:getter});blocked(array);
 assert.equal(reads,0);
});

test('throwing and revoked proxies cannot leak errors or escape fail-closed handling',()=>{
 let coercions=0;const invalid={toString(){coercions++;throw Error('SYNTHETIC_PRIVATE_COERCION');}};
 const input=current();input.transactionId=invalid;blocked(input);assert.equal(coercions,0);
 for(const location of ['result','rows','row']){
  const input=current(),target=location==='result'?input:location==='rows'?input.rows:input.rows[0];
  const proxy=new Proxy(target,{getPrototypeOf(){throw Error('SYNTHETIC_PRIVATE_PROXY');}});
  if(location==='result')blocked(proxy);else{if(location==='rows')input.rows=proxy;else input.rows[0]=proxy;blocked(input);}
 }
 const revoked=Proxy.revocable(current(),{});revoked.revoke();blocked(revoked.proxy);
});
