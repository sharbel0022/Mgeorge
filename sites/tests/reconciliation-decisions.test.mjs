import test from 'node:test';
import {analyzeReconciliation} from '../lib/reconciliation-engine.js';
import {reconciliationDecisionContracts} from '../../test/helpers/reconciliation-decisions.mjs';

reconciliationDecisionContracts(test, analyzeReconciliation);
