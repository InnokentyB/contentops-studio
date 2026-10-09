import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMediaMetricsTools } from '../mcp/tools/media_metrics_tools';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('External Radar reads article bodies and finds replies through authorized read-only Planner tools', t => {
    const server = new McpServer({ name: 'dzen-article-replies', version: '1' });
    const register = t.mock.method(server,'registerTool');
    registerMediaMetricsTools(server);
    for (const name of ['ba_dzen_read_post','ba_dzen_find_replies']) {
        const call = register.mock.calls.find(entry => entry.arguments[0] === name);
        assert.ok(call, `${name} must be available without direct browser access`);
        const config = call.arguments[1];
        assert.ok(config && typeof config === 'object');
        assert.deepEqual(Reflect.get(config, 'annotations'), {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true});
        for (const role of ['planner','strategist','owner'] as const) assert.equal(isToolAllowedForProfile(role,name),true);
        for (const role of ['writer','publisher','organization_researcher'] as const) assert.equal(isToolAllowedForProfile(role,name),false);
    }
});

import { parseDzenArticle } from '../services/puppeteer/dzen_article_reader';
import { matchDzenReplies, monitorDzenReplies } from '../services/dzen_reply_monitor';
import * as readers from '../services/puppeteer/dzen_inbound_reader';
import * as articles from '../services/puppeteer/dzen_article_reader';
import * as monitor from '../services/dzen_reply_monitor';
import engagement from '../services/dzen_engagement.service';
import prisma from '../db';

const article = {title:'Проверка результата агента',text:'Первый абзац.\n\nВторой абзац.',author:'Автор',published_at:null,
    canonical:'https://dzen.ru/a/asJAvMmQ8zlRn8CV?secdata=SECRET',body_count:1,comments_control:true,restricted:false,truncated:false,cookie:'SECRET'};
test('article returns actual paragraphs with explicit missing date; foreign canonical and empty/restricted bodies fail closed',()=>{
    const result = parseDzenArticle(article,'https://dzen.ru/a/asJAvMmQ8zlRn8CV');
    assert.equal(result.text,article.text);assert.equal(result.author_name,'Автор');assert.equal(result.complete,true);
    assert.equal(result.published_at,null);assert.equal(result.publication_date_status,'unknown');
    assert.equal(result.comment_permission,'unknown');assert.doesNotMatch(JSON.stringify(result),/SECRET|secdata|cookie/);
    assert.equal(parseDzenArticle({...article,published_at:'2026-10-09T10:00:00+01:00'},result.post_url).published_at,'2026-10-09T09:00:00.000Z');
    assert.equal(parseDzenArticle({...article,truncated:true},result.post_url).complete,false);
    for(const change of [{text:''},{body_count:2},{restricted:true}]) assert.throws(()=>parseDzenArticle({...article,...change},result.post_url),/INTERFACE_CHANGED/);
    assert.throws(()=>parseDzenArticle({...article,canonical:'https://dzen.ru/a/foreign'},result.post_url),/SCOPE_MISMATCH/);
});

const row = {id:'1',text:'Наш комментарий',author_name:'Владелец',is_connected_owner:true,created_at:'2026-10-09T10:00:00Z',parent_comment_id:null,reply_to_id:null};
const thread = {status:'observed' as const,complete:true,post_url:'https://dzen.ru/a/asJAvMmQ8zlRn8CV',comments:[row],replies:{complete:true,items:[
    {...row,id:'2',text:'Прямой ответ',is_connected_owner:false,parent_comment_id:'1',reply_to_id:'1'},
    {...row,id:'3',text:'Наш ответ',parent_comment_id:'1',reply_to_id:'2'},
    {...row,id:'4',text:'Ответ на наш ответ',is_connected_owner:false,parent_comment_id:'1',reply_to_id:'3'},
    {...row,id:'5',text:'Ответ другому читателю',is_connected_owner:false,parent_comment_id:'1',reply_to_id:'2'},
    {...row,id:'6',text:'Без точного адресата',is_connected_owner:false,parent_comment_id:'1',reply_to_id:null}
]}};
test('reply matching includes answers to our nested comments and separates other discussion messages',()=>{
    const result = matchDzenReplies(thread);
    assert.deepEqual(result.replies.map(row=>row.id),['2','4']);
    assert.deepEqual(result.conversation_activity.map(row=>row.id),['5','6']);
    assert.deepEqual(result.own_comments.map(row=>row.id),['1','3']);
    assert.equal(matchDzenReplies({...thread,complete:false}).status,'partial');
    assert.throws(()=>matchDzenReplies({status:'unknown'}),/INTERFACE_CHANGED/);
});

const replace = (t: import('node:test').TestContext,target:object,key:string,value:(...args:unknown[])=>Promise<unknown>)=>{
    const original = Reflect.get(target,key);Object.defineProperty(target,key,{value,configurable:true,writable:true});
    t.after(()=>Object.defineProperty(target,key,{value:original,configurable:true,writable:true}));
};
test('project authorization precedes article/provider/database reads; errors never expose secrets',async t=>{
    let allowed = false, calls = 0;
    replace(t,prisma.projectMember,'findUnique',async()=>allowed ? {id:1}:null);
    replace(t,prisma.socialChannel,'findFirst',async()=>({type:'dzen',config:{channel_id:'owned',cookies:'SYNTHETIC=SECRET'}}));
    replace(t,prisma.contentItem,'findMany',async()=>[]);
    replace(t,prisma.projectSettings,'findMany',async()=>[]);
    t.mock.method(articles,'readDzenArticle',async()=>{calls++;throw Error('DZEN_ARTICLE_INTERFACE_CHANGED SECRET');});
    t.mock.method(monitor,'monitorDzenReplies',async()=>{calls++;throw Error('DZEN_AUTH_REQUIRED SECRET');});
    const args = {projectId:10,channelId:116,actorId:'user:1'};
    await assert.rejects(engagement.readPost({...args,postUrl:thread.post_url}),/Access denied/);
    await assert.rejects(engagement.findReplies(args),/Access denied/);assert.equal(calls,0);
    allowed = true;
    for(const result of [await engagement.readPost({...args,postUrl:thread.post_url}),await engagement.findReplies(args)]) {
        assert.equal(result.status,'unknown');assert.doesNotMatch(JSON.stringify(result),/SECRET/);
    }
    assert.equal(calls,2);
});

test('reply target discovery uses only current project/channel records and includes explicit legacy threads',async t=>{
    replace(t,prisma.projectMember,'findUnique',async()=>({id:1}));
    replace(t,prisma.socialChannel,'findFirst',async()=>({type:'dzen',config:{channel_id:'owned',cookies:'SYNTHETIC=SECRET'}}));
    replace(t,prisma.contentItem,'findMany',async(...args)=>{
        const input=args[0];assert.ok(input && typeof input==='object');
        assert.deepEqual(Reflect.get(input,'where'),{project_id:10,channel_id:116,published_link:{not:null}});
        return [{published_link:thread.post_url}];
    });
    replace(t,prisma.projectSettings,'findMany',async(...args)=>{
        const input=args[0];assert.ok(input && typeof input==='object');assert.deepEqual(Reflect.get(input,'where'),{project_id:10,key:{startsWith:'dzen_comment:'}});
        return [{value:JSON.stringify({channel_id:116,status:'published',url:'https://dzen.ru/a/own'})},
            {value:JSON.stringify({channel_id:117,status:'published',url:'https://dzen.ru/a/foreign'})},{value:'invalid'},{value:JSON.stringify({status:'published',url:'https://dzen.ru/a/legacy-unbound'})}];
    });
    t.mock.method(monitor,'monitorDzenReplies',async(_config:Parameters<typeof monitorDzenReplies>[0],options:Parameters<typeof monitorDzenReplies>[1])=>{
        assert.deepEqual(options.knownThreadUrls,['https://dzen.ru/a/explicit','https://dzen.ru/a/own',thread.post_url]);
        return {status:'observed',complete:false};
    });
    const result = await engagement.findReplies({projectId:10,channelId:116,actorId:'user:1',knownThreadUrls:['https://dzen.ru/a/explicit']});
    assert.equal(result.status,'observed');assert.doesNotMatch(JSON.stringify(result),/foreign|legacy-unbound/);
});

test('bounded monitoring preserves unknown and unloaded threads instead of returning a false zero',async t=>{
    t.mock.method(readers,'readDzenInbound',async()=>({status:'observed',comments:{status:'observed',items:[{...row,kind:'comment',post_url:thread.post_url,is_connected_owner:false},{...row,id:'owned-answer',kind:'reply'}],pagination:{exhausted:true}},activity:{events:[],unread_observation:{unchanged:true}}}));
    let unknown = false;
    t.mock.method(readers,'readDzenThread',async()=>{if(unknown) throw Error('DZEN_AUTH_REQUIRED SECRET');return thread;});
    const config = {channel_id:'owned',cookies:'SYNTHETIC=SECRET'};
    const options = {knownThreadUrls:[thread.post_url],maxThreads:1};
    const full = await monitorDzenReplies(config,options);
    assert.equal(full.replies_to_our_comments.count,2);assert.equal(full.owned_publication_responses.count,1);assert.equal(full.complete,false);
    const filtered = await monitorDzenReplies(config,{...options,since:'2026-10-09T11:00:00Z'});
    assert.equal(filtered.replies_to_our_comments.count,0);
    const bounded = await monitorDzenReplies(config,{...options,knownThreadUrls:[thread.post_url,'https://dzen.ru/a/unscanned']});
    assert.equal(bounded.replies_to_our_comments.count,null);assert.deepEqual(bounded.unscanned_thread_urls,['https://dzen.ru/a/unscanned']);
    unknown = true;
    const failed = await monitorDzenReplies(config,options);
    assert.equal(failed.replies_to_our_comments.count,null);assert.equal(failed.threads[0].status,'unknown');assert.doesNotMatch(JSON.stringify(failed),/SECRET/);
    const noTargets = await monitorDzenReplies(config,{knownThreadUrls:[]});assert.equal(noTargets.replies_to_our_comments.count,null);
});
