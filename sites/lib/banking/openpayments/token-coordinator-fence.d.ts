declare const applicationFence:unique symbol;
export interface OpenPaymentsTokenFence {readonly [applicationFence]:true;}
type Database={prepare(sql:string):{bind(...values:any[]):any}};
export function createOpenPaymentsTokenFence(input:{database:Database;familyKey:string;configHash:string;epoch:number;controlRevision:number}):OpenPaymentsTokenFence;
/** Fixed SELECT guard only; throws for another raw database or a forged value. */
export function openPaymentsTokenFenceStatement(capability:OpenPaymentsTokenFence,database:Database):D1PreparedStatement;
