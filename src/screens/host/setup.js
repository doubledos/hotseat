/* host/setup.js
   The Setup wizard: roster, question bank check, level types, and the Ready
   step that starts the game. */

import { LEVEL_MONEY } from '../../core/constants.js';
import { saveLobby } from '../../core/lobby.js';
import { editingPhrase, mode, setSetupStep, setupStep } from '../../core/session.js';
import { state } from '../../core/state.js';
import { esc, money } from '../../core/util.js';
import { loadTestData } from '../../dev/testdata.js';
import { teamName } from '../../rules/ladder.js';
import { addPlayer, deletePlayer, startHosting, togglePlayerTeam } from '../../rules/players.js';
import { cancelEditPhrase, deletePhrase, savePhraseFromForm, startEditPhrase } from '../../rules/questions.js';
import { renderHost } from './index.js';
import { renderQuestionsTab } from './questions.js';
import { showModal } from '../../ui/modal.js';

export function renderSetupTab(){
  const players=state.players;
  const aCount=players.filter(p=>p.team==='A').length;
  const bCount=players.filter(p=>p.team==='B').length;
  const qCount=state.questions.length;
  const hardFail=players.length<2||aCount<1||bCount<1;
  const checks=[
    {ok:players.length>=2,text:`Players: ${players.length} added (need ≥2)`},
    {ok:aCount>=1&&bCount>=1,text:`Both teams have players (${state.teamAName}: ${aCount}, ${state.teamBName}: ${bCount})`},
    {ok:qCount>=15,level:qCount>=15?'ok':qCount>=5?'warn':'bad',text:`Questions: ${qCount} in pool (recommend ≥15)`},
  ];

  const playersBody=`
    ${state.players.length===0&&state.questions.length===0?`<div class="quickstart-row">
      <span>Just want to try it out?</span>
      <button class="btn btn-ghost btn-sm" onclick="loadTestData()">Load Test Data</button>
    </div>`:''}
    <div class="field" style="margin-bottom:16px;">
      <label>Game Mode</label>
      <div class="mode-toggle">
        <button class="mode-opt ${state.gameMode==='classic'?'is-active':''}" onclick="setGameMode('classic')">
          <b>Classic</b><span>Shared ladder, team money, steals &amp; Final Wager</span>
        </button>
        <button class="mode-opt ${state.gameMode==='race'?'is-active':''}" onclick="setGameMode('race')">
          <b>Race Mode</b><span>Separate ladders — first team to level 15 wins, no money</span>
        </button>
      </div>
    </div>
    <div class="two-col">
      <div>
        <div class="field"><label>Name</label><input type="text" class="input" id="player-name-input" placeholder="Player name"></div>
        <div class="field"><label>Team</label><select class="input" id="player-team-input"><option value="A">${esc(state.teamAName)}</option><option value="B">${esc(state.teamBName)}</option></select></div>
        <button class="btn btn-primary btn-sm" onclick="addPlayer()">+ Add Player</button>
        <hr class="divider">
        <div class="field"><label>Team A name</label><input type="text" class="input" id="setup-team-a" value="${esc(state.teamAName)}"></div>
        <div class="field"><label>Team B name</label><input type="text" class="input" id="setup-team-b" value="${esc(state.teamBName)}"></div>
      </div>
      <div class="q-list">
        ${players.length===0?'<div class="hint">No players yet.</div>':players.map(p=>`
          <div class="q-row">
            <div class="q-row-text"><b>${esc(p.name)}</b><div class="q-row-sub">${esc(teamName(p.team))}</div></div>
            <div class="q-row-actions">
              <button class="btn btn-ghost btn-sm" onclick="togglePlayerTeam('${p.id}')">Switch Team</button>
              <button class="btn btn-danger btn-sm" onclick="showModal('','Remove ${esc(p.name)}?','Remove',()=>deletePlayer('${p.id}'))">✕</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  const levelRow=l=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:20px;font-weight:700;font-size:13px;color:var(--c-muted);">${l}</span>
        <span class="money-sm" style="width:76px;">${money(LEVEL_MONEY[l-1])}</span>
        <button class="btn btn-ghost btn-sm" style="min-width:72px;${state.levelTypes[l-1]==='puzzle'?'border-color:var(--c-purple);color:#c070f0;':''}" onclick="toggleLevelType(${l})">
          ${state.levelTypes[l-1]==='puzzle'?'Puzzle':'Trivia'}
        </button>
      </div>`;
  const levelBody=`<div class="hint" style="margin-bottom:10px;">All levels default to Easy unless changed. Set a level to Puzzle to use a word puzzle instead of a question.</div>
    <div class="two-col">
      <div>${Array.from({length:8},(_,i)=>i+1).map(levelRow).join('')}</div>
      <div>${Array.from({length:7},(_,i)=>i+9).map(levelRow).join('')}</div>
    </div>`;

  const phraseBody=`
    <div class="row">
      <div class="field"><label>Category</label><input type="text" class="input" id="phrase-cat" placeholder="Movie Title"></div>
      <div class="field w2"><label>${editingPhrase?'Editing phrase':'Phrase'}</label><input type="text" class="input" id="phrase-text" placeholder="THE FULL ANSWER IN CAPS"></div>
    </div>
    <div class="row">
      <button class="btn btn-primary btn-sm" onclick="savePhraseFromForm()">${editingPhrase?'Save Changes':'Add Phrase'}</button>
      ${editingPhrase?'<button class="btn btn-ghost btn-sm" onclick="cancelEditPhrase()">Cancel</button>':''}
    </div>
    <div class="q-list">
      ${state.phraseBank.length===0?'<div class="hint">No phrases yet.</div>':state.phraseBank.map(p=>`
        <div class="q-row ${editingPhrase===p.id?'editing':''}">
          <div class="q-row-text">${p.category?`<span class="diff-puzzle" style="margin-right:6px;">${esc(p.category)}</span>`:''}${esc(p.phrase)}</div>
          <div class="q-row-actions">
            ${p.used?'<span class="used-tag">Used</span>':''}
            <button class="btn btn-ghost btn-sm" onclick="startEditPhrase('${p.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="showModal('','Delete this phrase?','Delete',()=>deletePhrase('${p.id}'))">✕</button>
          </div>
        </div>`).join('')}
    </div>`;

  const readyBody=`
    <div class="checklist">
      ${checks.map(c=>`<div class="check-item"><span class="${c.ok?'check-ok':'check-bad'}">${c.ok?'✓':'✗'}</span>${esc(c.text)}</div>`).join('')}
    </div>
    <button class="btn btn-primary btn-block mt-12" ${hardFail?'disabled':''} onclick="startHosting()">Start Hosting</button>
    ${hardFail?'<div class="hint mt-8">Fix issues above to start.</div>':''}`;

  const steps=[
    {key:'players', num:1, icon:'', label:'Players & Teams', body:playersBody},
    {key:'questions', num:2, icon:'', label:'Questions', body:renderQuestionsTab()},
    {key:'levels', num:3, icon:'', label:'Levels & Puzzles', body:levelBody+'<hr class="divider">'+phraseBody},
    {key:'ready', num:4, icon:'', label:'Ready Check', body:readyBody},
  ];
  if(!steps.some(s=>s.key===setupStep)) setSetupStep('players');
  const idx=steps.findIndex(s=>s.key===setupStep);
  const cur=steps[idx];

  const stepRail=`<div class="setup-steps">
    ${steps.map(s=>`<button class="setup-step-pill ${s.key===setupStep?'active':''}" onclick="goSetupStep('${s.key}')">
      <span class="setup-step-num">${s.num}</span>${s.label}
    </button>`).join('')}
  </div>`;

  const prevBtn=idx>0?`<button class="btn btn-ghost" onclick="goSetupStep('${steps[idx-1].key}')">← Back</button>`:'<span></span>';
  const nextBtn=idx<steps.length-1?`<button class="btn btn-primary" onclick="goSetupStep('${steps[idx+1].key}')">Next →</button>`:'<span></span>';

  return `${stepRail}
    <div class="card" style="max-width:1100px;margin:0 auto;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:var(--c-gold);font-weight:700;margin-bottom:14px;">${cur.label}</div>
      ${cur.body}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--c-border);">
        ${prevBtn}${nextBtn}
      </div>
    </div>`;
}
export function goSetupStep(step){ setSetupStep(step); renderHost(); }
export async function setGameMode(m){
  if(state.gamePhase!=='setup') return; // locked once hosting has started
  state.gameMode=m;
  await saveLobby(); renderHost();
}

export async function toggleLevelType(l){
  state.levelTypes[l-1]=state.levelTypes[l-1]==='puzzle'?'':'puzzle';
  await saveLobby(); renderHost();
}
