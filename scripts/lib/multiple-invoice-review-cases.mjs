// Independent synthetic probes for the existing paths. These deliberately do not
// implement or authorize the future manual-vector command. No production data.
export const sitesCases=String.raw`

function multiState(amounts){
 let state=emptyState();state.company.name='M.George Vitvaror AB';
 for(let index=0;index<amounts.length;index++){const number=String(6101+index);state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic explicit customer AB',number,ocr:'',total:amounts[index],issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:'synthetic-multi-invoice-'+index,referenceOriginal:{invoice_number:number,reference:'',issuer_name:'M.George Vitvaror AB'}}}).state;}
 const refs=state.invoices.map(i=>'Faktura '+i.number),total=amounts.reduce((n,a)=>n+a,0);
 return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:total,party:'Synthetic explicit customer AB',payerReference:'',bankReference:'SYNTHETIC-MULTI-'+amounts.length,kind:'payment',verified:true},{reference_number:'',remittance_information:refs})]}).state;
}
async function multiFixture(t,amounts){
 const state=multiState(amounts),f=await fixture(t,state),objects=new Map();
 for(const invoice of state.invoices){const bytes=new TextEncoder().encode('%PDF-1.4\nSynthetic explicit invoice '+invoice.number+'\nTotal minor '+invoice.total),sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');objects.set('synthetic-owner/'+invoice.documentId,bytes);f.sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(invoice.documentId,'synthetic-owner',invoice.number+'.pdf','application/pdf',bytes.length,sha,'2026-10-01');}
 f.env.BUCKET={async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}:null;}};
 t.mock.method(globalThis,'fetch',async()=>{throw Error('No external calls allowed');});return f;
}
for(const amounts of [[30001,43099],[10001,20002,43097]])test('Sites direct multi-reference, '+amounts.length+' invoices',async t=>{
 const f=await multiFixture(t,amounts),before=f.read(),results=[];
 assert.equal(before.state.transactions[0].referenceEvidence.incomplete,false);
 for(const invoice of before.state.invoices){for(const correction of [false,true]){const result=await f.post({type:'match.create',invoiceId:invoice.id,transactionId:before.state.transactions[0].id,amount:invoice.total,note:'Checked synthetic explicit allocation original',referenceCorrection:correction});assert.equal(result.status,400);assert.match(result.body.error,/referens/);results.push({invoice:invoice.number,correction,status:result.status,error:result.body.error});}}
 assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
 console.log('MULTI_DIRECT_BLOCKED',JSON.stringify({invoices:amounts.length,references:before.state.transactions[0].referenceEvidence.candidates.map(c=>c.value),results}));
});
for(const amounts of [[30001,43099],[10001,20002,43097]])test('Sites split then manual multi, '+amounts.length+' invoices',async t=>{
 const f=await multiFixture(t,amounts),before=f.read(),parent=before.state.transactions[0],original=structuredClone(parent.bankData);
 const command={type:'transaction.split',id:parent.id,rows:before.state.invoices.map(i=>({party:i.party,payerReference:i.number,amount:i.total}))},request={revision:before.revision,requestId:crypto.randomUUID(),command};
 const results=await Promise.all([f.postRaw(request),f.postRaw(request)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 let after=f.read();const children=after.state.transactions.filter(t=>t.parentId===parent.id);
 assert.equal(children.length,amounts.length);assert.deepEqual(after.state.transactions.find(t=>t.id===parent.id).bankData,original);
 console.log('MULTI_SPLIT_INITIAL',JSON.stringify({invoices:amounts.length,concurrentStatuses:results.map(r=>r.status),allocations:after.state.allocations.length,children:children.map(c=>({reference:c.payerReference,evidence:c.evidence,party:c.party,amount:c.amount})),economicTotal:economicTransactions(after.state).reduce((n,t)=>n+t.amount,0)}));
 const replay=await f.postRaw(request);assert.equal(replay.status,200);assert.deepEqual(f.read(),after);
 for(const invoice of after.state.invoices){if(f.read().state.allocations.some(a=>a.active&&a.invoiceId===invoice.id))continue;const child=children.find(c=>c.payerReference===invoice.number);const result=await f.post({type:'match.create',invoiceId:invoice.id,transactionId:child.id,amount:invoice.total,note:'Synthetic explicit child allocation checked'});assert.equal(result.status,200,JSON.stringify(result.body));}
 after=f.read();assert.equal(after.state.allocations.filter(a=>a.active).length,amounts.length);assert.deepEqual(after.state.invoices.map(i=>balance(after.state,i)),amounts.map(()=>0));assert.equal(economicTransactions(after.state).reduce((n,t)=>n+t.amount,0),amounts.reduce((n,a)=>n+a,0));
 console.log('MULTI_SPLIT_FINAL',JSON.stringify({invoices:amounts.length,allocations:after.state.allocations.length,revision:after.revision,originalUnchanged:JSON.stringify(after.state.transactions.find(t=>t.id===parent.id).bankData)===JSON.stringify(original)}));
});
for(const delta of [-1,1])test('Sites split rejects one ore total difference '+delta,async t=>{
 const f=await multiFixture(t,[30001,43099]),before=f.read(),parent=before.state.transactions[0],rows=before.state.invoices.map(i=>({party:i.party,payerReference:i.number,amount:i.total}));rows[0].amount+=delta;
 const result=await f.post({type:'transaction.split',id:parent.id,rows});assert.equal(result.status,400);assert.match(result.body.error,/exakt/);assert.deepEqual(f.read(),before);console.log('MULTI_SPLIT_SUM_REJECTED',JSON.stringify({delta,status:result.status,error:result.body.error}));
});


test('Sites three-way partial progress is not one approval transaction',async t=>{
 const f=await multiFixture(t,[10001,20002,43097]),before=f.read(),parent=before.state.transactions[0];
 const split=await f.post({type:'transaction.split',id:parent.id,rows:before.state.invoices.map(i=>({party:i.party,payerReference:i.number,amount:i.total}))});assert.equal(split.status,200);
 let state=f.read().state;const invoice=state.invoices[0],child=state.transactions.find(t=>t.parentId===parent.id&&t.payerReference===invoice.number);
 const request={revision:f.read().revision,requestId:crypto.randomUUID(),command:{type:'match.create',invoiceId:invoice.id,transactionId:child.id,amount:invoice.total,note:'Synthetic first explicit reviewed allocation'}};
 const results=await Promise.all([f.postRaw(request),f.postRaw(request)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const saved=f.read();assert.ok(saved.state.allocations.length>0&&saved.state.allocations.length<3);
 assert.equal((await f.postRaw(request)).status,200);assert.deepEqual(f.read(),saved);
 const pending=saved.state.invoices.find(i=>balance(saved.state,i)>0),next=saved.state.transactions.find(t=>t.parentId===parent.id&&t.payerReference===pending.number);
 f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run();
 const blocked=await f.post({type:'match.create',invoiceId:pending.id,transactionId:next.id,amount:pending.total,note:'Synthetic second explicit allocation after consent loss'});
 assert.notEqual(blocked.status,200);assert.deepEqual(f.read(),saved);
 console.log('MULTI_PARTIAL_PROGRESS',JSON.stringify({concurrent:results.map(r=>r.status),committedAllocations:saved.state.allocations.length,totalAllocated:saved.state.allocations.reduce((n,a)=>n+a.amount,0),pendingBalances:saved.state.invoices.map(i=>balance(saved.state,i)),laterRevocationStatus:blocked.status,originalUnchanged:JSON.stringify(saved.state.transactions.find(t=>t.id===parent.id).bankData)===JSON.stringify(parent.bankData)}));
});
for(const mutation of ['fractional','negative'])test('Sites split rejects '+mutation+' minor amounts',async t=>{
 const f=await multiFixture(t,[30001,43099]),before=f.read(),rows=before.state.invoices.map(i=>({party:i.party,payerReference:i.number,amount:i.total}));
 if(mutation==='fractional'){rows[0].amount+=0.5;rows[1].amount-=0.5;}else{rows[0].amount=-30001;rows[1].amount=103101;}
 const result=await f.post({type:'transaction.split',id:before.state.transactions[0].id,rows});assert.equal(result.status,400);assert.deepEqual(f.read(),before);console.log('MULTI_AMOUNT_BLOCKED',JSON.stringify({mutation,status:result.status,error:result.body.error}));
});
test('Sites final manual allocation rolls back if consent changes immediately before commit',async t=>{
 const f=await multiFixture(t,[30001,43099]),initial=f.read(),parent=initial.state.transactions[0];
 await f.post({type:'transaction.split',id:parent.id,rows:initial.state.invoices.map(i=>({party:i.party,payerReference:i.number,amount:i.total}))});
 const before=f.read(),invoice=before.state.invoices[0],child=before.state.transactions.find(t=>t.parentId===parent.id&&t.payerReference===invoice.number),audit=f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
 f.beforeBatch=statements=>{if(statements.some(s=>/UPDATE workspaces SET payload/.test(s.query)))f.sqlite.prepare("UPDATE bank_connections SET selected_accounts='[]'").run();};
 const response=await f.post({type:'match.create',invoiceId:invoice.id,transactionId:child.id,amount:invoice.total,note:'Synthetic explicit amount checked'});
 assert.equal(response.status,409);assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,audit);console.log('MULTI_CONSENT_FENCE',JSON.stringify({status:response.status,allocations:before.state.allocations.length,error:response.body.error}));
});

`;
export const nodeCases=String.raw`

saveSettings(db,{...getSettings(db),company_name:'M.George Vitvaror AB'});
const nativeFetch=globalThis.fetch;globalThis.fetch=(url,...args)=>{if(new URL(url).hostname!=='127.0.0.1')throw Error('No external calls allowed');return nativeFetch(url,...args);};
function multi(amounts){
 const id='synthetic-multi-'+(++serial),invoices=[];
 db.prepare('DELETE FROM bank_connections').run();approveSyntheticBankAccount(db,account);db.prepare("UPDATE bank_connections SET owner='local-admin'").run();
 for(let index=0;index<amounts.length;index++){
  const invoiceId=id+'-'+index,number=String(7000+serial*10+index);
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run(invoiceId,'customer',number,'Synthetic explicit customer AB',amounts[index],'','2026-10-01');
  const original=storeDocument(db,{name:invoiceId+'.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-1.4\nSynthetic invoice '+number+' total minor '+amounts[index]),invoice_id:invoiceId});
  db.prepare("UPDATE documents SET status='registered',extraction=? WHERE id=?").run(JSON.stringify({fields:{invoice_number:{value:number},reference:{value:''}},details:{supplier:{name:'M.George Vitvaror AB'}}}),original.id);
  invoices.push({id:invoiceId,number,amount:amounts[index]});
 }
 const total=amounts.reduce((n,a)=>n+a,0),raw={status:'BOOK',booking_date:'2026-10-26',credit_debit_indicator:'CRDT',transaction_amount:{amount:(total/100).toFixed(2),currency:'SEK'},debtor:{name:'Synthetic explicit customer AB'},reference_number:amounts.length===1?invoices[0].number:'',remittance_information:amounts.length===1?[]:invoices.map(i=>'Faktura '+i.number),entry_reference:id};
 storeTransactions(db,[normalizeBankApiTransaction(raw,account)],'enablebanking');
 const transaction=listTransactions(db).find(t=>t.bank_reference===id);
 const evidence=reconciliationData(db,{owner:'local-admin'}),checked=evidence.transactions.find(t=>t.id===transaction.id);
 assert.equal(checked.original_verified,true);assert.equal(checked.account_consent_issue,'');
 for(const invoice of invoices){const checked=evidence.invoices.find(i=>i.id===invoice.id);assert.equal(checked.invoice_original_verified,true);assert.equal(checked.referencePolicy.applies,true);assert.equal(checked.referencePolicy.status,'REVIEW');}
 return{invoices,transaction,total};
}
for(const amounts of [[30001,43099],[10001,20002,43097]])test('Node actual HTTP multi-reference is blocked under strict MGeorge policy '+amounts.length,async()=>{
 const f=multi(amounts),before=stored(),results=[];
 for(const invoice of f.invoices){const result=await call({invoice_id:invoice.id,transaction_id:f.transaction.id,amount_cents:invoice.amount,confirm:true});assert.equal(result.status,409);assert.match(result.body.error,/referens/);results.push({invoice:invoice.number,status:result.status,error:result.body.error});}
 const repeat=await Promise.all(f.invoices.map(invoice=>call({invoice_id:invoice.id,transaction_id:f.transaction.id,amount_cents:invoice.amount,confirm:true})));assert.ok(repeat.every(r=>r.status===409));assert.deepEqual(stored(),before);
 console.log('NODE_MULTI_BLOCKED',JSON.stringify({invoices:amounts.length,originalVerified:true,consentValid:true,concurrentStatuses:repeat.map(r=>r.status),results}));
});
test('Node positive single-reference control and duplicate replay',async()=>{
 const f=multi([73100]),invoice=f.invoices[0],body={invoice_id:invoice.id,transaction_id:f.transaction.id,amount_cents:invoice.amount,confirm:true};
 const results=await Promise.all([call(body),call(body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);
 assert.equal(db.prepare('SELECT count(*) n FROM allocations WHERE transaction_id=?').get(f.transaction.id).n,1);
 assert.equal(db.prepare('SELECT sum(amount_cents) n FROM allocations WHERE transaction_id=?').get(f.transaction.id).n,73100);
 console.log('NODE_SINGLE_CONTROL',JSON.stringify({statuses:results.map(r=>r.status),allocations:1,total:73100}));
});

`;
export const contractCases=String.raw`

for(const amounts of [[30001,43099],[10001,20002,43097]])test('C4 stored explicit multi approval remains non-executable: '+amounts.length+' invoices',async()=>{
 const input=reconciliationContractFixture();input.invoices[0].totalMinor=amounts[0];
 for(let index=1;index<amounts.length;index++){const number=String(42+index).padStart(5,'0');input.invoices.push({...structuredClone(input.invoices[0]),id:'invoice-'+(index+1),number,totalMinor:amounts[index]});input.transactions[0].references.push({kind:'invoice',value:number,rawValue:number,source:'$.remittance_information['+index+']',validity:'unchecked'});}
 const before=structuredClone(input),preview=await buildReconciliationPreview(input),row=preview.decisions[0];
 const approval={contractVersion:preview.contractVersion,source:'stored_business_approval',ownerId:input.ownerId,approvedBy:'synthetic-reviewer',approved:true,requestId:'synthetic-multi-request',expiresAt:'2026-09-13T12:30:00.000Z',snapshotSha256:preview.snapshot.sha256,revision:preview.snapshot.revision,decisions:[{transactionId:row.transactionId,allocations:row.allocations.map(({invoiceId,amountMinor,currency})=>({invoiceId,amountMinor,currency}))}]};
 const result=validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:'2026-09-13T12:05:00.000Z',consumedRequestIds:[]});
 assert.equal(row.status,'REVIEW');assert.equal(row.bankEvidenceStatus,'VERIFIED');assert.deepEqual(row.allocations.map(a=>a.amountMinor),amounts);assert.equal(result.valid,false);assert.equal(result.writesAllowed,false);assert.ok(result.reasonCodes.includes('DECISION_NOT_VERIFIED'));assert.deepEqual(input,before);
 console.log('C4_MULTI_APPROVAL',JSON.stringify({invoices:amounts.length,amounts:row.allocations.map(a=>a.amountMinor),bankEvidenceStatus:row.bankEvidenceStatus,status:row.status,...result}));
});

`;
