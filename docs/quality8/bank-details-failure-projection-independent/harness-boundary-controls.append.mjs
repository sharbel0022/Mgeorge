// Baseline controls isolate the two initial reviewer fixture assumptions.
test('independent harness control: rotating runtime key after seed stops before any provider read', async t => {
 const f=await usageDetailsFixture(t),before={...f.connection()};
 const generationBefore=(await f.store.application(f.owner)).generation;
 f.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 const generationAfter=(await f.store.application(f.owner)).generation;
 assert.notEqual(generationAfter,generationBefore);
 let error;try{await f.service.revalidateConsent(post('revalidate'));}catch(caught){error=caught;}
 assert.ok(error);assert.ok(!(error instanceof ConsentError));
 const response=f.service.bankFailure(error),body=await response.json();
 assert.equal(response.status,409);assert.deepEqual(f.calls,[]);
 assert.ok(!('usageDiagnostic' in body));assert.ok(!('usageDetailsDiagnostic' in body));
 assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
 t.diagnostic(JSON.stringify({boundary:'runtime-generation',status:response.status,providerCalls:f.calls.length,generationChanged:true,consentError:false}));
});
test('independent harness control: lost authentication after committed failed audit returns 401 on baseline', async t => {
 const f=await usageDetailsFixture(t),before={...f.connection()},batch=f.d1.batch.bind(f.d1);
 f.provider.getAccountDetails=async()=>{throw new ProviderError('BANK_TIMEOUT','SYNTHETIC_REVIEW_CONTROL',504,true);};
 f.d1.batch=async statements=>{const result=await batch(statements);if(failedAuditBatch(statements))f.user=null;return result;};
 let error;try{await f.service.revalidateConsent(post('revalidate'));}catch(caught){error=caught;}
 assert.ok(error);assert.ok(!(error instanceof ConsentError));
 const response=f.service.bankFailure(error),body=await response.json();
 assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Object.keys(body).sort(),['error','signIn']);
 assert.equal(body.signIn,'/signin-with-chatgpt?return_to=%2Fbank');
 assert.deepEqual(f.calls.map(c=>c.name),['getSession','getAccountDetails']);
 assert.ok(!('usageDiagnostic' in body));assert.ok(!('usageDetailsDiagnostic' in body));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidation.failed'").get().n,1);
 assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
 t.diagnostic(JSON.stringify({boundary:'authentication-after-audit',status:response.status,providerCalls:f.calls.length,failedAuditRows:1,consentError:false}));
});
