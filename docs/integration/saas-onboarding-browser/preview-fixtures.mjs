// Isolated browser preview only. Never imported by the product build.
import { directoryFixture, snapshotFixture, authorizationFixture } from '../../../sites/tests/helpers/saas-onboarding-fixture.mjs';
export function installPreviewFixtures() {
 const companies=directoryFixture().companies;let active='company-alpha',version=1,revision=3,connected=!['disconnected','unsupported'].includes(new URLSearchParams(location.search).get('scenario')),selected=true;
 const scenario=new URLSearchParams(location.search).get('scenario');
 if(scenario==='viewer')companies[0].role='viewer';
 const context=()=>({version:'company-context-v1',companyId:active,storageOwner:'synthetic-owner-'+active,actorId:'synthetic-actor',role:companies.find(c=>c.id===active).role,membershipVersion:1,companyVersion:1,contextVersion:version});
 const reply=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}}));
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=init.method||'GET',body=init.body?JSON.parse(init.body):{};
  if(url.origin!==location.origin)throw Error('External request blocked by synthetic preview');
  if(url.pathname==='/api/companies')return reply({version:'company-context-v1',companies:companies.map(c=>({...c,membershipVersion:1,companyVersion:1})),activeCompanyId:active,contextVersion:version,context:context()});
  if(url.pathname==='/api/companies/active'){if(body.contextVersion!==version||!companies.some(c=>c.id===body.companyId))return reply({error:'Stale'},409);active=body.companyId;version++;sessionStorage.setItem('synthetic-active-company',active);return reply({context:context()});}
  if(url.pathname==='/api/onboarding/companies'){
   if(method==='POST'){const company={id:'company-new',name:body.name,organizationNumber:null,role:'owner'};companies.push(company);sessionStorage.setItem('synthetic-created-company',JSON.stringify(company));return reply({version:1,company},201);}
   return reply({...directoryFixture(),companies,activeCompanyId:active,contextVersion:version,legacy:false});
  }
  const match=url.pathname.match(/^\/api\/companies\/([^/]+)\/(.*)$/);
  if(match){const id=match[1];if(id!==active||scenario==='denied')return reply({error:'Denied'},403);
   const snapshot=()=>{const s=snapshotFixture(id,Date.now());s.revision=revision;s.accounts[0].selected=selected;if(!connected){s.connection=null;s.accounts=[];s.payments=[];s.sync={state:'never',automaticEnabled:false,lastSuccessAt:null,nextAllowedAt:null,errorCode:null};}
    if(scenario==='unsupported'){s.banks[0].available=false;s.banks[0].authorization='unavailable';s.banks[0].unavailableReason='configuration_required';s.actions.connect=false;}
    if(scenario==='expired'&&s.connection)s.connection.validUntil=new Date(Date.now()-60000).toISOString();
    return s;};
   if(match[2]==='bank-onboarding')return reply(snapshot());
   if(['bank/connect','bank/renew'].includes(match[2]))return reply(authorizationFixture(id,Date.now()));
   if(match[2]==='bank/disconnect'){connected=false;revision++;return reply({version:1,companyId:id,accepted:true});}
   if(match[2]==='bank/accounts'){selected=body.accountIds.length>0;revision++;return reply({version:1,companyId:id,accepted:true});}
   return reply({error:'Synthetic preview action unavailable'},503);
  }
  return reply({error:'Unexpected API blocked by synthetic preview'},404);
 };
 const created=sessionStorage.getItem('synthetic-created-company');if(created)companies.push(JSON.parse(created));
 const saved=sessionStorage.getItem('synthetic-active-company');if(companies.some(c=>c.id===saved))active=saved;
}
