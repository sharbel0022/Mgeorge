import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {invoiceScalarLayoutRegressions} from '../../test/helpers/invoice-scalar-layout-regressions.mjs';
const {interpretInvoice}=await loadInvoiceParser();
invoiceScalarLayoutRegressions(interpretInvoice,'Sites scalar layout');
