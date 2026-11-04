export type CompanyAccountEvidence = {
  status: 'verified'; origin: 'bank' | 'provider'; evidenceId: string;
  companyId: string; actorId: string; bankName: string; country: string;
  accountUids: string[]; checkedAt: string; validUntil: string;
};
export function resolveCorporateAccountEvidence(configuration: unknown, input: {
  context: { companyId: string; storageOwnerId: string; actorId: string };
  bankName: string; country: string; accounts: { uid: string; key: string; usage?: string }[];
  validUntil: string; now?: number;
}): CompanyAccountEvidence | undefined;
