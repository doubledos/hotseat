/* questions.js
   CRUD for the question bank and the puzzle phrase bank. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { esc, genId } from '../core/util.js';
import { editingPhrase, editingQuestion, setEditingPhrase, setEditingQuestion } from '../core/session.js';

/* ===== Question bank CRUD ===== */
export async function saveQuestionFromForm(){
  const text=(document.getElementById('q-text').value||'').trim(); if(!text) return;
  const opts=['q-opt-a','q-opt-b','q-opt-c','q-opt-d'].map(id=>(document.getElementById(id).value||'').trim()).filter(v=>v);
  if(!opts.length) return;
  const diff=document.getElementById('q-diff').value||'easy';
  if(editingQuestion){
    const q=state.questions.find(x=>x.id===editingQuestion);
    if(q){ q.text=text; q.options=opts; q.difficulty=diff; }
    setEditingQuestion(null);
  } else {
    state.questions.push({id:genId(),text,options:opts,difficulty:diff,used:false});
  }
  await saveLobby();
  ['q-text','q-opt-a','q-opt-b','q-opt-c','q-opt-d'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  R.host();
}
export function startEditQuestion(id){
  const q=state.questions.find(x=>x.id===id); if(!q) return;
  setEditingQuestion(id); R.host();
  setTimeout(()=>{
    const textEl=document.getElementById('q-text');
    if(textEl) textEl.value=q.text;
    (q.options||[]).forEach((o,i)=>{ const el=document.getElementById(['q-opt-a','q-opt-b','q-opt-c','q-opt-d'][i]); if(el) el.value=o; });
    const diffEl=document.getElementById('q-diff');
    if(diffEl) diffEl.value=q.difficulty||'easy';
  },0);
}
export function cancelEditQuestion(){ setEditingQuestion(null); R.host(); }
export async function deleteQuestion(id){
  state.questions=state.questions.filter(x=>x.id!==id);
  if(editingQuestion===id) setEditingQuestion(null);
  await saveLobby(); R.host();
}
export async function resetAllUsedFlags(){
  state.questions.forEach(q=>q.used=false);
  state.phraseBank.forEach(p=>p.used=false);
  await saveLobby(); R.host();
}

/* Phrases */
export async function savePhraseFromForm(){
  const cat=(document.getElementById('phrase-cat').value||'').trim();
  const phrase=(document.getElementById('phrase-text').value||'').trim(); if(!phrase) return;
  if(editingPhrase){
    const p=state.phraseBank.find(x=>x.id===editingPhrase);
    if(p){ p.category=cat; p.phrase=phrase; }
    setEditingPhrase(null);
  } else {
    state.phraseBank.push({id:genId(),category:cat,phrase:phrase,used:false});
  }
  await saveLobby();
  ['phrase-cat','phrase-text'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  R.host();
}
export function startEditPhrase(id){
  const p=state.phraseBank.find(x=>x.id===id); if(!p) return;
  setEditingPhrase(id); R.host();
  setTimeout(()=>{
    const catEl=document.getElementById('phrase-cat'); if(catEl) catEl.value=p.category||'';
    const phraseEl=document.getElementById('phrase-text'); if(phraseEl) phraseEl.value=p.phrase;
  },0);
}
export function cancelEditPhrase(){ setEditingPhrase(null); R.host(); }
export async function deletePhrase(id){
  state.phraseBank=state.phraseBank.filter(x=>x.id!==id);
  if(editingPhrase===id) setEditingPhrase(null);
  await saveLobby(); R.host();
}
