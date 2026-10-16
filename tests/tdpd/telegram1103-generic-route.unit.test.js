const test=require('node:test');const assert=require('node:assert/strict');
const {TelegramTaskPublicationService}=require('../../dist/services/telegram_task_publication.service');
test('generic Telegram non-story MP4 cannot gain photo transport or provider authority',async()=>{
    const task={id:779,project_id:10,channel_id:109,type:'publication',visual_placement:'video_cover',
        content_revision:2,accepted_revision:2,text_state:'accepted',draft_text:'Synthetic video caption',
        visual_state:'APPROVED',selected_asset_id:8,status:'ready_for_execution',publication_mode:'connector_auto',
        channel:{id:109,type:'telegram',config:{telegram_channel_id:'@synthetic'}},
        selected_asset:{id:8,status:'approved',content_revision:2,file_url:'https://media.synthetic.invalid/original.mp4',
            provenance:{planner_storage:{mime_type:'video/mp4'}}}};
    let writes=0;const execute=async()=>{writes++;throw Error('provider must not be reached');};
    const db={workflowEvent:{findUnique:async()=>null},contentItem:{findFirst:async()=>task,updateMany:execute},
        deliveryAttempt:{findFirst:async()=>null},projectMember:{findFirst:async()=>({user_id:2})}};
    db.$transaction=async run=>run(db);
    const service=new TelegramTaskPublicationService({prisma:db,publisher:{publishTelegramTaskMtproto:execute},publicationFacts:{record:execute}});
    await assert.rejects(service.execute({projectId:10,taskId:779,idempotencyKey:'synthetic-video'}),/TELEGRAM_NATIVE_VIDEO_EXACT_ROUTE_REQUIRED/);
    const preview=await service.execute({projectId:10,taskId:779,dryRun:true});
    assert.equal(preview.direct_execution_supported,false);assert.equal(preview.connector_ready,false);
    assert.equal(preview.payload_preview.image_url,null);assert.equal(preview.payload_preview.video_url,task.selected_asset.file_url);
    assert.equal(writes,0);
});
