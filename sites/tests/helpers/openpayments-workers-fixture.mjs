import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let certificate;
/** Ephemeral synthetic material. No provider keys or network operations. */
export function syntheticWorkersCertificate(){
 if(certificate)return certificate;
 const directory=mkdtempSync(join(tmpdir(),'openpayments-workers-certificate-'));
 try{
  const configuration=join(directory,'openssl.cnf'),cert=join(directory,'client.pem');
  writeFileSync(configuration,'[req]\ndistinguished_name=subject\n[subject]\n',{mode:0o600});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-config',configuration,'-subj','/CN=synthetic-workers-client','-days','2','-keyout',join(directory,'client.key'),'-out',cert],{stdio:'ignore'});
  const certificatePem=readFileSync(cert,'utf8'),parsed=new X509Certificate(certificatePem);
  certificate=Object.freeze({certificatePem,certificateSha256:parsed.fingerprint256.replaceAll(':','').toLowerCase(),validFrom:Date.parse(parsed.validFrom),validTo:Date.parse(parsed.validTo)});
  return certificate;
 }finally{rmSync(directory,{recursive:true,force:true});}
}
export function workersBindingConfiguration(overrides={}){
 const {certificatePem,certificateSha256}=syntheticWorkersCertificate();
 return {version:1,credentialGeneration:'g1',binding:'OPENPAYMENTS_MTLS',certificateId:'00000000-0000-4000-8000-000000000001',certificatePem,certificateSha256,...overrides};
}
