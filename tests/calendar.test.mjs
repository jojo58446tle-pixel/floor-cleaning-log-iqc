import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the shipped rendering function rather than a duplicate calendar algorithm.
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const calendar=source.slice(source.indexOf('function calendar(){'),source.indexOf('function gallery(){'));
for(const month of ['2026-10','2026-02','2024-02','2026-11','2026-12']){
 test(`Calendar renders all dates and complete weeks for ${month}`,()=>{
  const content={innerHTML:'',querySelectorAll:()=>[]};
  const context={state:{month,records:[],settings:{holidays:[]},admin:false},$:()=>content,today:()=> '2026-10-11',fmt:x=>x,monthName:x=>x,esc:x=>x,openDetail:()=>{}};
  vm.runInNewContext(calendar+'\ncalendar();',context);
  const [year,m]=month.split('-').map(Number),days=new Date(year,m,0).getDate();
  const dates=[...content.innerHTML.matchAll(/data-date="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(dates.length,days);
  assert.equal(dates[0],month+'-01');
  assert.equal(dates.at(-1),month+'-'+days);
  assert.equal((content.innerHTML.match(/class="day /g)||[]).length%7,0);
  assert.ok(!content.innerHTML.includes('size=full'));
 });
}
