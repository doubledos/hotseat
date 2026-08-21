/* host/rules.js
   The Rules tab: a static reference card the operator can read on air. */

import { LIFELINE_DEFS } from '../../core/constants.js';
import { money } from '../../core/util.js';

export function renderRulesTab(){
  return `<div class="card rules-card">
    <div class="rules-body">
    <h2>The Game</h2>
    <p>Two teams. One player sits in the hot seat and climbs a shared 15-level money ladder. Correct answers bank ${money(100)} to ${money(1500)} per level to the hot seat player personally and to their team. The hot seat player only ever wins what they personally banked.</p>
    <h2>Question Flow</h2>
    <p>Host draws a question, reveals it, then reveals answer options one at a time. The hot seat player has unlimited time. Lifelines are available once options are shown, until the player locks in an answer.</p>
    <h2>Getting It Wrong — The Steal</h2>
    <p>The opposing team's next-in-line panelist (rotates person to person each time) gets a shot at the same question — locked in by phone, or tapped in manually by the host. Correct: they steal the hot seat, take that level's money, and the ladder climbs. Wrong: the original hot seat player keeps their seat, nobody earns that level's money, but the ladder still climbs to the next level either way.</p>
    <h2>Puzzle Rounds</h2>
    <p>Any level the host marks as a Puzzle Round (Setup → Level Types) swaps the trivia question for a word-guess board. A glitch takes over the screen, and teams alternate calling letters. Every letter pick — hit or miss — resets a 20-second clock for the currently guessing team to shout the full phrase; if it runs out, the hot seat swaps to the other team. Whoever's in the hot seat when the phrase is solved earns that level's money.</p>
    <h2>Final Wager (before Level 15)</h2>
    <p>All players secretly set a wager from their personal bank on their phones. The host reveals the question. Hot seat player answers. Correct: everyone who wagered wins their wager. Wrong: hot seat bounces to the other team; everyone loses their wager.</p>
    <h2>Lifelines (one set per team per game)</h2>
    ${LIFELINE_DEFS.map(({label,desc})=>`<div class="rules-ll"><div><b>${label}</b>${desc}</div></div>`).join('')}
    <h2>Manual Adjustments</h2>
    <p>Use the Quick Adjust panel during the game to add or subtract money for shouting penalties, corrections, or anything else. Amounts can be negative.</p>
    </div>
  </div>`;
}
