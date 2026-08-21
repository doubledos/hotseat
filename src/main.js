/* Hotseat - application entry point.
   Loaded by index.html as <script type="module">.
   See CLAUDE.md for the file map. */

import { dbDelete, dbGet, dbList, dbSet, hasSupabase } from './core/db.js';
import { LEVEL_DIFFICULTY_DEFAULT, LEVEL_MONEY, LIFELINE_DEFS, PUZZLE_TIMER_MS, QWERTY } from './core/constants.js';
import { bounceText, debounce, esc, genId, letterFor, money, shuffleArray, slugify } from './core/util.js';
import { playBigWinThenTheme, playLoop, playOnce, stopLoop } from './screens/display-audio.js';
import { defaultState, normalizeState, setState, state } from './core/state.js';
import { LIFELINE_ICONS, chairIconSVG, hotSeatLogoImg, teamFlameIcon, teamGradId, teamMidColor, tvIcon } from './ui/icons.js';
import { R, bindRenderers } from './ui/rerender.js';
import { currentLobbyCode, editingPhrase, editingQuestion, hostTab, lastWheelSeen, mode, myPlayerId, phoneLifelineRequestedKey, phonePromoteMenuOpen, phoneSpinRequestedFor, phoneVotedRound, phoneWagerSubmitted, seenWagerIds, setEditingPhrase, setEditingQuestion, setActiveHostTab, setLastWheelSeen, setLobbyCode, setMode, setMyPlayerId, setPhoneLifelineRequestedKey, setPhonePromoteMenuOpen, setPhoneSpinRequestedFor, setPhoneVotedRound, setPhoneWagerSubmitted, setSeenWagerIds, setSetupStep, setupStep } from './core/session.js';
import { createLobby, lastSavedJSON, listLobbies, loadLobby, lobbyKey, saveLobby, setLastSaved } from './core/lobby.js';
import { cancelModal, confirmModal, setPendingModal, showModal, showPicker } from './ui/modal.js';
import { activeLevel, advanceLevel, elapsedMinutes, hotSeatPlayer, isLevelWon, levelDiff, levelMoney, levelType, opposingTeam, playerById, teamName, winLevel } from './rules/ladder.js';
import { availableQuestions, correctDisplayIdx, makeCurrentQuestion, pickQuestion } from './rules/pool.js';
import { buildBombWheelOutcomes, resolvedOutcomeFor, wheelMoneyLabel, wheelOutcomeLabel, wheelOutcomeResultText, wheelSliceColor, wheelSliceVisual } from './rules/wheel.js';
import { animateWheel, buildWheelHTML, flashWheelResult, onWheelLanded, revealWheelOutcome, showWheelZoom, wheelResultText } from './ui/wheel-view.js';
import { changeHotSeatPick, confirmHotSeatReveal, dismissDefendedSteal, flowAdvance, flowButtonLabel, getNextInLine, hostDrawQuestion, hostSelectAnswer, hostSetStealVote, lockStealAnswer, markCorrect, advanceLevelNoMoney, pollStealVotes, raceSwapAfterMiss, rerollQuestion, resolveSteal, retryDoubleDip, revealCorrectAnswer, revealHotSeatResult, revealStealGuess, rotateQueue, startSteal, unlockStealAnswer, applyStealWinner, confirmWheelWinner, confirmBombWheel } from './rules/flow.js';
import { phoneRequestLifeline, pollLifelineRequests, pollSpinRequest, requestSpinWheel, spinWheel, undoLifeline, useLifeline } from './rules/lifelines.js';
import { applyAdjustment, doNewGame, endGame, newGame } from './rules/score.js';
import { pausePuzzleTimer, pressLetter, puzzleSolved, resumePuzzleTimer, swapPuzzleHotSeat, triggerPuzzle } from './rules/puzzle.js';
import { finalizeWager, pollWagerAnswers, pollWagers, revealWagerQuestion, startWager } from './rules/wager.js';
import { addPlayer, deletePlayer, setHotSeat, startHosting, togglePlayerTeam } from './rules/players.js';
import { cancelEditPhrase, cancelEditQuestion, deletePhrase, deleteQuestion, resetAllUsedFlags, savePhraseFromForm, saveQuestionFromForm, startEditPhrase, startEditQuestion } from './rules/questions.js';
import { exportQuestionsMarkdown, importQuestionsMarkdown } from './rules/porting.js';
import { phoneSubmitWager, phoneSubmitWagerAnswer, phoneVote } from './rules/phone.js';
import { loadTestData } from './dev/testdata.js';
import { buildBoardHTML, buildKeyboardHTML, puzzleTimerHTML } from './ui/puzzle-view.js';
import { claimPlayer, unclaimPlayer } from './rules/phone.js';
import { renderHost } from './screens/host/index.js';
import { renderDisplay } from './screens/display.js';
import { renderPlayer } from './screens/player.js';
import { renderHostEntry, loadAndRenderLobbyList, renderLobbyEntry, renderPlayerClaim, renderEndScreen } from './screens/entry.js';
import { createNewLobby, deleteLobbyFromList, openExistingLobby } from './screens/entry.js';
import { copyPlayerLinkFromPopover, goSetupStep, openAdjustModal, openDisplay, openHostMoreMenu, quickAdjust, setGameMode, setHostTab, toggleLevelType, togglePlayerLinkPopover } from './screens/host/index.js';
import { setPromoteMenu, submitPhoneWager } from './screens/player.js';

/* ============================================================
   FORTUNE & FORTUNE v3
   Part 2: Config, storage, state schema, utilities
   ============================================================ */



let pollTimer = null;
/* Inline on* handlers run in GLOBAL scope, so assigning phonePromoteMenuOpen
   directly inside an attribute would write to window and never reach the
   module-scoped binding. Writes go through this function, which the barrel
   republishes. */

// Detect hash-based routing
function detectMode(){
  const h = location.hash;
  if(h==='#host') return 'host';
  if(h==='#display') return 'display';
  if(h==='#player'||h===''||h==='#') return 'player';
  return 'player';
}

/* ===== Utilities ===== */
async function pollForUpdates(){
  if(!currentLobbyCode) return;
  try{
    const res = await dbGet(lobbyKey());
    if(res&&res.value&&res.value!==lastSavedJSON){
      const newState = normalizeState(JSON.parse(res.value));
      setState(newState);
      setLastSaved(res.value);
      R.all();
    }
  } catch(e){}
  // Poll steal votes if host
  if(mode==='host'&&state.steal&&!state.steal.locked){
    await pollStealVotes();
  }
  // Poll wagers if host
  if(mode==='host'&&state.wager&&state.wager.active&&!state.wager.revealed){
    await pollWagers();
  }
  if(mode==='host'&&state.wager&&state.wager.active&&state.wager.revealed&&!state.wager.resolved){
    await pollWagerAnswers();
  }
  // Poll player-requested lifelines / wheel spins if host
  if(mode==='host'&&currentLobbyCode&&state.hotSeatTeam&&!state.wheel){
    await pollLifelineRequests();
  }
  if(mode==='host'&&currentLobbyCode&&state.wheel&&!state.wheel.spunAt){
    await pollSpinRequest();
  }
}


/* ===== Wheel — outcome pool, visuals, physics-driven spin ===== */







function render(){
  document.body.classList.remove('mode-display','mode-player','mode-host');
  if(mode==='display') renderDisplay();
  else if(mode==='player') renderPlayer();
  else if(mode==='host'){
    document.body.classList.add('mode-host');
    if(!currentLobbyCode){ document.getElementById('app-root').innerHTML=renderHostEntry(); setTimeout(loadAndRenderLobbyList,150); }
    else renderHost();
  }
}

window.addEventListener('hashchange',()=>{
  setMode(detectMode());
  render();
});

/* ===== Keyboard shortcuts (host, live play only) ===== */
function keyToOptionIndex(key){
  const map={'1':0,'2':1,'3':2,'4':3,'a':0,'b':1,'c':2,'d':3,'A':0,'B':1,'C':2,'D':3};
  return key in map ? map[key] : null;
}
function handleHostKeydown(e){
  if(mode!=='host'||hostTab!=='game') return;
  const active=document.activeElement;
  const tag=active&&active.tagName?active.tagName.toLowerCase():'';
  if(tag==='input'||tag==='textarea'||tag==='select'||(active&&active.isContentEditable)) return;
  if(document.getElementById('modal-overlay')?.classList.contains('show')) return;

  const f=state.flow; const q=state.currentQuestion;
  const key=e.key;

  const optIdx=keyToOptionIndex(key);
  if(optIdx!==null&&q&&optIdx<q.options.length){
    if(f.stage==='selecting'){ e.preventDefault(); hostSelectAnswer(optIdx); return; }
    if(f.stage==='steal-peek'){ e.preventDefault(); hostSetStealVote(optIdx); return; }
  }

  if(key===' '||key==='Enter'){
    if(['idle','question','options'].includes(f.stage)&&q){ e.preventDefault(); flowAdvance(); return; }
    if(f.stage==='revealing'){ e.preventDefault(); confirmHotSeatReveal(); return; }
    if(f.stage==='steal-locked'){ e.preventDefault(); revealCorrectAnswer(); return; }
    if(f.stage==='revealed'&&q&&f.hotSeatAnswer===correctDisplayIdx(q)){ e.preventDefault(); markCorrect(); return; }
    if(f.stage==='doubledip-miss'){ e.preventDefault(); retryDoubleDip(); return; }
    if(f.stage==='race-miss'){ e.preventDefault(); raceSwapAfterMiss(); return; }
  }
}
document.addEventListener('keydown', handleHostKeydown);


/* ============================================================
   Inline-handler compatibility barrel
   Module scope is not global, so the 71 functions referenced from
   inline on* attributes in generated markup must be published on
   window or every button silently becomes a no-op. Generated from
   the handler attributes themselves - do not hand-edit; regenerate
   if you add or rename an inline handler.
   ============================================================ */
Object.assign(window, {
  setPromoteMenu,
  addPlayer, advanceLevelNoMoney, cancelEditPhrase, cancelEditQuestion,
  cancelModal, changeHotSeatPick, claimPlayer, confirmBombWheel,
  confirmHotSeatReveal, confirmModal, confirmWheelWinner, copyPlayerLinkFromPopover,
  createNewLobby, deleteLobbyFromList, deletePhrase, deletePlayer,
  deleteQuestion, dismissDefendedSteal, esc, exportQuestionsMarkdown,
  finalizeWager, flowAdvance, goSetupStep, hostDrawQuestion,
  hostSelectAnswer, hostSetStealVote, importQuestionsMarkdown, loadTestData,
  lockStealAnswer, markCorrect, newGame, openAdjustModal,
  openDisplay, openExistingLobby, openHostMoreMenu, pausePuzzleTimer,
  phoneRequestLifeline, phoneSubmitWagerAnswer, phoneVote, pressLetter,
  puzzleSolved, quickAdjust, raceSwapAfterMiss, renderPlayer,
  requestSpinWheel, rerollQuestion, resolveSteal, resumePuzzleTimer,
  retryDoubleDip, revealCorrectAnswer, revealWagerQuestion, savePhraseFromForm,
  saveQuestionFromForm, setGameMode, setHostTab, setHotSeat,
  showModal, spinWheel, startEditPhrase, startEditQuestion,
  startHosting, submitPhoneWager, swapPuzzleHotSeat, toggleLevelType,
  togglePlayerLinkPopover, togglePlayerTeam, triggerPuzzle, unclaimPlayer,
  undoLifeline, unlockStealAnswer, useLifeline,
});

/* Fill in the late-bound render hooks that rules modules call through.
   Must run before the first render. */
bindRenderers({ host: renderHost, player: renderPlayer, display: renderDisplay, all: render });

(async function init(){
  setMode(detectMode());
  if(mode==='display'){
    const params=new URLSearchParams(location.search);
    const slug=params.get('lobby');
    if(slug){ const ok=await loadLobby(slug); if(ok) setLobbyCode(slug); }
    render(); pollTimer=setInterval(pollForUpdates,1200); return;
  }
  if(mode==='player'){
    const params=new URLSearchParams(location.search);
    const slug=params.get('lobby');
    if(slug){ const ok=await loadLobby(slug); if(ok) setLobbyCode(slug); }
    if(currentLobbyCode){ try{ const saved=localStorage.getItem('gs-my-player-'+currentLobbyCode); if(saved&&playerById(saved)) setMyPlayerId(saved); } catch(e){} }
    render(); pollTimer=setInterval(pollForUpdates,1500); return;
  }
  // Host mode — load from URL slug
  const hParams=new URLSearchParams(location.search); const hSlug=hParams.get('lobby');
  if(hSlug){ const ok=await loadLobby(hSlug); if(ok) setLobbyCode(hSlug); }
  render(); pollTimer=setInterval(pollForUpdates,1500); setTimeout(loadAndRenderLobbyList,150);
})();
