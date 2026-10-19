import test from 'node:test';
import assert from 'node:assert/strict';
import {browserDefaults} from '../services/browser_publication_contract';
import {createBrowserRecoveryResumePort} from '../services/browser_recovery_resume_repository';
test('Prisma resume repository never registers an executor by default',()=>{
    const port=createBrowserRecoveryResumePort(browserDefaults);
    assert.equal(port.executorFence,undefined);
    assert.equal(typeof port.transaction,'function');
});
