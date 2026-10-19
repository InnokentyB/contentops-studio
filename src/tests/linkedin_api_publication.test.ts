import test from 'node:test';
import assert from 'node:assert/strict';
import {GenericLinkedInApiService} from '../services/linkedin_api_publication.service';
const scope={projectId:91001,taskId:91002,actorId:'user:91003',expectedManifestChecksum:'sha256:'+'a'.repeat(64)};
test('default disabled governed API refuses public send before any database or provider operation',async()=>{
 const service=new GenericLinkedInApiService();
 await assert.rejects(service.publish({...scope,releaseIdempotencyKey:'synthetic-release',idempotencyKey:'synthetic-send'}),/LINKEDIN_API_DISABLED/);
});
test('malformed scope cannot reach governed release or reconcile',async()=>{
 const service=new GenericLinkedInApiService();
 await assert.rejects(service.reconcile({...scope,projectId:-1,attemptId:91004}));
 await assert.rejects(service.release({...scope,idempotencyKey:'bad'}));
});
