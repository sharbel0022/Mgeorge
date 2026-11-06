export function enrichSitesInvoice(input:{
  database:any; owner:string; job:Record<string,any>; baseline:any;
  environment:Record<string,string>; loadBytes:()=>Promise<Uint8Array>;
  adapter?:(input:any)=>Promise<any>;
}):Promise<any>;
