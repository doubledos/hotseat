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
    // Questions (pool, lives in lobby state)
    questions: [],
    // Ladder
    ladderCurrent: 1,
    ladderWon: Array(15).fill(false), // which levels have been cleared
    ladderWonTeam: Array(15).fill(null), // which team ('A'/'B') cleared each level
    // Race mode — each team climbs its own ladder independently, first to clear level 15 wins
    race: {
      A:{current:1, won:Array(15).fill(false)},
      B:{current:1, won:Array(15).fill(false)}
    },
    levelTypes: Array(15).fill(''), // '' = auto by difficulty, 'puzzle' = puzzle
    // Lifelines
    lifelines: {
      A:{promote:false,doubleDip:false,swap:false},
      B:{promote:false,doubleDip:false,swap:false}
    },
    // Current flow
    currentQuestion: null,
    flow: {stage:'idle',optionsRevealed:0,hotSeatAnswer:-1,stealPeeked:false,stealRevealed:false,doubleDipUsed:false},
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
    // Phrase bank (puzzle content)
    phraseBank: [],
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
