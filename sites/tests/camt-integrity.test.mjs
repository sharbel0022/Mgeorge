import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBankgiroXML,parseSpecificationBytes} from '../lib/bankgiro-parser.js';
import {applyCommand,emptyState} from '../lib/domain.ts';
import {camtIntegrityTests,syntheticCamt,account} from './helpers/camt-integrity.mjs';

camtIntegrityTests({parse:parseBankgiroXML,parseBytes:bytes=>parseSpecificationBytes(bytes,'synthetic.xml'),report:row=>row.reportEvidence});
test('V4 report metadata remains distinct from bank payer and survives specification import',()=>{
 const rows=parseBankgiroXML(syntheticCamt),state=applyCommand(emptyState(),{type:'transactions.import',rows:[{account,date:'2026-10-26',amount:62500,bankReference:'SYNTHETIC-ENTRY',description:'Bankgiro inbetalning',kind:'batch',currency:'SEK'}]}).state;
 const result=applyCommand(state,{type:'bankgiro.import',rows,documentId:'synthetic-original',hash:'a'.repeat(64),name:'synthetic.xml'}).state;
 const payment=result.transactions.find(t=>t.specification);assert.deepEqual(payment.reportEvidence,rows[0].reportEvidence);assert.equal(payment.party,'Syntetisk Kund AB');assert.equal(payment.payerReference,'000018');assert.equal(payment.reportEvidence.accountServicer,'SYNTHETIC');
});
