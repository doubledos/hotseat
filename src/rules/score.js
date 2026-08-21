/* score.js
   Manual score adjustments, ending the game, and resetting for a new one.

   Adjustments are recorded in state.adjustments rather than silently folded
   into the bank, so the host can see what was changed and why. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { setPendingModal, showModal } from '../ui/modal.js';
import { esc, genId, money } from '../core/util.js';
import { setActiveHostTab, setSetupStep } from '../core/session.js';
import { playerById, teamName } from './ladder.js';

/* ===== Score adjustments ===== */
export async function applyAdjustment(targetType, targetId, amount, reason){
  // targetType: 'player' | 'teamA' | 'teamB'
  const adj={id:genId(),targetType,targetId,amount,reason:reason||'Manual adjustment',ts:Date.now()};
  state.adjustments.push(adj);
  if(targetType==='player'){
    const p=playerById(targetId);
    if(p) p.personalBank=Math.max(0,(p.personalBank||0)+amount);
  } else if(targetType==='teamA'){
    state.teamABank=Math.max(0,(state.teamABank||0)+amount);
  } else if(targetType==='teamB'){
    state.teamBBank=Math.max(0,(state.teamBBank||0)+amount);
  }
  await saveLobby(); R.host();
}


/* ===== Ending ===== */
export async function endGame(){
  state.ended=true; state.gamePhase='ended';
  await saveLobby(); R.all();
}

/* ===== New game ===== */
export function newGame(){
  document.getElementById('modal-icon').style.display='none';
  document.getElementById('modal-message').innerHTML='<b>Start a New Game</b><div style="font-size:13px;color:var(--c-muted);font-weight:400;margin-top:4px;">Scores, ladder, and lifelines always reset.</div>';
  document.getElementById('modal-picker').style.display='none';
  const wrap=document.getElementById('modal-input-wrap');
  wrap.style.display='block';
  wrap.innerHTML=`
    <label style="display:flex;align-items:center;gap:8px;font-size:14px;text-align:left;margin-bottom:10px;cursor:pointer;">
      <input type="checkbox" id="ng-keep-players" checked style="width:16px;height:16px;flex-shrink:0;"> Keep players &amp; teams
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:14px;text-align:left;cursor:pointer;">
      <input type="checkbox" id="ng-keep-questions" checked style="width:16px;height:16px;flex-shrink:0;"> Keep questions &amp; puzzle phrases
    </label>`;
  const confirmBtn=document.getElementById('modal-confirm-btn');
  confirmBtn.style.display=''; confirmBtn.textContent='Start New Game';
  setPendingModal(doNewGame);
  document.getElementById('modal-overlay').classList.add('show');
}
export async function doNewGame(){
  const keepPlayers=document.getElementById('ng-keep-players')?.checked??true;
  const keepQuestions=document.getElementById('ng-keep-questions')?.checked??true;
  state.gamePhase='setup';
  state.hostingStartedAt=0;
  setSetupStep('players');
  state.teamABank=0; state.teamBBank=0;
  if(keepPlayers){ state.players.forEach(p=>p.personalBank=0); }
  else { state.players=[]; state.hotSeatQueue={A:[],B:[]}; state.hotSeatPlayerId=null; }
  state.ladderCurrent=1;
  state.ladderWon=Array(15).fill(false);
  state.ladderWonTeam=Array(15).fill(null);
  state.race={A:{current:1,won:Array(15).fill(false)},B:{current:1,won:Array(15).fill(false)}};
  state.raceWinner=null;
  state.lifelines={A:{promote:false,doubleDip:false,swap:false},B:{promote:false,doubleDip:false,swap:false}};
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  state.puzzle={phrase:'',category:'',revealedLetters:[],usedLetters:[],active:false,glitchAt:0,currentGuessingTeam:'A',timerStartedAt:0,timerPaused:true,timerElapsed:0};
  state.wager={active:false,question:null,wagers:{},revealed:false,resolved:false};
  state.adjustments=[];
  state.ended=false;
  if(keepQuestions){ state.questions.forEach(q=>q.used=false); state.phraseBank.forEach(p=>p.used=false); }
  else { state.questions=[]; state.phraseBank=[]; }
  await saveLobby(); setActiveHostTab('setup'); R.host();
}
