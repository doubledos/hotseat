/* host/questions.js
   The question bank editor: one textarea holding the whole library.

   There is no per-question form any more. The bank is global and permanent, so
   the useful operations are "paste a batch in" and "fix a line", both of which
   a text field does better than a form.

   Saving is guarded: the text is parsed first, and a bank that does not parse
   is refused with the offending line numbers rather than half-written. */

import { bank } from '../../core/bank.js';
import { bankDraft, bankStatus, isTestMode, testModeForced } from '../../core/session.js';
import { bankText } from '../../rules/bank-edit.js';
import { esc } from '../../core/util.js';

export function renderQuestionsTab(){
  const text = bankDraft===null ? bankText() : bankDraft;
  const dirty = bankDraft!==null;
  const unused = bank.questions.filter(q=>!q.usedAt).length;
  const retired = bank.questions.length - unused;
  const st = bankStatus;

  /* Test mode is stated here as well as on the play screen: this is where a
     bank gets edited, and knowing whether a game will consume questions is
     part of reading the numbers above. */
  const testBanner = isTestMode()
    ? `<div class="bank-testmode">Test mode ${testModeForced()?'(forced — no database configured)':'on'} —
         questions drawn in a game will <b>not</b> be retired.</div>`
    : '';

  return `
    <div class="card">
      <div class="bank-head">
        <div>
          <div class="bank-title">Question bank</div>
          <div class="bank-sub">${bank.questions.length} question${bank.questions.length===1?'':'s'} ·
            <b>${unused}</b> unused · ${retired} retired · ${bank.phrases.length} phrase${bank.phrases.length===1?'':'s'}</div>
        </div>
        <div class="bank-actions">
          <button class="btn btn-ghost btn-sm" onclick="downloadBank()">Download</button>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;">Upload
            <input type="file" accept=".txt,.md" style="display:none;" onchange="uploadBank(this.files[0])">
          </label>
          <button class="btn btn-ghost btn-sm" onclick="undoBankSave()">Undo last save</button>
        </div>
      </div>
      ${testBanner}

      <div class="bank-help">
        One question per line: <code>Question text | correct answer | wrong | wrong | wrong</code>.
        The first answer is the correct one. A leading <code>x</code> marks a question as retired
        (<code>x2026-08-25</code> keeps the date); delete the <code>x</code> to bring it back.
        Blank lines and <code>#</code> comments are ignored. Phrases go below <code>--- PHRASES ---</code>.
      </div>

      <textarea id="bank-text" class="bank-textarea" spellcheck="false"
        oninput="onBankInput(this.value)">${esc(text)}</textarea>

      ${st ? `<div class="bank-status ${st.ok?'is-ok':'is-bad'}">${esc(st.message)}</div>` : ''}
      ${st && st.errors && st.errors.length ? `<div class="bank-errors">${
        st.errors.slice(0,12).map(e=>`<div class="bank-error"><b>line ${e.line}</b> ${esc(e.msg)}<div class="bank-error-src">${esc(e.text)}</div></div>`).join('')
      }${st.errors.length>12?`<div class="bank-error">…and ${st.errors.length-12} more</div>`:''}</div>` : ''}

      <div class="bank-savebar">
        <button class="btn btn-primary" onclick="saveBankFromEditor()">Save bank</button>
        ${dirty?`<button class="btn btn-ghost" onclick="confirmDiscardDraft()">Discard changes</button>
                 <span class="bank-dirty">Unsaved changes</span>`:''}
      </div>
    </div>`;
}
