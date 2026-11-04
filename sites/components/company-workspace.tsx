'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createCompanyClient,installCompanyClientSurface,type CompanyClient,type CompanyClientSnapshot} from '@/lib/company-client.js';

const roles={owner:'Ägare',admin:'Administratör',accountant:'Redovisning',viewer:'Läsbehörighet'};

/** Children never mount until their request boundary is installed. Switching
 * unmounts the entire tree, including drafts, demos, original previews and all
 * child polling caches, then starts a new browser document after server approval. */
export default function CompanyWorkspace({children}:{children:ReactNode}){
  const client=useRef<CompanyClient|null>(null),[snapshot,setSnapshot]=useState<CompanyClientSnapshot|null>(null);
  useEffect(()=>{
    let live=true,bootstrapped=false,removeSurface:(()=>void)|undefined;
    const boundary=createCompanyClient({baseUrl:window.location.href,fetch:window.fetch.bind(window)});client.current=boundary;
    const unsubscribe=boundary.subscribe(next=>{if(live&&(bootstrapped||!['ready','legacy','signed_out'].includes(next.status)))setSnapshot(next);});
    void boundary.initialize().then(next=>{
      if(!live)return;
      if(next.status==='ready'||next.status==='legacy')removeSurface=installCompanyClientSurface(boundary,window);
      bootstrapped=true;setSnapshot(next);
    }).catch(()=>{if(live)setSnapshot(boundary.snapshot);});
    return()=>{live=false;unsubscribe();removeSurface?.();boundary.dispose();if(client.current===boundary)client.current=null;};
  },[]);
  async function switchCompany(companyId:string){
    const boundary=client.current;if(!boundary||companyId===boundary.snapshot.context?.companyId)return;
    try{await boundary.switchCompany(companyId);window.location.replace('/');}
    catch{/* The boundary stays blank until an explicit fresh read. */}
  }
  if(!snapshot||snapshot.status==='pending'||snapshot.status==='switching'||snapshot.status==='blocked')return <main className="company-access-status" role={snapshot?.status==='blocked'?'alert':'status'} aria-live="polite">
    <h1>{snapshot?.status==='blocked'?'Företagsåtkomsten behöver kontrolleras':snapshot?.status==='switching'?'Byter företag…':'Kontrollerar företagsåtkomst…'}</h1>
    {snapshot?.status==='blocked'&&<><p>{snapshot.error}</p><button className="btn" type="button" onClick={()=>window.location.reload()}>Läs in sidan igen</button></>}
  </main>;
  if(snapshot.status==='selection_required')return <main className="company-access-status">
    <h1>Välj företag</h1><p>Välj en arbetsyta som du har aktuell behörighet till.</p>
    <label>Företag<select aria-label="Välj företag" value="" onChange={event=>switchCompany(event.target.value)}><option value="" disabled>Välj företag…</option>{snapshot.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
  </main>;
  return <>{snapshot.status==='ready'&&snapshot.context&&<aside className="company-context-bar" aria-label="Företagskontext">
    <label className="company-context-selector"><span>Aktivt företag</span><select aria-label="Aktivt företag" value={snapshot.context.companyId} onChange={event=>switchCompany(event.target.value)}>{snapshot.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
    <span className="company-context-role">{roles[snapshot.context.role]}</span>
    {snapshot.companies.length>1&&<small>När du byter företag stängs öppna formulär.</small>}
  </aside>}{children}</>;
}
