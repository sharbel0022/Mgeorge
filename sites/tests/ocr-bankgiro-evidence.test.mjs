import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {registerOcrBankgiroTests} from '../../test/helpers/ocr-bankgiro-parser-tests.mjs';

const {interpretInvoice}=await loadInvoiceParser();
registerOcrBankgiroTests('sites',interpretInvoice);
