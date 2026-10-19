// Deliberately invalid offline peer. Production registry never names this executable.
process.once('message',message=>{const {invocation:i}=message;process.send({kind:'result',nonce:i.nonce,result:{complete:true,absent:true,accountId:i.package.accountId,packageDigest:i.package.digest,checkedAt:new Date().toISOString()}});});
process.on('disconnect',()=>process.exit(0));
