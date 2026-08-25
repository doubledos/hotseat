/* bank.js
   The question bank: one global library, shared by every game.

   It used to live inside the lobby blob, which meant questions added for one
   game did not exist in the next, and `used` reset every time. It also meant
   every surface re-downloaded the entire bank on every poll, 1.2s apart - at a
   thousand questions that is ~177KB a tick to the TV alone, and the bank is
   meant to grow forever.

   Nothing but the host needs it. The drawn question is copied into the lobby
   blob (currentQuestion, sus.reveal), so the TV and phones already have what
   they render. So the bank lives in its own row and only the host loads it.

     bank:v1        the library
     bank:v1:prev   the version before the last save, for one-step undo

   `bank` is exported as a live binding, the same contract as `state` in
   state.js: mutate its properties freely, never rebind it, call setBank() to
   replace it wholesale. */

import { dbGet, dbSet } from './db.js';

export const BANK_KEY = 'bank:v1';
export const BANK_PREV_KEY = 'bank:v1:prev';

export let bank = { questions: [], phrases: [] };
export function setBank(next){
  bank = { questions: next.questions || [], phrases: next.phrases || [] };
  return bank;
}

let loaded = false;
export function bankLoaded(){ return loaded; }

export async function loadBank(){
  const res = await dbGet(BANK_KEY);
  if(res && res.value){
    try{ setBank(JSON.parse(res.value)); loaded = true; return true; }
    catch(e){ /* fall through - a corrupt row must not wipe the in-memory bank */ }
  }
  loaded = true;
  return false;
}

/* Every save stashes the previous version first. The bank has no per-lobby
   copies to fall back on any more, so a bad paste would otherwise be
   unrecoverable. */
export async function saveBank(){
  const prev = await dbGet(BANK_KEY);
  if(prev && prev.value) await dbSet(BANK_PREV_KEY, prev.value);
  await dbSet(BANK_KEY, JSON.stringify(bank));
}

export async function restorePreviousBank(){
  const res = await dbGet(BANK_PREV_KEY);
  if(!res || !res.value) return false;
  try{
    const parsed = JSON.parse(res.value);
    /* Swap rather than overwrite, so an accidental restore can itself be
       undone by restoring again. */
    await dbSet(BANK_PREV_KEY, JSON.stringify(bank));
    setBank(parsed);
    await dbSet(BANK_KEY, JSON.stringify(bank));
    return true;
  }catch(e){ return false; }
}

/* ===== Drawing ===== */

export function unusedQuestions(){ return bank.questions.filter(q=>!q.usedAt); }
export function unusedPhrases(){ return bank.phrases.filter(p=>!p.usedAt); }

/* Retire a question. In test mode this is a no-op, so our own runs never burn
   the real library - see isTestMode in session.js. */
export function retire(item, testMode){
  if(testMode || !item) return;
  item.usedAt = new Date().toISOString().slice(0,10);
}

/* ===== Migration =====
   Questions from lobbies saved before the bank moved out. Content only: the
   owner sorts out which are spent by hand afterwards, via the textarea, so
   nothing is guessed at here. Text is the identity, so importing the same
   lobby twice does not duplicate. */
export function mergeLegacyQuestions(questions, phrases){
  let added = 0;
  const haveQ = new Set(bank.questions.map(q=>q.text));
  for(const q of (questions||[])){
    if(!q || !q.text || haveQ.has(q.text)) continue;
    haveQ.add(q.text);
    bank.questions.push({id:q.id, text:q.text, options:(q.options||[]).slice(), usedAt:null});
    added++;
  }
  const haveP = new Set(bank.phrases.map(p=>p.phrase));
  for(const p of (phrases||[])){
    if(!p || !p.phrase || haveP.has(p.phrase)) continue;
    haveP.add(p.phrase);
    bank.phrases.push({id:p.id, category:p.category||'', phrase:p.phrase, usedAt:null});
    added++;
  }
  return added;
}
