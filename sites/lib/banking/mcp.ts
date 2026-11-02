import { automaticSync, automaticSyncStatus, bankFailure } from './service';

const tools = [
  {name:'bank_account_evidence',title:'Läs aktuell bankverifierad kontoalias',description:'Kontaktar befintlig AIS-bankanslutning för att läsa högst fem av ägarens redan godkända kontoresurser. Jämför en ägd AIS-bankhändelse och ett ägt rapportoriginal mot bankens uttryckliga kontoidentifierare utan IBAN-beräkning. Kräver aktivt produktionsmedgivande och valt SEK-konto. Bevarar fakturor, kontofakta och saldon; sparar endast driftlås och bankens återförsöksspärr.',inputSchema:{type:'object',properties:{transactionId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},documentId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['transactionId'],oneOf:[{required:['documentId'],not:{required:['sha256']}},{required:['sha256'],not:{required:['documentId']}}],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
  {name:'payment_evidence',title:'Läs privat betalnings- och fakturaevidens',description:'Läser endast den inloggade ägarens sparade betalningsunderlag och befintliga originalkontroller. Välj bankhändelse-ID eller exakt referens. Datum och heltalsören väljer enbart granskningsförslag, aldrig bevis. Ändrar ingenting och kontaktar inte banken eller Gmail.',inputSchema:{type:'object',properties:{transactionId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},reference:{type:'string',minLength:1,maxLength:100},amountCents:{type:'integer',minimum:-100000000000,maximum:100000000000},date:{type:'string',format:'date'},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:5}},oneOf:[{required:['transactionId'],not:{anyOf:[{required:['reference']},{required:['amountCents']},{required:['date']}]}},{required:['reference'],not:{required:['transactionId']}}],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'retained_report_evidence',title:'Läs privat sparat bankrapportoriginal',description:'Kontrollerar endast ett befintligt ägt bankoriginals storlek, SHA256 och tolkade rader. Välj original-ID eller exakt SHA256. Sidindelade rader visar aktuell kontoverifiering och registerförekomst. Kopplar inga underlag eller fakturor och hämtar inga nya uppgifter.',inputSchema:{type:'object',properties:{documentId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},transactionId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:100}},oneOf:[{required:['documentId'],not:{required:['sha256']}},{required:['sha256'],not:{required:['documentId']}}],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'backup_step',title:'Säkerhetskopiera ekonomi och original',description:'Skapar eller återupptar dagens krypterade säkerhetskopia för den inloggade användaren. Kopierar högst fem original per anrop och kontrolläser varje kopia. Ändrar inga fakturor eller betalningar.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'backup_status',title:'Status för verifierad säkerhetskopia',description:'Visar datum, verifieringsstatus och filantal för den inloggade användarens säkerhetskopior. Inga nycklar eller ekonomiska uppgifter returneras.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'bankgiro_source_status',title:'Status för automatisk Bankgiroinläsning',description:'Läser den autentiserade ägarens rapportkö, rapportstatus och nästa möjliga hämtning. En rapportkälla som inte anslutits och verifierats visas som avstängd. Kontaktar inte banken.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'bankgiro_auto_ingest',title:'Hämta och läs in Bankgirorapporter',description:'Bearbetar en begränsad beständig rapportkö för den autentiserade ägaren. Kräver en separat ansluten och verifierad rapportkälla. Bevarar original, kontrollerar dubbletter och använder befintlig import. Ändrar inga fakturors betalningskopplingar och skickar inga mejl eller betalningar.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
  {name:'process_invoice_documents',title:'Tolka väntande fakturaunderlag',description:'Bearbetar en begränsad beständig dokumentkö för den inloggade användaren. PDF-text läses i Sites; skannade dokument sparas i en beständig kö för OCR i molnet, med ansluten lokal dator som reserv. Registrerar endast gröna fakturor från uttryckligen verifierade motparter. Skickar inga mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'reconcile_customer_payments',title:'Stäm av betalningar och förbered kundmeddelanden',description:'Kontrollerar den autentiserade användarens fakturor och verifierade bankunderlag, matchar endast säkra betalningar och förbereder utkast för granskning. Skickar aldrig mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'gmail_auto_sync',title:'Hämta fakturabilagor från Gmail',description:'Hämtar fakturaunderlag till den autentiserade användarens arbetsyta högst var 15 minut med befintligt Google-medgivande. Förbereder underlag och avstämmer säkra betalningar mot registrerade fakturor. Skickar aldrig mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
  {name:'gmail_sync_status',title:'Status för Gmail',description:'Visar anslutning, senaste lyckade hämtning och sammanräknad dokumentstatus. Returnerar inga fakturor, mejltexter eller original och ändrar ingenting.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  { name: 'bank_auto_sync_status', title: 'Status för automatisk bankhämtning', description: 'Läser endast den autentiserade användarens anslutnings- och hämtningsstatus, utan transaktioner eller kontonummer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'bank_auto_sync', title: 'Hämta nya bankhändelser', description: 'Hämtar bokförda bankhändelser till den autentiserade användarens privata fakturakoll när automatisk hämtning är aktiverad och förfallen. Använder endast redan valt företagskonto och befintligt bankmedgivande. Avstämmer endast säkra betalningar och förbereder utkast. Skickar inga mejl och utför inga betalningar.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
];
const versions = ['2026-07-28', '2025-03-26'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function bankRpc(body: unknown): Promise<Response> {
  const input = object(body) ? body : {}, id = typeof input.id === 'string' || typeof input.id === 'number' ? input.id : null;
  const result = (value: unknown) => Response.json({ jsonrpc: '2.0', id, result: value }, { headers: { 'Cache-Control': 'private, no-store' } });
  const error = (code: number, message: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: { 'Cache-Control': 'private, no-store' } });
  if (input.jsonrpc !== '2.0' || typeof input.method !== 'string') return error(-32600, 'Invalid request');
  if (input.method === 'server/discover') return result({ supportedVersions: versions, capabilities: { tools: {} }, serverInfo: { name: 'mg-fakturakoll', version: '1.0.0' } });
  if (input.method === 'initialize') {
    const wanted = object(input.params) ? input.params.protocolVersion : null;
    return result({ protocolVersion: typeof wanted === 'string' && versions.includes(wanted) ? wanted : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'mg-fakturakoll', version: '1.0.0' } });
  }
  if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (input.method === 'tools/list') return result({ tools });
  if (input.method !== 'tools/call') return error(-32601, 'Method not found');
  const params = object(input.params) ? input.params : null;
  if (!params || !tools.some(tool => tool.name === params.name)) return error(-32602, 'Unknown tool');
  const args = params.arguments ?? {};
  // Caller identity comes only from Sites OAuth headers. No owner, account,
  // credential, request-context or force-refresh argument is accepted.
  const evidenceReader=params.name==='payment_evidence'||params.name==='retained_report_evidence';
  const currentAccountReader=params.name==='bank_account_evidence';
  if (!evidenceReader&&!currentAccountReader&&(!object(args) || Object.keys(args).length)) return error(-32602, 'This tool accepts no arguments');
  let response: Response;
  try {
    if(currentAccountReader){
      response=await(await import('./account-evidence')).readBankAccountEvidence(args);
    }else if(evidenceReader){
      const readers=await import('../evidence-read');
      response=params.name==='payment_evidence'?await readers.readPaymentEvidence(args):await readers.readRetainedReportEvidence(args);
    }else if(params.name==='backup_step'||params.name==='backup_status'){
      response=await(await import('../backups')).backupRpc(params.name==='backup_step');
    }else if(params.name==='bankgiro_auto_ingest'||params.name==='bankgiro_source_status'){
      const {identity,response:json}=await import('../server');const user=await identity();
      const reports=await import('../bankgiro-ingest-service');
      response=json(params.name==='bankgiro_auto_ingest'?await reports.runBankgiroSource(user.userId):await reports.bankgiroSourceStatus(user.userId));
    }else if(params.name==='process_invoice_documents'){
      const {identity,response:json}=await import('../server');const user=await identity();const processing=await import('../document-processing');const settings=await processing.processingSettings(user);
      const backup=await(await import('../backups')).runOwnerBackup(user.userId);
      response=json({...(settings?.enabled?await processing.processDocuments(user.userId):{skipped:'paused',...await processing.processingStatus(user.userId)}),backup});
    }else if(params.name==='reconcile_customer_payments'){
      const {identity,response:json}=await import('../server');const user=await identity();
      response=json(await (await import('../customer-messages')).reconcileAndPrepare(user.userId));
    }else if(String(params.name).startsWith('gmail_')){
      const gmail=await import('../gmail-service');
      try{response=params.name==='gmail_auto_sync'?await gmail.gmailSync(undefined,true):await gmail.gmailStatus(true);}catch(e){response=gmail.gmailFailure(e);}
    }else response=params.name === 'bank_auto_sync' ? await automaticSync() : await automaticSyncStatus();
  }
  catch (cause) { response = bankFailure(cause); }
  const data = await response.json();
  return result({ content: [{ type: 'text', text: currentAccountReader&&response.ok?'Kontoevidens utan ändrade ekonomiska uppgifter. Driftlås och bankens väntetid hanteras separat; se structuredContent.':evidenceReader&&response.ok?'Privat läsning utan ändringar. Evidens och fullständighet finns i structuredContent.':JSON.stringify(data) }], structuredContent: data, ...(response.ok ? {} : { isError: true }) });
}
