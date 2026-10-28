/** One manual control, a common review queue, and evidence on the invoice itself.
 * Sending remains exclusively in messages.js and its version-bound approval API.
 */
let controlEpoch = 0, controlTimer = null, controlStarting = false, controlRequest = null;
let controlReviewFilter = 'all';
const controlLabels = {queued:'Väntar',running:'Pågår',done:'Klart',cached:'Sparat underlag',waiting:'Väntar på nästa steg',blocked:'Behöver åtgärd',error:'Kunde inte slutföras',interrupted:'Avbruten'};
function resetPaymentControl(){controlEpoch++;clearTimeout(controlTimer);controlTimer=null;controlStarting=false;controlRequest=null;controlReviewFilter='all';state.control=null;}
function controlData(){return state.control || {counts:{},totals:{},queue:[],run:null};}
function controlBusy(){return controlStarting || controlData().run?.status==='running';}
function controlButton(){return `<button class="primary control-button" data-control-start ${controlBusy()?'disabled aria-busy="true"':''}>${icon(controlBusy()?'clock':'check')}${controlBusy()?'Kontrollen pågår':'Kontrollera alla betalningar'}</button>`;}
function controlProgress(){
  const run=controlData().run;
  if(!run)return `<p class="control-hint">Gmail → dokument → bank → avstämning → mejlutkast. Du godkänner varje kundmejl separat.</p>`;
  const title={running:'Kontrollen pågår',complete:'Kontrollen är genomförd',partial:'Delvis klart – några steg behöver följas upp',interrupted:'Kontrollen avbröts'}[run.status]||'Kontrollstatus';
  return `<div class="control-run"><div class="control-run-title"><strong>${esc(title)}</strong><span>${datetime(run.finished_at||run.started_at)}</span></div><ol class="control-steps">${run.steps.map((s,n)=>`<li class="control-step ${esc(s.state)}"><span class="control-step-mark">${['done','cached'].includes(s.state)?icon('check'):n+1}</span><strong>${esc(s.title)}</strong><span>${esc(controlLabels[s.state]||s.state)}</span><p>${esc(s.note||'')}${s.next_at?` Nästa möjliga försök: ${datetime(s.next_at)}.`:''}</p></li>`).join('')}</ol><p class="control-hint">Kontrollstatus gäller arbetsstegen, inte att alla fakturor är betalda. Inga mejl skickas här.</p></div>`;
}
function controlConnections(){
  const bank=state.bank.connections||[],ok=bank.some(c=>c.status==='connected');
  const lastBank=bank.map(c=>c.last_synced).filter(Boolean).sort().at(-1);
  return `<div class="control-connections"><button class="control-connection" data-action="gmail-settings"><span class="connection-dot ${gmailConnected()?'ok':''}"></span><strong>Gmail</strong><span>${gmailConnected()?'Ansluten':'Kontrollera anslutning'}</span><small>Hämtat ${datetime(state.gmail.last_synced)}</small>${icon('chevron')}</button><button class="control-connection" data-nav="connections"><span class="connection-dot ${ok?'ok':''}"></span><strong>Swedbank</strong><span>${ok?'Ansluten':'Kontrollera anslutning'}</span><small>Hämtat ${datetime(lastBank)}</small>${icon('chevron')}</button><button class="control-connection" data-nav="settings"><span class="connection-dot ok"></span><strong>Dokumenttolkning</strong><span>Lokal i appservern</span><small>Bearbetas när servern är igång</small>${icon('chevron')}</button></div>`;
}
function paymentControlOverview(){
  const d=controlData(),t=d.totals,c=d.counts;
  return `<section class="control-hero"><div><span class="eyebrow">DIN ARBETSDAG, FÖRENKLAD</span><h2>En kontroll.<br>Allt som behöver ditt beslut.</h2><p>Hämta underlag, kontrollera betalningar och samla avvikelser. Systemet förbereder – du bestämmer.</p><div class="control-main-action">${controlButton()}<span>${icon('shield')} Inga kundmejl skickas av kontrollen</span></div></div><div class="control-hero-note"><span class="control-note-icon">${icon('file')}</span><strong>Faktura → betalning → beslut</strong><p>Original, bankuppgifter och mejlutkast på samma ställe. Inga gissade betalningar.</p></div></section>${controlConnections()}<section id="payment-control-progress" class="control-progress" aria-live="polite">${controlProgress()}</section><p class="control-hint">Senaste fullständiga kontroll: ${datetime(d.last_successful_control)}</p><div class="stat-grid control-stats">${stat('','file','Totalt fakturerat',money(t.billed_cents||0),'kundfakturor minus kreditfakturor','data-nav="customers"')}${stat('amber','clock','Verifierat utestående',money(t.verified_outstanding_cents||0),'efter registrerad underlagskontroll','data-nav="customers" data-filter="verified_outstanding"')}${stat('red','calendar','Förfallodatum passerat',t.overdue_count||0,`${money(t.overdue_cents||0)} att kontrollera`,'data-nav="customers" data-filter="overdue"')}${stat('purple','mail','Kundmeddelanden',c.messages||0,`${c.gmail_documents||0} nya Gmail-underlag att granska`,'data-nav="messages"')}${stat('green','check','Betalt & verifierat',money(t.paid_cents||0),`${t.paid_count||0} helt betalda fakturor`,'data-nav="customers" data-filter="paid"')}${stat('','file','Kvar att stämma av',money(t.remaining_cents||0),`${t.open_count||0} fakturor med kvarvarande belopp`,'data-nav="customers" data-filter="open"')}${stat('amber','clock','Delbetalda',t.partial_count||0,`${money(t.partial_remaining_cents||0)} kvar på delbetalda`,'data-nav="customers" data-filter="partial"')}${stat('purple','filter','Behöver ditt beslut',c.review||0,'samlat i en granskningskö','data-nav="review"')}</div><p class="control-accounting-note">${icon('info')} Kvarvarande belopp är inte bevis på obetald skuld när underlaget ännu inte är avstämt.</p><div class="control-columns"><section class="panel"><div class="panel-head"><div><span class="eyebrow">NÄSTA STEG</span><h2>Det här behöver du titta på</h2></div><button class="text-button" data-nav="review">Visa alla ${icon('chevron')}</button></div>${controlQueue(d.queue.slice(0,5))}</section><aside class="panel control-side"><h2>Underlag som saknas</h2><span class="control-big-number">${c.specifications||0}</span><h3>Bankgiro-specifikationer</h3><p>Kontots insättning visar inte alltid vem som betalat. Importera betalarnas detaljer – inte samma insättning igen.</p><button class="outline full" data-action="bank-file">${icon('upload')} Importera betalningsspecifikation</button><hr><h3>${c.other||0} övriga bankhändelser</h3><p>Kortköp, utbetalningar och kortåterbetalningar ligger separat från kundinbetalningarna.</p><button class="text-button" data-open-bank-group="other">Visa övriga händelser ${icon('chevron')}</button></aside></div><section class="panel section-space"><div class="panel-head"><h2>Kundfakturor</h2><button class="text-button" data-nav="customers">Alla fakturor ${icon('chevron')}</button></div>${recentInvoices(byDirection('customer'))}</section>`;
}
function controlQueue(items){
  if(!items.length)return `<div class="empty"><div class="orb">${icon('check')}</div><h3>Inget i den här kön</h3><p>En tom kö är inte bevis på full betalning. Kontrollera att fakturor och betalningsunderlag är hämtade.</p></div>`;
  const kindLabels={document:'Fakturauppgifter',payment:'Betalning att identifiera',specification:'Saknat Bankgiro-underlag',message:'Kundmeddelande',invoice:'Ej avstämd faktura',anomaly:'Ekonomisk avvikelse'};
  const icons={document:'file',payment:'bank',specification:'upload',message:'mail',invoice:'file',anomaly:'info'};
  return `<div class="control-queue">${items.map(q=>{
    const attrs=q.type==='document'?`data-document="${esc(q.entity_id)}"`:q.type==='message'?`data-review-message="${esc(q.entity_id)}"`:['invoice','anomaly'].includes(q.type)?`data-invoice="${esc(q.entity_id)}"`:`data-transaction="${esc(q.entity_id)}"`;
    return `<article class="control-task"><span class="orb ${q.blocked?'task-warning':''}">${icon(icons[q.type]||'file')}</span><div class="control-task-copy"><span class="control-task-kind">${esc(kindLabels[q.type]||'Granskning')}</span><h3>${esc(q.title)}</h3><p>${esc(q.reason)}</p></div><div class="control-task-action">${q.amount_cents!=null?`<strong>${money(q.amount_cents)}</strong>`:''}<button class="outline small" ${attrs}>${esc(q.action)} ${icon('chevron')}</button></div></article>`;
  }).join('')}</div>`;
}
function paymentControlReview(){
  const d=controlData(),queue=d.queue;
  const tabs=[['all','Alla'],['document','Fakturauppgifter'],['payment','Betalningar'],['financial','Ekonomiska avvikelser'],['specification','Bankgiro-underlag'],['message','Mejl att läsa'],['invoice','Ej avstämda fakturor']];
  const filtered=controlReviewFilter==='all'?queue:queue.filter(q=>controlReviewFilter==='financial'?q.category==='financial':q.type===controlReviewFilter);
  return `<div class="control-review-heading"><div><h2>En kö. Ett beslut i taget.</h2><p class="muted">Se varför en post behöver kontrolleras och öppna rätt underlag direkt.</p></div>${controlButton()}</div><section id="payment-control-progress" class="control-progress" aria-live="polite">${controlProgress()}</section><div class="button-row section-space"><button class="text-button" data-nav="import">Import & underlag</button><button class="text-button" data-nav="messages">Alla kundmeddelanden och utskick</button></div><section class="panel"><div class="control-tabs" aria-label="Filtrera granskning">${tabs.map(([key,label])=>`<button class="${controlReviewFilter===key?'active':''}" data-control-filter="${key}" aria-pressed="${controlReviewFilter===key}">${label}<span>${key==='all'?queue.length:queue.filter(q=>key==='financial'?q.category==='financial':q.type===key).length}</span></button>`).join('')}</div>${controlQueue(filtered)}</section><p class="control-accounting-note">${icon('shield')} Här finns inga massutskick. Varje kundmejl öppnas, granskas och godkänns separat.</p>`;
}
function paymentGroupUI(t){
  if(t.excluded||t.status==='excluded')return 'excluded';
  if(t.status==='matched'||t.available_cents===0)return 'matched';
  if(t.amount_cents>0&&t.is_aggregate)return 'bankgiro';
  if(t.amount_cents<0||/kortköp|card purchase|card refund|återbetalning.*kort|löneutbetalning/iu.test(`${t.description||''} ${t.reference||''}`))return 'other';
  return t.amount_cents>0?'incoming':'other';
}
function paymentTitleUI(t){return t.payer?.trim()||(t.is_aggregate?'Bankgiro – betalningsspecifikation saknas':t.description?.trim()||(t.amount_cents<0?'Utbetalning – mottagare saknas':'Inbetalning – betalare saknas'));}
function paymentBankPage(){
  const f=state.filters.bank;
  const tabs=[['incoming','Kundinbetalningar'],['identify','Behöver identifieras'],['bankgiro','Bankgiro-underlag'],['other','Övrigt'],['matched','Matchade'],['all','Alla'],['excluded','Undantagna']];
  return `<div class="control-review-heading"><div><h2>Kundbetalningar först</h2><p class="muted">Kortköp och lön finns under Övrigt. Originaluppgifter och historik bevaras.</p></div><div class="button-row"><button class="outline" data-nav="connections">Bankanslutning</button><button class="outline" data-action="bank-file">${icon('upload')}Importera underlag</button></div></div><section class="panel"><div class="control-tabs">${tabs.map(([key,label])=>`<button class="${f.status===key?'active':''}" data-bank-filter="${key}">${label}<span>${key==='all'?state.transactions.length:state.transactions.filter(t=>key==='identify'?paymentGroupUI(t)==='incoming':paymentGroupUI(t)===key).length}</span></button>`).join('')}</div><div class="control-search"><label class="search-field">${icon('search')}<input data-search="bank" value="${esc(f.q)}" placeholder="Sök betalare, referens eller beskrivning" aria-label="Sök bankhändelser"></label></div><div id="bank-results">${paymentBankResults()}</div></section><div class="info-note section-space">${icon('info')}<div>Grupperingen hjälper dig hitta rätt underlag. Den ändrar inte bankens bokföringsuppgifter eller betalningsstatus.</div></div>`;
}
function paymentBankResults(){
  const f=state.filters.bank,q=String(f.q||'').toLocaleLowerCase('sv-SE');
  const rows=state.transactions.filter(t=>(f.status==='all'||f.status==='identify'&&paymentGroupUI(t)==='incoming'||paymentGroupUI(t)===f.status||f.status==='review'&&!['matched','excluded','other'].includes(paymentGroupUI(t))||t.status===f.status)&&(!q||`${t.payer||''} ${t.reference||''} ${t.description||''}`.toLocaleLowerCase('sv-SE').includes(q)));
  f.page=Math.min(f.page,Math.max(1,Math.ceil(rows.length/f.size)));
  return rows.length?bankTable(rows.slice((f.page-1)*f.size,f.page*f.size))+pagination(rows.length,f):empty('bank','Inga händelser i det här urvalet','Byt filter eller hämta fler bankunderlag.');
}
async function paymentInvoiceDetail(id){
  const epoch=controlEpoch;
  try{
    const [detail,mail]=await Promise.all([api('/invoices/'+encodeURIComponent(id)),api('/customer-messages')]);
    if(epoch!==controlEpoch||!state.me?.authenticated)return;
    state.messages=mail.items;
    const {invoice:i,allocations,documents,analysis=[]}=detail;
    const drafts=mail.items.filter(m=>m.invoice_id===id&&['draft','sending','unknown'].includes(m.status));
    const suggestions=state.suggestions.filter(s=>s.invoice_id===id);
    const first=documents[0],percent=Math.min(100,Math.max(0,(i.paid_cents||0)/i.total_cents*100));
    modal('Faktura '+i.invoice_number,`<div class="control-invoice-head"><div><span class="eyebrow">${i.direction==='customer'?'KUNDFAKTURA':'LEVERANTÖRSFAKTURA'}</span><h2>${esc(i.party)}</h2><p>${esc(i.invoice_number)} · förfaller ${date(i.due_at)}</p></div>${invoiceBadge(i)}</div><div class="control-invoice-totals"><div><span>Fakturabelopp</span><strong>${money(i.total_cents)}</strong></div><div><span>Verifierat betalt</span><strong>${money(i.paid_cents)}</strong></div><div><span>Kvar att stämma av</span><strong>${money(i.remaining_cents)}</strong></div></div><progress class="control-payment-bar" max="100" value="${percent}" aria-label="${Math.round(percent)} procent verifierat betalt"></progress>${i.status==='unreconciled'?'<p class="control-accounting-note">Ingen säker betalning är kopplad ännu. Detta bevisar inte att fakturan är obetald.</p>':''}<div class="control-invoice-grid"><section><h3>1. Originalfakturan</h3>${first?`<a class="text-button" href="/api/documents/${encodeURIComponent(first.id)}" target="_blank" rel="noopener">Öppna hela originalet ${icon('download')}</a><img class="control-original" alt="Originalfaktura, första sidan" src="/api/documents/${encodeURIComponent(first.id)}/preview">`:'<p class="muted">Inget original bifogat.</p>'}<dl class="detail-grid"><div><dt>Fakturadatum</dt><dd>${date(i.issued_at)}</dd></div><div><dt>OCR / referens</dt><dd>${esc(i.reference||'Saknas')}</dd></div><div><dt>Netto</dt><dd>${i.net_cents==null?'Saknas':money(i.net_cents)}</dd></div><div><dt>Moms</dt><dd>${i.vat_cents==null?'Saknas':money(i.vat_cents)}</dd></div></dl><button class="text-button" data-attach="${esc(id)}">Bifoga underlag</button></section><section><h3>2. Betalningsunderlag</h3>${allocations.length?allocations.map(a=>`<div class="control-evidence"><strong>${money(a.amount_cents)} · ${date(a.transaction?.booked_at)}</strong><p>${esc(a.transaction?.payer||'Namn saknas')} · referens ${esc(a.transaction?.reference||'saknas')}</p><span class="status paid">Verifierad koppling</span><button class="text-button" data-transaction="${esc(a.transaction_id)}">Visa bankhändelse</button><button class="text-button" data-undo="${esc(a.id)}">Ångra matchning</button></div>`).join(''):'<p class="muted">Inga verifierade betalningar registrerade.</p>'}${suggestions.length?`<h4>Förslag att granska</h4>${suggestions.map(s=>`<div class="control-evidence warning"><p>${esc(s.reason)}</p><button class="outline small" data-transaction="${esc(s.transaction_id)}">Granska betalningen</button></div>`).join('')}`:'<p class="muted">Inga nya säkra förslag i det hämtade underlaget.</p>'}<h3 class="section-space">3. Avvikelseanalys</h3>${analysis.length?analysis.map(a=>`<div class="control-evidence warning"><p>${esc(a.reason)}</p>${a.transaction_id?`<button class="text-button" data-transaction="${esc(a.transaction_id)}">Visa betalningsunderlag</button>`:''}</div>`).join(''):'<p class="muted">Ingen särskild avvikelse har identifierats i det sparade underlaget.</p>'}<h3 class="section-space">4. Kundmeddelande</h3>${drafts.length?drafts.map(m=>`<div class="control-mail-preview"><strong>${esc(m.subject)}</strong><p>Till: ${esc(m.recipient||'Mejladressen behöver verifieras')}</p><pre>${esc(m.body)}</pre><button class="primary" data-review-message="${esc(m.id)}">${icon('eye')}Läs och granska mejlet</button><small>Ingen sändning sker när du öppnar utkastet.</small></div>`).join(''):'<p class="muted">Inget aktuellt mejlutkast finns. Kontrollen förbereder utkast först när underlaget visar ett uppföljningsbehov.</p>'}</section></div><div class="button-row"><button class="outline" data-edit-invoice="${esc(id)}">Redigera fakturauppgifter</button>${i.remaining_cents>0?`<button class="outline" data-reconcile="${esc(id)}">Kontrollera betalningsstatus</button>`:''}</div>`,null,null,true);
  }catch(error){handleError(error);}
}
async function startPaymentControl(){
  if(controlBusy())return;
  const epoch=controlEpoch;controlStarting=true;
  render();
  try{
    controlRequest ||= crypto.randomUUID();
    const {job,reused}=await api('/payment-control/run','POST',{request_id:controlRequest});
    if(epoch!==controlEpoch||!state.me?.authenticated)return;
    state.control ||= {counts:{},totals:{},queue:[]};state.control.run=job;controlRequest=null;
    if(job.status!=='running')toast(reused?'Den senaste kontrollen används. Vänta en stund innan nästa hämtning.':'Kontrollen är avslutad.');
  }catch(error){if(epoch===controlEpoch)handleError(error);}
  finally{if(epoch===controlEpoch&&state.me?.authenticated){controlStarting=false;render();}}
}
function resumePaymentControl(){
  const job=controlData().run;
  if(controlTimer||!state.me?.authenticated||job?.status!=='running'||document.hidden)return;
  const epoch=controlEpoch;
  controlTimer=setTimeout(async()=>{
    controlTimer=null;
    try{
      const result=await api('/payment-control/runs/'+encodeURIComponent(job.id));
      if(epoch!==controlEpoch||!state.me?.authenticated)return;
      state.control.run=result.job;
      const area=document.getElementById('payment-control-progress');if(area)area.innerHTML=controlProgress();
      if(result.job.status==='running')resumePaymentControl();
      else {await refresh();if(epoch===controlEpoch)toast(result.job.status==='complete'?'Kontrollen är genomförd. Granska det som behöver ditt beslut.':'Delvis klart. Öppna kontrollstatus för nästa steg.');}
    }catch(error){if(epoch===controlEpoch){handleError(error);}}
  },1500);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePaymentControl();});
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-control-start')){event.preventDefault();await startPaymentControl();}
  else if(b.dataset.controlFilter){controlReviewFilter=b.dataset.controlFilter;render();}
  else if(b.dataset.openBankGroup){state.filters.bank.status=b.dataset.openBankGroup;state.filters.bank.page=1;navigate('bank');}
});
