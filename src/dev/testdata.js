/* testdata.js
   Sample players, questions and phrases for trying the game out. Imported
   only by the host setup screen. */

import { state } from '../core/state.js';
import { saveLobby } from '../core/lobby.js';
import { R } from '../ui/rerender.js';
import { showModal } from '../ui/modal.js';
import { genId } from '../core/util.js';
import { teamName } from '../rules/ladder.js';

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
      {text:'What color is a stop sign?',options:['Red','Blue','Green','Yellow'],difficulty:'easy'},
      {text:'How many sides does a triangle have?',options:['3','4','5','6'],difficulty:'easy'},
      {text:'What planet is closest to the Sun?',options:['Mercury','Venus','Earth','Mars'],difficulty:'easy'},
      {text:'How many legs does a spider have?',options:['8','6','4','10'],difficulty:'easy'},
      {text:'What is the capital of France?',options:['Paris','London','Berlin','Madrid'],difficulty:'easy'},
      {text:'What gas do plants absorb from the air?',options:['Carbon dioxide','Oxygen','Nitrogen','Hydrogen'],difficulty:'easy'},
      {text:'Who painted the Mona Lisa?',options:['Leonardo da Vinci','Michelangelo','Raphael','Botticelli'],difficulty:'medium'},
      {text:'How many keys does a standard piano have?',options:['88','76','92','64'],difficulty:'medium'},
      {text:'What is the chemical symbol for gold?',options:['Au','Ag','Fe','Cu'],difficulty:'medium'},
      {text:'In what year did the Titanic sink?',options:['1912','1905','1920','1898'],difficulty:'medium'},
      {text:'What is the largest organ in the human body?',options:['Skin','Liver','Lungs','Heart'],difficulty:'medium'},
      {text:'What language has the most native speakers?',options:['Mandarin Chinese','English','Spanish','Hindi'],difficulty:'medium'},
      {text:'What is the speed of light (approx)?',options:['300,000 km/s','150,000 km/s','500,000 km/s','30,000 km/s'],difficulty:'hard'},
      {text:'Which element has atomic number 1?',options:['Hydrogen','Helium','Lithium','Carbon'],difficulty:'hard'},
      {text:'What is the powerhouse of the cell?',options:['Mitochondria','Nucleus','Ribosome','Golgi apparatus'],difficulty:'hard'},
      {text:'Who developed the theory of general relativity?',options:['Albert Einstein','Isaac Newton','Niels Bohr','Max Planck'],difficulty:'hard'},
      {text:'What ancient wonder was located in Alexandria?',options:['The Lighthouse','The Colossus','The Hanging Gardens','The Mausoleum'],difficulty:'hard'},
      {text:'Which treaty ended World War I?',options:['Treaty of Versailles','Treaty of Paris','Treaty of Westphalia','Treaty of Utrecht'],difficulty:'hard'},
    ];
    qs.forEach(q=>state.questions.push({id:genId(),...q,used:false}));
    const phrases=[
      {category:'Movie Title',phrase:'THE WIZARD OF OZ'},
      {category:'Famous Person',phrase:'ALBERT EINSTEIN'},
      {category:'Place',phrase:'GREAT WALL OF CHINA'},
      {category:'Phrase',phrase:'BETTER LATE THAN NEVER'},
    ];
    phrases.forEach(p=>state.phraseBank.push({id:genId(),...p,used:false}));
    await saveLobby(); R.host();
  });
}

/* ============================================================
   Part 4: Render helpers — shared builders
   ============================================================ */
