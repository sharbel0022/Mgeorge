import {existsSync} from 'node:fs';
import {runReconciliationContractCases} from './helpers/reconciliation-contract-cases.mjs';

const moduleUrl=new URL('../sites/lib/reconciliation-contract.js',import.meta.url);
const api=existsSync(moduleUrl)?await import(moduleUrl.href):{};
runReconciliationContractCases(api);
