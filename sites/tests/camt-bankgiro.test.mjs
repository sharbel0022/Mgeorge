import {parseBankgiroXML} from '../lib/bankgiro-parser.js';
import {camtBankgiroTests} from './helpers/camt-bankgiro.mjs';

camtBankgiroTests({
 parse:parseBankgiroXML,
 fields:row=>({bankgiro:row.recipientBankgiro??'',payerBankgiro:row.payerBankgiro??'',payer:row.party,reference:row.payerReference,amount:row.amount,date:row.date})
});
