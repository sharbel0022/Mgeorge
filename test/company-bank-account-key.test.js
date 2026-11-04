import test from 'node:test';
import assert from 'node:assert/strict';
import {companyBankAccountKey} from '../sites/lib/company-bank-account-key.js';

const account={provider:'enablebanking',bank:'Synthetic bank',country:'SE',accountIdentity:'iban:SE4280000890119146168423'};

test('stable job account identity survives IBAN formatting and provider runtime aliases',()=>{
 const expected=companyBankAccountKey(account);
 assert.equal(companyBankAccountKey({...account,provider:'enable-banking',bank:'SYNTHETIC BANK',accountIdentity:'se42 8000 0890 1191 4616 8423'}),expected);
 assert.match(expected,/^account:[a-f0-9]{64}$/);
 assert.ok(!expected.includes('SE42'));
});

test('local account namespaces cannot share a durable job identity across banks or providers',()=>{
 const local={...account,accountIdentity:'other:BBAN:SYNTHETIC123'},key=companyBankAccountKey(local);
 for(const change of [{bank:'Other synthetic bank'},{provider:'other-provider'},{country:'NO'},{accountIdentity:'hash:BBAN:SYNTHETIC123'},{accountIdentity:'other:BBAN:SYNTHETIC124'}])assert.notEqual(companyBankAccountKey({...local,...change}),key);
});

test('opaque primary identity bytes remain case sensitive and tuple boundaries are unambiguous',()=>{
 assert.notEqual(companyBankAccountKey({...account,accountIdentity:'hash:AbC'}),companyBankAccountKey({...account,accountIdentity:'hash:abc'}));
 assert.notEqual(companyBankAccountKey({...account,bank:'a:b',accountIdentity:'c'}),companyBankAccountKey({...account,bank:'a',accountIdentity:'b:c'}));
});

test('missing or malformed canonical account evidence cannot produce a job key',()=>{
 for(const change of [{accountIdentity:''},{accountIdentity:' account '},{accountIdentity:'a\u0000b'},{accountIdentity:'iban:unknown'},{bank:''},{country:'SWE'},{provider:''}])assert.throws(()=>companyBankAccountKey({...account,...change}),/verified stable/);
 assert.throws(()=>companyBankAccountKey(),/verified stable/);
});
