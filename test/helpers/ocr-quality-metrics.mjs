import {isDeepStrictEqual} from 'node:util';

const emptyCounts=()=>({tp:0,fp:0,fn:0,expectedNonNull:0,returnedNonNull:0,correctNull:0,reviewedFields:0});
const ratio=(numerator,denominator)=>denominator?numerator/denominator:null;
const rowFields=['description','quantity','unit_price_cents','net_cents','vat_rate','vat_cents','total_cents'];

// Only explicitly annotated detail groups are scored. Extra rows within an
// annotated table are included, so hallucinated cells cannot escape precision.
// Evidence text and timestamps are deliberately outside the field-value rubric.
export function projectReviewedFields(extraction,gold){
  const expected={},actual={};
  const put=(path,want,got)=>{expected[path]=want??null;actual[path]=got??null;};
  for(const [key,value] of Object.entries(gold.fields))put(key,value,extraction.fields?.[key]?.value);
  for(const [group,want] of Object.entries(gold.details||{})){
    const got=extraction.details?.[group];
    if(group==='line_items'){
      put('details.line_items.length',want.length,Array.isArray(got)?got.length:null);
      for(let i=0;i<Math.max(want.length,Array.isArray(got)?got.length:0);i++){
        for(const key of rowFields)put(`details.line_items.${i}.${key}`,want[i]?.[key],got?.[i]?.[key]);
      }
    }else if(group==='vat_rates'){
      put('details.vat_rates',[...want].sort((a,b)=>a-b),Array.isArray(got)?[...got].sort((a,b)=>a-b):got);
    }else if(want!==null&&typeof want==='object'&&!Array.isArray(want)){
      for(const [key,value] of Object.entries(want))put(`details.${group}.${key}`,value,got?.[key]);
    }else put(`details.${group}`,want,got);
  }
  return {expected,actual};
}

export function evaluateDocument({id,family,subset='text',expected,actual,level,requireReview,durationMs,error=null,...metadata}){
  const counts=emptyCounts(),fields=[];
  for(const name of [...new Set([...Object.keys(expected),...Object.keys(actual)])].sort()){
    const want=expected[name]??null,got=actual[name]??null;
    const expectedPresent=want!==null,returned=got!==null,correct=isDeepStrictEqual(want,got);
    const fieldCounts={tp:correct&&expectedPresent?1:0,fp:returned&&!correct?1:0,fn:expectedPresent&&!correct?1:0,
      expectedNonNull:expectedPresent?1:0,returnedNonNull:returned?1:0,correctNull:correct&&!expectedPresent?1:0,reviewedFields:1};
    for(const key of Object.keys(counts))counts[key]+=fieldCounts[key];
    fields.push({name,group:name.startsWith('details.')?'detail':'scalar',expected:want,actual:got,correct,counts:fieldCounts});
  }
  const documentExact=!error&&fields.every(field=>field.correct),green=level==='green';
  return {id,family,subset,...metadata,level,requireReview:Boolean(requireReview),durationMs,error,counts,documentExact,
    green,falseGreen:green&&(Boolean(requireReview)||!documentExact),manualReview:!green,
    unnecessaryReview:!green&&!requireReview&&documentExact,fields};
}

function countFields(fields){
  const counts=emptyCounts();
  for(const field of fields)for(const key of Object.keys(counts))counts[key]+=field.counts[key];
  return {counts,fieldPrecision:ratio(counts.tp,counts.tp+counts.fp),fieldRecall:ratio(counts.tp,counts.tp+counts.fn)};
}

function basicSummary(rows){
  const greenCount=rows.filter(row=>row.green).length,falseGreenCount=rows.filter(row=>row.falseGreen).length;
  const exactDocuments=rows.filter(row=>row.documentExact).length,manualReviewCount=rows.filter(row=>row.manualReview).length;
  const times=rows.map(row=>row.durationMs).filter(time=>Number.isFinite(time)&&time>=0).sort((a,b)=>a-b);
  const totalTimeMs=times.reduce((sum,time)=>sum+time,0);
  return {documents:rows.length,...countFields(rows.flatMap(row=>row.fields)),exactDocuments,documentCoverage:ratio(exactDocuments,rows.length),
    greenCount,greenCoverage:ratio(greenCount,rows.length),correctGreenCount:greenCount-falseGreenCount,correctGreenCoverage:ratio(greenCount-falseGreenCount,rows.length),
    falseGreenCount,falseGreenRate:ratio(falseGreenCount,rows.length),falseGreenAmongGreen:ratio(falseGreenCount,greenCount),
    greenWrongValueCount:rows.filter(row=>row.green&&row.fields.some(field=>field.counts.fp>0)).length,
    greenIncompleteCount:rows.filter(row=>row.green&&!row.fields.some(field=>field.counts.fp>0)&&row.fields.some(field=>field.counts.fn>0)).length,
    greenUnsafeDecisionCount:rows.filter(row=>row.green&&row.requireReview).length,
    greenProcessingErrorCount:rows.filter(row=>row.green&&row.error).length,
    manualReviewCount,manualReviewRate:ratio(manualReviewCount,rows.length),
    requireReviewCount:rows.filter(row=>row.requireReview).length,unnecessaryReviewCount:rows.filter(row=>row.unnecessaryReview).length,
    errorCount:rows.filter(row=>row.error).length,timedDocuments:times.length,totalTimeMs,averageTimeMs:ratio(totalTimeMs,times.length),
    medianTimeMs:times.length?(times[Math.floor((times.length-1)/2)]+times[Math.floor(times.length/2)])/2:null,
    p95TimeMs:times.length?times[Math.ceil(times.length*.95)-1]:null};
}

export function summarizeDocuments(rows){
  const byField={},byFamily={},bySubset={},byFieldGroup={};
  for(const name of [...new Set(rows.flatMap(row=>row.fields.map(field=>field.name)))].sort()){
    byField[name]=countFields(rows.flatMap(row=>row.fields.filter(field=>field.name===name)));
  }
  for(const family of [...new Set(rows.map(row=>row.family))].sort())byFamily[family]=basicSummary(rows.filter(row=>row.family===family));
  for(const subset of [...new Set(rows.map(row=>row.subset))].sort())bySubset[subset]=basicSummary(rows.filter(row=>row.subset===subset));
  for(const group of ['scalar','detail']){
    const scoped=rows.map(row=>{
      const fields=row.fields.filter(field=>field.group===group);
      const documentExact=!row.error&&fields.every(field=>field.correct);
      return {...row,fields,documentExact,falseGreen:row.green&&(row.requireReview||!documentExact),unnecessaryReview:row.manualReview&&!row.requireReview&&documentExact};
    }).filter(row=>row.fields.length);
    byFieldGroup[group]=basicSummary(scoped);
  }
  return {...basicSummary(rows),byFieldGroup,byFamily,bySubset,byField};
}
