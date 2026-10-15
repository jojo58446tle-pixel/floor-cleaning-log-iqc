import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const photo={id:'photo-1',width:1440,height:1920};
const record={id:'00000000-0000-0000-0000-000000000001',date:'2026-10-07',area:'IQC Lab Floor',activityType:'Floor Cleaning',startTime:'09:30',endTime:'10:20',note:'Test-only evidence',published:true,beforeImages:[photo],afterImages:[{...photo,id:'photo-2'}],additionalImages:[]};
const summary={cleaningDays:1,totalActivities:1,cleaningRate:3.2,daysInMonth:31,areasCleaned:1,photosUploaded:2};
async function until(check){for(let i=0;i<30;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.ok(check(),'UI did not reach expected state');}
test('Dashboard is the only navigation page; Calendar, Detail and Image Viewer work',async()=>{
 const dom=new JSDOM(html,{url:'https://cleaning.example/',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.fetch=async path=>{requests.push(path);let data;
   if(path==='/api/auth/session')data={authenticated:false,csrf:null};
   else if(path==='/api/settings')data={areas:['IQC Lab Floor','IQC Table'],holidays:[]};
   else if(path.startsWith('/api/records?'))data={records:path.includes('2026-10')?[record]:[],summary};
   else if(path.startsWith('/api/record?'))data={record};
   else if(path.startsWith('/api/statistics?'))data={months:[{month:'2026-10',...summary,areaCounts:{'IQC Lab Floor':1},activityCounts:{'Floor Cleaning':1}}]};
   else throw new Error('Unexpected request '+path);
   return{ok:true,status:200,json:async()=>data};
 };
 await w.eval('(async()=>{'+script+'})()');
 d.querySelector('#month').value='2026-10';d.querySelector('#month').dispatchEvent(new w.Event('change'));await until(()=>d.querySelector('[data-date="2026-10-07"]'));
 assert.equal(d.querySelectorAll('[data-date]').length,31);assert.equal(d.querySelector('#add').hidden,true);
 assert.ok([...d.querySelectorAll('.calendar img')].every(img=>img.src.includes('size=thumb')&&img.src.includes('v=2')));
 d.querySelector('[data-date="2026-10-07"]').click();await until(()=>d.querySelector('.detail-record'));
 assert.equal(d.querySelector('#detail').open,true);assert.equal(d.querySelectorAll('.detail-photos img').length,2);assert.equal(d.querySelectorAll('.evidence section').length,1);assert.ok(!d.querySelector('#detail-content').textContent.includes('START / FINISH'));
 assert.equal(d.querySelector('[data-edit]'),null);
 assert.deepEqual([...d.querySelectorAll('nav [data-page]')].map(b=>b.textContent),['Dashboard']);
 d.querySelector('[data-image]').click();assert.equal(d.querySelector('#viewer').open,true);assert.ok(d.querySelector('#full-image').src.includes('size=full'));
 d.querySelector('#zoom-in').click();assert.ok(d.querySelector('#full-image').classList.contains('zoomed'));
 d.querySelector('#photo-next').click();d.querySelector('#photo-prev').click();d.querySelector('[data-close="viewer"]').click();assert.equal(d.querySelector('#full-image').getAttribute('src'),null);
 d.querySelector('[data-close="detail"]').click();
 d.querySelector('#next').click();await until(()=>d.querySelector('#month').value==='2026-11'&&d.querySelector('[data-date="2026-11-30"]'));
 d.querySelector('#previous').click();await until(()=>d.querySelector('[data-date="2026-10-31"]'));
 d.querySelector('#today').click();await until(()=>d.querySelector('.calendar'));
 assert.equal(requests.some(path=>path.startsWith('/api/statistics?')),false);assert.equal(d.querySelector('#message').hidden,true);dom.window.close();
});

test('Admin upload retries without reselection, guards duplicate submit and publishes; empty activity is rejected',async()=>{
 const dom=new JSDOM(html,{url:'https://cleaning.example/',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.URL.createObjectURL=()=> 'blob:test-photo';w.URL.revokeObjectURL=()=>{};
 w.createImageBitmap=async()=>({width:4000,height:3000,close(){}});
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},fillRect(){}});
 w.HTMLCanvasElement.prototype.toBlob=function(cb,type,quality){assert.equal(this.width,1920);assert.equal(this.height,1440);assert.ok(['image/webp','image/jpeg'].includes(type));assert.equal(quality,.8);cb(new w.Blob(['compressed'],{type:type==='image/webp'?'image/png':type}));};
 w.fetch=async(path,options={})=>{
  requests.push({path,...options});let data;
  if(path==='/api/auth/session')data={authenticated:true,csrf:'test-csrf'};
  else if(path==='/api/settings')data={areas:['IQC Lab Floor'],holidays:[]};
  else if(path.startsWith('/api/records?'))data={records:[],summary};
  else if(path==='/api/records')data={record:{...record,published:false,beforeImages:[],afterImages:[]}};
  else if(path.startsWith('/api/upload?')){if(requests.filter(r=>r.path.startsWith('/api/upload?')).length===2)return{ok:false,status:503,json:async()=>({error:'Temporary upload failure'})};data={record:{...record,beforeImages:[],afterImages:[photo]}};}
  else if(path.startsWith('/api/record?'))data={record:{...record,beforeImages:[],afterImages:[photo]}};
  else throw new Error('Unexpected request '+path);
  return{ok:true,status:200,json:async()=>data};
 };
 await w.eval('(async()=>{'+script+'})()');d.querySelector('#add').click();
 const form=d.querySelector('#record-form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.match(d.querySelector('#editor-status').textContent,/at least one cleaning photo/);
 assert.equal(requests.some(r=>r.method==='POST'),false);
 const camera=d.querySelector('#after-camera');assert.equal(camera.getAttribute('capture'),'environment');
 assert.equal(d.querySelector('#after-input').hasAttribute('capture'),false);
 Object.defineProperty(camera,'files',{value:[new w.File(['phone-photo'],'phone.jpg',{type:'image/jpeg'}),new w.File(['second'],'second.jpg',{type:'image/jpeg'})]});camera.dispatchEvent(new w.Event('change'));
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>d.querySelector('#editor-status').textContent.includes('Temporary upload failure'));assert.equal(requests.filter(r=>r.path==='/api/records').length,1);form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>!d.querySelector('#editor').open);
 const upload=requests.find(r=>r.path.startsWith('/api/upload?'));assert.ok(upload.path.includes('group=after'));assert.equal(upload.body.type,'image/jpeg');assert.equal(upload.headers['Content-Type'],'image/jpeg');assert.equal(requests.filter(r=>r.path.startsWith('/api/upload?')).length,3);
 assert.ok(requests.some(r=>r.method==='PUT'&&JSON.parse(r.body).publish===true));
 assert.equal(d.querySelectorAll('#editor .upload-box').length,1);assert.equal(form.elements.startTime,undefined);assert.equal(form.elements.endTime,undefined);
 assert.equal(JSON.parse(requests.find(r=>r.path==='/api/records').body).startTime,'');
 d.querySelector('#edit-saved').click();await until(()=>d.querySelector('#editor').open);
 assert.equal(d.querySelectorAll('#after-preview img').length,1);
 d.querySelector('[aria-label="Remove photo"]').click();camera.dispatchEvent(new w.Event('change'));
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>!d.querySelector('#editor').open);
 const update=requests.filter(r=>r.method==='PUT').at(-1);assert.deepEqual(JSON.parse(update.body).removeImageIds,[photo.id]);assert.equal(requests.filter(r=>r.path==='/api/records').length,1);
 dom.window.close();
});

test('Public landing never opens login automatically, even at the legacy /admin URL',async()=>{
 for(const path of ['/','/admin']){
  const dom=new JSDOM(html,{url:'https://cleaning.example'+path,runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/auth/session'?{authenticated:false,csrf:null}:url==='/api/settings'?{areas:['IQC Lab Floor'],holidays:[]}:{records:[],summary}});
  await w.eval('(async()=>{'+script+'})()');
  assert.equal(d.querySelector('#login').open,false);assert.ok(d.querySelector('.calendar'));assert.equal(d.querySelector('#add').hidden,true);
  d.querySelector('#admin-sign-in').click();assert.equal(d.querySelector('#login').open,true);
  d.querySelector('[data-close="login"]').click();assert.equal(d.querySelector('#login').open,false);
  d.querySelector('#next').click();await until(()=>d.querySelector('.calendar'));
  assert.equal(d.querySelector('#login').open,false);dom.window.close();
 }
});

async function compressionHarness(encode,{width=8000,height=6000,bitmapFails=false}={}){
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window,calls=[];
 let closed=0,revoked=0;
 w.createImageBitmap=async()=>{if(bitmapFails)throw Error('unsupported');return{width,height,close(){closed++;}};};
 w.URL.createObjectURL=()=> 'blob:decode';w.URL.revokeObjectURL=()=>{revoked++;};
 w.Image=class{constructor(){this.width=width;this.height=height;}set src(v){if(v)queueMicrotask(()=>this.onload());}};
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},fillRect(){}});
 w.HTMLCanvasElement.prototype.toBlob=function(cb,type,quality){calls.push({width:this.width,height:this.height,type,quality});cb(encode(w,type,quality,this.width));};
 const fn=w.eval('('+script.slice(script.indexOf('async function mobileImage('),script.indexOf("$('#record-form').onsubmit"))+')');
 return{dom,w,calls,run:()=>fn(new w.File(['photo'],'phone.heic')),closed:()=>closed,revoked:()=>revoked};
}
test('adaptive compression reduces quality then resolution and frees resources',async()=>{
 const h=await compressionHarness((w,type,q,width)=>new w.Blob([new Uint8Array(width>1280?3100000:100)],{type}));
 const blob=await h.run();assert.ok(blob.size<3000000);assert.equal(h.calls.at(-1).width,1280);assert.ok(h.calls.some(c=>c.quality===.35));assert.equal(h.closed(),1);h.dom.window.close();
});
test('Safari PNG encoder fallback is rejected; JPEG MIME is returned without enlargement',async()=>{
 const h=await compressionHarness((w,type)=>new w.Blob(['photo'],{type:type==='image/webp'?'image/png':type}),{width:300,height:200,bitmapFails:true});
 const blob=await h.run();assert.equal(blob.type,'image/jpeg');assert.equal(h.calls[0].width,300);assert.equal(h.calls[0].height,200);assert.equal(h.revoked(),1);h.dom.window.close();
});
test('null WebP encoder falls back to JPEG',async()=>{
 const h=await compressionHarness((w,type)=>type==='image/webp'?null:new w.Blob(['jpeg'],{type}));assert.equal((await h.run()).type,'image/jpeg');assert.equal(h.closed(),1);h.dom.window.close();
});

test('unreadable image reports actionable HEIC guidance and revokes decode URL',async()=>{
 const h=await compressionHarness(()=>null,{bitmapFails:true});h.w.Image=class{set src(v){if(v)queueMicrotask(()=>this.onerror(Error('decode')));}};
 await assert.rejects(h.run(),/HEIC\/HEIF/);assert.equal(h.revoked(),1);h.dom.window.close();
});
