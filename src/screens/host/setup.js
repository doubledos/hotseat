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
import { unusedQuestionCount } from '../../rules/pool.js';

export function renderSetupTab(){
  const players=state.players;
  const aCount=players.filter(p=>p.team==='A').length;
  const bCount=players.filter(p=>p.team==='B').length;
  const qCount=state.questions.length;
  const hardFail=players.length<2||aCount<1||bCount<1;

  /* Two different kinds of "not ready", which the old single checklist ran
     together: a blocker actually stops Start Hosting, a recommendation does
     not. A thin question bank used to render as a red cross next to an enabled
     Start button, which reads as "you are stuck" when you are not. */
  const checks=[
    {level:players.length>=2?'ok':'bad', blocking:true, step:'players',
      text:players.length>=2?`${players.length} players added`:`Only ${players.length} player${players.length===1?'':'s'} — needs at least 2`},
    {level:aCount>=1&&bCount>=1?'ok':'bad', blocking:true, step:'players',
      text:`${esc(state.teamAName)}: ${aCount} · ${esc(state.teamBName)}: ${bCount}${aCount<1||bCount<1?' — both teams need a player':''}`},
    {level:qCount>=15?'ok':'warn', blocking:false, step:'questions',
      text:qCount===0?'No questions in the bank — the game has nothing to draw':`${qCount} question${qCount===1?'':'s'} in the bank${qCount<15?' — 15 or more makes for a full game':''}`},
    {level:state.phraseBank.length>0||!state.levelTypes.includes('puzzle')?'ok':'warn', blocking:false, step:'levels',
      text:state.levelTypes.includes('puzzle')
        ?`${state.levelTypes.filter(t=>t==='puzzle').length} puzzle level${state.levelTypes.filter(t=>t==='puzzle').length===1?'':'s'} · ${state.phraseBank.length} phrase${state.phraseBank.length===1?'':'s'} to draw from`
        :'No puzzle levels set — every level is a trivia question'},
  ];
  /* Red is reserved for "this stops you starting" in both the rail and the
     checklist. Gold means look at it; the game will still run. */
  const glyph={ok:'✓',warn:'!',bad:'✗'};
  const stepState={
    players:hardFail?'bad':'ok',
    questions:qCount>=15?'ok':'warn',
    levels:'none',
    ready:hardFail?'bad':'ok',
  };

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
        <button class="mode-opt ${state.gameMode==='sus'?'is-active':''}" onclick="setGameMode('sus')">
          <b>Sus Mode</b><span>One secret saboteur — everyone answers, the group votes</span>
        </button>
      </div>
    </div>
    ${state.gameMode==='sus'?susSetupHTML():''}
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

  const checkRow=c=>`<div class="check-item">
      <span class="check-glyph check-${c.level}">${glyph[c.level]}</span>
      <span class="check-text">${c.text}</span>
      ${c.level==='ok'?'':`<button class="btn btn-ghost btn-sm" onclick="goSetupStep('${c.step}')">Fix this</button>`}
    </div>`;
  const blockers=checks.filter(c=>c.blocking);
  const advisories=checks.filter(c=>!c.blocking);
  const readyBody=`
    <div class="checklist">
      <div class="check-group-label">Required before you can start</div>
      ${blockers.map(checkRow).join('')}
      <div class="check-group-label">Not blocking — worth a look</div>
      ${advisories.map(checkRow).join('')}
    </div>
    <button class="btn btn-primary btn-block btn-lg mt-16" ${hardFail?'disabled':''} onclick="startHosting()">${hardFail?'Start Hosting — not ready yet':'Start Hosting'}</button>
    <div class="hint text-center mt-8">${hardFail
      ?'Clear the required items above to start.'
      :'Locks the game mode and starts the pacing clock. Players, questions and levels stay editable from this tab once you are live.'}</div>`;

  /* Each step says what it is for. Without this the operator has to open a
     step to find out whether it is something they must do or something they
     can skip — and steps 3 and 4 are the two most commonly misread. */
  const steps=[
    {key:'players', num:1, label:'Players & Teams', body:playersBody,
      blurb:'Who is playing, and which team they sit with. At least one player on each side.'},
    {key:'questions', num:2, label:'Questions', body:renderQuestionsTab(),
      blurb:'The trivia bank the game draws from. Answer A is always the correct one.'},
    {key:'levels', num:3, label:'Levels & Puzzles', body:levelBody+'<hr class="divider">'+phraseBody,
      blurb:'Optional. Turn any of the 15 levels into a word puzzle, and stock the phrases they pull from.'},
    {key:'ready', num:4, label:'Ready Check', body:readyBody,
      blurb:'What the game still needs before you can go live.'},
  ];
  if(!steps.some(s=>s.key===setupStep)) setSetupStep('players');
  const idx=steps.findIndex(s=>s.key===setupStep);
  const cur=steps[idx];

  const stepRail=`<div class="setup-steps">
    ${steps.map(s=>`<button class="setup-step-pill state-${stepState[s.key]} ${s.key===setupStep?'active':''}" onclick="goSetupStep('${s.key}')">
      <span class="setup-step-num">${stepState[s.key]==='ok'?'✓':s.num}</span>${s.label}
    </button>`).join('')}
  </div>`;

  const prevBtn=idx>0?`<button class="btn btn-ghost" onclick="goSetupStep('${steps[idx-1].key}')">← ${steps[idx-1].label}</button>`:'<span></span>';
  const nextBtn=idx<steps.length-1?`<button class="btn btn-primary" onclick="goSetupStep('${steps[idx+1].key}')">${steps[idx+1].label} →</button>`:'<span></span>';

  return `${stepRail}
    <div class="card setup-card">
      <div class="setup-head">
        <div class="setup-head-title">Step ${cur.num} of 4 · ${cur.label}</div>
        <div class="setup-head-blurb">${cur.blurb}</div>
      </div>
      ${cur.body}
      <div class="setup-foot">${prevBtn}${nextBtn}</div>
    </div>`;
}
/* Sus mode deals a distinct question to every player, every round, and never
   reuses one. That means rounds x players questions before a game can start -
   10 x 6 is 60, which is far more than the ladder game ever needs. Without
   this check the game would deal fine for a few rounds and then strand with
   players holding nothing, so the shortfall is stated up front and in the
   host's terms: how many are missing, not just that something is wrong. */
export function susQuestionsNeeded(){
  return state.sus.totalRounds * Math.max(1, state.players.length);
}
export function susBankShortfall(){
  return Math.max(0, susQuestionsNeeded() - unusedQuestionCount());
}
function susSetupHTML(){
  const need = susQuestionsNeeded();
  const have = unusedQuestionCount();
  const short = Math.max(0, need-have);
  return `<div class="sus-preflight ${short?'is-short':'is-ok'}">
    <div class="sus-preflight-head">${short?'Not enough questions yet':'Question bank is ready'}</div>
    <div class="sus-preflight-body">
      ${state.sus.totalRounds} rounds x ${state.players.length||1} player${state.players.length===1?'':'s'}
      = <b>${need}</b> needed, <b>${have}</b> unused in the bank.
      ${short?`<br><b>Add ${short} more</b> — every player gets their own question each round, and none repeat.`
             :`<br>Enough for a full game.`}
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
