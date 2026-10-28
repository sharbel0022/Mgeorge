type ConsentStatus = {
  configured?: boolean;
  storageReady?: boolean;
  connection?: { status?: string; validUntil?: string } | null;
};

// URL result parameters are navigation hints. Only the authenticated server's
// current connection record can support a successful consent notice.
export function confirmedBankConsent(status: ConsentStatus | null | undefined, at = Date.now()): boolean {
  const connection = status?.connection;
  const expiry = Date.parse(connection?.validUntil || '');
  return status?.configured === true && status.storageReady === true && connection?.status === 'connected' && Number.isFinite(expiry) && expiry > at;
}
