import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import sharp from 'sharp';
import api from '../netlify/functions/api.mts';
import { reset,stores,failNextDelete } from './memory-blobs.mjs';
const secret='test-session-secret-'.repeat(3),salt='unit-tests',password='test-password';
const authEnv={CLEANING_SESSION_SECRET:secret,CLEANING_ADMIN_PASSWORD_HASH:salt+':'+scryptSync(password,salt,64).toString('hex')};
globalThis.Netlify={env:{get:key=>authEnv[key]||''}};
const production={deploy:{context:'production'}};
let cookie='',csrf='';
const fields={date:'2026-10-07',area:'IQC Lab Floor',activityType:'Floor Cleaning',startTime:'09:30',endTime:'10:20',note:'Integration fixture — not a real cleaning record'};
async function call(path,method='GET',body,admin=false,context=production){const headers={origin:'https://cleaning.example'};if(admin){headers.cookie=cookie;headers['x-csrf-token']=csrf;}if(body&&!(body instanceof Buffer))headers['content-type']='application/json';const response=await api(new Request('https://cleaning.example/api/'+path,{method,headers,body:body instanceof Buffer?body:body?JSON.stringify(body):undefined}),context);return response;}
async function login(){const res=await call('auth/login','POST',{password});assert.equal(res.status,200);cookie=res.headers.get('set-cookie');csrf=(await res.json()).csrf;}
test('Public cannot add, edit, delete, upload or manage areas directly',async()=>{reset();for(const [path,method] of [['records','POST'],['record?date=2026-10-07&id=00000000-0000-0000-0000-000000000000','PUT'],['record?date=2026-10-07&id=00000000-0000-0000-0000-000000000000','DELETE'],['upload?date=2026-10-07&id=00000000-0000-0000-0000-000000000000','POST'],['settings','PUT']])assert.equal((await call(path,method,fields)).status,401);});
test('Admin API rejects missing CSRF and wrong-origin requests',async()=>{reset();await login();const response=await api(new Request('https://cleaning.example/api/records',{method:'POST',headers:{origin:'https://cleaning.example',cookie},body:JSON.stringify(fields)}),production);assert.equal(response.status,403);const cross=await api(new Request('https://cleaning.example/api/records',{method:'POST',headers:{origin:'https://evil.example',cookie,'x-csrf-token':csrf},body:JSON.stringify(fields)}),production);assert.equal(cross.status,403);});
test('draft → actual image conversion → publication → read → edit → delete with cleanup',async()=>{
 reset();await login();const created=await call('records','POST',fields,true);assert.equal(created.status,201);let record=(await created.json()).record;
 const ref=new URLSearchParams({date:record.date,id:record.id}).toString();
 assert.equal((await(await call('records?month=2026-10')).json()).records.length,0);
 assert.equal((await call('record?'+ref)).status,404);
 assert.equal((await call('record?'+ref,'PUT',{...fields,updatedAt:record.updatedAt,publish:true},true)).status,400);
 const mobile=await sharp({create:{width:3200,height:2400,channels:3,background:'#556677'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 for(const group of ['before','after']){const response=await call('upload?'+ref+'&group='+group,'POST',mobile,true);assert.equal(response.status,201);record=(await response.json()).record;}
 assert.equal(record.beforeImages[0].height,1920);assert.equal(record.beforeImages[0].width,1440);
 const published=await call('record?'+ref,'PUT',{...fields,updatedAt:record.updatedAt,publish:true},true);assert.equal(published.status,200);record=(await published.json()).record;
 const month=await(await call('records?month=2026-10')).json();assert.equal(month.records.length,1);assert.equal(month.summary.photosUploaded,2);assert.equal(month.summary.cleaningDays,1);
 const full=await call('image?'+ref+'&photo='+record.afterImages[0].id+'&size=full'),thumb=await call('image?'+ref+'&photo='+record.afterImages[0].id+'&size=thumb');assert.equal(full.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).height,400);
 assert.equal((await(await call('statistics?month=2026-10')).json()).months.at(-1).totalActivities,1);
 const changed=await call('record?'+ref,'PUT',{...fields,note:'Updated fixture',updatedAt:record.updatedAt},true);assert.equal(changed.status,200);
 const stale=await call('record?'+ref,'PUT',{...fields,updatedAt:record.updatedAt},true);assert.equal(stale.status,409);
 assert.equal((await call('record?'+ref,'DELETE',undefined,true)).status,200);
 assert.equal((await call('image?'+ref+'&photo='+record.afterImages[0].id)).status,404);
 assert.equal([...stores.get('production:cleaning-log').keys()].filter(k=>k.startsWith('records/')||k.startsWith('images/')).length,0);
});
test('Preview records are isolated from production store',async()=>{reset();await login();await call('records','POST',fields,true,{deploy:{context:'deploy-preview'}});assert.equal((await(await call('records?month=2026-10','GET',undefined,true)).json()).records.length,0);assert.equal((await(await call('records?month=2026-10','GET',undefined,true,{deploy:{context:'deploy-preview'}})).json()).records.length,1);});

async function publishedFixture(){
 reset();await login();let record=(await(await call('records','POST',fields,true)).json()).record;
 const ref=new URLSearchParams({date:record.date,id:record.id}).toString();
 const photo=await sharp({create:{width:600,height:800,channels:3,background:'#789abc'}}).jpeg().toBuffer();
 for(const group of ['before','after'])record=(await(await call('upload?'+ref+'&group='+group,'POST',photo,true)).json()).record;
 record=(await(await call('record?'+ref,'PUT',{...fields,updatedAt:record.updatedAt,publish:true},true)).json()).record;
 return{record,ref,photo};
}
test('Published edit uploads stay private until Save; Cancel removes only its batch',async()=>{
 const {ref,photo}=await publishedFixture();const batch='11111111-1111-1111-1111-111111111111';
 const uploaded=await call('upload?'+ref+'&group=before&editBatch='+batch,'POST',photo,true);assert.equal(uploaded.status,201);
 const {record,photo:added}=await uploaded.json();assert.equal(record.beforeImages.length,2);
 const publicRecord=(await(await call('record?'+ref)).json()).record;assert.equal(publicRecord.beforeImages.length,1);assert.equal(publicRecord.pendingImages,undefined);
 assert.equal((await call('image?'+ref+'&photo='+added.id)).status,404);
 assert.equal((await call('image?'+ref+'&photo='+added.id,'GET',undefined,true)).status,200);
 assert.equal((await call('discard-uploads?'+ref,'POST',{editBatch:batch},true)).status,200);
 assert.equal((await call('image?'+ref+'&photo='+added.id,'GET',undefined,true)).status,404);
 assert.equal((await(await call('records?month=2026-10')).json()).summary.photosUploaded,2);
});
test('Save publishes the selected edit batch and updates real statistics',async()=>{
 const {ref,photo}=await publishedFixture();const batch='22222222-2222-2222-2222-222222222222';
 const uploaded=await call('upload?'+ref+'&group=after&editBatch='+batch,'POST',photo,true);const {record}=await uploaded.json();
 assert.equal((await call('record?'+ref,'PUT',{...fields,updatedAt:record.updatedAt,publish:true,editBatch:batch},true)).status,200);
 assert.equal((await(await call('records?month=2026-10')).json()).summary.photosUploaded,3);
});
test('Partial deletion can be retried; tombstone hides evidence and preserves cleanup references',async()=>{
 const {ref}=await publishedFixture();failNextDelete('images/');
 assert.equal((await call('record?'+ref,'DELETE',undefined,true)).status,500);
 assert.equal((await call('record?'+ref)).status,404);
 assert.equal((await(await call('records?month=2026-10')).json()).summary.totalActivities,0);
 assert.equal((await(await call('records?month=2026-10','GET',undefined,true)).json()).records.length,1);
 assert.equal((await call('record?'+ref,'DELETE',undefined,true)).status,200);
 assert.equal(stores.get('production:cleaning-log').size,0);
});

test('Direct environment password authenticates securely and overrides legacy hash',async()=>{
 const direct='short';
 authEnv.CLEANING_ADMIN_PASSWORD=direct;
 try {
  const wrong=await call('auth/login','POST',{password:'incorrect-password'});assert.equal(wrong.status,401);assert.equal(wrong.headers.get('set-cookie'),null);
  assert.equal((await call('auth/login','POST',{password})).status,401);
  const correct=await call('auth/login','POST',{password:direct});assert.equal(correct.status,200);
  const data=await correct.json();assert.equal(data.authenticated,true);assert.equal(JSON.stringify(data).includes(direct),false);assert.equal(JSON.stringify(data).includes(authEnv.CLEANING_ADMIN_PASSWORD_HASH),false);
  const setCookie=correct.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.equal(setCookie.includes(direct),false);
  const session=await api(new Request('https://cleaning.example/api/auth/session',{headers:{cookie:setCookie}}),production);assert.equal((await session.json()).authenticated,true);
  const logout=await api(new Request('https://cleaning.example/api/auth/logout',{method:'POST',headers:{origin:'https://cleaning.example',cookie:setCookie,'x-csrf-token':data.csrf}}),production);assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 } finally {delete authEnv.CLEANING_ADMIN_PASSWORD;}
});
test('Oversized direct password fails closed; hash works when direct password is absent',async()=>{
 authEnv.CLEANING_ADMIN_PASSWORD='x'.repeat(257);
 try {assert.equal((await call('auth/login','POST',{password:authEnv.CLEANING_ADMIN_PASSWORD})).status,503);assert.equal((await call('auth/login','POST',{password})).status,503);}finally{delete authEnv.CLEANING_ADMIN_PASSWORD;}
 assert.equal((await call('auth/login','POST',{password})).status,200);
 assert.equal((await call('auth/login','POST',{password:'wrong'})).status,401);
});
