/* Rules tests for Sus mode.

   The scoring and voting maths is the part of this mode that is easy to break
   without noticing: an off-by-one in the threshold, or counting a suspended
   player in the denominator, still renders fine and just quietly plays wrong.

   These functions are pure, so they run in plain node with no DOM:

     node tools/test-sus-rules.mjs
*/

import { state } from '../src/core/state.js';
import { scoreSusRound, susVoteTally, isSuspended, eligiblePlayers, susPassCount } from '../src/rules/sus.js';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`); }
};

/* n players, the first `correct` of whom answered correctly */
const rows = (n, correct) => Array.from({length:n}, (_,i) => ({playerId:'p'+i, pickedIdx: i<correct?1:0, correctIdx:1}));

console.log('-- the 60% bar --');
t('3 of 5 = 60% passes',   scoreSusRound(rows(5,3)),  {passed:true,  correct:3, eligible:5});
t('2 of 5 = 40% fails',    scoreSusRound(rows(5,2)),  {passed:false, correct:2, eligible:5});
t('3 of 4 = 75% passes',   scoreSusRound(rows(4,3)),  {passed:true,  correct:3, eligible:4});
t('2 of 4 = 50% fails',    scoreSusRound(rows(4,2)),  {passed:false, correct:2, eligible:4});
t('6 of 10 = 60% passes',  scoreSusRound(rows(10,6)), {passed:true,  correct:6, eligible:10});
t('5 of 10 = 50% fails',   scoreSusRound(rows(10,5)), {passed:false, correct:5, eligible:10});
t('nobody eligible cannot pass', scoreSusRound([]),   {passed:false, correct:0, eligible:0});

console.log('-- a question left unanswered scores as wrong --');
t('pickedIdx -1 is wrong', scoreSusRound([{pickedIdx:-1,correctIdx:1},{pickedIdx:1,correctIdx:1}]),
  {passed:false, correct:1, eligible:2});
t('one unanswered among five', scoreSusRound(
  [{pickedIdx:-1,correctIdx:1},{pickedIdx:1,correctIdx:1},{pickedIdx:1,correctIdx:1},{pickedIdx:1,correctIdx:1},{pickedIdx:0,correctIdx:1}]),
  {passed:true, correct:3, eligible:5});

console.log('-- a suspended player leaves the denominator entirely --');
state.players = [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}];
state.sus.round = 3;
state.sus.suspendedFor = {e:3};
t('suspended for this round',        isSuspended('e',3), true);
t('back in for the next round',      isSuspended('e',4), false);
t('eligible drops the suspended',    eligiblePlayers(3).map(p=>p.id), ['a','b','c','d']);
t('3 of the 4 remaining is 75%, not 60%', scoreSusRound(rows(4,3)).passed, true);

console.log('-- suspension needs a strict majority --');
const tally = (votes, elig) => { state.sus.votes = votes; state.sus.eligible = elig; return susVoteTally().suspendId; };
t('3 of 5 suspends',              tally({a:'x',b:'x',c:'x',d:'y',e:'skip'}, ['a','b','c','d','e']), 'x');
t('2 of 5 does not',              tally({a:'x',b:'x',c:'y',d:'z',e:'skip'}, ['a','b','c','d','e']), null);
t('a 2-2 tie suspends nobody',    tally({a:'x',b:'x',c:'y',d:'y'},          ['a','b','c','d']), null);
t('exactly half is not majority', tally({a:'x',b:'x',c:'skip',d:'skip'},    ['a','b','c','d']), null);
t('3 of 4 suspends',              tally({a:'x',b:'x',c:'x',d:'y'},          ['a','b','c','d']), 'x');
t('a 1/1/1 plurality suspends nobody', tally({a:'x',b:'y',c:'z'},           ['a','b','c']), null);
t('everyone skipping suspends nobody', tally({a:'skip',b:'skip',c:'skip'},  ['a','b','c']), null);

console.log('-- winning takes 6 of 10 --');
const setResults = n => { state.sus.results = Array.from({length:10},(_,i)=>({passed:i<n})); return susPassCount(); };
t('passes are counted',      setResults(6), 6);
t('6 wins it for the group', setResults(6) >= state.sus.passesNeeded, true);
t('5 hands it to Sus',       setResults(5) >= state.sus.passesNeeded, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
