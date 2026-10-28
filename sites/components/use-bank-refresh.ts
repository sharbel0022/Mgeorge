"use client";
import { useEffect, useRef } from 'react';

// The stored, owner-specific opt-in and six-hour due time are enforced by the
// server. This also refreshes data written by the cloud task while a page is open.
export function useBankRefresh(enabled: boolean, blocked: boolean, onComplete: () => void) {
  const latest = useRef({ blocked, onComplete }); latest.current = { blocked, onComplete };
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, pending = false, lastCheck = 0;
    async function refresh() {
      if (stopped || pending || latest.current.blocked || document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
      pending = true; lastCheck = Date.now();
      try {
        await fetch('/api/bank/auto-sync', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
        if (!stopped && !latest.current.blocked) latest.current.onComplete();
      } catch { /* A later check retries; saved records remain visible. */ }
      finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled]);
}
