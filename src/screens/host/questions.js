/* host/questions.js
   The Questions tab: question and phrase bank editing, plus markdown
   import / export. */

import { editingQuestion } from '../../core/session.js';
import { state } from '../../core/state.js';
import { esc } from '../../core/util.js';
import { exportQuestionsMarkdown, importQuestionsMarkdown } from '../../rules/porting.js';
import { cancelEditQuestion, deleteQuestion, resetAllUsedFlags, saveQuestionFromForm, startEditQuestion } from '../../rules/questions.js';
import { diffPill } from '../../ui/atoms.js';
import { showModal } from '../../ui/modal.js';

export function renderQuestionsTab(){
  const byDiff={easy:[],medium:[],hard:[]};
  state.questions.forEach(q=>{ (byDiff[q.difficulty]||byDiff.easy).push(q); });
  const formHtml=`
    <div class="card card-sm" style="margin-bottom:14px;">
      <div style="font-size:13px;font-weight:700;color:var(--c-gold);margin-bottom:10px;">${editingQuestion?'Editing Question':'New Question'}</div>
      <div class="field"><label>Question</label><textarea class="input" id="q-text" rows="2" placeholder="Question text"></textarea></div>
      <div class="field">
        <label>Answers — <b style="color:var(--c-gold-light);">A is always correct</b>; fill only A for hidden-answer</label>
        <div class="row"><div class="field"><input type="text" class="input" id="q-opt-a" placeholder="A — correct answer"></div><div class="field"><input type="text" class="input" id="q-opt-b" placeholder="B (optional)"></div></div>
        <div class="row"><div class="field"><input type="text" class="input" id="q-opt-c" placeholder="C (optional)"></div><div class="field"><input type="text" class="input" id="q-opt-d" placeholder="D (optional)"></div></div>
      </div>
      <div class="field"><label>Difficulty</label><select class="input" id="q-diff"><option value="easy">Easy (Levels 1-5)</option><option value="medium">Medium (Levels 6-10)</option><option value="hard">Hard (Levels 11-15)</option></select></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" onclick="saveQuestionFromForm()">${editingQuestion?'Save':'Add Question'}</button>
        ${editingQuestion?'<button class="btn btn-ghost btn-sm" onclick="cancelEditQuestion()">Cancel</button>':''}
      </div>
    </div>
    <div class="bank-tools">
      <button class="btn btn-ghost btn-sm" onclick="exportQuestionsMarkdown()">Export .md</button>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;">Import .md <input type="file" accept=".md,.txt" style="display:none;" onchange="importQuestionsMarkdown(this.files[0])"></label>
      <span class="bank-tools-sep"></span>
      <button class="btn btn-danger btn-sm" onclick="showModal('','Mark every question and phrase unused again?','Reset All',resetAllUsedFlags)">Reset every Used mark</button>
    </div>
  `;
  const listHtml=['easy','medium','hard'].map(diff=>{
    const qs=byDiff[diff];
    return `<div style="margin-bottom:16px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:6px;">${diffPill(diff)} — ${qs.length} question${qs.length===1?'':'s'}</div>
      <div class="q-list">
        ${qs.length===0?`<div class="hint">No ${diff} questions yet.</div>`:qs.map(q=>`
          <div class="q-row ${editingQuestion===q.id?'editing':''}">
            <div class="q-row-text">
              ${esc(q.text)}
              <div class="q-row-sub">✓ ${esc((q.options||[])[0]||'')} · ${(q.options||[]).length} option${(q.options||[]).length===1?' (hidden)':'s'}</div>
            </div>
            <div class="q-row-actions">
              ${q.used?'<span class="used-tag">Used</span>':''}
              <button class="btn btn-ghost btn-sm" onclick="startEditQuestion('${q.id}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="showModal('','Delete this question?','Delete',()=>deleteQuestion('${q.id}'))">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  return `<div class="two-col"><div>${formHtml}</div><div>${listHtml}</div></div>`;
}
