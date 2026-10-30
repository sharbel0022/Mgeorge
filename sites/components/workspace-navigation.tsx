"use client";

import {useEffect,useRef,type KeyboardEvent,type MouseEvent,type ReactNode} from 'react';
import {ArrowRight,Building2,CheckCheck,ChevronDown,FileText,Landmark,LayoutDashboard,Menu,ReceiptText,Settings,ShieldCheck,X} from 'lucide-react';
import {workspaceHref,isWorkspaceLinkClick,type WorkspaceView} from '@/lib/workspace-location';

export type {WorkspaceView} from '@/lib/workspace-location';
type Props={view:WorkspaceView;reviewCount:number;company:{name:string;email:string};open:boolean;onNavigate:(view:WorkspaceView)=>void;onClose:()=>void};
const items=[
 {id:'overview',label:'Översikt',icon:LayoutDashboard},
 {id:'receivable',label:'Kundfakturor',icon:FileText},
 {id:'payable',label:'Leverantörsfakturor',icon:ReceiptText},
 {id:'bank',label:'Bank',icon:Landmark},
 {id:'review',label:'Behöver granskas',icon:CheckCheck},
] as const;
const area=(view:WorkspaceView)=>view==='contacts'?'receivable':['messages','documents','imports'].includes(view)?'review':['connections','history'].includes(view)?'settings':view;

function followLink(event:MouseEvent<HTMLAnchorElement>,view:WorkspaceView,onNavigate:Props['onNavigate']){
 if(isWorkspaceLinkClick(event)){event.preventDefault();onNavigate(view);}
}
export function WorkspaceLink({view,onNavigate,children,className,current}:{view:WorkspaceView;onNavigate:Props['onNavigate'];children:ReactNode;className?:string;current?:'page'|'location'}){
 return <a href={workspaceHref(view)} className={className} aria-current={current} onClick={event=>followLink(event,view,onNavigate)}>{children}</a>;
}

export function retainMobileNavigationFocus(event:KeyboardEvent<HTMLDialogElement>){
 if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey)return;
 const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')).filter(control=>control.tabIndex>=0&&control.getClientRects().length>0);
 const first=controls[0],last=controls.at(-1),active=event.currentTarget.ownerDocument.activeElement;
 if(event.shiftKey&&active===first&&last){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&active===last&&first){event.preventDefault();first.focus();}
}

function NavigationContents({view,reviewCount,company,onNavigate}:Omit<Props,'open'|'onClose'>){
 const active=area(view);
 return <>
  <a className="brand" href="/" onClick={event=>followLink(event,'overview',onNavigate)}><strong>MG</strong><span>Fakturakoll</span></a>
  <div className="workspace"><span className="workspace-icon"><Building2 size={19}/></span><div><strong>M.George Vitvaror</strong><span>Företagsöversikt</span></div><ChevronDown size={15}/></div>
  <div className="nav-label">ARBETSYTA</div>
  <nav aria-label="Huvudmeny">{items.map(({id,label,icon:Icon})=><WorkspaceLink key={id} view={id} className={`nav-item ${active===id?'active':''}`} current={view===id?'page':active===id?'location':undefined} onNavigate={onNavigate}><Icon size={19} aria-hidden="true"/><span>{label}</span>{id==='review'&&reviewCount>0&&<b aria-label={`${reviewCount} ärenden att granska`}>{reviewCount}</b>}</WorkspaceLink>)}</nav>
  <div className="sidebar-bottom">
   <WorkspaceLink view="settings" className={`nav-item ${active==='settings'?'active':''}`} current={view==='settings'?'page':active==='settings'?'location':undefined} onNavigate={onNavigate}><Settings size={18} aria-hidden="true"/><span>Inställningar</span></WorkspaceLink>
   <div className="sidebar-help"><ShieldCheck size={21} aria-hidden="true"/><strong>Din privata arbetsyta</strong><p>Fakturor, betalningar och beslut samlade. Varje kundmejl godkänns separat.</p><WorkspaceLink view="imports" onNavigate={onNavigate}>Import & underlag <ArrowRight size={14} aria-hidden="true"/></WorkspaceLink></div>
   <div className="user-chip"><div className="avatar" aria-hidden="true">MG</div><div><strong>{company.name}</strong><span>{company.email}</span></div></div>
  </div>
 </>;
}

function MobileNavigation({onClose,...props}:Omit<Props,'open'>){
 const ref=useRef<HTMLDialogElement>(null),closeRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const dialog=ref.current;if(!dialog)return;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  const desktop=window.matchMedia('(min-width: 761px)');
  const resized=()=>{if(desktop.matches)onClose();};
  dialog.showModal();closeRef.current?.focus({preventScroll:true});document.body.style.overflow='hidden';desktop.addEventListener('change',resized);
  resized();
  return()=>{
   desktop.removeEventListener('change',resized);dialog.close();document.body.style.overflow=overflow;
   if(opener?.isConnected&&opener.getClientRects().length)opener.focus({preventScroll:true});
   else document.getElementById('main-content')?.focus({preventScroll:true});
  };
 },[onClose]);
 return <dialog ref={ref} id="workspace-mobile-navigation" className="mobile-navigation" aria-label="Huvudmeny" aria-modal="true" onKeyDown={retainMobileNavigationFocus} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  <div className="sidebar mobile-navigation-panel"><button ref={closeRef} type="button" className="icon-button navigation-close" aria-label="Stäng menyn" onClick={onClose}><X size={21}/></button><NavigationContents {...props}/></div>
 </dialog>;
}

export function MobileMenuButton({open,onClick}:{open:boolean;onClick:()=>void}){
 return <button type="button" className="icon-button mobile-menu" aria-label="Öppna menyn" aria-controls="workspace-mobile-navigation" aria-haspopup="dialog" aria-expanded={open} onClick={onClick}><Menu size={21}/></button>;
}

export default function WorkspaceNavigation(props:Props){
 return <><aside className="sidebar desktop-navigation" aria-label="Arbetsytans navigation"><NavigationContents {...props}/></aside>{props.open&&<MobileNavigation {...props}/>}</>;
}
