import {runSitesOcr,sitesOcrFailure} from '../src/sites-ocr-pull.js';

// Credentials are read only by this step and are never printed or passed as
// command-line arguments. The extraction child receives no credential variables.
try{
  const result=await runSitesOcr({origin:process.env.MG_SITES_ORIGIN,token:process.env.MG_SITES_OCR_TOKEN,mode:'cloud'});
  const needsAttention=result.failed||result.status_unknown||result.accepted_pending||result.aftercheck_pending;
  console.log(JSON.stringify({status:needsAttention?'needs_attention':'complete',processed:result.processed,failed:result.failed,...(result.accepted_pending?{accepted_pending:result.accepted_pending}:{}),...(result.status_unknown?{status_unknown:true}:{}),...(result.aftercheck_pending?{aftercheck_pending:true}:{})}));
  if(needsAttention)process.exitCode=1;
}catch(error){
  console.log(JSON.stringify({status:'failed',...sitesOcrFailure(error),reason:'Kontrollera moln-OCR-konfigurationen och Sites jobbstatus.'}));
  process.exitCode=1;
}
