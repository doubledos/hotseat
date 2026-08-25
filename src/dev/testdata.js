/* testdata.js
   Sample players, questions and phrases for trying the game out. Imported
   only by the host setup screen. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { genId } from '../core/util.js';
import { teamName } from '../rules/ladder.js';
import { bank, saveBank } from '../core/bank.js';

/* ===== Test data ===== */
export async function loadTestData(){
  showModal('','Load sample players, questions, and phrases? This adds to existing data.','Load Test Data', async()=>{
    const teams=[{n:'Alex',t:'A'},{n:'Blake',t:'A'},{n:'Casey',t:'B'},{n:'Dana',t:'B'}];
    teams.forEach(({n,t})=>{
      const p={id:genId(),name:n,team:t,personalBank:0};
      state.players.push(p);
      state.hotSeatQueue[t].push(p.id);
    });
    state.teamAName='The Brains'; state.teamBName='The Brawns';
    const qs=[
      {text:'What color is a stop sign?',options:['Red','Blue','Green','Yellow']},
      {text:'How many sides does a triangle have?',options:['3','4','5','6']},
      {text:'What planet is closest to the Sun?',options:['Mercury','Venus','Earth','Mars']},
      {text:'How many legs does a spider have?',options:['8','6','4','10']},
      {text:'What is the capital of France?',options:['Paris','London','Berlin','Madrid']},
      {text:'What gas do plants absorb from the air?',options:['Carbon dioxide','Oxygen','Nitrogen','Hydrogen']},
      {text:'Who painted the Mona Lisa?',options:['Leonardo da Vinci','Michelangelo','Raphael','Botticelli']},
      {text:'How many keys does a standard piano have?',options:['88','76','92','64']},
      {text:'What is the chemical symbol for gold?',options:['Au','Ag','Fe','Cu']},
      {text:'In what year did the Titanic sink?',options:['1912','1905','1920','1898']},
      {text:'What is the largest organ in the human body?',options:['Skin','Liver','Lungs','Heart']},
      {text:'What language has the most native speakers?',options:['Mandarin Chinese','English','Spanish','Hindi']},
      {text:'What is the speed of light (approx)?',options:['300,000 km/s','150,000 km/s','500,000 km/s','30,000 km/s']},
      {text:'Which element has atomic number 1?',options:['Hydrogen','Helium','Lithium','Carbon']},
      {text:'What is the powerhouse of the cell?',options:['Mitochondria','Nucleus','Ribosome','Golgi apparatus']},
      {text:'Who developed the theory of general relativity?',options:['Albert Einstein','Isaac Newton','Niels Bohr','Max Planck']},
      {text:'What ancient wonder was located in Alexandria?',options:['The Lighthouse','The Colossus','The Hanging Gardens','The Mausoleum']},
      {text:'Which treaty ended World War I?',options:['Treaty of Versailles','Treaty of Paris','Treaty of Westphalia','Treaty of Utrecht']},
    ];
    qs.forEach(q=>bank.questions.push({id:genId(),...q,usedAt:null}));
    const phrases=[
      {category:'Movie Title',phrase:'THE WIZARD OF OZ'},
      {category:'Famous Person',phrase:'ALBERT EINSTEIN'},
      {category:'Place',phrase:'GREAT WALL OF CHINA'},
      {category:'Phrase',phrase:'BETTER LATE THAN NEVER'},
    ];
    phrases.forEach(p=>bank.phrases.push({id:genId(),...p,usedAt:null}));
    await saveBank();
  await saveLobby(); R.host();
  });
}

/* ============================================================
   Part 4: Render helpers — shared builders
   ============================================================ */
