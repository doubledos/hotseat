/* display-audio.js
   Web Audio score. Called only by the TV display surface.
   Extracted from index.html @5c0cf1c; logic unchanged. */

/* ===== Sound design — produced mp3 score (audio/), TV surface only ===== */
export let audioCtx = null;
export function getAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    audioCtx = new AC();
  }
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
document.addEventListener('click', getAudioCtx, {once:false});

export const AUDIO_SRC={
  mainTheme:'audio/main-theme.mp3',
  letsPlay:'audio/lets-play.mp3',
  question:'audio/question.mp3',
  finalAnswer:'audio/final-answer.mp3',
  win:'audio/win.mp3',
  lose:'audio/lose.mp3',
  bigWin:'audio/big-win.mp3'
};
export const audioBuffers={};
export const audioLoading={};
export function loadAudioBuffer(key){
  if(audioBuffers[key]) return Promise.resolve(audioBuffers[key]);
  const ctx=getAudioCtx(); if(!ctx) return Promise.resolve(null);
  if(!audioLoading[key]){
    audioLoading[key]=fetch(AUDIO_SRC[key]).then(r=>r.arrayBuffer()).then(buf=>ctx.decodeAudioData(buf)).then(decoded=>{ audioBuffers[key]=decoded; return decoded; }).catch(()=>null);
  }
  return audioLoading[key];
}
document.addEventListener('click', ()=>{ Object.keys(AUDIO_SRC).forEach(loadAudioBuffer); }, {once:true});

export let activeLoop=null; // {key, source, gain}
export function stopLoop(fadeSec){
  if(!activeLoop) return;
  const {source,gain}=activeLoop; const ctx=getAudioCtx();
  if(fadeSec&&ctx){
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime+fadeSec);
    setTimeout(()=>{ try{source.stop();}catch(e){} }, fadeSec*1000+50);
  } else {
    try{source.stop();}catch(e){}
  }
  activeLoop=null;
}
export async function playLoop(key, opts){
  opts=opts||{};
  if(activeLoop&&activeLoop.key===key) return;
  const ctx=getAudioCtx(); if(!ctx) return;
  const buf=await loadAudioBuffer(key); if(!buf) return;
  stopLoop(opts.crossfade);
  const source=ctx.createBufferSource();
  source.buffer=buf; source.loop=true;
  const gain=ctx.createGain();
  const target=opts.volume!==undefined?opts.volume:0.5;
  gain.gain.setValueAtTime(opts.fadeIn?0:target, ctx.currentTime);
  if(opts.fadeIn) gain.gain.linearRampToValueAtTime(target, ctx.currentTime+opts.fadeIn);
  source.connect(gain); gain.connect(ctx.destination);
  source.start(0);
  activeLoop={key, source, gain};
}
export let activeOneShot=null;
export function stopOneShot(){
  if(activeOneShot){ try{activeOneShot.source.stop();}catch(e){} activeOneShot=null; }
}
export async function playOnce(key, opts){
  opts=opts||{};
  const ctx=getAudioCtx(); if(!ctx) return;
  const buf=await loadAudioBuffer(key); if(!buf) return;
  if(opts.solo) stopOneShot();
  const source=ctx.createBufferSource();
  source.buffer=buf;
  const gain=ctx.createGain();
  const target=opts.volume!==undefined?opts.volume:0.85;
  const fadeIn=opts.fadeIn!==undefined?opts.fadeIn:0.15;
  const fadeOut=opts.fadeOut!==undefined?opts.fadeOut:0.4;
  const now=ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(target, now+fadeIn);
  if(fadeOut>0&&buf.duration>fadeIn+fadeOut){
    gain.gain.setValueAtTime(target, now+buf.duration-fadeOut);
    gain.gain.linearRampToValueAtTime(0, now+buf.duration);
  }
  source.connect(gain); gain.connect(ctx.destination);
  if(opts.onEnded) source.onended=opts.onEnded;
  source.start(0);
  if(opts.solo) activeOneShot={key, source, gain};
}
export async function playBigWinThenTheme(){
  const ctx=getAudioCtx(); if(!ctx) return;
  const buf=await loadAudioBuffer('bigWin');
  if(!buf){ playLoop('mainTheme',{fadeIn:2.5,volume:0.35}); return; }
  const source=ctx.createBufferSource();
  source.buffer=buf;
  const gain=ctx.createGain();
  gain.gain.value=0.9;
  source.connect(gain); gain.connect(ctx.destination);
  source.onended=()=>{ playLoop('mainTheme',{fadeIn:2.5,volume:0.35}); };
  source.start(0);
}
