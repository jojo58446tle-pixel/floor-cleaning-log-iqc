const $ = s => document.querySelector(s);
const groups = ['before', 'after', 'additional'];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
const fmt = date => new Date(date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const monthName = m => new Date(m+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
let state = {page:'calendar',month:today().slice(0,7),records:[],settings:{areas:[],holidays:[]},admin:false,csrf:null,summary:null};
let loadGeneration = 0, viewerPhotos = [], viewerIndex = 0, zoom = 1, editing = null, draft = null, busy = false;
let editSession = null;
let queued = {before:[],after:[],additional:[]}, removed = new Set(), previewUrls = [];
const titles = {calendar:'Cleaning calendar',gallery:'Photo evidence gallery',statistics:'Cleaning statistics',area:'IQC cleaning areas',about:'About this log'};
const imageUrl = (r,p,size='thumb') => `/api/image?${new URLSearchParams({date:r.date,id:r.id,photo:p.id,size})}`;
function photos(records=state.records) {return records.filter(r=>r.published).flatMap(r=>groups.flatMap(g=>r[g+'Images'].map(p=>({r,p,group:g}))));}
async function api(path,options={}) {
 const headers = {...(options.body && typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...(options.method && options.method!=='GET'?{'X-CSRF-Token':state.csrf||''}:{}),...options.headers};
 const res = await fetch('/api/'+path,{credentials:'same-origin',...options,headers});
 let body;try{body=await res.json();}catch{throw new Error('API returned HTTP '+res.status+' without JSON. Check the Netlify Functions deployment.');} if(!res.ok) throw new Error(body.error || 'Request failed.'); return body;
}
function notice(message){$('#message').hidden=!message;$('#message').textContent=message||'';}
function options(values,first){return (first?`<option value="">${esc(first)}</option>`:'')+values.map(v=>`<option>${esc(v)}</option>`).join('');}
function authUI(){
 $('#auth-actions').innerHTML=state.admin?'<button id="logout">Sign out</button>':'<button type="button" id="admin-sign-in" class="admin-link">Admin sign in</button>';
 $('#add').hidden=!state.admin;$('#view-mode').textContent=state.admin?'Admin · Edit access':'Public · Read only';
 $('#admin-sign-in')?.addEventListener('click',()=>$('#login').showModal());
 $('#logout')?.addEventListener('click',async()=>{try{await api('auth/logout',{method:'POST'});state.admin=false;state.csrf=null;authUI();await load();history.replaceState({},'', '/');}catch(e){notice(e.message);}});
}
function summary(){
 const s=state.summary;if(!s){$('#summary').innerHTML='';return;}
 $('#summary').innerHTML=[['Cleaning Days',s.cleaningDays,'Days with published evidence'],['Total Activities',s.totalActivities,'Published cleaning records'],['Cleaning Rate',s.cleaningRate+'%',`${s.cleaningDays} / ${s.daysInMonth} calendar days`],['Areas Cleaned',s.areasCleaned,'Distinct areas this month'],['Photos Uploaded',s.photosUploaded,'Before, After & Additional']].map(([label,value,hint])=>`<article><span class="label">${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
}
async function load(){
 const generation=++loadGeneration;notice('');$('#month').value=state.month;$('#page-title').textContent=titles[state.page];
 $('nav').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
 $('#content').innerHTML='<div class="panel empty-state">Loading cleaning records…</div>';
 try{const [data,settings]=await Promise.all([api('records?month='+state.month),api('settings')]);if(generation!==loadGeneration)return;state.records=data.records;state.summary=data.summary;state.settings=settings;summary();await render(generation);}catch(e){if(generation!==loadGeneration)return;notice(e.message);$('#summary').innerHTML='';$('#content').innerHTML='<div class="panel empty-state"><strong>Records could not be loaded</strong><p>Please retry. No results have been assumed.</p><button id="retry">Retry</button></div>';$('#retry').onclick=load;}
}
async function render(generation=loadGeneration){
 if(state.page==='calendar')calendar();if(state.page==='gallery')gallery();if(state.page==='area')areas();if(state.page==='about')about();if(state.page==='statistics')await statistics(generation);
}
function calendar(){
 const [year,month]=state.month.split('-').map(Number),offset=(new Date(year,month-1,1).getDay()+6)%7,days=new Date(year,month,0).getDate();
 let cells='';for(let i=0;i<offset;i++)cells+='<div class="day empty" aria-hidden="true"></div>';
 for(let day=1;day<=days;day++){
   const date=`${state.month}-${String(day).padStart(2,'0')}`,rows=state.records.filter(r=>r.date===date),published=rows.filter(r=>r.published),r=published[0]||rows[0],p=r&&(r.afterImages[0]||r.beforeImages[0]);
   cells+=`<button class="day ${rows.length?'has-record':''} ${date===today()?'today':''} ${state.settings.holidays.includes(date)?'holiday':''}" data-date="${date}" aria-label="${esc(fmt(date))}, ${published.length} published activities"><span class="number">${day}${date===today()?'<small>Today</small>':''}</span>${r?`${p?`<img class="thumb" src="${imageUrl(r,p)}" alt="${esc(r.area)} photo evidence" loading="lazy" decoding="async">`:''}<span class="activity">${esc(r.activityType)}</span><span class="area">${esc(r.area)}</span><span class="badge ${r.published?'':'draft'}">${r.published?'✓ Cleaned':'Draft · Not public'}</span>${rows.length>1?`<span class="count">${rows.length} Activities</span>`:''}`:`<span class="no-activity">${state.settings.holidays.includes(date)?'Holiday':'No activity'}</span>`}</button>`;
 }
 const trailing=(7-(offset+days)%7)%7;
 for(let i=0;i<trailing;i++)cells+='<div class="day empty" aria-hidden="true"></div>';
 $('#content').innerHTML=`<div class="panel"><div class="panel-heading"><h3>${monthName(state.month)}</h3><div class="legend"><span><i class="dot green"></i>Cleaned</span><span><i class="dot gray"></i>No activity</span><span><i class="dot blue"></i>Today</span><span><i class="dot pink"></i>Holiday</span></div></div><div class="calendar-scroll"><div class="weekdays">${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar">${cells}</div></div></div><p class="muted">Select a date to view cleaning photo evidence.${state.admin?' Draft activities are visible only to Admin.':''} Cleaning rate = days with published evidence ÷ calendar days in the selected month. Holidays are configured by Admin.</p>`;
 $('#content').querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>openDetail(b.dataset.date));
}
function gallery(){
 $('#content').innerHTML=`<div class="filters"><label>Area<select id="area-filter">${options([...new Set([...state.settings.areas,...state.records.filter(r=>r.published).map(r=>r.area)])],'All areas')}</select></label><label>Activity type<select id="activity-filter">${options([...new Set(state.records.filter(r=>r.published).map(r=>r.activityType))],'All activities')}</select></label><label>Image type<select id="type-filter"><option value="">Before, After & Additional</option><option value="before">Before</option><option value="after">After</option><option value="additional">Additional</option></select></label></div><div id="gallery-grid" class="gallery"></div>`;
 const draw=()=>{const rows=photos().filter(x=>(!$('#area-filter').value||x.r.area===$('#area-filter').value)&&(!$('#activity-filter').value||x.r.activityType===$('#activity-filter').value)&&(!$('#type-filter').value||x.group===$('#type-filter').value));$('#gallery-grid').innerHTML=rows.length?rows.map((x,i)=>`<button class="photo-card" data-photo="${i}"><img src="${imageUrl(x.r,x.p)}" alt="${esc(x.group+' — '+x.r.area)}" loading="lazy" decoding="async"><span class="caption"><span class="type">${x.group}</span><strong>${esc(x.r.area)}</strong><small>${fmt(x.r.date)} · ${esc(x.r.activityType)}</small></span></button>`).join(''):'<div class="empty-state"><strong>No photo evidence</strong>No matching photos in this month.</div>';$('#gallery-grid').querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>openViewer(rows,Number(b.dataset.photo)));};
 ['area-filter','activity-filter','type-filter'].forEach(id=>$('#'+id).onchange=draw);draw();
}
async function statistics(generation){
 $('#content').innerHTML='<div class="panel empty-state">Loading monthly statistics…</div>';
 const data=await api('statistics?month='+state.month);if(generation!==loadGeneration||state.page!=='statistics')return;
 const areaCounts={},activityCounts={};for(const m of data.months){for(const [key,v] of Object.entries(m.areaCounts))areaCounts[key]=(areaCounts[key]||0)+v;for(const [key,v] of Object.entries(m.activityCounts))activityCounts[key]=(activityCounts[key]||0)+v;}
 $('#content').innerHTML=`<p class="muted">12 months ending ${monthName(state.month)} · Published photo evidence only</p><div class="panel table-scroll"><table><thead><tr><th>MONTH</th><th>CLEANING DAYS</th><th>ACTIVITIES</th><th>CLEANING RATE</th></tr></thead><tbody>${data.months.map(m=>`<tr><td>${monthName(m.month)}</td><td>${m.cleaningDays}</td><td>${m.totalActivities}</td><td>${m.cleaningRate}%</td></tr>`).join('')}</tbody></table></div><div class="stat-grid"><section class="panel"><h3>Cleaning frequency by area · activities</h3><div id="area-bars"></div></section><section class="panel"><h3>Activity type count</h3><div id="activity-bars"></div></section></div>`;
 bars($('#area-bars'),areaCounts);bars($('#activity-bars'),activityCounts);
}
function bars(container,counts){const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]),max=Math.max(1,...entries.map(e=>e[1]));container.innerHTML=entries.length?entries.map(([key,v],i)=>`<div class="bar-row"><span>${esc(key)}</span><div class="bar-track"><div class="bar" data-width="${v/max*100}"></div></div><strong>${v}</strong></div>`).join(''):'<p class="muted">No published activities in this period.</p>';container.querySelectorAll('.bar').forEach(b=>b.style.setProperty('--bar-width',b.dataset.width+'%'));}
function areas(){
 $('#content').innerHTML=`<div class="area-grid">${state.settings.areas.map(a=>`<article class="area-card"><span class="eyebrow">IQC AREA</span><h3>${esc(a)}</h3><p>${state.records.filter(r=>r.published&&r.area===a).length} activities in ${monthName(state.month)}</p></article>`).join('')}</div>${state.admin?'<form id="settings-form" class="panel settings"><h3>Manage areas & holidays</h3><p class="muted">One area or holiday date per line. Removing an area does not change historical records.</p><div class="form-grid"><label>Active areas<textarea name="areas" rows="9"></textarea></label><label>Holiday dates · YYYY-MM-DD<textarea name="holidays" rows="9"></textarea></label></div><button class="primary" type="submit">Save settings</button><p id="settings-status" role="status"></p></form>':''}`;
 if(state.admin){const form=$('#settings-form');form.elements.areas.value=state.settings.areas.join('\n');form.elements.holidays.value=state.settings.holidays.join('\n');form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await api('settings',{method:'PUT',body:JSON.stringify({areas:form.elements.areas.value.split('\n').map(x=>x.trim()).filter(Boolean),holidays:form.elements.holidays.value.split('\n').map(x=>x.trim()).filter(Boolean)})});await load();}catch(err){$('#settings-status').textContent=err.message;}finally{button.disabled=false;}};}
}
function about(){$('#content').innerHTML='<article class="panel about"><span class="eyebrow">CLEAN WORKPLACE, BETTER QUALITY</span><h3>Cleaning is actually performed and documented.</h3><p>This log records real cleaning activities in the IQC workplace, with dated Before and After photo evidence. Multiple activities can be recorded for the same day.</p><p>Anyone with the link can view the calendar, photos and statistics. Only an authenticated Admin can add, edit or delete records.</p><h3>How to read the calendar</h3><p>Green means a documented cleaning activity. Gray means no recorded activity. Blue marks today in Thailand. Pink marks a holiday configured by Admin; no factory holiday schedule is assumed.</p><h3>Monthly cleaning rate</h3><p>Distinct days with published cleaning evidence divided by all calendar days in the selected month. It measures documentation frequency and is not a compliance score.</p><h3>Photo privacy</h3><p>Do not upload photos containing confidential drawings, customer information, supplier confidential information, passwords, screens, or sensitive company data.</p></article>';}
async function openDetail(date){
 const dialog=$('#detail');$('#detail-title').textContent=fmt(date);$('#detail-content').innerHTML='<p>Loading activity details…</p>';dialog.showModal();
 try{const rows=state.records.filter(r=>r.date===date);if(!rows.length){$('#detail-content').innerHTML=`<div class="empty-state"><strong>No recorded activity</strong>There is no cleaning evidence for this date.</div>${state.admin?'<button id="add-on-date" class="primary">+ Add activity</button>':''}`;$('#add-on-date')?.addEventListener('click',()=>{dialog.close();openEditor(null,date);});return;}
 const records=await Promise.all(rows.map(r=>api('record?'+new URLSearchParams({date,id:r.id})).then(x=>x.record)));
 const all=photos(records);if(state.admin){all.splice(0,all.length,...records.flatMap(r=>groups.flatMap(group=>r[group+'Images'].map(p=>({r,p,group})))));}
 $('#detail-content').innerHTML=records.map(r=>`<article class="detail-record"><h3>${esc(r.activityType)}</h3><span class="badge ${r.published?'':'draft'}">${r.published?'✓ Cleaned':'Draft · Not public'}</span><div class="details-grid"><div><small>AREA</small>${esc(r.area)}</div><div><small>START / FINISH</small>${r.startTime} – ${r.endTime}</div><div><small>DATE</small>${fmt(r.date)}</div></div><p class="note">${esc(r.note||'No additional notes.')}</p><div class="evidence">${groups.map(g=>`<section class="${g}"><h4>${g}</h4><div class="detail-photos">${r[g+'Images'].map(p=>`<button data-image="${all.findIndex(x=>x.p.id===p.id)}"><img src="${imageUrl(r,p,'full')}" alt="${esc(g+' — '+r.area)}" loading="lazy" decoding="async"></button>`).join('')||'<span class="muted">No photos</span>'}</div></section>`).join('')}</div>${state.admin?`<div class="detail-actions"><button data-edit="${r.id}">Edit activity</button><button class="danger" data-delete="${r.id}">Delete activity</button></div>`:''}</article>`).join('');
 $('#detail-content').querySelectorAll('[data-image]').forEach(b=>b.onclick=()=>openViewer(all,Number(b.dataset.image)));
 $('#detail-content').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{dialog.close();openEditor(records.find(r=>r.id===b.dataset.edit));});
 $('#detail-content').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this activity and all its photo evidence permanently?'))return;const r=records.find(r=>r.id===b.dataset.delete);b.disabled=true;try{await api('record?'+new URLSearchParams({date:r.date,id:r.id}),{method:'DELETE'});dialog.close();await load();}catch(e){b.disabled=false;notice(e.message);}});
 }catch(e){$('#detail-content').textContent=e.message;}
}
function openViewer(list,index){viewerPhotos=list;viewerIndex=index;zoom=1;showPhoto();$('#viewer').showModal();}
function showPhoto(){const x=viewerPhotos[viewerIndex];$('#full-image').src=imageUrl(x.r,x.p,'full');$('#full-image').alt=x.group+' — '+x.r.area;$('#viewer-caption').textContent=`${fmt(x.r.date)} · ${x.r.area} · ${x.group}`;$('#photo-counter').textContent=`${viewerIndex+1} / ${viewerPhotos.length}`;zoom=1;applyZoom();}
function applyZoom(){const image=$('#full-image');image.classList.toggle('zoomed',zoom>1);image.style.setProperty('--zoom-width',viewerPhotos[viewerIndex].p.width*zoom+'px');}
function nextPhoto(step){viewerIndex=(viewerIndex+step+viewerPhotos.length)%viewerPhotos.length;showPhoto();}
$('#photo-next').onclick=()=>nextPhoto(1);$('#photo-prev').onclick=()=>nextPhoto(-1);$('#zoom-in').onclick=()=>{zoom=Math.min(4,zoom+.5);applyZoom();};$('#zoom-out').onclick=()=>{zoom=Math.max(1,zoom-.5);applyZoom();};
document.addEventListener('keydown',e=>{if($('#viewer').open){if(e.key==='ArrowRight')nextPhoto(1);if(e.key==='ArrowLeft')nextPhoto(-1);}});
$('#viewer').addEventListener('close',()=>{$('#full-image').removeAttribute('src');viewerPhotos=[];});
function resetPreviews(){previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];}
async function openEditor(record=null,date=today()){
 if(!state.admin)return;draft=null;editSession=record?sessionStorage.getItem('cleaning-edit:'+record.id)||crypto.randomUUID():crypto.randomUUID();if(record){sessionStorage.setItem('cleaning-edit:'+record.id,editSession);try{record=(await api('record?'+new URLSearchParams({date:record.date,id:record.id,editBatch:editSession}))).record;}catch(e){notice(e.message);return;}}editing=record;busy=false;queued={before:[],after:[],additional:[]};removed=new Set();resetPreviews();
 const f=$('#record-form');f.reset();$('#editor-title').textContent=record?'Edit cleaning activity':'Add cleaning activity';
 f.elements.area.innerHTML=options([...new Set([...state.settings.areas,...(record?[record.area]:[])])]);
 f.elements.date.value=record?.date||date;f.elements.date.disabled=!!record;f.elements.area.value=record?.area||state.settings.areas[0];
 for(const name of ['activityType','startTime','endTime','note'])f.elements[name].value=record?.[name]||(name==='activityType'?'Floor Cleaning':name==='startTime'?'09:30':name==='endTime'?'10:20':'');
 $('#editor-status').textContent='';$('#save-record').disabled=false;groups.forEach(drawPreview);$('#editor').showModal();
}
function drawPreview(group){const saved=(editing||draft)?.[group+'Images']||[];const box=$('#'+group+'-preview');box.innerHTML='';
 for(const p of saved.filter(p=>!removed.has(p.id))){const r=editing||draft,wrap=document.createElement('span');wrap.className='preview-item';wrap.innerHTML=`<img src="${imageUrl(r,p)}" alt="${group} photo"><button type="button" aria-label="Remove photo">✕</button>`;wrap.querySelector('button').onclick=()=>{removed.add(p.id);drawPreview(group);};box.append(wrap);}
 queued[group].forEach((file,i)=>{const wrap=document.createElement('span');wrap.className='preview-item';const objectUrl=URL.createObjectURL(file);previewUrls.push(objectUrl);wrap.innerHTML=`<img alt="Selected ${group} photo"><button type="button" aria-label="Remove selected photo">✕</button>`;wrap.querySelector('img').src=objectUrl;wrap.querySelector('button').onclick=()=>{queued[group].splice(i,1);drawPreview(group);};box.append(wrap);});
}
document.querySelectorAll('[data-photo-group]').forEach(input=>input.onchange=e=>{const g=input.dataset.photoGroup;queued[g].push(...e.target.files);e.target.value='';drawPreview(g);});
async function mobileImage(file){
 if(file.size>40000000)throw new Error('Photo exceeds 40 MB. Export a smaller JPEG.');
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error('This phone photo cannot be opened. Export HEIC as JPEG and try again.');}
 const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 let output=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.8));if(!output)throw new Error('Photo conversion failed. Please retry.');
 if(output.size>4500000)output=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.65));
 if(!output||output.size>4500000)throw new Error('Photo is too large after compression. Select a smaller photo.');return output;
}
$('#record-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;const form=e.target,base=editing||draft;const has=g=>(base?.[g+'Images']||[]).filter(p=>!removed.has(p.id)).length+queued[g].length;
 if(!groups.some(g=>has(g))){$('#editor-status').textContent='Add at least one cleaning photo to publish this activity.';return;}
 if(groups.reduce((n,g)=>n+has(g),0)>30){$('#editor-status').textContent='Maximum 30 photos per activity.';return;}
 const fields=Object.fromEntries(new FormData(form));fields.date=form.elements.date.value;
 busy=true;$('#save-record').disabled=true;$('#cancel-editor').disabled=true;$('#discard').disabled=true;for(const input of form.querySelectorAll('input,select,textarea'))input.disabled=true;
 try{
   // Compress before creating a draft, so unsupported phone photos leave no empty record.
   const prepared={};for(const g of groups){prepared[g]=[];for(let i=0;i<queued[g].length;i++){$('#editor-status').textContent=`Preparing ${g} photo ${i+1}…`;prepared[g].push(await mobileImage(queued[g][i]));}}
   if(!base){$('#editor-status').textContent='Creating activity…';draft=(await api('records',{method:'POST',body:JSON.stringify(fields)})).record;}
   let current=editing||draft;
   for(const g of groups){while(prepared[g].length){$('#editor-status').textContent=`Uploading ${g} photo…`;const result=await api('upload?'+new URLSearchParams({date:current.date,id:current.id,group:g,editBatch:editSession}),{method:'POST',body:prepared[g][0],headers:{'Content-Type':'image/webp'}});current=result.record;if(editing)editing=current;else draft=current;prepared[g].shift();queued[g].shift();}}
   $('#editor-status').textContent='Saving photo evidence…';await api('record?'+new URLSearchParams({date:current.date,id:current.id}),{method:'PUT',body:JSON.stringify({...fields,updatedAt:current.updatedAt,publish:true,editBatch:editSession,removeImageIds:[...removed]})});
   sessionStorage.removeItem('cleaning-edit:'+current.id);draft=null;editing=null;busy=false;$('#editor').close();resetPreviews();state.month=fields.date.slice(0,7);await load();
 }catch(err){$('#editor-status').textContent=err.message+' Uploaded photos are retained so you can retry.';groups.forEach(drawPreview);}
 finally{busy=false;$('#save-record').disabled=false;$('#cancel-editor').disabled=false;$('#discard').disabled=false;for(const input of form.querySelectorAll('input,select,textarea'))input.disabled=false;form.elements.date.disabled=!!(editing||draft);}
};
async function cancelEditor(){if(busy)return;if(editing?.published){try{await api('discard-uploads?'+new URLSearchParams({date:editing.date,id:editing.id}),{method:'POST',body:JSON.stringify({editBatch:editSession})});}catch(e){$('#editor-status').textContent='Uploads could not be discarded: '+e.message;return;}}if(draft){try{await api('record?'+new URLSearchParams({date:draft.date,id:draft.id}),{method:'DELETE'});draft=null;}catch(e){$('#editor-status').textContent='Draft could not be removed: '+e.message;return;}}if(editing)sessionStorage.removeItem('cleaning-edit:'+editing.id);$('#editor').close();resetPreviews();await load();}
$('#cancel-editor').onclick=cancelEditor;$('#discard').onclick=cancelEditor;$('#editor').addEventListener('cancel',e=>{e.preventDefault();cancelEditor();});
$('#add').onclick=()=>openEditor();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;$('#login-error').textContent='';try{const data=await api('auth/login',{method:'POST',body:JSON.stringify({password:e.target.elements.password.value})});state.admin=data.authenticated;state.csrf=data.csrf;e.target.reset();$('#login').close();authUI();await load();}catch(err){$('#login-error').textContent=err.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;load();});
function moveMonth(step){const [y,m]=state.month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+step,1));const next=d.toISOString().slice(0,7);if(next<'2000-01'||next>'2199-12')return;state.month=next;load();}
$('#previous').onclick=()=>moveMonth(-1);$('#next').onclick=()=>moveMonth(1);$('#today').onclick=()=>{state.month=today().slice(0,7);load();};$('#month').onchange=e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)&&e.target.value>='2000-01'&&e.target.value<='2199-12'){state.month=e.target.value;load();}};
try{const session=await api('auth/session');state.admin=session.authenticated;state.csrf=session.csrf;}catch(e){notice(e.message);}authUI();await load();
