/* host/index.js
   The host console: the operator's surface. Topbar, the Setup / Play / Rules
   tabs, the flow card that drives a question, the quick-adjust rail, and the
   setup wizard.

   This is the only surface that changes game state directly; the TV and the
   phones render from what the host has already committed. */

import { openAdjustModal } from './adjust.js';
import { renderGameTab } from './game.js';
import { renderRulesTab } from './rules.js';
import { renderSetupTab } from './setup.js';
import { renderWagerTab } from './wager.js';

import { LEVEL_MONEY, LIFELINE_DEFS } from '../../core/constants.js';
import { hasSupabase } from '../../core/db.js';
import { saveLobby } from '../../core/lobby.js';
import { currentLobbyCode, editingPhrase, editingQuestion, hostTab, lastWheelSeen, mode, seenWagerIds, setActiveHostTab, setLastWheelSeen, setSetupStep, setupStep } from '../../core/session.js';
import { state } from '../../core/state.js';
import { debounce, esc, letterFor, money } from '../../core/util.js';
import { loadTestData } from '../../dev/testdata.js';
import { advanceLevelNoMoney, changeHotSeatPick, confirmBombWheel, confirmHotSeatReveal, confirmWheelWinner, dismissDefendedSteal, flowAdvance, getNextInLine, hostDrawQuestion, hostSelectAnswer, hostSetStealVote, lockStealAnswer, markCorrect, raceSwapAfterMiss, rerollQuestion, resolveSteal, retryDoubleDip, revealCorrectAnswer, unlockStealAnswer } from '../../rules/flow.js';
import { activeLevel, elapsedMinutes, hotSeatPlayer, levelDiff, levelMoney, levelType, opposingTeam, teamName } from '../../rules/ladder.js';
import { spinWheel, undoLifeline, useLifeline } from '../../rules/lifelines.js';
import { addPlayer, deletePlayer, setHotSeat, startHosting, togglePlayerTeam } from '../../rules/players.js';
import { correctDisplayIdx } from '../../rules/pool.js';
import { exportQuestionsMarkdown, importQuestionsMarkdown } from '../../rules/porting.js';
import { pausePuzzleTimer, puzzleSolved, resumePuzzleTimer, swapPuzzleHotSeat, triggerPuzzle } from '../../rules/puzzle.js';
import { cancelEditPhrase, cancelEditQuestion, deletePhrase, deleteQuestion, resetAllUsedFlags, savePhraseFromForm, saveQuestionFromForm, startEditPhrase, startEditQuestion } from '../../rules/questions.js';
import { applyAdjustment, newGame } from '../../rules/score.js';
import { finalizeWager, revealWagerQuestion } from '../../rules/wager.js';
import { resolvedOutcomeFor, wheelOutcomeResultText } from '../../rules/wheel.js';
import { diffPill, ladderStripHTML } from '../../ui/atoms.js';
import { chairIconSVG } from '../../ui/icons.js';
import { setPendingModal, showModal, showPicker } from '../../ui/modal.js';
import { buildBoardHTML, buildKeyboardHTML, puzzleTimerHTML, startPuzzleTimerRAF } from '../../ui/puzzle-view.js';
import { animateWheel, buildWheelHTML, wheelResultText } from '../../ui/wheel-view.js';
import { renderEndScreen } from '../entry.js';

export function renderHost(){
  if(mode!=='host') return;
  const root=document.getElementById('app-root');
  // preserve input values
  const preserve=['q-text','q-opt-a','q-opt-b','q-opt-c','q-opt-d','phrase-cat','phrase-text','player-name-input','setup-team-a','setup-team-b','adjust-amount','adjust-reason'];
  const saved={};
  preserve.forEach(id=>{ const el=document.getElementById(id); if(el) saved[id]=el.value; });
  const savedTeamSel=document.getElementById('player-team-input')?.value;
  const savedDiff=document.getElementById('q-diff')?.value;
  const savedAdjTarget=document.getElementById('adjust-target')?.value;

  const syncWarn=hasSupabase?'':
    `<div class="sync-warning">⚠ Supabase not configured — running in single-device mode. Phone voting and multi-device sync require Supabase. Add your credentials to the file.</div>`;

  // Topbar
  const hp=hotSeatPlayer();
  const ll=state.lifelines[state.hotSeatTeam];
  const teamAPlayers=state.players.filter(p=>p.team==='A');
  const teamBPlayers=state.players.filter(p=>p.team==='B');
  const setupLocked=state.gamePhase==='setup';
  const activeHostTab=setupLocked&&hostTab!=='rules'?'setup':hostTab;

  const topbar=`<div class="topbar">
    <span class="topbar-brand" style="display:inline-flex;align-items:center;">
      <span style="width:30px;height:auto;flex-shrink:0;">${chairIconSVG()}</span>
    </span>
    <span class="topbar-code">${esc(state.lobbyName||currentLobbyCode)}</span>
    <div class="tabs">
      <button class="tab-btn ${activeHostTab==='setup'?'active':''}" onclick="setHostTab('setup')">1 · Setup</button>
      <button class="tab-btn ${activeHostTab==='game'?'active':''}" ${setupLocked?'disabled title="Finish setup and Start Hosting first"':''} onclick="setHostTab('game')">2 · Play</button>
      <button class="tab-btn ${activeHostTab==='rules'?'active':''}" onclick="setHostTab('rules')">Rules</button>
    </div>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;position:relative;">
      <button class="btn btn-ghost btn-sm" onclick="openDisplay()">Display</button>
      <div style="position:relative;">
        <button class="btn btn-ghost btn-sm" onclick="togglePlayerLinkPopover()">Players</button>
        <div id="player-link-popover" class="link-popover">
          <input type="text" id="player-link-input" class="input" readonly onclick="this.select()">
          <button class="btn btn-primary btn-sm" id="player-link-copy-btn" onclick="copyPlayerLinkFromPopover()">Copy</button>
        </div>
      </div>
      <div style="width:1px;height:22px;background:var(--c-border);margin:0 2px;"></div>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="openHostMoreMenu()" title="More">⋯</button>
    </div>
  </div>`;

  // Reference strip — secondary info (teams/scores + ladder + pacing), not primary controls
  const isRaceMode=state.gameMode==='race';
  const ladderBar=state.gamePhase==='live'||state.gamePhase==='wager'||state.gamePhase==='puzzle'?
    `<div class="ref-strip">
      <div class="team-strip" style="row-gap:6px;">
        <span class="team-label">${esc(state.teamAName)}</span>
        ${isRaceMode?`<span class="money-sm">Level ${activeLevel('A')}</span>`:`<span class="money-sm">${money(state.teamABank)}</span>`}
        ${teamAPlayers.map(p=>`<button class="player-chip ${state.hotSeatPlayerId===p.id?'is-hot':''}" onclick="setHotSeat('${p.id}')">${esc(p.name)}${isRaceMode?'':`<span class="chip-bank">${money(p.personalBank)}</span>`}</button>`).join('')}
        <div class="ref-strip-divider"></div>
        <span class="team-label">${esc(state.teamBName)}</span>
        ${isRaceMode?`<span class="money-sm">Level ${activeLevel('B')}</span>`:`<span class="money-sm">${money(state.teamBBank)}</span>`}
        ${teamBPlayers.map(p=>`<button class="player-chip ${state.hotSeatPlayerId===p.id?'is-hot':''}" onclick="setHotSeat('${p.id}')">${esc(p.name)}${isRaceMode?'':`<span class="chip-bank">${money(p.personalBank)}</span>`}</button>`).join('')}
      </div>
      <div class="ref-strip-ladder">
        ${isRaceMode?`
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-right:4px;">${esc(state.teamAName)}</span>
          ${ladderStripHTML('A')}
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin:0 4px 0 10px;">${esc(state.teamBName)}</span>
          ${ladderStripHTML('B')}
        `:`
          <span style="font-size:11px;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-right:4px;">Level</span>
          ${ladderStripHTML()}
          <span class="money-sm" style="margin-left:8px;">${money(levelMoney(state.ladderCurrent))} up</span>
        `}
        ${state.hostingStartedAt?`<span class="pacing-badge" title="Time since hosting started">⏱ ${elapsedMinutes()}m in</span>`:''}
      </div>
    </div>`:'';

  let body='';
  if(hostTab==='rules'){
    body=renderRulesTab();
  } else if(state.gamePhase==='setup'||hostTab==='setup'){
    body=renderSetupTab();
  } else if(state.gamePhase==='ended'){
    body=renderEndedHost();
  } else if(state.gamePhase==='wager'){
    body=renderWagerTab();
  } else {
    body=renderGameTab();
  }

  root.innerHTML=`${topbar}${ladderBar}
    <div class="main-content">
      ${syncWarn}
      ${body}
    </div>`;

  // Restore inputs
  preserve.forEach(id=>{ const el=document.getElementById(id); if(el&&saved[id]!==undefined) el.value=saved[id]; });
  if(savedTeamSel){ const el=document.getElementById('player-team-input'); if(el) el.value=savedTeamSel; }
  if(savedDiff){ const el=document.getElementById('q-diff'); if(el) el.value=savedDiff; }
  if(savedAdjTarget){ const el=document.getElementById('adjust-target'); if(el) el.value=savedAdjTarget; }

  // Wire team name inputs
  const ta=document.getElementById('setup-team-a');
  const tb=document.getElementById('setup-team-b');
  if(ta) ta.addEventListener('input', debounce(e=>{ state.teamAName=e.target.value; saveLobby(); },400));
  if(tb) tb.addEventListener('input', debounce(e=>{ state.teamBName=e.target.value; saveLobby(); },400));

  // Wheel animation (only once it's actually been spun)
  if(state.wheel&&state.wheel.spunAt&&state.wheel.spunAt!==lastWheelSeen){
    setLastWheelSeen(state.wheel.spunAt);
    animateWheel(state.wheel,'host');
  } else if(state.wheel&&state.wheel.spunAt){
    const disc=document.getElementById('wheel-disc-host');
    if(disc){ const n=state.wheel.names.length,seg=360/n; disc.style.transition='none'; disc.style.transform=`rotate(${360*6+(360-(state.wheel.winnerIdx*seg+seg/2))}deg)`; }
    const res=document.getElementById('wheel-result-host');
    if(res) res.textContent=state.wheel.outcomes?wheelOutcomeResultText(resolvedOutcomeFor(state.wheel)):wheelResultText(state.wheel);
  }

  // Puzzle timer RAF
  if(state.puzzle.active&&!state.puzzle.timerPaused) startPuzzleTimerRAF();
}

export function renderEndedHost(){
  return renderEndScreen();
}

export function setHostTab(t){ setActiveHostTab(t); renderHost(); }
export function openDisplay(){
  const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='display';
  window.open(url.toString(),'_blank');
}
export function togglePlayerLinkPopover(){
  const pop=document.getElementById('player-link-popover'); if(!pop) return;
  const isOpen=pop.classList.contains('show');
  document.querySelectorAll('.link-popover.show').forEach(p=>p.classList.remove('show'));
  if(!isOpen){
    const url=new URL(location.href); url.searchParams.set('lobby',currentLobbyCode); url.hash='player';
    document.getElementById('player-link-input').value=url.toString();
    pop.classList.add('show');
  }
}
export async function copyPlayerLinkFromPopover(){
  const input=document.getElementById('player-link-input');
  input.select();
  try{ await navigator.clipboard.writeText(input.value); }catch(e){}
  const btn=document.getElementById('player-link-copy-btn');
  if(btn){ const orig=btn.textContent; btn.textContent='Copied'; setTimeout(()=>{ if(btn) btn.textContent=orig; },1200); }
}
document.addEventListener('click',(e)=>{
  const pop=document.getElementById('player-link-popover');
  if(pop&&pop.classList.contains('show')&&!e.target.closest('#player-link-popover')&&e.target.getAttribute('onclick')!=='togglePlayerLinkPopover()'){
    pop.classList.remove('show');
  }
});
export function openHostMoreMenu(){
  showPicker('More actions', [
    {label:'Manual Adjustment', value:'adjust'},
    {label:'New Game', value:'newgame'},
  ], v=>{
    if(v==='adjust') openAdjustModal();
    else if(v==='newgame') newGame();
  });
}

/* ============================================================
   Part 6: TV Display render
   ============================================================ */

/* Re-exported so main.js's inline-handler barrel has one place to import the
   host surface from, even though each tab lives in its own file. */
export { openAdjustModal, quickAdjust } from './adjust.js';
export { goSetupStep, setGameMode, toggleLevelType } from './setup.js';
