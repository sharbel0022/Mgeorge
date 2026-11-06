import https from 'node:https';
import {X509Certificate, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Every key/certificate is generated for this local test run. The only network
// substitution redirects a validated production host to our loopback listener;
// native TLS still verifies that host and the presented client certificate.
export function certificateFixture() {
  const directory=mkdtempSync(join(tmpdir(),'mg-op-runtime-tls-'));
  const file=name=>join(directory,name);
  writeFileSync(file('openssl.cnf'),'[req]\ndistinguished_name=subject\n[subject]\n',{mode:0o600});
  const openssl=args=>execFileSync('openssl',args,{cwd:directory,stdio:'ignore'});
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-config','openssl.cnf','-subj','/CN=Synthetic local CA','-days','2','-addext','basicConstraints=critical,CA:TRUE','-keyout','ca.key','-out','ca.pem']);
  for (const role of ['client','server']) {
    openssl(['req','-new','-newkey','rsa:2048','-nodes','-config','openssl.cnf','-subj','/CN=Synthetic '+role,'-keyout',role+'.key','-out',role+'.csr']);
    writeFileSync(file(role+'.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage='+ (role==='client'?'clientAuth':'serverAuth')+'\n'+(role==='server'?'subjectAltName=DNS:api.openbankingplatform.com,DNS:auth.openbankingplatform.com\n':''),{mode:0o600});
    openssl(['x509','-req','-in',role+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','2','-extfile',role+'.ext','-out',role+'.pem']);
  }
  for(const name of ['ca.key','ca.pem','client.key','client.pem','server.key','server.pem'])chmodSync(file(name),0o600);
  const read=name=>readFileSync(file(name),'utf8');
  const fingerprint=new X509Certificate(read('client.pem')).fingerprint256.replaceAll(':','').toLowerCase();
  const configuration={version:1,credentialGeneration:'synthetic-production-g1',certificateFile:file('client.pem'),privateKeyFile:file('client.key'),certificateSha256:fingerprint,caFile:file('ca.pem'),caSha256:createHash('sha256').update(read('ca.pem')).digest('hex')};
  return {directory,file,read,fingerprint,configuration,close:()=>rmSync(directory,{recursive:true,force:true})};
}

export async function localProvider(t,certificates,handler) {
  const requests=[];
  const server=https.createServer({key:certificates.read('server.key'),cert:certificates.read('server.pem'),ca:certificates.read('ca.pem'),requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk.toString('utf8');
    const received={method:req.method,path:req.url,host:req.headers.host,body,clientAuthorized:req.socket.authorized,clientFingerprint:req.socket.getPeerCertificate().fingerprint256?.replaceAll(':','').toLowerCase()};
    requests.push(received);
    try{const value=await handler(received);res.writeHead(value?.status||200,{'content-type':'application/json',...value?.headers});res.end(JSON.stringify(value?.body??value));}
    catch {res.writeHead(500);res.end('{}');}
  });
  server.on('tlsClientError',()=>{});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const original=https.request;
  t.mock.method(https,'request',(input,options,callback)=>{
    const url=new URL(input);
    if(!['https://api.openbankingplatform.com','https://auth.openbankingplatform.com'].includes(url.origin))throw Error('Unexpected synthetic TLS target');
    return original({ ...options,hostname:'127.0.0.1',port:server.address().port,servername:url.hostname,path:url.pathname+url.search,headers:{...options.headers,host:url.host}},callback);
  });
  return {requests,server};
}
