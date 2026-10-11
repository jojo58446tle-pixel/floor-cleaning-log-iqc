import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { optimizeImage } from '../netlify/lib/image.ts';
test('mobile EXIF orientation is applied before resize; full and thumbnail are WebP without EXIF',async()=>{
 const input=await sharp({create:{width:3200,height:2400,channels:3,background:'#567b98'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const result=await optimizeImage(input),full=await sharp(result.full).metadata(),thumb=await sharp(result.thumb).metadata();
 assert.equal(full.format,'webp');assert.equal(full.width,1440);assert.equal(full.height,1920);assert.equal(thumb.width,300);assert.equal(thumb.height,400);assert.equal(thumb.format,'webp');assert.equal(full.exif,undefined);assert.equal(full.orientation,undefined);
});
test('small photos are not enlarged or padded to meet file-size targets',async()=>{const input=await sharp({create:{width:300,height:200,channels:3,background:'#ffffff'}}).png().toBuffer();const result=await optimizeImage(input);assert.equal(result.width,300);assert.equal(result.height,200);assert.ok(result.full.length<300*1024);});
test('non-photo files are rejected',async()=>{await assert.rejects(()=>optimizeImage(Buffer.from('<script>bad</script>')));});
