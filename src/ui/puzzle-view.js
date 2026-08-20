/* puzzle-view.js
   Rendering the puzzle round: the letter board, the on-screen keyboard, and
   the countdown timer. Markup only - the rules live in rules/puzzle.js. */

import { state } from '../core/state.js';
import { esc } from '../core/util.js';
import { PUZZLE_TIMER_MS, QWERTY } from '../core/constants.js';
import { pressLetter } from '../rules/puzzle.js';
import { teamName } from '../rules/ladder.js';

export function buildBoardHTML(puzzle, prevSet){
  const phrase=puzzle.phrase||'';
  if(!phrase.trim()) return '<div class="text-muted text-center" style="padding:20px;">No phrase loaded.</div>';
  const revSet=new Set((puzzle.revealedLetters||[]).map(l=>l.toUpperCase()));
  const words=phrase.toUpperCase().split(' ').filter(w=>w.length>0);
  let html='<div class="board-words">';
  words.forEach(word=>{
    html+='<div class="board-word">';
    for(const ch of word){
      if(!/[A-Z]/.test(ch)){
        html+=`<div class="tile" style="background:transparent;border-color:transparent;">${esc(ch)}</div>`;
      } else if(revSet.has(ch)){
        const isNew=prevSet&&!prevSet.has(ch);
        html+=`<div class="tile${isNew?' flip':''}">${ch}</div>`;
      } else {
        html+=`<div class="tile blank"></div>`;
      }
    }
    html+='</div>';
  });
  html+='</div>';
  return html;
}

export function buildKeyboardHTML(puzzle){
  let html='<div class="keyboard">';
  QWERTY.forEach(row=>{
    html+='<div class="kb-row">';
    for(const ch of row){
      const used=(puzzle.usedLetters||[]).includes(ch);
      const hit=(puzzle.revealedLetters||[]).includes(ch);
      let cls='key';
      if(used) cls+=hit?' hit':' miss';
      html+=`<button class="${cls}" ${used?'disabled':''} onclick="pressLetter('${ch}')">${ch}</button>`;
    }
    html+='</div>';
  });
  html+='</div>';
  return html;
}

export function puzzleTimerHTML(puzzle, idSuffix){
  const elapsed=puzzle.timerPaused
    ? (puzzle.timerElapsed||0)
    : (puzzle.timerElapsed||0)+(Date.now()-(puzzle.timerStartedAt||Date.now()));
  const remaining=Math.max(0, PUZZLE_TIMER_MS-elapsed);
  const secs=Math.ceil(remaining/1000);
  const pct=remaining/PUZZLE_TIMER_MS;
  const circ=175.9;
  const offset=circ*(1-pct);
  const urgent=secs<=5;
  return `<div class="puzzle-timer">
    <div class="timer-circle">
      <svg class="timer-svg" viewBox="0 0 60 60">
        <circle class="timer-track" cx="30" cy="30" r="28"/>
        <circle class="timer-fill${urgent?' urgent':''}" cx="30" cy="30" r="28" id="timer-fill-${idSuffix}"
          style="stroke-dashoffset:${offset.toFixed(1)}"/>
      </svg>
      <div class="timer-num" id="timer-num-${idSuffix}">${secs}</div>
    </div>
    <div class="timer-label">${puzzle.timerPaused?'Paused':'Guessing — '+esc(teamName(puzzle.currentGuessingTeam))}</div>
  </div>`;
}
