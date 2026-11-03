export type SourceOriginal = {documentId?:string;importId?:string;sha256:string;intact?:boolean};
export type BankgiroSourceEvidence = {complete:true;reports:{documentId:string;importId:string;issue:string}[];snapshot:unknown[]};
export function projectBankgiroSourceEvidence(input:{owner:string;originals:SourceOriginal[];sources:Record<string,any>[];jobs:Record<string,any>[];now?:number}):BankgiroSourceEvidence;
export function readBankgiroSourceEvidence(database:any,owner:string,originals:SourceOriginal[]):Promise<BankgiroSourceEvidence>;
