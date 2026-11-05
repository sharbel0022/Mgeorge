/** D1-shaped facade over the same SQLite connection as the canonical importer.
 * Work and guards are trusted synchronous server callbacks, never request data. */
export function createCompanySyncDatabase(db){
 const statements=new WeakMap();
 const synchronous=value=>{
  if(value&&typeof value.then==='function'){
   Promise.resolve(value).catch(()=>{});
   throw TypeError('Company sync database work must be synchronous');
  }
  return value;
 };
 const execute=statement=>{
  const operation=statements.get(statement);
  if(!operation)throw TypeError('Statement belongs to a different company sync database');
  return operation();
 };
 const transaction=work=>{
  db.exec('BEGIN IMMEDIATE');
  try{const result=synchronous(work());db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
 };
 function prepare(query,args=[]){
  const result={
   bind(...values){return prepare(query,values);},
   async first(){return db.prepare(query).get(...args)||null;},
   async all(){return {results:db.prepare(query).all(...args)};},
   async run(){return execute(result);},
  };
  statements.set(result,()=>({success:true,meta:{changes:Number(db.prepare(query).run(...args).changes)}}));
  return result;
 }
 return {
  prepare,
  assert(statement){return execute(statement);},
  guard(assert){
   if(typeof assert!=='function')throw TypeError('A synchronous company guard is required');
   const statement={};
   statements.set(statement,()=>{if(synchronous(assert())===false)throw Object.assign(new Error('AUTHORIZATION_CHANGED'),{code:'AUTHORIZATION_CHANGED'});return {success:true,meta:{changes:0}};});
   return statement;
  },
  async batch(batch){return transaction(()=>batch.map(execute));},
  async batchWork(before,work,after){
   if(!Array.isArray(before)||typeof work!=='function'||typeof after!=='function')throw TypeError('Invalid company sync transaction');
   return transaction(()=>{
    before.forEach(execute);
    const result=synchronous(work()),tail=synchronous(after(result));
    if(!Array.isArray(tail))throw TypeError('Company sync transaction requires receipt statements');
    tail.forEach(execute);
    return result;
   });
  },
 };
}
