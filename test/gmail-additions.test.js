import test from 'node:test';import assert from 'node:assert/strict';
import {fetchGmailInvoiceDocuments} from '../src/gmail.js';
process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='synthetic-secret';
test('unexpected access-token expiry refreshes once and archived/sent neutral filenames are preserved',async()=>{
  const previous=globalThis.fetch;let profileAttempts=0,refreshes=0;
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    if(path==='/token'){refreshes++;return Response.json({access_token:'refreshed',expires_in:3600});}
    if(path.endsWith('/profile')){if(++profileAttempts===1)return Response.json({error:'unauthorized'},{status:401});return Response.json({emailAddress:'mg.vitvaror@gmail.com'});}
    if(path.endsWith('/messages'))return Response.json({messages:[{id:'sent'},{id:'archived'}]});
    if(path.includes('/attachments/'))return Response.json({data:Buffer.from('%PDF-test').toString('base64url')});
    const sent=path.endsWith('/sent');return Response.json({labelIds:sent?['SENT']:[],payload:{headers:[{name:'Subject',value:sent?'Dokument':'VB: Dokument'},{name:'From',value:'Sender <from@example.com>'},{name:'To',value:'Receiver <to@example.com>'}],parts:[1,2].map(n=>({partId:String(n),mimeType:'application/pdf',filename:'document-'+n+'.pdf',body:{attachmentId:'attachment-'+n}}))}});
  };
  try{const r=await fetchGmailInvoiceDocuments({access_token:'old',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',expires_at:Date.now()+3600000});assert.equal(refreshes,1);assert.equal(r.tokens.access_token,'refreshed');assert.equal(r.documents.length,4);assert.equal(r.documents[0].direction,'customer');assert.equal(r.documents[2].direction,'supplier');assert.equal(r.documents[2].metadata.direction_confident,false);assert.equal(r.documents[2].metadata.forwarded,true);assert.equal(r.documents[0].metadata.attachment_id,'attachment-1');assert.equal(r.documents[0].metadata.to,'Receiver <to@example.com>');}finally{globalThis.fetch=previous;}
});
