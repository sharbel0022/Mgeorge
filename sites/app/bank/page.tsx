import BankConnection from '@/components/bank-connection';
import BankgiroSourceStatus from '@/components/bankgiro-source-status';
import BankOnboarding from '@/components/onboarding/bank-onboarding';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bankanslutning | MG Fakturakoll', referrer: 'no-referrer' };

export default function BankPage() {
  return <main className="bank-page" style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 16px 64px' }}>
    <BankOnboarding legacy={<><nav aria-label="Tillbaka till fakturakollen" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, marginBottom: 28 }}>
      <a href="/" className="text-button" style={{ display: 'inline-flex' }}><ArrowLeft size={17}/> Till fakturaöversikten</a>
      <span className="private-badge"><ShieldCheck size={15}/> Din arbetsyta</span>
    </nav>
    <BankConnection/><BankgiroSourceStatus/></>}/>
  </main>;
}
