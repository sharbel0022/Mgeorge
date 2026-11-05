import {interpretInvoice} from '../src/invoice-extraction.js';
import {registerOcrBankgiroTests} from './helpers/ocr-bankgiro-parser-tests.mjs';

registerOcrBankgiroTests('node',interpretInvoice);
