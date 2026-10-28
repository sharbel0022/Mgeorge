import {runSitesOcr} from '../src/sites-ocr-pull.js';

// Credentials are read only by this step and are never printed or passed as
// command-line arguments. The extraction child receives no credential variables.
try{
  const result=await runSitesOcr({origin:process.env.MG_SITES_ORIGIN,token:process.env.MG_SITES_OCR_TOKEN,mode:'cloud'});
  console.log(JSON.stringify({status:result.failed?'needs_attention':'complete',processed:result.processed,failed:result.failed}));
  if(result.failed)process.exitCode=1;
}catch{
  console.log(JSON.stringify({status:'failed',reason:'Kontrollera moln-OCR-konfigurationen och Sites jobbstatus.'}));
  process.exitCode=1;
}
