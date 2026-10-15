import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { validDate, validMonth, summary, validateFields, recordKey } from '../netlify/lib/model.ts';
import { makeSession, readSession, verifyPassword, sameOrigin, cookieHeader } from '../netlify/lib/auth.ts';
const photo = {id:'photo'};
const row = (date, area='IQC Lab Floor', published=true) => ({date,area,activityType:'Floor Cleaning',published,beforeImages:[photo],afterImages:[photo],additionalImages:[]});
test('dates reject impossible months and leap days',()=>{assert.equal(validDate('2026-10-07'),true);assert.equal(validDate('2026-13-07'),false);assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2028-02-29'),true);assert.equal(validMonth('2026-00'),false);});
test('summary counts distinct days, multiple records and photo evidence without drafts',()=>{const s=summary([row('2026-10-07'),row('2026-10-07','IQC Table'),row('2026-10-08'),row('2026-10-09','IQC Table',false),row('2026-09-07')],'2026-10');assert.equal(s.cleaningDays,2);assert.equal(s.totalActivities,3);assert.equal(s.areasCleaned,2);assert.equal(s.photosUploaded,6);assert.equal(s.cleaningRate,6.5);assert.equal(s.areaCounts['IQC Lab Floor'],2);});
test('empty month statistics are real zero values',()=>{const s=summary([],'2028-02');assert.equal(s.daysInMonth,29);assert.equal(s.cleaningRate,0);assert.equal(s.totalActivities,0);});
test('record paths separate dates and ids',()=>{assert.equal(recordKey('2026-10-07','abc'),'records/2026/10/07/abc.json');});
test('fields reject unknown areas and reversed times',()=>{const fields={date:'2026-10-07',area:'IQC Lab Floor',activityType:'Floor Cleaning',startTime:'10:00',endTime:'09:00',note:''};assert.throws(()=>validateFields(fields,['IQC Lab Floor']));assert.throws(()=>validateFields({...fields,endTime:'11:00',area:'unknown'},['IQC Lab Floor']));assert.equal(validateFields({...fields,endTime:'11:00'},['IQC Lab Floor']).status,'cleaned');});
test('session is signed, rejects tampering and expires',()=>{const secret='s'.repeat(48),session=makeSession(secret);assert.equal(readSession(cookieHeader(session.token),secret).csrf,session.csrf);assert.equal(readSession('__Host-cleaning='+session.token+'x',secret),null);assert.equal(readSession('__Host-cleaning='+session.token,'other'.repeat(10)),null);const old=Date.now;Date.now=()=>old()+9*3600000;try{assert.equal(readSession(cookieHeader(session.token),secret),null);}finally{Date.now=old;}});
test('password is scrypt hash; malformed hashes never authenticate',()=>{const salt='test-only',hash=salt+':'+scryptSync('test-password',salt,64).toString('hex');assert.equal(verifyPassword('test-password',hash),true);assert.equal(verifyPassword('wrong',hash),false);assert.equal(verifyPassword('anything',''),false);});
test('cross-origin writes are rejected',()=>{assert.equal(sameOrigin(new Request('https://cleaning.example/api/records',{headers:{origin:'https://evil.example'}})),false);assert.equal(sameOrigin(new Request('https://cleaning.example/api/records',{headers:{origin:'https://cleaning.example'}})),true);assert.equal(sameOrigin(new Request('https://cleaning.example/api/records')),false);});

test('photo-only activities need no times; legacy valid times are preserved',()=>{
 const fields={date:'2026-10-15',area:'IQC Lab Floor',activityType:'Floor Cleaning',note:''};
 const result=validateFields(fields,['IQC Lab Floor']);assert.equal(result.startTime,'');assert.equal(result.endTime,'');
 assert.equal(validateFields({...fields,startTime:'09:00',endTime:'10:00'},['IQC Lab Floor']).startTime,'09:00');
 assert.throws(()=>validateFields({...fields,startTime:'09:00'},['IQC Lab Floor']));
});
