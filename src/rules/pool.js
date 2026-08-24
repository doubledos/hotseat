/* pool.js
   Drawing a question from the bank.

   displayOrder is a shuffle of the four options; index 0 is always the correct
   answer, so correctDisplayIdx finds where it landed on screen. */

import { state } from '../core/state.js';
import { shuffleArray } from '../core/util.js';

export function correctDisplayIdx(q){ return q&&q.displayOrder?q.displayOrder.indexOf(0):-1; }

export function availableQuestions(difficulty){
  const pool = state.questions.filter(q=>q.difficulty===difficulty&&!q.used);
  if(pool.length) return pool;
  return state.questions.filter(q=>q.difficulty===difficulty); // fallback used ones
}
export function pickQuestion(difficulty){
  let pool = state.questions.filter(q=>q.difficulty===difficulty&&!q.used);
  if(!pool.length) pool = state.questions.filter(q=>q.difficulty===difficulty);
  if(!pool.length) pool = state.questions.filter(q=>!q.used);
  if(!pool.length) pool = state.questions;
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}
/* Sus mode deals one distinct question per player per round, so it needs a
   batch rather than a single draw, and it ignores difficulty - a round is a
   group check, not a rung on a ladder.

   Unlike pickQuestion this never falls back to already-used questions. Handing
   two players the same question, or reusing one, would let them compare notes
   and would make a wrong answer look like sabotage when it was a repeat. It
   returns fewer than n rather than duplicating; the caller decides what to do,
   and setup blocks the game from starting when the bank is too small. */
export function unusedQuestionCount(){ return state.questions.filter(q=>!q.used).length; }
export function pickSusQuestions(n){
  const pool = shuffleArray(state.questions.filter(q=>!q.used));
  return pool.slice(0, n);
}
export function makeCurrentQuestion(q, level){
  const opts = (q.options||[]).slice();
  return {
    id:q.id, level:level||state.ladderCurrent,
    difficulty:q.difficulty, text:q.text,
    options:opts,
    displayOrder: opts.length>1 ? shuffleArray(opts.map((_,i)=>i)) : [0],
    imageKey: q.imageKey||null,
  };
}
