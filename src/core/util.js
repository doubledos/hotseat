/* util.js
   Pure helpers - no game state, no DOM. Safe to import anywhere.
   Extracted from index.html @5c0cf1c; logic unchanged. */

export function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
export function slugify(name){
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .slice(0,40)||'game';
}
export function esc(str){ return (str==null?'':String(str)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function bounceText(str){
  return [...str].map((ch,i)=>`<span style="animation-delay:${(i*0.06).toFixed(2)}s">${ch===' '?'&nbsp;':esc(ch)}</span>`).join('');
}
export function money(n){ return '$'+(n||0).toLocaleString(); }

export function debounce(fn,delay){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),delay); }; }
export function shuffleArray(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]; } return a; }
export function letterFor(i){ return String.fromCharCode(65+i); }
