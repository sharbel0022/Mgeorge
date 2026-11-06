import {parseCAMT} from '../src/importers.js';
import {camtBankgiroTests} from '../sites/tests/helpers/camt-bankgiro.mjs';

camtBankgiroTests({
 parse:parseCAMT,
 fields:row=>({bankgiro:row.bankgiro??'',payerBankgiro:row.payer_bankgiro??'',payer:row.payer,reference:row.reference,amount:row.amount_cents,date:row.booked_at})
});
