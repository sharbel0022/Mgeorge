import test from 'node:test';
import {analyzeReconciliation} from '../lib/reconciliation-engine.js';
import {normalizationContracts} from '../../test/helpers/reconciliation-normalization.mjs';
normalizationContracts(test,analyzeReconciliation);
