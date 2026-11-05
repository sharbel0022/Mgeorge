import {interpretInvoice} from '../src/invoice-extraction.js';
import {invoiceScalarLayoutRegressions} from './helpers/invoice-scalar-layout-regressions.mjs';
invoiceScalarLayoutRegressions(interpretInvoice,'Node scalar layout');
