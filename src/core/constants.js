/* constants.js
   Fixed game values and brand asset URLs. No behavior, no state.
   Extracted from index.html @5c0cf1c; logic unchanged. */

export const LOGO_EMBER_PNG = "https://raw.githubusercontent.com/doubledos/hotseat/main/hotseat-logotext-ember.png";
export const LOGO_WHITE_PNG = "https://raw.githubusercontent.com/doubledos/hotseat/main/hotseat-logotext.png";

/* ===== Constants ===== */
export const QWERTY = ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];
export const LEVEL_MONEY = [100,200,300,500,750,1000,2000,4000,8000,16000,32000,64000,125000,500000,1000000];
export const DIFFICULTIES = ['easy','medium','hard'];
export const LEVEL_DIFFICULTY_DEFAULT = (l) => l<=5?'easy':l<=10?'medium':'hard';
export const LIFELINE_DEFS = [
  {key:'promote', label:'Promote', icon:'', desc:'Swap a teammate into the hot seat permanently'},
  {key:'doubleDip', label:'Double Dip', icon:'', desc:'Two attempts; first miss triggers no steal'},
  {key:'swap', label:'Swap It Out', icon:'', desc:'Discard this question, draw a new one'},
  {key:'bomb', label:'Wildcard', icon:'', desc:'Skip the question — spin the chance wheel for cash, bankruptcy, or a seat swap'},
];
export const PUZZLE_TIMER_MS = 20000;
// Lobby uses named slugs
