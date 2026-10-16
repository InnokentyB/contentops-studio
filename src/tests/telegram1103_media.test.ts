import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVideo1103Url, inspectVideo1103Metadata, loadVideo1103 } from '../services/telegram1103/media';

const atom = (kind: string, payload: Buffer): Buffer => {
    const h = Buffer.alloc(8); h.writeUInt32BE(payload.length + 8); h.write(kind, 4); return Buffer.concat([h, payload]);
};
test('MP4 metadata comes from the video track, not assumed portrait geometry', () => {
    const tkhd=Buffer.alloc(84);tkhd.writeUInt32BE(1080*65536,76);tkhd.writeUInt32BE(1920*65536,80);
    const mdhd=Buffer.alloc(24);mdhd.writeUInt32BE(1000,12);mdhd.writeUInt32BE(42033,16);
    const hdlr=Buffer.alloc(24);hdlr.write('vide',8);
    const buffer=atom('moov',atom('trak',Buffer.concat([atom('tkhd',tkhd),atom('mdia',Buffer.concat([atom('mdhd',mdhd),atom('hdlr',hdlr)]))])));
    assert.deepEqual(inspectVideo1103Metadata(buffer),{width:1080,height:1920,duration:42.033});
    assert.throws(()=>inspectVideo1103Metadata(Buffer.alloc(0)),/METADATA/);
    const corrupt=Buffer.from(buffer);corrupt.writeUInt32BE(0xffffffff,0);
    assert.throws(()=>inspectVideo1103Metadata(corrupt),/METADATA/);
});
test('invalid storage configuration and malformed resource URL have a bounded non-secret error',()=>{
    process.env.R2_PUBLIC_BASE_URL='malformed';
    assert.throws(()=>assertVideo1103Url('https://media.synthetic.invalid/original.mp4'),/TELEGRAM_VIDEO_STORAGE_TARGET_MISMATCH/);
    process.env.R2_PUBLIC_BASE_URL='https://media.synthetic.invalid';
    assert.throws(()=>assertVideo1103Url('malformed'),/TELEGRAM_VIDEO_STORAGE_TARGET_MISMATCH/);
});
test('video download rejects MIME mismatch, changed bytes, redirects and off-origin URLs', async()=>{
    process.env.R2_PUBLIC_BASE_URL='https://media.synthetic.invalid';
    let calls=0;
    const fetcher:typeof fetch=async (_u,init)=>{calls++;assert.equal(init?.redirect,'error');return new Response('not video',{headers:{'content-type':'image/jpeg'}});};
    await assert.rejects(loadVideo1103('https://media.synthetic.invalid/original.mp4',fetcher),/RESOURCE/);
    for(const url of ['http://media.synthetic.invalid/a.mp4','https://evil.invalid/a.mp4','https://media.synthetic.invalid/a.mp4?token=bad']) {
        await assert.rejects(loadVideo1103(url,fetcher));
    }
    assert.equal(calls,1);
    await assert.rejects(loadVideo1103('https://media.synthetic.invalid/original.mp4',async()=>new Response(Buffer.from('tiny'),{headers:{'content-type':'video/mp4'}})),/BYTES/);
});
