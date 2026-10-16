const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(x).digest('hex');
const cover=Buffer.from('synthetic approved cover');
const accountId='6a8029aba055ec36033bf81c';
function fixture(){
 const body='Primary paragraph\nSecond paragraph'; const title='Exact synthetic title';
 const claim={attemptId:9,key:'native-test',package:{projectId:10,taskId:1002,channelId:116,revision:3,decisionId:300,decisionVersion:2,selectedAssetId:151,releaseId:3126,accountId,body,title,bodySha256:sha(body),assetSha256:sha(cover),schedule:'2026-10-13T11:30:00.000Z',manifest:'a'.repeat(64),assetUrl:'https://storage.supabase.co/cover.png',digest:'b'.repeat(64)}};
 const objectId='synthetic1002';const url='https://dzen.ru/a/'+objectId;
 const row={id:objectId,publisherId:accountId,title,isPublished:true,status:'published',publishTime:Date.parse('2026-10-16T11:00:00.000Z'),commonUrl:url};
 const evidence={schemaVersion:'studio-v3-editor-v2',submit:{id:objectId,publisherId:accountId},studio:row,primary:{objectId,accountId,title,body,cover:{objectId,imageId:'cover123',url:`https://avatars.dzeninfra.ru/get-zen_doc/123/pub_${objectId}_cover123/orig`}},coverBytes:cover,observedAt:'2026-10-16T11:01:00.000Z'};
 return {claim,evidence};
}
module.exports={fixture};
