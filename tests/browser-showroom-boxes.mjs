import{chromium}from'playwright';
import{mkdirSync,writeFileSync}from'node:fs';
const gameUrl=process.env.GAME_TEST_URL??'http://127.0.0.1:8000/';
const screenshots=process.env.BOX_SCREENSHOTS??'/tmp/revolt-original-boxes';
mkdirSync(screenshots,{recursive:true});
function install(){renderer.setPixelRatio(.7);renderer.shadowMap.enabled=false;window.__boxTest={render(){for(let i=0;i<90;i++)showroom.render(renderer,1/60,camera.aspect,keys);const center=new THREE.Box3().setFromObject(showroom.boxes[showroom.selected]).getCenter(new THREE.Vector3()).project(showroom.camera);const picked=showroom.pick(center.x,center.y);return{picked:picked?.id,cars:showroom.cars.map((car,i)=>({id:car.id,name:car.name,boxId:showroom.boxes[i].userData.boxId,position:showroom.boxes[i].userData.home.toArray()}))};}};}
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(gameUrl,async route=>{const response=await route.fetch(),body=(await response.text()).replace(/(<script[^>]*data-game-module="main\.js"[^>]*>)([\s\S]*?)(<\/script>)/,(_,a,b,c)=>a+b+'\n('+install.toString()+')();\n'+c);await route.fulfill({response,body});});
 await page.goto(gameUrl,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#scene')?.dataset.view==='menu',null,{timeout:120000});
 const names=await page.locator('#carSelect option').evaluateAll(options=>options.map(o=>o.textContent));
 for(let i=0;i<28;i++){await page.locator('#carSelect').selectOption(String(i));if(await page.locator('#carName').textContent()!==names[i])throw Error('Wrong car selection '+i);}
 await page.locator('#carSelect').selectOption('12');const result=await page.evaluate(()=>window.__boxTest.render());if(result.cars.length!==28||result.picked!=='gencar')throw Error('Box selection or picking failed');
 await page.screenshot({path:`${screenshots}/authored-boxes-${mobile?'phone':'desktop'}.png`});writeFileSync(`${screenshots}/car-box-placements.json`,JSON.stringify(result.cars,null,2));console.log(mobile?'phone':'desktop',{boxes:result.cars.length,selected:'Genghis Kar'});
 if(errors.length)throw Error(errors.join('\n'));await page.close();
}}finally{await browser.close();}
