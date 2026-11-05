import test from 'node:test';
import * as client from '../lib/manual-multiple-client.js';
import {registerManualClientCases} from '../../test/helpers/manual-multiple-client-cases.mjs';
registerManualClientCases(test,client,'Sites client');
