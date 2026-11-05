import {interpretInvoice} from '../src/invoice-extraction.js';
import {registerSummaryLabelTests} from './helpers/invoice-summary-label-cases.mjs';

registerSummaryLabelTests('node',interpretInvoice);
