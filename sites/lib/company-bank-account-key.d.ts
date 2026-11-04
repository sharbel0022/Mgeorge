/** The identity must come from the verified persisted account, not a selector. */
export function companyBankAccountKey(input:{provider:string;bank:string;country:string;accountIdentity:string}):string;
