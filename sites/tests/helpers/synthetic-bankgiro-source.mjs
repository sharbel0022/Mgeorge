import {createHash} from 'node:crypto';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function report(reportId='one',reference='0599',date='2026-10-01'){
 const bytes=new TextEncoder().encode(`Datum;Belopp;Avsändare;Fakturanummer;Valuta\n${date};100,25;Syntetisk betalare;${reference};SEK\n`);
 return {reportId,filename:reportId+'.csv',sha256:hash(bytes),bytes};
}
export function syntheticSource(reports=[report()]){
 return {id:'test-bank',mode:'synthetic',reports,calls:[],generation:'g1',scopeId:'test-scope',authorizationStatus:'VERIFIED',
  async authorize({owner}){this.calls.push('authorize');return {status:this.authorizationStatus,owner,sourceId:this.id,scopeId:this.scopeId,generation:this.generation,validUntil:'2099-01-01T00:00:00Z',evidenceId:'synthetic-only'};},
  async listReports({cursor,limit}){this.calls.push('list');const n=Number(cursor||0);return {reports:this.reports.slice(n,n+limit).map(({bytes,...r})=>r),nextCursor:String(Math.min(n+limit,this.reports.length))};},
  async fetchReport({report:r}){this.calls.push('fetch');return this.reports.find(x=>x.reportId===r.reportId&&x.sha256===r.sha256).bytes;}
 };
}
