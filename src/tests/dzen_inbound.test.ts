import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMediaMetricsTools } from '../mcp/tools/media_metrics_tools';
import { isToolAllowedForProfile } from '../mcp/capabilities';

test('Radar operator can read native inbound activity and exact public threads through scoped read-only tools', t => {
    const server = new McpServer({ name: 'dzen-inbound-test', version: '1' });
    const register = t.mock.method(server, 'registerTool');
    registerMediaMetricsTools(server);
    for (const name of ['ba_dzen_read_inbound', 'ba_dzen_read_thread']) {
        const call = register.mock.calls.find(entry => entry.arguments[0] === name);
        assert.ok(call, `${name} must expose actual native reads to Radar`);
        const config = call.arguments[1];
        assert.ok(config && typeof config === 'object');
        assert.deepEqual(Reflect.get(config, 'annotations'), { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
        for (const role of ['planner','strategist','owner'] as const) assert.equal(isToolAllowedForProfile(role, name), true);
        for (const role of ['writer','publisher','organization_researcher'] as const) assert.equal(isToolAllowedForProfile(role, name), false);
    }
});

import { parseDzenStudioComments, parseDzenActivity, parseDzenPublicThread } from '../services/dzen_inbound_contract';
import { dzenReadonlyRequest, dzenReadUrl } from '../services/puppeteer/dzen_readonly_browser';
import prisma from '../db';
import engagement from '../services/dzen_engagement.service';
import * as reader from '../services/puppeteer/dzen_inbound_reader';

const at = Date.parse('2026-10-08T12:00:00Z');
const commentsPayload = { status: 'ok', comments: [
    { id: 100, publisherId: 'owned', documentId: 'document', createdTs: at, authorUid: 2, text: 'Вопрос', rootId: 0, replyToId: 0 },
    { id: 101, publisherId: 'owned', documentId: 'document', createdTs: at + 1000, authorUid: 1, text: 'Ответ владельца', rootId: 100, replyToId: 100 }
], counters: [{ id: 100, childrenCount: 1 }], users: [{ uid: 1, displayName: 'Owner' },{ uid: 2, displayName: 'Reader' }],
    documentsPreviewInfos: [{ documentId: 'document', url: 'https://dzen.ru/a/owned?secdata=PRIVATE', title: 'Publication' }],
    csrfToken: 'SECRET', cookies: 'SECRET' };

test('Studio bodies preserve native timestamps and reply relationships; secret fields and URL tracking are excluded', () => {
    const rows = parseDzenStudioComments(commentsPayload,'owned','1');
    assert.equal(rows[0].kind,'comment');
    assert.equal(rows[1].kind,'reply');
    assert.equal(rows[1].parent_comment_id,'100');
    assert.equal(rows[1].reply_to_id,'100');
    assert.equal(rows[1].is_connected_owner,true);
    assert.equal(rows[0].created_at,'2026-10-08T12:00:00.000Z');
    assert.equal(rows[0].post_url,'https://dzen.ru/a/owned');
    assert.doesNotMatch(JSON.stringify(rows), /SECRET|PRIVATE|csrf|secdata/);
    assert.throws(() => parseDzenStudioComments(commentsPayload,'other','1'), /SCOPE_MISMATCH/);
    for (const invalid of [{status:'error',comments:[]}, {}, null, { ...commentsPayload, comments: [{ ...commentsPayload.comments[0], createdTs: 0 }] }]) {
        assert.throws(() => parseDzenStudioComments(invalid,'owned','1'), /INTERFACE_CHANGED/);
    }
});

test('native empty Studio response is an observed bounded zero; missing comments never becomes zero', () => {
    assert.deepEqual(parseDzenStudioComments({ ...commentsPayload, comments: [] },'owned','1'),[]);
    assert.throws(() => parseDzenStudioComments({ ...commentsPayload, comments: undefined },'owned','1'), /INTERFACE_CHANGED/);
});

const event = { id: 'event', recipientUid: '1', notificationType: 'comment_like', publisherId: 'external',
    targetUrl: 'https://dzen.ru/a/external?token=PRIVATE', targetDescription: 'Your comment', lastActionTs: at,
    parentCommentId: '100', lastActors: [{ name: 'Reader', action: 'like', secret: 'SECRET' }], csrfToken: 'SECRET' };

test('Activity is limited to owned publications and exact requested threads, with recipient identity verified', () => {
    const payload = { notifications: [event,{ ...event, id:'owned-event', publisherId:'owned', targetUrl:'https://dzen.ru/a/owned' }],take:25,skip:0,csrfToken:'SECRET' };
    const scoped = parseDzenActivity(payload,'owned','1',[]);
    assert.equal(scoped.events.length,1);
    assert.equal(scoped.excluded_unrelated_count,1);
    const monitored = parseDzenActivity(payload,'owned','1',['https://dzen.ru/a/external']);
    assert.equal(monitored.events.length,2);
    assert.equal(monitored.events[0].parent_comment_id,'100');
    assert.doesNotMatch(JSON.stringify(monitored),/SECRET|PRIVATE|csrf|token=/);
    assert.throws(() => parseDzenActivity(payload,'owned','2',[]), /SCOPE_MISMATCH/);
    assert.throws(() => parseDzenActivity({notifications:null},'owned','1',[]), /INTERFACE_CHANGED/);
});

test('native reads reject every write and prevent default-sorting mutation hidden in GET', () => {
    for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal(dzenReadonlyRequest(method,'https://dzen.ru/api/bell/notifications/seen-until'),null);
    assert.equal(dzenReadonlyRequest('GET','https://dzen.ru/api/bell/notifications/seen-until'),null);
    for (const unsafe of ['http://dzen.ru/api/test','https://localhost/api/test','https://127.0.0.1/api/test','https://dzen.ru.attacker.test/api/test','https://user:SECRET@dzen.ru/api/test']) assert.equal(dzenReadonlyRequest('GET',unsafe),null);
    const root = dzenReadonlyRequest('GET','https://dzen.ru/api/comments/v2/root-comments?updateDefaultSorting=true');
    assert.ok(root);
    assert.equal(new URL(root).searchParams.get('updateDefaultSorting'),'false');
    assert.equal(dzenReadUrl('https://dzen.ru/a/abc?token=PRIVATE#comment'),'https://dzen.ru/a/abc');
    assert.throws(() => dzenReadUrl('https://user:SECRET@dzen.ru/a/abc'));
});

test('public thread reads actual bodies; native child count does not fabricate loaded reply bodies', () => {
    const payload = { status:'ok',meta:{rootCommentsCount:1,childCommentsCount:2,totalCommentsCount:3,commentsVisibility:'visible',appliedSorting:'top'},
        items:[{entity:'comment',entityData:{id:100,documentId:'document',createdTs:at,authorUid:1,text:'Actual public comment'}}],
        usersById:{'1':{displayName:'Owner'}},metaByCommentId:{'100':{childrenCount:2}},csrfToken:'SECRET' };
    const parsed = parseDzenPublicThread(payload,'document','1');
    assert.equal(parsed.comments[0].text,'Actual public comment');
    assert.equal(parsed.replies.status,'partial');
    assert.equal(parsed.replies.count,0);
    assert.equal(parsed.replies.complete,false);
    assert.equal(parsed.complete,false);
    assert.doesNotMatch(JSON.stringify(parsed), /SECRET|csrf/);
    assert.throws(() => parseDzenPublicThread(payload,'foreign','1'), /SCOPE_MISMATCH/);
    const empty = parseDzenPublicThread({ ...payload, items:[],meta:{...payload.meta,rootCommentsCount:0,childCommentsCount:0,totalCommentsCount:0}},'document','1');
    assert.equal(empty.replies.count,0);
    assert.equal(empty.complete,true);
    const hidden = parseDzenPublicThread({...payload,meta:{...payload.meta,commentsVisibility:'hidden'}},'document','1');
    assert.equal(hidden.replies.status,'unknown');
    assert.equal(hidden.replies.count,null);
    assert.equal(hidden.complete,false);
});

test('authorization is checked before any provider read; provider failure remains UNKNOWN with sanitized evidence', async t => {
    let allowed = false;
    const replace = (target: object, key: string, value: (...args: unknown[]) => Promise<unknown>) => {
        const original = Reflect.get(target,key);
        Object.defineProperty(target,key,{value,configurable:true,writable:true});
        t.after(() => Object.defineProperty(target,key,{value:original,configurable:true,writable:true}));
    };
    replace(prisma.projectMember,'findUnique',async () => allowed ? {id:1} : null);
    replace(prisma.socialChannel,'findFirst',async (...args) => {
        assert.deepEqual(args[0],{where:{id:116,project_id:10,is_active:true},select:{type:true,config:true}});
        return {type:'dzen',config:{channel_id:'owned',cookies:'TEST_ONLY=SECRET'}};
    });
    let calls = 0;
    t.mock.method(reader,'readDzenInbound',async () => { calls++; throw new Error('DZEN_INBOUND_INTERFACE_CHANGED cookie=SECRET'); });
    t.mock.method(reader,'readDzenThread',async () => { calls++; throw new Error('DZEN_AUTH_REQUIRED SECRET'); });
    const scope = { projectId:10,channelId:116,actorId:'user:1' };
    await assert.rejects(engagement.readInbound(scope),/Access denied/);
    await assert.rejects(engagement.readThread({...scope,postUrl:'https://dzen.ru/a/test'}),/Access denied/);
    assert.equal(calls,0);
    allowed = true;
    for (const result of [await engagement.readInbound(scope),await engagement.readThread({...scope,postUrl:'https://dzen.ru/a/test'})]) {
        assert.equal(result.status,'unknown');
        assert.equal(result.count,null);
        assert.doesNotMatch(JSON.stringify(result), /SECRET|cookie=/);
    }
    assert.equal(calls,2);
});

import { parseDzenChildThread } from '../services/dzen_inbound_contract';

test('native child reply bodies preserve both root and direct reply IDs and reject a foreign thread', () => {
    const payload = { status:'ok',meta:{rootCommentsCount:1,childCommentsCount:1,totalCommentsCount:2,commentsVisibility:'visible',appliedSorting:'top'},
        items:[{entity:'comment',entityData:{id:101,documentId:'document',createdTs:at,authorUid:2,text:'Actual reply',rootCommentId:100,replyToCommentId:100}}],
        usersById:{'2':{displayName:'Reader'}},metaByCommentId:{'101':{childrenCount:0}},csrfToken:'SECRET' };
    const replies = parseDzenChildThread(payload,'document','1','100');
    assert.equal(replies[0].text,'Actual reply');
    assert.equal(replies[0].parent_comment_id,'100');
    assert.equal(replies[0].reply_to_id,'100');
    assert.throws(() => parseDzenChildThread(payload,'document','1','999'), /SCOPE_MISMATCH/);
    assert.doesNotMatch(JSON.stringify(replies), /SECRET|csrf/);
});

import puppeteer from 'puppeteer';
import { withDzenReadonlyPage } from '../services/puppeteer/dzen_readonly_browser';

test('operator native inbound scan reads bounded pages, returns real replies/events, blocks writes and closes the browser', async t => {
    const paths: string[] = [];
    let closed = 0, aborted = 0, continued = 0, commentPages = 0;
    type Request = { method(): string; url(): string; abort(): Promise<void>; continue(options: {url:string}): Promise<void> };
    let intercept: ((request: Request) => void) | undefined;
    const page = {
        setRequestInterception: async () => {}, on: (_event: string, handler: (request: Request) => void) => { intercept = handler; },
        setUserAgent: async () => {}, setCookie: async () => {}, goto: async () => {},
        url: () => 'https://dzen.ru/profile/editor/id/owned/comments/',
        waitForRequest: async () => ({headers: () => ({'x-csrf-token':'SYNTHETIC_CSRF','x-fp-token':'SYNTHETIC_FP'})}),
        evaluate: async (_fn: unknown,input?: {url:string;headers:Record<string,string>}) => {
            if (!input) return 'Комментарии';
            const url = new URL(input.url);
            paths.push(url.pathname);
            assert.ok(dzenReadonlyRequest('GET',input.url));
            if (url.pathname.endsWith('/latest_by_child')) assert.equal(input.headers['x-csrf-token'],'SYNTHETIC_CSRF');
            let payload: unknown;
            if (url.pathname === '/editor-api/v3/publishers/owned') payload = { publisher:{id:'owned',ownerUid:1},accessData:{canRead:true} };
            else if (url.pathname === '/api/bell/notifications/count') payload = {userId:'1',count:3,since:at};
            else if (url.pathname.endsWith('/latest_by_child')) {
                commentPages++;
                if (commentPages === 2) assert.equal(url.searchParams.get('commentIdAfter'),'100');
                payload = commentPages === 1 ? commentsPayload : {...commentsPayload,comments:[]};
            } else if (url.pathname === '/api/bell/notifications') payload = {notifications:[event],take:25,skip:0};
            else throw Error('Unexpected read endpoint');
            return {status:200,payload};
        }
    };
    t.mock.method(puppeteer,'launch',async () => ({ newPage:async () => page, close:async () => {closed++;} }));
    const result = await reader.readDzenInbound({channel_id:'owned',cookies:'test_only=synthetic'}, {maxPages:2,knownThreadUrls:['https://dzen.ru/a/external']});
    assert.equal(result.comments.count,1);
    assert.equal(result.replies.count,1);
    assert.equal(result.comments.pagination.exhausted,true);
    assert.equal(result.activity.events[0].parent_comment_id,'100');
    assert.equal(result.activity.unread_observation.unchanged,true);
    assert.equal(result.provenance.read_state_write_dispatched,false);
    assert.equal(closed,1);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_CSRF|SYNTHETIC_FP/);
    assert.ok(intercept);
    intercept({method:()=> 'POST',url:()=> 'https://dzen.ru/api/bell/notifications/seen-until',abort:async () => {aborted++;},continue:async () => {continued++;}});
    assert.equal(aborted,1);
    assert.equal(continued,0);
    assert.equal(paths.filter(path => path === '/api/bell/notifications/count').length,2);
});

test('reader browser closes when page creation or native identity verification fails', async t => {
    let closed = 0;
    t.mock.method(puppeteer,'launch',async () => ({ newPage:async () => {throw Error('Synthetic page failure');}, close:async () => {closed++;} }));
    await assert.rejects(withDzenReadonlyPage({channel_id:'owned',cookies:'test_only=synthetic'},async () => true), /Synthetic page failure/);
    assert.equal(closed,1);
});
