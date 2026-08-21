/* puzzle.js
   The letter-board round: revealing letters, the guess timer, swapping who is
   solving, and awarding the level when it is solved. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal, showPicker } from '../ui/modal.js';
import { esc } from '../core/util.js';
import { PUZZLE_TIMER_MS } from '../core/constants.js';
import { activeLevel, hotSeatPlayer, levelMoney, opposingTeam, playerById, teamName, winLevel } from './ladder.js';

/* ===== Puzzle ===== */
export async function triggerPuzzle(){
  const avail=state.phraseBank.filter(p=>!p.used);
  const pool=avail.length?avail:state.phraseBank;
  if(!pool.length){ showModal('','No puzzle phrases in the bank. Add some in Setup.',null,null); return; }
  const entry=pool[Math.floor(Math.random()*pool.length)];
  entry.used=true;
  state.puzzle={
    phrase:entry.phrase, category:entry.category||'',
    revealedLetters:[], usedLetters:[],
    active:true, glitchAt:Date.now(),
    currentGuessingTeam:state.hotSeatTeam,
    timerStartedAt:0, timerPaused:true, timerElapsed:0
  };
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  await saveLobby(); R.host();
}

export async function pressLetter(ch){
  if(state.puzzle.usedLetters.includes(ch)) return;
  state.puzzle.usedLetters.push(ch);
  if((state.puzzle.phrase||'').toUpperCase().includes(ch)){
    state.puzzle.revealedLetters.push(ch);
  }
  // Start/reset timer
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  state.puzzle.timerElapsed=0;
  await saveLobby(); R.host();
}

export async function pausePuzzleTimer(){
  if(state.puzzle.timerPaused) return;
  state.puzzle.timerElapsed=(state.puzzle.timerElapsed||0)+(Date.now()-state.puzzle.timerStartedAt);
  state.puzzle.timerPaused=true;
  await saveLobby(); R.host();
}

export async function resumePuzzleTimer(){
  if(!state.puzzle.timerPaused) return;
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  await saveLobby(); R.host();
}

export async function swapPuzzleHotSeat(){
  const other=opposingTeam(state.puzzle.currentGuessingTeam);
  state.puzzle.currentGuessingTeam=other;
  // Move hot seat to next player in queue on other team
  const queue=state.hotSeatQueue[other]||[];
  const candidates=state.players.filter(p=>p.team===other);
  let nextId=null;
  if(queue.length){
    const cur=queue.shift(); queue.push(cur); nextId=queue[0];
  } else if(candidates.length){
    nextId=candidates[0].id;
  }
  if(nextId){ state.hotSeatPlayerId=nextId; state.hotSeatTeam=other; }
  // Reset timer
  state.puzzle.timerStartedAt=Date.now();
  state.puzzle.timerPaused=false;
  state.puzzle.timerElapsed=0;
  await saveLobby(); R.host();
}

export async function puzzleSolved(){
  await pausePuzzleTimer();
  const lvl=activeLevel(); const amt=levelMoney(lvl);
  const hp=hotSeatPlayer();
  if(hp&&state.gameMode==='classic') hp.personalBank=(hp.personalBank||0)+amt;
  if(await winLevel(state.hotSeatTeam, amt)){ state.puzzle.active=false; await saveLobby(); R.host(); return; }
  state.puzzle.active=false;
  state.currentQuestion=null; state.flow={stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false};
  state.steal=null; state.wheel=null;
  await saveLobby(); R.host();
}
