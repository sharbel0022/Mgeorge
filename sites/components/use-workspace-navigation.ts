"use client";
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {createWorkspaceHistory,type WorkspaceView} from '@/lib/workspace-location';
import {createWorkspaceDraftGuard} from '@/lib/workspace-drafts';

type Filters={search:string;filter:string};
export function useWorkspaceNavigation(initialView:WorkspaceView,shell:RefObject<HTMLElement|null>,onViewChange:()=>void){
 const [view,setView]=useState(initialView),[filters,setFilters]=useState<Partial<Record<WorkspaceView,Filters>>>({});
 const history=useRef<ReturnType<typeof createWorkspaceHistory>|null>(null),drafts=useRef<ReturnType<typeof createWorkspaceDraftGuard>|null>(null),changed=useRef(onViewChange);
 changed.current=onViewChange;
 useEffect(()=>{
  if(!shell.current)return;
  const guard=createWorkspaceDraftGuard(shell.current);
  const controller=createWorkspaceHistory(window,(next,reason)=>{setView(next.view);if(reason!=='initial')changed.current();},()=>guard.canLeave(message=>window.confirm(message)));
  history.current=controller;drafts.current=guard;
  return()=>{controller.dispose();guard.dispose();history.current=null;drafts.current=null;};
 },[shell]);
 const navigate=useCallback((next:WorkspaceView)=>history.current?.navigate(next)||false,[]);
 const setSearch=useCallback((search:string)=>setFilters(all=>({...all,[view]:{search,filter:all[view]?.filter||'all'}})),[view]);
 const setFilter=useCallback((filter:string)=>setFilters(all=>({...all,[view]:{filter,search:all[view]?.search||''}})),[view]);
 const captureFormSubmission=useCallback((form:HTMLFormElement|null)=>drafts.current?.captureSubmission(form)||(()=>{}),[]);
 const dismissBankImport=useCallback(()=>history.current?.dismissBankImport(),[]);
 const resetFilters=useCallback(()=>setFilters({}),[]);
 return {view,navigate,search:filters[view]?.search||'',filter:filters[view]?.filter||'all',setSearch,setFilter,captureFormSubmission,dismissBankImport,resetFilters};
}
