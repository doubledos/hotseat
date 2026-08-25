/* state.js
   The game state schema and the single live state object.

   `state` is exported as a `let`. ES module bindings are live, so importers
   always observe the current object and may mutate its properties freely.
   What they may NOT do is rebind it - `state = x` outside this module is a
   syntax error. The three places that replace the whole object (loading a
   lobby, creating one, and adopting a polled update) call setState instead. */

/* ===== State schema ===== */
export function defaultState(){
  return {
    // Meta
    code: '',
    lobbyName: '',
    gamePhase: 'setup', // setup | live | puzzle | wager | ended
    hostingStartedAt: 0,
    gameMode: 'classic', // 'classic' (shared ladder + money) | 'race' (separate ladders, first to the top wins)
    // Teams
    teamAName: 'Team A',
    teamBName: 'Team B',
    teamABank: 0,
    teamBBank: 0,
    // Players [{id,name,team,personalBank}]
    players: [],
    hotSeatTeam: 'A',
    hotSeatPlayerId: null,
    hotSeatQueue: {A:[], B:[]}, // ordered player ids for rotation
    // Ladder
    ladderCurrent: 1,
    ladderWon: Array(15).fill(false), // which levels have been cleared
    ladderWonTeam: Array(15).fill(null), // which team ('A'/'B') cleared each level
    // Race mode — each team climbs its own ladder independently, first to clear level 15 wins
    race: {
      A:{current:1, won:Array(15).fill(false)},
      B:{current:1, won:Array(15).fill(false)}
    },
    levelTypes: Array(15).fill(''), // '' = trivia, 'puzzle' = word puzzle
    // Lifelines
    lifelines: {
      A:{promote:false,doubleDip:false,swap:false},
      B:{promote:false,doubleDip:false,swap:false}
    },
    // Current flow
    currentQuestion: null,
    /* doubleDipArmed is per-question: set when the lifeline is played, and gone
       as soon as flow resets for the next question. Distinct from
       lifelines[team].doubleDip, which is the permanent "already spent" flag. */
    flow: {stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false,doubleDipArmed:false},
    // Steal
    steal: null,
    stealRoundCounter: 0,
    wagerRoundCounter: 0,
    wheel: null,
    // Puzzle
    puzzle: {
      phrase:'', category:'', revealedLetters:[], usedLetters:[],
      active:false, glitchAt:0,
      currentGuessingTeam:'A',
      timerStartedAt:0, timerPaused:true, timerElapsed:0
    },
    // Wager (before level 15)
    wager: {active:false, question:null, wagers:{}, revealed:false, resolved:false},
    // Score adjustments
    adjustments: [],
    /* Sus mode. Its own self-contained game: no ladder, money, teams, hot seat,
       steal or lifelines. Everything above this line is untouched when
       gameMode is 'sus'.

       Note what is NOT here: who the Sus player is, and the answer key. Every
       surface polls this whole blob, so anything in it is readable from dev
       tools. Those two live in rows a phone has no reason to fetch - see the
       key table in rules/sus.js. susRevealId is filled in only once the game
       is over and secrecy no longer matters. */
    sus: {
      active:false,
      round:0,
      totalRounds:10,
      passesNeeded:6,
      threshold:0.6,
      stage:'idle',      // idle | answering | reveal | round-result | voting | vote-result | ended
      eligible:[],       // player ids answering this round (excludes the suspended)
      submitted:[],      // player ids whose answer has landed
      reveal:[],         // built at reveal time: {playerId,text,options,pickedIdx,correctIdx}
      revealIdx:0,
      results:[],        // one per finished round: {passed,correct,eligible}
      suspendedFor:{},   // playerId -> the round number they sit out
      votes:{},          // voterId -> targetId | 'skip'
      lastSuspendedId:null, // who the last vote suspended, for the result screen
      dealError:null,    // {needed,got} when the bank cannot cover a full round
      outcome:null,      // 'team' | 'sus'
      susRevealId:null,
    },
    // Ending
    ended: false,
  };
}

export function normalizeState(s){
  const d = defaultState();
  for(const k of Object.keys(d)){
    if(!(k in s)) s[k]=d[k];
  }
  if(!s.puzzle) s.puzzle = d.puzzle;
  if(!s.wager) s.wager = d.wager;
  /* Lobbies saved before Sus mode existed have no sus block, and ones saved
     mid-development may be missing newer fields. Fill in per key rather than
     replacing wholesale, so a game in progress is not reset. */
  if(!s.sus) s.sus = d.sus;
  else for(const k of Object.keys(d.sus)) if(!(k in s.sus)) s.sus[k]=d.sus[k];
  if(!s.lifelines.A.hasOwnProperty('promote')){
    ['A','B'].forEach(t=>{
      s.lifelines[t].promote = s.lifelines[t].huddle||false;
      delete s.lifelines[t].huddle;
      delete s.lifelines[t].bomb;
    });
  }
  return s;
}

/* ===== App state ===== */
export let state = defaultState();

/* Replace the whole state object. Only for load/create/poll - everything else
   should mutate properties on the existing object. */
export function setState(next){ state = next; return state; }
