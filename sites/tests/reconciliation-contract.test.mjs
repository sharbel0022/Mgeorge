import {existsSync} from 'node:fs';
import {runReconciliationContractCases} from '../../test/helpers/reconciliation-contract-cases.mjs';

const moduleUrl=new URL('../lib/reconciliation-contract.js',import.meta.url);
const api=existsSync(moduleUrl)?await import(moduleUrl.href):{};
runReconciliationContractCases(api);
