import test from 'node:test';
import {analyzeReconciliation} from '../src/reconciliation.js';
import {normalizationContracts} from './helpers/reconciliation-normalization.mjs';
normalizationContracts(test,analyzeReconciliation);
