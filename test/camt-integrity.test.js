import {parseCAMT,parseBankFile} from '../src/importers.js';
import {camtIntegrityTests} from '../sites/tests/helpers/camt-integrity.mjs';

camtIntegrityTests({parse:parseCAMT,parseBytes:bytes=>parseBankFile('synthetic.xml',Buffer.from(bytes).toString('base64')),report:row=>row.account_evidence.report});
