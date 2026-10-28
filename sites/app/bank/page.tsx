import BankConnection from '@/components/bank-connection';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bankanslutning | MG Fakturakoll', referrer: 'no-referrer' };

export default function BankPage() {
  return <main className="bank-page" style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 64px' }}>
    <nav aria-label="Tillbaka till fakturakollen" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, marginBottom: 28 }}>
      <a href="/" className="text-button" style={{ display: 'inline-flex' }}><ArrowLeft size={17}/> Till fakturaöversikten</a>
      <span className="private-badge"><ShieldCheck size={15}/> Din arbetsyta</span>
    </nav>
    <BankConnection/>
  </main>;
}
