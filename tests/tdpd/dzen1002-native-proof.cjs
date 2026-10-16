require('ts-node/register/transpile-only');
const test=require('node:test');const assert=require('node:assert/strict');
const {fixture}=require('../fixtures/dzen1002-native.cjs');
const {verifyDzen1002NativeProof}=require('../../src/services/puppeteer/dzen1002_publisher_proof.ts');
test('R08 exact native object/account primary body and cover produce strict receipt',()=>{
 const {claim,evidence}=fixture(); const result=verifyDzen1002NativeProof(claim,evidence);
 assert.equal(result.schemaVersion,'dzen1002-native-v1');assert.equal(result.objectId,evidence.studio.id);assert.equal(result.packageDigest,claim.package.digest);
 assert.deepEqual(Object.keys(result).sort(),['schemaVersion','attemptId','key','packageDigest','accountId','objectId','url','publishedAt','observedAt','bodySha256','assetSha256','title'].sort());
});
test('R08 only CRLF and NBSP body normalization is accepted',()=>{const {claim,evidence}=fixture();evidence.primary.body='Primary\u00a0paragraph\r\nSecond paragraph';assert.ok(verifyDzen1002NativeProof(claim,evidence));});
const invalid={
 'recommendation match does not prove primary body':e=>{e.recommendations=e.primary.body;e.primary.body='Unrelated';},
 'extra primary text':e=>{e.primary.body+='\nextra';},'missing primary text':e=>{e.primary.body='Primary paragraph';},
 'collapsed whitespace':e=>{e.primary.body=e.primary.body.replace('\n',' ');},'missing body':e=>{delete e.primary.body;},
 'wrong account':e=>{e.primary.accountId='foreign';},'wrong studio account':e=>{e.studio.publisherId='foreign';},
 'wrong submit account':e=>{e.submit.publisherId='foreign';},'wrong submit object':e=>{e.submit.id='other';},
 'wrong primary object':e=>{e.primary.objectId='other';},'wrong title':e=>{e.primary.title+='extra';},
 'wrong URL object':e=>{e.studio.commonUrl='https://dzen.ru/a/other';},'URL credentials':e=>{e.studio.commonUrl='https://secret@dzen.ru/a/synthetic1002';},
 'missing time':e=>{delete e.studio.publishTime;},'future time':e=>{e.studio.publishTime=Date.parse(e.observedAt)+1;},
 'unpublished state':e=>{e.studio.isPublished=false;},'missing cover':e=>{delete e.primary.cover;},
 'foreign object cover':e=>{e.primary.cover.objectId='other';},'transformed cover':e=>{e.primary.cover.url=e.primary.cover.url.replace('/orig','/scale_1200');},
 'wrong cover bytes':e=>{e.coverBytes=Buffer.from('different');},'empty cover bytes':e=>{e.coverBytes=Buffer.alloc(0);},
 'unsupported shape':e=>{e.schemaVersion='future';},'missing primary':e=>{delete e.primary;},
 'arbitrary payload URL':e=>{e.payload={url:e.studio.commonUrl};delete e.submit;}
};
for(const [name,mutate]of Object.entries(invalid))test('R08 rejects '+name,()=>{const {claim,evidence}=fixture();mutate(evidence);assert.throws(()=>verifyDzen1002NativeProof(claim,evidence),/DZEN1002_NATIVE_UNCERTAIN/);});
