// Explicit synthetic bank responses for tests. Never used to enrich production data.
import {encryptObject} from '../src/security.js';
import {normalizeBankApiTransaction} from '../src/importers.js';
export function withSyntheticBankOriginal(payment){
  const original={status:'BOOK',booking_date:payment.booked_at,credit_debit_indicator:payment.amount_cents<0?'DBIT':'CRDT',transaction_amount:{amount:(Math.abs(payment.amount_cents)/100).toFixed(2),currency:payment.currency},debtor:{name:payment.payer||''},creditor:{name:payment.payer||''},reference_number:payment.reference||'',entry_reference:payment.bank_reference||'',note:payment.description||'',...(payment.is_aggregate?{bank_transaction_code:{description:'Bankgiro samlingspost'}}:{})};
  return {...payment,...normalizeBankApiTransaction(original,payment.account)};
}

export function approveSyntheticBankAccount(db,account){
  process.env.BANK_DATA_KEY='3'.repeat(64);delete process.env.ENCRYPTION_KEY;
  db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-bank','enablebanking','Syntetisk Bank',encryptObject({session_id:'synthetic-session'}),encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01T00:00:00Z','synthetic-owner','connected','synthetic-account');
}
