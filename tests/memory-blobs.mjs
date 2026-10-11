// Unit/integration adapter only. Never used by deployed Functions.
export const stores = new Map();
let revision=0;
export function reset(){stores.clear();revision=0;}
function open(name){
 if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);
 async function set(key,data,opts={}){const old=map.get(key);if((opts.onlyIfNew&&old)||(opts.onlyIfMatch&&opts.onlyIfMatch!==old?.etag))return{modified:false};const etag=String(++revision);map.set(key,{data,etag});return{modified:true,etag};}
 return{set,setJSON:(key,value,opts)=>set(key,structuredClone(value),opts),async get(key,opts={}){const value=map.get(key)?.data;if(value===undefined)return null;if(opts.type==='arrayBuffer')return value.arrayBuffer();return structuredClone(value);},async getWithMetadata(key){const value=map.get(key);return value?{data:structuredClone(value.data),etag:value.etag,metadata:{}}:null;},async list({prefix}={}){return{blobs:[...map.entries()].filter(([key])=>!prefix||key.startsWith(prefix)).map(([key,value])=>({key,etag:value.etag}))};},async delete(key){map.delete(key);}};
}
export function getStore(options){return open('production:'+options.name);}
export function getDeployStore(options){return open('preview:'+options.name);}
