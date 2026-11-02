import * as adapter from '../src/gmail.js';
import {gmailAdapterReliabilityTests} from './helpers/gmail-adapter-reliability.mjs';

Object.assign(process.env,{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GMAIL_ACCOUNT:'mg.vitvaror@gmail.com'});
gmailAdapterReliabilityTests(adapter);
