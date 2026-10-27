import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const gameUrl=process.env.GAME_TEST_URL??'http://127.0.0.1:8000/';
const screenshots=process.env.RACE_GRID_SCREENSHOTS??'/tmp/revolt-race-grid';
mkdirSync(screenshots,{recursive:true});
function install(){
 renderer.setPixelRatio(.6);renderer.shadowMap.enabled=false;
 window.__gridTest={
  state(){return{count:racers.length,opponents:racers.filter(r=>!r.isPlayer).length,place:placeEl.textContent,locked:raceCountdown.locked,car:playerCarId,cars:racers.map(r=>({name:r.name,slot:r.gridSlot,position:r.position.toArray(),enabled:r.car.body.isEnabled(),speed:r.velocity.length()}))};},
  drive(){raceCountdown.elapsed=4;raceCountdown.stage=null;for(let i=0;i<240;i++)stepRacePhysics();updateHud();return this.state();},
 };
}
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(gameUrl,async route=>{const response=await route.fetch();const body=(await response.text()).replace(/(<script[^>]*data-game-module="main\.js"[^>]*>)([\s\S]*?)(<\/script>)/,(_,a,b,c)=>a+b+'\n('+install.toString()+')();\n'+c);await route.fulfill({response,body});});
 await page.goto(gameUrl,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#scene')?.dataset.view==='menu',null,{timeout:120000});
 for(const [track,choice] of [['nhood1','0'],['nhood2','24'],['muse1','0'],['ship2','0']]){
  await page.locator('#menuTrack').selectOption(track);await page.waitForFunction(id=>window.revoltMap?.id===id&&!document.querySelector('#startBtn').disabled,track,{timeout:60000});
  await page.locator('#carSelect').selectOption(choice);await page.locator('#startBtn').dispatchEvent('click');
  await page.waitForFunction(()=>document.querySelector('#scene').dataset.view==='race'&&document.querySelector('#scene').dataset.countdown==='3',null,{timeout:60000});
  const grid=await page.evaluate(()=>window.__gridTest.state());
  if(grid.count!==8||grid.opponents!==7||grid.place!=='8/8'||grid.cars[0].slot.row!==3||grid.cars.some(r=>!r.enabled))throw Error(JSON.stringify(grid));
  if(track==='nhood1')await page.screenshot({path:`${screenshots}/eight-car-starting-grid.png`});
  const driven=await page.evaluate(()=>window.__gridTest.drive());
  const moved=driven.cars.slice(1).filter((car,i)=>car.position.some((v,axis)=>Math.abs(v-grid.cars[i+1].position[axis])>1)).length;
  if(moved!==7)throw Error('Opponents not driving: '+JSON.stringify(driven));
  console.log(track,{cars:grid.count,opponents:grid.opponents,place:grid.place,playerRow:grid.cars[0].slot.row+1,movingOpponents:moved});
  await page.locator('#menuBtn').dispatchEvent('click');await page.waitForFunction(()=>document.querySelector('#scene').dataset.view==='menu');
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
