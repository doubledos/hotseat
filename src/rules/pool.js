/* pool.js
   Drawing a question from the global bank.

   displayOrder is a shuffle of the options; index 0 is always the correct
   answer, so correctDisplayIdx finds where it landed on screen.

   There are no difficulty tiers. The game is not played for money, so an easy
   rung has nothing to offer - every level draws from the whole library. */

import { state } from '../core/state.js';
import { bank, unusedQuestions, retire } from '../core/bank.js';
import { isTestMode } from '../core/session.js';
import { shuffleArray } from '../core/util.js';

export function correctDisplayIdx(q){ return q&&q.displayOrder?q.displayOrder.indexOf(0):-1; }

export function unusedQuestionCount(){ return unusedQuestions().length; }

/* A single draw for the ladder game. Retired questions are never handed back:
   with one permanent library, a repeat means someone has already heard it. */
export function pickQuestion(){
  const pool = unusedQuestions();
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}

/* Sus mode deals one distinct question per player per round, so it needs a
   batch. It returns fewer than n rather than repeating: two players holding
   the same question could compare notes, and a repeat would make an honest
   wrong answer look like sabotage. dealSusRound refuses a short round. */
export function pickSusQuestions(n){
  return shuffleArray(unusedQuestions()).slice(0, n);
}

/* Retire what was drawn, unless we are in test mode. This is the single place
   a question is spent, so there is one thing to get right. */
export function spend(q){ retire(q, isTestMode()); }

export function makeCurrentQuestion(q, level){
  const opts = (q.options||[]).slice();
  return {
    id:q.id, level:level||state.ladderCurrent,
    text:q.text,
    options:opts,
    displayOrder: opts.length>1 ? shuffleArray(opts.map((_,i)=>i)) : [0],
    imageKey: q.imageKey||null,
  };
}
