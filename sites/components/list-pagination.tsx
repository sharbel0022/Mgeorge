'use client';

type Props={page:number;pageCount:number;total:number;start:number;end:number;onPageChange:(page:number)=>void;label:string};

export default function ListPagination({page,pageCount,total,start,end,onPageChange,label}:Props){
 const first=page<=1,last=page>=pageCount;
 return <nav className="list-pagination" aria-label={`${label} – sidnavigering`}>
  <p className="list-pagination-count" role="status" aria-live="polite" aria-atomic="true">{`Visar ${start}–${end} av ${total} ${label.toLowerCase()}`}</p>
  <div className="list-pagination-controls">
   {/* Keep a focused control mounted and focusable when it reaches a boundary. */}
   <button type="button" className="btn" aria-disabled={first} onClick={()=>{if(!first)onPageChange(page-1);}}>Föregående sida</button>
   <span>{`Sida ${page} av ${pageCount}`}</span>
   <button type="button" className="btn" aria-disabled={last} onClick={()=>{if(!last)onPageChange(page+1);}}>Nästa sida</button>
  </div>
 </nav>;
}
