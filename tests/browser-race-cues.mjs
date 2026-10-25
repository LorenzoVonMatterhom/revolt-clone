import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const gameUrl=process.env.GAME_TEST_URL??'http://127.0.0.1:8000/';
const screenshots=process.env.RACE_CUE_SCREENSHOTS??'/tmp/revolt-race-cues';
mkdirSync(screenshots,{recursive:true});
function install(){
 renderer.setPixelRatio(.6);renderer.shadowMap.enabled=false;
 window.__cueTest={
  state(){return{stage:raceCountdown.stage,locked:raceCountdown.locked,time:elapsedRace,position:player.position.toArray(),audio:sounds.countdown.isPlaying,rate:sounds.countdown.getPlaybackRate(),gain:listener.gain.gain.value,turnAudio:sounds.turn.isPlaying,directions:loadedLevel.directions.length};},
  turn(type){raceCountdown.elapsed=4;raceCountdown.stage=null;turnGuide.reset(loadedLevel.directions);const trigger=loadedLevel.directions.find(t=>t.type===type);if(!trigger)throw Error('Missing trigger '+type);player.position.copy(trigger.position);player.car.body.setTranslation(trigger.position,true);turnGuide.update(.01,trigger.position);raceCues.update(null,turnGuide.current);return {type,order:trigger.order,label:raceCues.canvas.getAttribute('aria-label'),audio:sounds.turn.isPlaying};}
 };
}
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(gameUrl,async route=>{const response=await route.fetch();const body=(await response.text()).replace(/(<script[^>]*data-game-module="main\.js"[^>]*>)([\s\S]*?)(<\/script>)/,(_,a,b,c)=>a+b+'\n('+install.toString()+')();\n'+c);await route.fulfill({response,body});});
 await page.goto(gameUrl);await page.waitForFunction(()=>document.querySelector('#scene')?.dataset.view==='menu',null,{timeout:120000});
 if(mobile)await page.locator('#startBtn').tap();else await page.locator('#startBtn').click();
 await page.waitForFunction(()=>document.querySelector('#scene')?.dataset.countdown==='3');
 const initial=await page.evaluate(()=>window.__cueTest.state());
 await page.keyboard.down('w');
 await page.screenshot({path:`${screenshots}/countdown-${mobile?'phone':'desktop'}.png`});
 for(const stage of ['2','1']){
  await page.waitForFunction(stage=>document.querySelector('#scene').dataset.countdown===stage,stage,{timeout:30000});
  const state=await page.evaluate(()=>window.__cueTest.state());if(state.time!==0||!state.locked||state.position.some((v,i)=>Math.abs(v-initial.position[i])>.001))throw Error('Cars/timer moved before GO: '+JSON.stringify(state));
  console.log(mobile?'phone':'desktop',stage,state);
 }
 await page.waitForFunction(()=>document.querySelector('#scene').dataset.countdown==='GO!',null,{timeout:30000});
 const go=await page.evaluate(()=>window.__cueTest.state());if(go.locked||!go.audio||go.rate!==1.45)throw Error('No GO release/sound '+JSON.stringify(go));
 await page.keyboard.up('w');
 await page.screenshot({path:`${screenshots}/go-${mobile?'phone':'desktop'}.png`});
 for(const type of [6,2]){
  const turn=await page.evaluate(type=>window.__cueTest.turn(type),type);console.log(mobile?'phone':'desktop','turn',turn);
  await page.screenshot({path:`${screenshots}/turn-${type}-${mobile?'phone':'desktop'}.png`});
 }
 await page.locator('#menuBtn').dispatchEvent('click');
 if(!await page.locator('.race-cues').evaluate(el=>el.hidden))throw Error('Race cues visible in menu');
 if(errors.length)throw Error(errors.join('\n'));await page.close();
 }
}finally{await browser.close();}
