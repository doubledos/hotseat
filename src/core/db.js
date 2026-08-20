/* db.js
   Supabase kv_store access. Falls back to localStorage when SUPABASE_URL is blank,
   which is what the local test build relies on to avoid touching production data.
   Extracted from index.html @5c0cf1c; logic unchanged. */

/* ===== Supabase config ===== */
export const SUPABASE_URL = 'https://lmjluzxzxpbuhvantbwt.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtamx1enh6eHBidWh2YW50Ynd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzQyMzcsImV4cCI6MjA5OTY1MDIzN30.Qj0SZi_pBJNvLdDj5Hr9osh9ub3xRkhRyx-1AZjElKY';
export const hasSupabase = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export async function sbFetch(path, opts){
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers:{
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts && opts.headers)
    }
  });
  if(!res.ok) return null;
  const text = await res.text();
  try{ return JSON.parse(text); } catch(e){ return null; }
}

export async function dbGet(key){
  if(!hasSupabase){
    try{ const v=localStorage.getItem(key); return v!==null?{key,value:v}:null; } catch(e){ return null; }
  }
  const rows = await sbFetch('/rest/v1/kv_store?key=eq.'+encodeURIComponent(key)+'&select=key,value&limit=1',{method:'GET'});
  return (rows&&rows.length)?{key,value:rows[0].value}:null;
}
export async function dbSet(key, value){
  if(!hasSupabase){
    try{ localStorage.setItem(key,value); return {key,value}; } catch(e){ return null; }
  }
  const row = await sbFetch('/rest/v1/kv_store',{
    method:'POST',
    headers:{'Prefer':'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify({key,value})
  });
  return row?{key,value}:null;
}
export async function dbDelete(key){
  if(!hasSupabase){
    try{ localStorage.removeItem(key); return {key,deleted:true}; } catch(e){ return null; }
  }
  await sbFetch('/rest/v1/kv_store?key=eq.'+encodeURIComponent(key),{method:'DELETE'});
  return {key,deleted:true};
}
export async function dbList(prefix){
  if(!hasSupabase){
    try{
      const keys=[];
      for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(prefix))keys.push(k);}
      return keys;
    } catch(e){ return []; }
  }
  const rows = await sbFetch('/rest/v1/kv_store?key=like.'+encodeURIComponent(prefix+'%')+'&select=key',{method:'GET'});
  return rows?rows.map(r=>r.key):[];
}
