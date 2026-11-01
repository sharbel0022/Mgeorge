// Legacy receipts may retain their exact old facts. Metadata additions never confer new trust.
export function referenceEvidenceCompatible(stored,current){
 if(JSON.stringify(stored||{})===JSON.stringify(current||{}))return true;
 if(stored?.version!=='payment-references-2026-10-28.2')return false;
 const oldCandidate=c=>c?{value:c.value,source:c.source,kind:c.kind,priority:c.priority,validity:c.validity}:null;
 const projection={version:stored.version,candidates:current.candidates.map(oldCandidate),selected:oldCandidate(current.selected),incomplete:current.incomplete,warnings:current.warnings};
 return JSON.stringify(stored)===JSON.stringify(projection);
}
