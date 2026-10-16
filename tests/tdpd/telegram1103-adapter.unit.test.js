const test=require('node:test');const assert=require('node:assert/strict');const bigInt=require('big-integer');
const {Api}=require('telegram');const {CustomFile}=require('telegram/client/uploads');
const {sendVideo1103}=require('../../dist/services/telegram1103/adapter');
const clientService=require('../../dist/services/telegram_client.service').default;
const {TG1103}=require('../../dist/services/telegram1103/contract');
test('native MP4 adapter sends exactly one file, then verifies caption, channel, video type, size and identity',async()=>{
    const original={init:clientService.init,getClient:clientService.getClient};let sends=0,reads=0;
    const channel=new Api.Channel({id:bigInt(1),title:'Owned',username:'analystcraft',photo:new Api.ChatPhotoEmpty(),date:1});
    const attribute=new Api.DocumentAttributeVideo({duration:42,w:1080,h:1920,supportsStreaming:true});
    const document=new Api.Document({id:bigInt(2),accessHash:bigInt(3),fileReference:Buffer.alloc(0),date:1,
        mimeType:'video/mp4',size:bigInt(TG1103.bytes),dcId:1,attributes:[attribute]});
    const readback={id:777,message:'Exact caption',peerId:new Api.PeerChannel({channelId:bigInt(1)}),media:new Api.MessageMediaDocument({document})};
    const file=new CustomFile('original.mp4',1,'',Buffer.from('x'));
    const args={target:'@analystcraft',caption:'Exact caption',file,metadata:{width:1080,height:1920,duration:42},idempotencyKey:'one'};
    clientService.init=async()=>true;clientService.getClient=async()=>({getEntity:async()=>channel,
        sendFile:async(entity,payload)=>{sends++;assert.equal(entity,channel);assert.equal(payload.file,file);
            assert.equal(payload.forceDocument,false);assert.equal(payload.parseMode,null);
            assert.equal(payload.supportsStreaming,true);assert.equal(payload.attributes[0].w,1080);return{id:777};},
        getMessages:async()=>{reads++;return[readback];}});
    try{
        assert.equal((await sendVideo1103(args)).publicUrl,'https://t.me/analystcraft/777');
        assert.equal(sends,1);assert.equal(reads,1);
        document.mimeType='image/jpeg';await assert.rejects(sendVideo1103(args),/READBACK_MISMATCH/);assert.equal(sends,2);
        channel.username='foreign';await assert.rejects(sendVideo1103(args),/TARGET_MISMATCH/);assert.equal(sends,2);
    }finally{clientService.init=original.init;clientService.getClient=original.getClient;}
});
