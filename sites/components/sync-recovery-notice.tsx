export default function SyncRecoveryNotice({channel}:{channel:'bank'|'Gmail'}){
 return <p className="bank-inline-error" role="alert">Automatisk {channel==='bank'?'bankhämtning':'Gmail-hämtning'} är stoppad efter upprepade misslyckade eller avbrutna försök. Kontrollera anslutningen och felmeddelandet. När leverantörens väntetid har gått ut kan du försöka hämta manuellt. En lyckad hämtning återupptar automatiken.</p>;
}
