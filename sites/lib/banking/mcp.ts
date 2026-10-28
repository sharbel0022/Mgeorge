import { automaticSync, automaticSyncStatus, bankFailure } from './service';

const tools = [
  {name:'backup_step',title:'Säkerhetskopiera ekonomi och original',description:'Skapar eller återupptar dagens krypterade säkerhetskopia för den inloggade användaren. Kopierar högst fem original per anrop och kontrolläser varje kopia. Ändrar inga fakturor eller betalningar.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'backup_status',title:'Status för verifierad säkerhetskopia',description:'Visar datum, verifieringsstatus och filantal för den inloggade användarens säkerhetskopior. Inga nycklar eller ekonomiska uppgifter returneras.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'process_invoice_documents',title:'Tolka väntande fakturaunderlag',description:'Bearbetar en begränsad beständig dokumentkö för den inloggade användaren. PDF-text läses i Sites; skannade dokument sparas i en beständig kö för OCR i molnet, med ansluten lokal dator som reserv. Registrerar endast gröna fakturor från uttryckligen verifierade motparter. Skickar inga mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'reconcile_customer_payments',title:'Stäm av betalningar och förbered kundmeddelanden',description:'Kontrollerar den autentiserade användarens fakturor och verifierade bankunderlag, matchar endast säkra betalningar och förbereder utkast för granskning. Skickar aldrig mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}},
  {name:'gmail_auto_sync',title:'Hämta fakturabilagor från Gmail',description:'Hämtar fakturaunderlag till den autentiserade användarens arbetsyta högst var 15 minut med befintligt Google-medgivande. Förbereder underlag och avstämmer säkra betalningar mot registrerade fakturor. Skickar aldrig mejl.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
  {name:'gmail_sync_status',title:'Status för Gmail',description:'Visar den autentiserade användarens Gmail-anslutning och sparade underlag. Ändrar ingenting.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
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
  if (!object(args) || Object.keys(args).length) return error(-32602, 'This tool accepts no arguments');
  let response: Response;
  try {
    if(params.name==='backup_step'||params.name==='backup_status'){
      response=await(await import('../backups')).backupRpc(params.name==='backup_step');
    }else if(params.name==='process_invoice_documents'){
      const {identity,response:json}=await import('../server');const user=await identity();const processing=await import('../document-processing');const settings=await processing.processingSettings(user);
      const backup=await(await import('../backups')).runOwnerBackup(user.userId);
      response=json({...(settings?.enabled?await processing.processDocuments(user.userId):{skipped:'paused',...await processing.processingStatus(user.userId)}),backup});
    }else if(params.name==='reconcile_customer_payments'){
      const {identity,response:json}=await import('../server');const user=await identity();
      response=json(await (await import('../customer-messages')).reconcileAndPrepare(user.userId));
    }else if(String(params.name).startsWith('gmail_')){
      const gmail=await import('../gmail-service');
      try{response=params.name==='gmail_auto_sync'?await gmail.gmailSync(undefined,true):await gmail.gmailStatus();}catch(e){response=gmail.gmailFailure(e);}
    }else response=params.name === 'bank_auto_sync' ? await automaticSync() : await automaticSyncStatus();
  }
  catch (cause) { response = bankFailure(cause); }
  const data = await response.json();
  return result({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(response.ok ? {} : { isError: true }) });
}
