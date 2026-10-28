// Swedish templates use verified amounts only. No transport or approval logic.
export function validRecipient(email){
  if(typeof email!=='string'||email.length>240||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||/[\r\n\0]/.test(email))return false;
  const [local,domain]=email.split('@');
  return local.length<=64&&!/^\.|\.$|\.\./.test(local)&&domain.split('.').every(label=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
const money=c=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(c/100);
export function generateMessage(i,kind){
  const intro=`Hej ${i.party},\n\nVi kontaktar er angående faktura ${i.invoice_number} på ${money(i.total_cents)}.`,paid=`Vi har verifierat betalningar på ${money(i.paid_cents)}. Återstående saldo är ${money(i.remaining_cents)}.`;
  const text={partial:`${paid} Vänligen kontrollera resterande belopp och återkom om ni har frågor.`,possible_vat:`${paid} Skillnaden motsvarar fakturans momsbelopp på ${money(i.vat_cents)}. Kan betalningen ha avsett beloppet exklusive moms? Hjälp oss gärna att kontrollera detta.`,missing_reference:'Betalningsunderlaget saknar fakturareferens. Kan ni bekräfta betalningsdatum, belopp och vilken faktura betalningen avser? Betalningen är ännu inte säkert kopplad.',wrong_reference:'Betalningsreferensen behöver kontrolleras. Kan ni bekräfta vilken faktura betalningen avser och ange korrekt fakturanummer?',overdue:`${paid} Förfallodatum var ${i.due_at}. Våra betalningsunderlag har kontrollerats. Vänligen kontrollera betalningen och återkom med betalningsbekräftelse om beloppet redan har betalats.`,overpayment:'En verifierad betalning överstiger det belopp som fördelats till fakturan. Kan ni hjälpa oss att kontrollera vad det överskjutande beloppet avser?',possible_duplicate:'Vi har hittat betalningsunderlag som kan avse ytterligare en betalning för fakturan. Vi behöver er hjälp att kontrollera detta innan vi drar någon slutsats.',confirmation:'Vi behöver hjälp att stämma av betalningsunderlaget. Kan ni skicka betalningsdatum, belopp och betalningsreferens? Vi har ännu inte kunnat fastställa betalningsstatus.'}[kind];
  const referenceNote=kind==='wrong_reference'&&i.payment_references?.length?`\n\nReferenser i underlaget: ${i.payment_references.join(', ')}. Fakturans referens: ${i.reference||i.invoice_number}.`:'';
  return {subject:`Avstämning av faktura ${i.invoice_number}`.replace(/[\r\n\0]/g,' '),body:`${intro}\n\n${text}${referenceNote}\n\nTack för hjälpen!\nM.George Vitvaror AB`};
}
