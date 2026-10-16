import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

test('Telegram video release/send is publisher-only; rebind is Art-only and all actors are principal-bound',()=>{
    for (const name of ['ba_release_telegram_video_task1103','ba_publish_telegram_video_task1103']) {
        assert.equal(isToolAllowedForProfile('publisher',name),true);
        for (const role of ['writer','editor','art_director','planner'] as const) assert.equal(isToolAllowedForProfile(role,name),false);
    }
    const name='ba_rebind_telegram_video_task1103_asset';
    assert.equal(isToolAllowedForProfile('art_director',name),true);
    for (const role of ['writer','editor','publisher','planner'] as const) assert.equal(isToolAllowedForProfile(role,name),false);
    const principal={userId:2,actorId:'user:2',projectId:10,profile:'art_director' as const};
    const req={jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{projectId:10,actorId:'user:999'}}};
    const scoped=scopeRemoteMcpRequest(req,principal);
    assert.equal(scoped.allowed,true);assert.equal(scoped.body.params.arguments.actorId,'user:2');
    assert.equal(scopeRemoteMcpRequest({...req,params:{...req.params,arguments:{projectId:7}}},principal).allowed,false);
});
