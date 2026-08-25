/* bank-edit.js
   Editing the question bank as text.

   The whole library is one textarea. Saving re-parses it and replaces the bank
   wholesale, which is only safe because parseBank is all-or-nothing: if any
   line is malformed the save is refused, the errors name their line numbers,
   and the stored bank is left exactly as it was.

   Replaces the old per-question form and the markdown file import/export. */

import { bank, setBank, saveBank, loadBank, restorePreviousBank, mergeLegacyQuestions } from '../core/bank.js';
import { parseBank, serialiseBank, describeParse } from '../core/bank-format.js';
import { genId } from '../core/util.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { bankDraft, setBankDraft, setBankStatus } from '../core/session.js';

/* What the textarea shows: the stored bank, serialised. */
export function bankText(){ return serialiseBank(bank); }

/* Parse the textarea without committing, so the host can see what a save would
   do - and what is wrong - before anything is written. */
export function checkBankText(text){
  const res = parseBank(text, {makeId: genId});
  setBankStatus({ok: res.ok, message: describeParse(res), errors: res.errors});
  R.host();
  return res;
}

export async function saveBankText(text){
  const res = parseBank(text, {makeId: genId});
  if(!res.ok){
    /* Refused. Nothing is written - the stored bank is untouched. */
    setBankStatus({ok:false, message:describeParse(res), errors:res.errors});
    R.host();
    return false;
  }
  setBank({questions:res.questions, phrases:res.phrases});
  await saveBank();
  setBankDraft(null);
  setBankStatus({ok:true, message:`Saved — ${describeParse(res)}`, errors:[]});
  R.host();
  return true;
}

export async function undoBankSave(){
  const ok = await restorePreviousBank();
  setBankDraft(null);
  setBankStatus(ok
    ? {ok:true, message:`Restored the previous version — ${bank.questions.length} questions.`, errors:[]}
    : {ok:false, message:'No previous version stored yet.', errors:[]});
  R.host();
}

export function downloadBank(){
  const blob = new Blob([bankText()], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hotseat-questions-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* Upload replaces the textarea, not the bank. The host still has to read the
   parse result and press Save, so a bad file cannot overwrite the library in
   one click. */
export function uploadBank(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    setBankDraft(String(e.target.result||''));
    checkBankText(bankDraftOrText());
  };
  reader.readAsText(file);
}

export function bankDraftOrText(){ return bankDraft===null ? bankText() : bankDraft; }

/* One-time pull of questions from a lobby saved before the bank moved out.
   Content only - everything arrives unused, and the textarea is the tool for
   marking what is actually spent. */
export async function importLegacyBank(legacyQuestions, legacyPhrases){
  await loadBank();
  const added = mergeLegacyQuestions(legacyQuestions, legacyPhrases);
  if(added) await saveBank();
  setBankDraft(null);
  setBankStatus({ok:true, message:`Imported ${added} item${added===1?'':'s'} from this lobby.`, errors:[]});
  R.host();
  return added;
}

export function confirmDiscardDraft(){
  showModal('', 'Discard your unsaved edits and reload the stored bank?', 'Discard', ()=>{
    setBankDraft(null);
    setBankStatus(null);
    R.host();
  });
}

/* Typing only stashes the draft. Deliberately does NOT repaint: re-rendering
   the host on every keystroke would replace the textarea and throw the cursor
   back to the start, which makes editing a long bank impossible. The parse
   result appears when the host asks for it, on save. */
export function onBankInput(value){ setBankDraft(value); }

export function saveBankFromEditor(){
  const el = typeof document!=='undefined' && document.getElementById('bank-text');
  return saveBankText(el ? el.value : bankDraftOrText());
}
