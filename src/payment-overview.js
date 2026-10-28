/**
 * Read-only presentation model for the one-click workspace.
 * Classification helps navigation; it is never evidence that a bill is paid.
 */
export function paymentGroup(t) {
  if (t.excluded || t.status === 'excluded') return 'excluded';
  if (t.status === 'matched' || t.available_cents === 0) return 'matched';
  if (t.amount_cents > 0 && t.is_aggregate) return 'bankgiro';
  // A positive card refund is not a customer payment merely because it is positive.
  const text = `${t.description || ''} ${t.reference || ''}`;
  if (t.amount_cents < 0 || /kortköp|card purchase|card refund|återbetalning.*kort|löneutbetalning/iu.test(text)) return 'other';
  return t.amount_cents > 0 ? 'incoming' : 'other';
}

export function paymentTitle(t) {
  if (t.payer?.trim()) return t.payer.trim();
  if (t.is_aggregate) return 'Bankgiro – betalningsspecifikation saknas';
  if (t.description?.trim()) return t.description.trim();
  return t.amount_cents < 0 ? 'Utbetalning – mottagare saknas' : 'Inbetalning – betalare saknas';
}

export function buildPaymentOverview({invoices = [], transactions = [], documents = [], messages = [], suggestions = []}) {
  const customer = invoices.filter(i => i.direction === 'customer' && i.kind !== 'credit');
  const pending = documents.filter(d => !d.invoice_id && d.status === 'needs_review');
  const groups = {incoming: [], bankgiro: [], other: [], matched: [], excluded: []};
  for (const t of transactions) groups[paymentGroup(t)].push(t);
  const relevantMessages = messages.filter(m => ['draft', 'sending', 'unknown'].includes(m.status));
  const queue = [];
  for (const m of relevantMessages) {
    const uncertain = ['sending', 'unknown'].includes(m.status);
    queue.push({id: `message:${m.id}`, type: 'message', entity_id: m.id,
      invoice_id: m.invoice_id, priority: uncertain ? 0 : 40,
      title: `${m.invoice?.party || 'Kund'} · ${m.invoice?.invoice_number || 'Faktura'}`,
      reason: uncertain ? 'Utskickets status är oklar. Kontrollera Skickat i Gmail. Skicka inte igen.' :
        !m.recipient ? 'Verifiera kundadressen och läs utkastet innan du godkänner.' : 'Mejlutkastet väntar på att du läser och godkänner det.',
      action: uncertain ? 'Kontrollera utskick' : 'Läs mejlutkast', blocked: uncertain, amount_cents: m.invoice?.remaining_cents ?? null});
  }
  for (const d of pending) queue.push({id: `document:${d.id}`, type: 'document', entity_id: d.id,
    priority: 10, title: d.name || 'Fakturaunderlag', reason: d.extraction?.issues?.[0] ||
      (d.extraction?.fields ? 'Kontrollera de tolkade uppgifterna mot originalet.' : 'Dokumentet behöver tolkas innan en faktura kan registreras.'),
    action: 'Granska faktura', blocked: false, amount_cents: null});
  for (const t of groups.incoming) {
    const candidates = suggestions.filter(s => s.transaction_id === t.id);
    const one = candidates.length === 1 ? invoices.find(i => i.id === candidates[0].invoice_id) : null;
    queue.push({id: `payment:${t.id}`, type: 'payment', entity_id: t.id, invoice_id: one?.id || '',
      priority: 20, title: paymentTitle(t), reason: candidates.length > 1 ?
        `${candidates.length} fakturor kan passa. Kontrollera underlaget innan du väljer.` :
        candidates[0]?.reason || 'Ingen säker fakturakoppling hittad. Beloppet ensamt räcker inte.',
      action: 'Granska betalning', blocked: false, amount_cents: t.available_cents ?? Math.abs(t.amount_cents)});
  }
  for (const t of groups.bankgiro) queue.push({id: `spec:${t.id}`, type: 'specification', entity_id: t.id,
    priority: 30, title: `Bankgiroinsättning · ${t.booked_at || ''}`,
    reason: 'Hämta de individuella betalningsuppgifterna. Samlingsbeloppet får inte räknas en gång till.',
    action: 'Visa vad som saknas', blocked: true, amount_cents: t.available_cents ?? Math.abs(t.amount_cents)});
  const suggestedIds = new Set(suggestions.map(s => s.invoice_id));
  const messagedIds = new Set(relevantMessages.map(m => m.invoice_id));
  for (const i of customer.filter(i => i.status === 'unreconciled' && !suggestedIds.has(i.id) && !messagedIds.has(i.id))) {
    queue.push({id: `invoice:${i.id}`, type: 'invoice', entity_id: i.id, invoice_id: i.id,
      priority: 35, title: `${i.party} · ${i.invoice_number}`, reason:
        'Betalning är inte bekräftad. Det är inte samma sak som att fakturan är obetald.',
      action: 'Visa faktura och underlag', blocked: false, amount_cents: i.remaining_cents});
  }
  queue.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const total = (items, field) => items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  const partial = customer.filter(i => i.status === 'partial');
  return {
    counts: {documents: pending.length, payments: groups.incoming.length, specifications: groups.bankgiro.length,
      messages: relevantMessages.length, other: groups.other.length, matched: groups.matched.length, review: queue.length},
    totals: {paid_cents: total(customer, 'paid_cents'), paid_count: customer.filter(i => i.status === 'paid').length,
      remaining_cents: total(customer, 'remaining_cents'), open_count: customer.filter(i => i.remaining_cents > 0).length,
      unreconciled_cents: total(customer.filter(i => i.status === 'unreconciled'), 'remaining_cents'),
      partial_count: partial.length, partial_remaining_cents: total(partial, 'remaining_cents')},
    queue,
    note: 'Kvarvarande belopp baseras på registrerade matchningar. Ej avstämd betyder inte bevisat obetald.'
  };
}
