import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDocument,summarizeDocuments,projectReviewedFields} from './helpers/ocr-quality-metrics.mjs';

// The oracle below is hand counted: a wrong non-null answer costs both one FP
// and one FN. Abstaining on a null fact contributes neither TP nor a denominator.
test('field counts distinguish wrong values, missing values and correct abstentions',()=>{
  const row=evaluateDocument({id:'counts',family:'metric-test',expected:{a:'0018',b:200,c:300,d:null,e:null,f:0},actual:{a:'0018',b:201,c:null,d:'invented',e:null,f:0},level:'green',requireReview:false,durationMs:12});
  assert.deepEqual(row.counts,{tp:2,fp:2,fn:2,expectedNonNull:4,returnedNonNull:4,correctNull:1,reviewedFields:6});
  assert.equal(row.documentExact,false);
  assert.equal(row.falseGreen,true);
  const summary=summarizeDocuments([row]);
  assert.equal(summary.fieldPrecision,.5);
  assert.equal(summary.fieldRecall,.5);
  assert.equal(summary.documentCoverage,0);
  assert.equal(summary.falseGreenCount,1);
  assert.equal(summary.greenWrongValueCount,1);
  assert.equal(summary.greenIncompleteCount,0);
  assert.equal(summary.greenUnsafeDecisionCount,0);
  assert.equal(summary.falseGreenRate,1);
  assert.equal(summary.falseGreenAmongGreen,1);
  assert.equal(summary.manualReviewRate,0);
  assert.equal(summary.averageTimeMs,12);
});

test('field accuracy and decision accuracy remain separate for unsafe exact documents',()=>{
  const rows=[
    evaluateDocument({id:'safe',family:'normal',expected:{id:'0007'},actual:{id:'0007'},level:'green',requireReview:false,durationMs:5}),
    evaluateDocument({id:'unsafe',family:'conflict',expected:{id:'0008'},actual:{id:'0008'},level:'green',requireReview:true,durationMs:15}),
    evaluateDocument({id:'held',family:'conflict',expected:{id:null},actual:{id:null},level:'yellow',requireReview:true,durationMs:10}),
    evaluateDocument({id:'overheld',family:'normal',expected:{id:'0009'},actual:{id:'0009'},level:'yellow',requireReview:false,durationMs:10}),
  ];
  const summary=summarizeDocuments(rows);
  assert.equal(summary.fieldPrecision,1);
  assert.equal(summary.fieldRecall,1);
  assert.equal(summary.documentCoverage,1);
  assert.equal(summary.greenCoverage,.5);
  assert.equal(summary.correctGreenCoverage,.25);
  assert.equal(summary.falseGreenCount,1);
  assert.equal(summary.greenWrongValueCount,0);
  assert.equal(summary.greenIncompleteCount,0);
  assert.equal(summary.greenUnsafeDecisionCount,1);
  assert.equal(summary.falseGreenRate,.25);
  assert.equal(summary.falseGreenAmongGreen,.5);
  assert.equal(summary.manualReviewRate,.5);
  assert.equal(summary.unnecessaryReviewCount,1);
  assert.equal(summary.averageTimeMs,10);
  assert.equal(summary.byFamily.conflict.falseGreenCount,1);
  assert.deepEqual(summary.byField.id.counts,{tp:3,fp:0,fn:0,expectedNonNull:3,returnedNonNull:3,correctNull:1,reviewedFields:4});
});

test('leading zeroes, null denominators and empty runs are not converted to perfect precision',()=>{
  const wrong=evaluateDocument({id:'zero',family:'identifiers',expected:{id:'0007'},actual:{id:'7'},level:'red',requireReview:false,durationMs:0});
  assert.deepEqual(wrong.counts,{tp:0,fp:1,fn:1,expectedNonNull:1,returnedNonNull:1,correctNull:0,reviewedFields:1});
  const absent=summarizeDocuments([evaluateDocument({id:'empty',family:'missing',expected:{id:null},actual:{id:null},level:'red',requireReview:true,durationMs:0})]);
  assert.equal(absent.fieldPrecision,null);
  assert.equal(absent.fieldRecall,null);
  const empty=summarizeDocuments([]);
  assert.equal(empty.fieldPrecision,null);
  assert.equal(empty.fieldRecall,null);
  assert.equal(empty.documentCoverage,null);
  assert.equal(empty.averageTimeMs,null);
});

test('detail projection grades missing baseline details and extra returned row cells',()=>{
  const gold={fields:{invoice_number:'0007'},details:{supplier:{name:'Demo AB'},vat_rates:[6,25],line_items:[{description:'A',quantity:2,unit_price_cents:100,net_cents:200,vat_rate:25,vat_cents:50,total_cents:250}]}};
  const baseline=projectReviewedFields({fields:{invoice_number:{value:'0007'}}},gold);
  const baselineScore=evaluateDocument({id:'old',family:'rows',...baseline,level:'green',requireReview:false,durationMs:1});
  assert.equal(baselineScore.counts.tp,1);
  assert.equal(baselineScore.counts.fn,10);
  assert.equal(baselineScore.falseGreen,true);
  assert.equal(summarizeDocuments([baselineScore]).greenIncompleteCount,1);
  assert.equal(summarizeDocuments([baselineScore]).byFieldGroup.scalar.falseGreenCount,0);
  const prediction={fields:{invoice_number:{value:'0007'}},details:{supplier:{name:'Demo AB'},vat_rates:[25,6],line_items:[{description:'A',quantity:2,unit_price_cents:100,net_cents:200,vat_rate:25,vat_cents:50,total_cents:250},{description:'ghost',quantity:1,unit_price_cents:null,net_cents:null,vat_rate:null,vat_cents:null,total_cents:null}]}};
  const score=evaluateDocument({id:'extra',family:'rows',...projectReviewedFields(prediction,gold),level:'yellow',requireReview:false,durationMs:1});
  // Extra description + quantity and wrong row count: 3 FP. Wrong count: 1 FN.
  assert.equal(score.counts.tp,10);
  assert.equal(score.counts.fp,3);
  assert.equal(score.counts.fn,1);
  assert.equal(score.documentExact,false);
});

test('processing errors stay in the denominator and cannot become exact empty documents',()=>{
  const row=evaluateDocument({id:'failed',family:'unreadable',expected:{id:null},actual:{id:null},level:'red',requireReview:true,durationMs:2,error:'worker-error'});
  assert.equal(row.documentExact,false);
  assert.equal(summarizeDocuments([row]).errorCount,1);
  assert.equal(summarizeDocuments([row]).documentCoverage,0);
});
