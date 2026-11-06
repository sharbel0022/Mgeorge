export type QueueHealth={basis:string;observed_at:string;pending:number;ready_pdf:number;ready_ocr:number;deferred:number;active:number;expired_leases:number;exhausted:number;failed:number;oldest_pending_at:string|null;next_retry_at:string|null;ocr_worker_unavailable:boolean};
export type Processing={enabled?:boolean;cloud_ocr_configured?:boolean;cloud_worker_recent?:boolean;cloud_last_completed?:string;worker_online?:boolean;scheduler_configured?:boolean;last_processed?:string|null;registered?:number;messages_waiting?:number;counts?:Record<string,number>;aftercheck_pending?:number;review_reasons?:{basis:string;total:number;analyzed:number;limit:number;truncated:boolean;counts:Record<string,number>};queue_health?:QueueHealth;throughput?:{basis:string;window_start:string;window_end:string;completed_documents:number}};
export type ScheduleObservation={last_invoked_at:string|null;last_completed_at:string|null;last_outcome:string|null;source:'system_entrypoint';external_schedule_verified:false};
export type AttachmentRejections={total:number;reasons:{code:string;count:number}[]};
const reconnectStatuses=new Set(['renewal_required','missing_scope','access_denied','invalid_client','account_mismatch','invalid_tokens']);
export const gmailNeedsReconnect=(status?:string)=>reconnectStatuses.has(status||'');
const outcomeLabels:Record<string,string>={completed:'Hämtning slutförd',completed_pending:'Hämtning slutförd – efterkontroll återstår',not_due:'Väntar till nästa tillåtna hämtning',paused:'Dokumentautomatik pausad',blocked:'Automatik stoppad',reconnect_required:'Gmail behöver anslutas igen',error:'Anropet misslyckades',running_or_interrupted:'Slutresultat saknas – pågår eller avbröts'};
const rejectionLabels:Record<string,string>={attachment_too_large:'För stor bilaga',attachment_unreadable:'Bilagan kunde inte läsas',attachment_format_invalid:'Ogiltigt filformat',message_metadata_invalid:'Mejluppgifter saknas eller är ogiltiga',unclassified:'Orsak saknas i äldre uppgift'};
const reviewLabels:Record<string,string>={uninterpreted:'Tolkning saknas eller kan inte sammanställas',missing_invoice_number:'Fakturanummer saknas',missing_party:'Kund eller leverantör saknas',missing_dates:'Faktura- eller förfallodatum saknas',missing_organization:'Organisationsnummer saknas',missing_amount:'Giltigt totalbelopp saknas',missing_vat_or_net:'Moms eller nettobelopp saknas',unverified_counterparty:'Motparten var inte verifierad vid tolkningen',possible_duplicate:'Möjlig dubblett',arithmetic_conflict:'Belopp eller moms stämmer inte',identity_conflict:'Motstridiga eller oklara identiteter',table_incomplete:'Ofullständig artikeltabell',interrupted_after_extraction:'Tolkning sparad före avbrott – kontroll återstår',low_confidence:'Osäkra tolkade fält',other_review:'Annan kontroll eller registrering återstår'};
const date=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(value)):'Ingen ännu';
function StatusTime({value,empty}:{value?:string|null;empty:string}){
 if(value===undefined)return <>Status inte hämtad</>;
 if(!value)return <>{empty}</>;
 return Number.isFinite(Date.parse(value))?<time dateTime={value}>{date(value)}</time>:<>Tidpunkt okänd</>;
}
export function GmailFetchStatus({lastSuccessfulFetch,observation,compact=false}:{lastSuccessfulFetch?:string|null;observation?:ScheduleObservation;compact?:boolean}){
 const Row=compact?'small':'p',className=compact?'block':undefined,observed=observation?.source==='system_entrypoint'?observation:undefined;
 return <>
  <Row className={className}>Senaste lyckade hämtning: <StatusTime value={lastSuccessfulFetch} empty="Ingen hämtning ännu"/></Row>
  <Row className={className}>Senaste automatiska anrop: {observed?<StatusTime value={observed.last_invoked_at} empty="Inget anrop observerat"/>:'Status saknas'}</Row>
  <Row className={className}>Senaste slutförda automatikanrop: {observed?<StatusTime value={observed.last_completed_at} empty="Ingen slutförd körning observerad"/>:'Status saknas'}</Row>
  <Row className={className}>Senaste anropets resultat: {!observed?'Status saknas':!observed.last_invoked_at?'Inget anrop observerat':outcomeLabels[observed.last_outcome||'']||'Okänt resultat'}</Row>
  <Row className={className}>Externt schema: Inte verifierat. Anropen bekräftar inte att ett externt schema har körts.</Row>
 </>;
}
export function DocumentQueueStatus({processing,compact=false}:{processing?:Processing;compact?:boolean}){
 const Row=compact?'small':'p',className=compact?'block':undefined,registered=processing?.registered;
 const health=processing?.queue_health,throughput=processing?.throughput;
 const quantity=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:'Okänt';
 const count=(...keys:string[])=>{
  const counts=processing?.counts;if(!counts)return 'Okänt';
  const values=keys.map(key=>counts[key]??0);
  if(values.some(value=>!Number.isSafeInteger(value)||value<0))return 'Okänt';
  const total=values.reduce((sum,value)=>sum+value,0);return Number.isSafeInteger(total)?total:'Okänt';
 };
 return <>
  <Row className={className}>Senaste bearbetning: <StatusTime value={processing?.last_processed} empty="Ingen ännu"/></Row>
  <Row className={className}>I kö: {count('queued','waiting_ocr')} · Bearbetas: {count('processing')} · Klara för registrering: {count('ready')} · Att granska: {count('needs_review','duplicate')} · Registrerade underlag: {typeof registered==='number'&&Number.isSafeInteger(registered)&&registered>=0?registered:'Okänt'} · Misslyckade jobb: {count('failed')}</Row>
  {health&&<>
   <Row className={className}>Redo för texttolkning: {quantity(health.ready_pdf)} · Redo för OCR: {quantity(health.ready_ocr)} · Väntar på nytt försök: {quantity(health.deferred)}</Row>
   <Row className={className}>Avbrutna jobb att återuppta: {quantity(health.expired_leases)} · Förbrukade försök: {quantity(health.exhausted)}</Row>
   {!compact&&<Row>Äldsta väntande underlag: <StatusTime value={health.oldest_pending_at} empty={health.pending===0?'Inga väntande underlag':'Tidpunkt okänd'}/>. Nästa möjliga återförsök: <StatusTime value={health.next_retry_at} empty="Inga uppskjutna försök"/></Row>}
   {health.ocr_worker_unavailable===true&&<Row className={className} role="alert">OCR-kön väntar: ingen OCR-arbetare har nyligen kontaktat tjänsten. Kontrollera molnarbetaren eller starta den anslutna OCR-datorn.</Row>}
  </>}
  {throughput&&<Row className={className}>Unika underlag med sparad tolkning senaste dygnet: {quantity(throughput.completed_documents)}</Row>}
 </>;
}
export function GmailAttachmentRejections({rejections,compact=false}:{rejections?:AttachmentRejections;compact?:boolean}){
 const Row=compact?'small':'p',value=rejections?.total,total=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
 return <><Row className={compact?'block':undefined}>Bilagor avvisade före import: {total??'Okänt'}</Row>{!compact&&total!==null&&total>0&&<details><summary>Varför avvisades bilagor?</summary><p>De här bilagorna ingår inte i dokumentkön. Kontrollera originalen i Gmail.</p><ul>{(rejections?.reasons||[]).filter(reason=>Number.isSafeInteger(reason.count)&&reason.count>0).map(reason=><li key={reason.code}>{rejectionLabels[reason.code]||'Orsak saknas'}: {reason.count}</li>)}</ul></details>}</>;
}
export function DocumentOcrStatus({processing}:{processing?:Processing}){
 const cloud=processing?.cloud_ocr_configured,review=processing?.review_reasons;
 return <><p>PDF-text tolkas i Sites. {cloud?'Bilder och skannade PDF:er kan bearbetas i molnet även när datorn är avstängd.':'Bilder och skannade PDF:er väntar på den anslutna OCR-datorn, som behöver vara på och inloggad.'} Svensk OCR används utan extern AI-tolkning.</p><p>Dokumentautomatik: {processing?.enabled===true?'Aktiverad – kontrollera senaste hämtning':processing?.enabled===false?'Pausad':'Status inte hämtad'}. {cloud?<>Moln-OCR: {processing?.enabled===false?'Pausad':processing?.cloud_worker_recent?'Nyligen kontakt':'Väntar på körning'}. Senaste sparade OCR-resultat: {date(processing?.cloud_last_completed)}. </>:null}Lokal OCR{cloud?' i reserv':''}: {processing?.worker_online?'Ansluten':'Ingen kontakt'}.</p><DocumentQueueStatus processing={processing}/>{Number(processing?.aftercheck_pending)>0&&<p role="alert">{processing!.aftercheck_pending} registrerade underlag väntar på efterkontroll. Registreringen är sparad. Kör betalningskontrollen igen för att uppdatera avstämning och utkast.</p>}{review&&review.total>0&&<details><summary>Varför väntar underlag på granskning?</summary><p>{review.analyzed} av {review.total} underlag sammanställda från sparade tolkningar. Ett underlag kan ha flera orsaker. Uppgifterna beskriver tolkningstillfället och ersätter inte kontroll av originalet.{review.truncated?' Endast den begränsade delen av kön visas här.':''}</p><ul>{Object.entries(reviewLabels).filter(([key])=>Number(review.counts[key])>0).map(([key,label])=><li key={key}>{label}: {review.counts[key]}</li>)}</ul></details>}</>;
}
