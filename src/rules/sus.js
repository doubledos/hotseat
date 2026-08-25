/* sus.js
   Sus mode: a social deduction round game. One player is secretly Sus and
   tries to make the group fail; everyone else answers honestly.

   Per round: every eligible player gets their own question on their own phone,
   the TV reveals the results one player at a time, and a round passes if at
   least `threshold` of the eligible players were correct. Then the group votes
   to suspend whoever they suspect, for exactly one round. After `totalRounds`,
   the group wins if it passed at least `passesNeeded` rounds.

   This mode shares nothing with the ladder game but the lobby, the roster and
   the question bank. It does not touch money, teams, the hot seat or steals.

   ===== Why the per-player rows =====

   Every surface polls one shared JSON blob, so anything stored in `state` is
   readable by anyone with dev tools. Two things must not be:

     - who is Sus
     - which option is correct

   Both live in rows outside the blob instead. This stops casual peeking; it is
   not proof against someone determined, because there is no server-side logic
   in this architecture to enforce it.

   The rows also solve a second problem. Phones must not write the lobby blob:
   six read-modify-write cycles racing each other would silently lose answers.
   Each phone writes only its own row and the host merges them, which is the
   same pattern pollStealVotes already uses for steal votes.

     susrole:<lobby>:<playerId>          host writes   only that phone reads
     susq:<lobby>:<round>:<playerId>     host writes   only that phone reads
     suskey:<lobby>:<round>              host writes   host reads
     susans:<lobby>:<round>:<playerId>   phone writes  host polls
     susvote:<lobby>:<round>:<playerId>  phone writes  host polls
*/

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { dbSet, dbGet, dbList, dbDelete } from '../core/db.js';
import { currentLobbyCode, mode } from '../core/session.js';
import { shuffleArray } from '../core/util.js';
import { pickSusQuestions } from './pool.js';
import { spend } from './pool.js';

export const susRoleKey  = (pid)          => `susrole:${currentLobbyCode}:${pid}`;
export const susQKey     = (round, pid)   => `susq:${currentLobbyCode}:${round}:${pid}`;
export const susKeyKey   = (round)        => `suskey:${currentLobbyCode}:${round}`;
export const susAnsKey   = (round, pid)   => `susans:${currentLobbyCode}:${round}:${pid}`;
export const susVoteKey  = (round, pid)   => `susvote:${currentLobbyCode}:${round}:${pid}`;

/* ===== Helpers ===== */

/* Suspended for the round currently being played. suspendedFor holds the round
   number a player sits out, so it expires on its own as the round advances -
   there is nothing to clear. */
export function isSuspended(pid, round){
  return state.sus.suspendedFor[pid] === (round || state.sus.round);
}
export function eligiblePlayers(round){
  const r = round || state.sus.round;
  return state.players.filter(p=>!isSuspended(p.id, r));
}
export function susPassCount(){ return state.sus.results.filter(r=>r.passed).length; }
export function susFailCount(){ return state.sus.results.filter(r=>!r.passed).length; }
export function questionsNeeded(){
  return state.sus.totalRounds * Math.max(1, state.players.length);
}

/* ===== Starting a game ===== */

export async function startSusGame(){
  if(!state.players.length) return;
  /* A rerun in the same lobby would otherwise inherit the previous game's
     roles and answers, and a phone reading a stale role row would be told it
     is Sus in a game where it is not. */
  await clearSusRows();
  const s = state.sus;
  s.active = true;
  s.round = 0;
  s.stage = 'idle';
  s.results = [];
  s.suspendedFor = {};
  s.votes = {};
  s.reveal = [];
  s.revealIdx = 0;
  s.eligible = [];
  s.submitted = [];
  s.outcome = null;
  s.susRevealId = null;
  state.gamePhase = 'live';
  state.ended = false;
  state.hostingStartedAt = state.hostingStartedAt || Date.now();

  /* Deal the roles. Every player gets a row so nobody can infer their role
     from the absence of one, and so a phone always has something to read. */
  const chosen = state.players[Math.floor(Math.random()*state.players.length)];
  for(const p of state.players){
    await dbSet(susRoleKey(p.id), p.id===chosen.id ? 'sus' : 'good');
  }
  /* The host needs to know who it was to resolve the ending, and it must not
     be in the polled blob until then. */
  await dbSet(`susid:${currentLobbyCode}`, chosen.id);
  await saveLobby(); R.all();
}

/* ===== Dealing a round ===== */

export async function dealSusRound(){
  const s = state.sus;

  /* Refuse to deal a short round.

     pickSusQuestions returns fewer than asked rather than reusing a question,
     so a thin bank used to mean some players simply got nothing - and the round
     then scored against only the players who did. A round four people were
     meant to play would tally 1 of 1 and pass, which is worse than not dealing
     at all, because it silently hands the group a win.

     Setup's pre-flight makes this unlikely, but it is not sufficient: players
     can be added after the check, and a lobby can be resumed with a bank that
     has since been edited. */
  const wanted = eligiblePlayers(s.round + 1);
  const available = pickSusQuestions(wanted.length);
  if(available.length < wanted.length){
    s.dealError = {needed: wanted.length, got: available.length};
    await saveLobby(); R.all();
    return;
  }
  s.dealError = null;

  s.round += 1;
  s.stage = 'answering';
  s.reveal = [];
  s.revealIdx = 0;
  s.votes = {};
  s.submitted = [];

  const players = eligiblePlayers(s.round);
  s.eligible = players.map(p=>p.id);

  const drawn = available;   // reserved above, after the sufficiency check
  const key = {};
  for(let i=0;i<players.length;i++){
    const p = players[i];
    const q = drawn[i];
    if(!q) continue;                       // unreachable: the check above guarantees enough
    spend(q);
    /* Shuffle here and send only the shuffled options. The phone never learns
       which one is right, so the answer key stays out of both the blob and the
       row the player can read. */
    const order = shuffleArray((q.options||[]).map((_,idx)=>idx));
    const shown = order.map(idx=>q.options[idx]);
    const correctIdx = order.indexOf(0);
    key[p.id] = {qid:q.id, correctIdx, text:q.text, options:shown};
    await dbSet(susQKey(s.round, p.id), JSON.stringify({text:q.text, options:shown}));
  }
  await dbSet(susKeyKey(s.round), JSON.stringify(key));
  await saveLobby(); R.all();
}

/* ===== Collecting answers ===== */

export async function pollSusAnswers(){
  const s = state.sus;
  if(!s.active || s.stage!=='answering') return;
  const prefix = `susans:${currentLobbyCode}:${s.round}:`;
  const keys = await dbList(prefix);
  let changed = false;
  for(const k of keys){
    const pid = k.slice(prefix.length);
    if(s.eligible.includes(pid) && !s.submitted.includes(pid)){
      s.submitted.push(pid); changed = true;
    }
  }
  if(changed){ await saveLobby(); if(mode==='host') R.host(); }
}

/* ===== Reveal =====
   Only now does the correct answer reach the shared blob. By this point every
   answer is locked, so publishing it cannot change anyone's play. */

export async function beginSusReveal(){
  const s = state.sus;
  const res = await dbGet(susKeyKey(s.round));
  let key = {}; try{ key = JSON.parse(res && res.value || '{}'); }catch(e){ key = {}; }

  const rows = [];
  for(const pid of s.eligible){
    const k = key[pid];
    if(!k) continue;
    const a = await dbGet(susAnsKey(s.round, pid));
    const picked = (a && a.value!=null && a.value!=='') ? parseInt(a.value,10) : -1;
    rows.push({
      playerId: pid,
      text: k.text,
      options: k.options,
      pickedIdx: Number.isNaN(picked) ? -1 : picked,
      correctIdx: k.correctIdx,
    });
  }
  s.reveal = rows;
  s.revealIdx = 0;
  s.stage = 'reveal';
  await saveLobby(); R.all();
}

export async function susRevealNext(){
  const s = state.sus;
  if(s.stage!=='reveal') return;
  if(s.revealIdx < s.reveal.length - 1){
    s.revealIdx += 1;
    await saveLobby(); R.all();
    return;
  }
  await tallySusRound();
}

/* ===== Scoring =====
   A round passes when at least `threshold` of the ELIGIBLE players were
   correct. Suspended players are not eligible, so they are absent from the
   denominator entirely rather than counting as wrong - suspending someone
   must not itself push the group towards failure.

   An unanswered question counts as wrong: pickedIdx stays -1, which never
   equals correctIdx. */

export function scoreSusRound(rows){
  const eligible = rows.length;
  const correct = rows.filter(r=>r.pickedIdx===r.correctIdx).length;
  const passed = eligible>0 && (correct/eligible) >= state.sus.threshold;
  return {passed, correct, eligible};
}

export async function tallySusRound(){
  const s = state.sus;
  s.results.push(scoreSusRound(s.reveal));
  s.stage = 'round-result';
  await saveLobby(); R.all();
}

/* ===== Voting ===== */

export async function openSusVoting(){
  const s = state.sus;
  s.votes = {};
  s.stage = 'voting';
  await saveLobby(); R.all();
}

export async function pollSusVotes(){
  const s = state.sus;
  if(!s.active || s.stage!=='voting') return;
  const prefix = `susvote:${currentLobbyCode}:${s.round}:`;
  const keys = await dbList(prefix);
  let changed = false;
  for(const k of keys){
    const pid = k.slice(prefix.length);
    if(!(pid in s.votes)){
      const res = await dbGet(k);
      if(res && res.value!==undefined){ s.votes[pid] = res.value; changed = true; }
    }
  }
  if(changed){ await saveLobby(); if(mode==='host') R.host(); }
}

/* Strict majority of the players entitled to vote - the same set that answered
   this round. A tie suspends nobody, and so does a plurality: with 3 voters
   split 1/1/1 nobody has more than half. */
export function susVoteTally(){
  const s = state.sus;
  const counts = {};
  for(const target of Object.values(s.votes)){
    if(target && target!=='skip') counts[target] = (counts[target]||0)+1;
  }
  const voters = s.eligible.length;
  let topId = null, topN = 0, tied = false;
  for(const [pid,n] of Object.entries(counts)){
    if(n>topN){ topId=pid; topN=n; tied=false; }
    else if(n===topN){ tied = true; }
  }
  const majority = topId && !tied && topN > voters/2;
  return {counts, topId, topN, voters, suspendId: majority ? topId : null};
}

export async function closeSusVoting(){
  const s = state.sus;
  const {suspendId} = susVoteTally();
  /* Suspension covers the NEXT round, which is why it is stored as a round
     number rather than a boolean - it expires by itself. */
  if(suspendId) s.suspendedFor[suspendId] = s.round + 1;
  s.lastSuspendedId = suspendId || null;
  s.stage = 'vote-result';
  await saveLobby(); R.all();

  if(s.round >= s.totalRounds) await endSusGame();
}

/* ===== Ending =====
   Always after the full run of rounds. Suspending Sus never ends the game
   early; it only takes them out of one round. */

export async function endSusGame(){
  const s = state.sus;
  s.outcome = susPassCount() >= s.passesNeeded ? 'team' : 'sus';
  const res = await dbGet(`susid:${currentLobbyCode}`);
  s.susRevealId = res && res.value ? res.value : null;
  s.stage = 'ended';
  s.active = false;
  state.ended = true;
  state.gamePhase = 'ended';
  await saveLobby(); R.all();
}

export async function nextSusRound(){
  if(state.sus.round >= state.sus.totalRounds){ await endSusGame(); return; }
  await dealSusRound();
}

/* Wipes the per-player rows a finished game leaves behind, so a rerun in the
   same lobby cannot read a stale role or answer. */
export async function clearSusRows(){
  /* Trailing colon matters: dbList is a prefix match, so `susq:game` would
     also sweep the rows of a lobby called `game2`. */
  for(const prefix of ['susrole:','susq:','suskey:','susans:','susvote:']){
    const keys = await dbList(`${prefix}${currentLobbyCode}:`);
    for(const k of keys) await dbDelete(k);
  }
  await dbDelete(`susid:${currentLobbyCode}`);
}
