// Explicit synthetic bank responses for tests. Never used to enrich production data.
export function withSyntheticBankOriginal(payment){
  return {...payment,raw_bank_data:{status:'BOOK',booking_date:payment.booked_at,credit_debit_indicator:payment.amount_cents<0?'DBIT':'CRDT',transaction_amount:{amount:(Math.abs(payment.amount_cents)/100).toFixed(2),currency:payment.currency},debtor:{name:payment.payer||''},creditor:{name:payment.payer||''},reference_number:payment.reference||'',entry_reference:payment.bank_reference||'',note:payment.description||''}};
}
