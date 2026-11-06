import test from 'node:test';
import {analyzeReconciliation} from '../src/reconciliation.js';
import {reconciliationDecisionContracts} from './helpers/reconciliation-decisions.mjs';

reconciliationDecisionContracts(test, analyzeReconciliation);
