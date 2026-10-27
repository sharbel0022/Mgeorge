import test from 'node:test';
import assert from 'node:assert/strict';
import {gmailAuthorizationUrl,prepareGmailSend} from '../src/gmail.js';
process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';process.env.GMAIL_ACCOUNT='mg.vitvaror@gmail.com';
const read='https://www.googleapis.com/auth/gmail.readonly',send='https://www.googleapis.com/auth/gmail.send';
const tokens=()=>({access_token:'test',refresh_token:'refresh',expires_at:Date.now()+3600000,scope:read+' '+send});
const message={recipient:'kund@example.com',subject:'Avstämning av faktura 0597',body:'Hej! Återstående saldo är 625 kr.',rfc_message_id:'<1234-abcd@mg-fakturakoll.local>'};
async function mocked(mock,fn){const previous=globalThis.fetch;globalThis.fetch=mock;try{await fn();}finally{globalThis.fetch=previous;}}
const response=body=>new Response(JSON.stringify(body),{status:200});
test('send consent explicitly requests readonly and send while default consent stays readonly',()=>{
  assert.equal(new URL(gmailAuthorizationUrl('s'.repeat(43),'http://localhost:3000')).searchParams.get('scope'),read);
  assert.equal(new URL(gmailAuthorizationUrl('s'.repeat(43),'http://localhost:3000',{send:true})).searchParams.get('scope'),read+' '+send);
});
test('Gmail preflight enforces send scope and company account without a send POST',async()=>{
  let posts=0;
  await mocked(async(url,options)=>{if(options.method==='POST')posts++;return response({emailAddress:'wrong@example.com'});},async()=>{
    await assert.rejects(prepareGmailSend({...tokens(),scope:read}),e=>e.code==='missing_send_scope');
    await assert.rejects(prepareGmailSend(tokens()),e=>e.code==='account_mismatch');
  });assert.equal(posts,0);
});
test('Gmail submission uses RFC MIME, exact recipient, UTF8 and a single POST',async()=>{
  let posts=0,raw;
  await mocked(async(url,options)=>{
    if(url.endsWith('/profile'))return response({emailAddress:process.env.GMAIL_ACCOUNT});
    assert.ok(url.endsWith('/messages/send'));assert.equal(options.method,'POST');posts++;
    raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();return response({id:'gmail-confirmed'});
  },async()=>{const submit=await prepareGmailSend(tokens());assert.equal((await submit(message)).id,'gmail-confirmed');});
  assert.equal(posts,1);assert.match(raw,/From: mg.vitvaror@gmail.com\r\nTo: kund@example.com/);assert.match(raw,/Content-Transfer-Encoding: base64/);assert.match(raw,/Message-ID: <1234-abcd@mg-fakturakoll.local>/);
});
test('timeout and provider 401 never trigger automatic send retry',async()=>{
  for(const error of ['timeout','401']){
    let posts=0;
    await mocked(async url=>{if(url.endsWith('/profile'))return response({emailAddress:process.env.GMAIL_ACCOUNT});posts++;if(error==='timeout')throw Error('network timeout');return new Response(JSON.stringify({error:{}}),{status:401});},async()=>{const submit=await prepareGmailSend(tokens());await assert.rejects(submit(message));});assert.equal(posts,1);
  }
});
test('header injection is rejected before network submission',async()=>{
  let posts=0;
  await mocked(async url=>{if(url.endsWith('/profile'))return response({emailAddress:process.env.GMAIL_ACCOUNT});posts++;return response({id:'gmail'});},async()=>{
    const submit=await prepareGmailSend(tokens());assert.throws(()=>submit({...message,recipient:'kund@example.com\r\nBcc: bad@example.com'}),/Ogiltiga/);assert.throws(()=>submit({...message,subject:'Hej\r\nBcc: bad@example.com'}),/Ogiltiga/);
  });assert.equal(posts,0);
});
