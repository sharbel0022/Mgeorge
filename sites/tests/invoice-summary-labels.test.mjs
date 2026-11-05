import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {registerSummaryLabelTests} from '../../test/helpers/invoice-summary-label-cases.mjs';

const {interpretInvoice}=await loadInvoiceParser();
registerSummaryLabelTests('sites',interpretInvoice);
