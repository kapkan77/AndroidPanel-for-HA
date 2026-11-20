/* Regression: real pointer down/up across frequent HA updates, no device calls. */
const assert=require('node:assert/strict');
module.exports=async function(page,url){
  let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
  await page.goto(url);await page.waitForFunction(()=>window.previewReady);
  await page.evaluate(()=>{
    window.testCalls=[];const c=document.querySelector('hmi-room-panel');c.preview=false;
    c.hass={...demoHass,callService:async(domain,action,data)=>{
      testCalls.push({domain,action,data});const state=demoHass.states[data.entity_id];
      if(action==='set_temperature')demoHass.states[data.entity_id]={...state,attributes:{...state.attributes,temperature:data.temperature}};
      else if(action==='turn_on'||action==='turn_off')demoHass.states[data.entity_id]={...state,state:action==='turn_on'?'on':'off'};
    }};
    let pulse=0;window.stateUpdates=setInterval(()=>{pulse++;demoHass.states['sensor.demo_humidity']={...demoHass.states['sensor.demo_humidity'],state:String(45+pulse%10)};c.hass=c._hass;},20);
  });
  const card=page.locator('#panel hmi-room-panel');
  for(const [id,action,direction] of [['nightlight','toggle'],['humidifier','toggle'],['climate','step','1'],['climate','step','-1']]){
    const button=card.locator(`[data-widget-id="${id}"] [data-action="${action}"]${direction?`[data-direction="${direction}"]`:''}`);
    await button.evaluate(b=>window.heldButton=b);const before=await page.evaluate(()=>testCalls.length);
    for(let i=0;i<30;i++){
      const box=await button.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();
      await card.evaluate(c=>c.serviceQueue);
    }
    eq(await page.evaluate(n=>testCalls.length-n,before),30,id+' '+(direction||action)+': all 30 ordinary mouse clicks survive updates');
    eq(await button.evaluate(b=>b===window.heldButton),true,'Button DOM identity is stable');
    eq(await button.locator('ha-icon').evaluate(i=>i.style.display==='inline-flex'),true,'Renderer preserves attributes owned by the HA custom element');
  }
  await card.locator('[data-widget-id="nightlight"] [data-action="toggle"]').focus();
  await page.waitForTimeout(120);
  eq(await card.locator('[data-widget-id="nightlight"] [data-action="toggle"]').evaluate(b=>b.getRootNode().activeElement===b),true,'Focus survives state refresh');
  const beforeKeyboard=await page.evaluate(()=>testCalls.length);await page.keyboard.press('Enter');await card.evaluate(c=>c.serviceQueue);
  eq(await page.evaluate(n=>testCalls.length-n,beforeKeyboard),1,'Keyboard activation remains usable');
  await page.evaluate(()=>clearInterval(stateUpdates));
  eq(await card.evaluate(async c=>{let calls=0;c.hass={...demoHass,callService:async()=>{calls++;await new Promise(r=>setTimeout(r,50));}};await Promise.all([c.service('light','turn_on',{entity_id:'light.demo'}),c.service('fan','turn_off',{entity_id:'fan.demo'})]);return calls;}),2,'Pending service does not silently discard another device command');
  await card.evaluate(c=>{c.setConfig({...c.config,pages:[{id:'second',kind:'page',title:'Second',widgets:[]}]});c.hass={...demoHass,callService:async()=>testCalls.push('unexpected')};});
  const originalCalls=await page.evaluate(()=>testCalls.length);
  const box=await card.locator('[data-widget-id="nightlight"] [data-action="toggle"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-100,box.y+box.height/2,{steps:10});await page.mouse.up();
  eq(await card.evaluate(c=>c.activePage),'second','Horizontal swipe changes page');
  eq(await page.evaluate(()=>testCalls.length),originalCalls,'Swipe does not activate crossed button');
  await card.evaluate(c=>{c.navigate('main');c.previewClock();});
  await card.locator('.clock').click();
  eq(await card.evaluate(c=>c.clockShown),false,'First touch wakes night clock');
  eq(await page.evaluate(()=>testCalls.length),originalCalls,'Wake does not control a device');
  await page.waitForTimeout(460);
  await card.locator('[data-widget-id="nightlight"] [data-action="toggle"]').click();await card.evaluate(c=>c.serviceQueue);
  eq(await page.evaluate(()=>testCalls.length),originalCalls+1,'Next deliberate click works after wake');
  // A separate touch-capable page tests touchstart -> update -> touchend in Chromium.
  const touch=await page.context().browser().newPage({viewport:{width:480,height:800},hasTouch:true,isMobile:true});
  try{
    await touch.goto(url);await touch.waitForFunction(()=>window.previewReady);
    await touch.evaluate(()=>{window.touchCalls=0;const c=document.querySelector('hmi-room-panel');c.preview=false;c.hass={...demoHass,callService:async()=>touchCalls++};});
    const target=await touch.locator('#panel hmi-room-panel [data-widget-id="nightlight"] [data-action="toggle"]').boundingBox();
    const session=await touch.context().newCDPSession(touch),point={x:target.x+target.width/2,y:target.y+target.height/2};
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await touch.evaluate(()=>{const c=document.querySelector('hmi-room-panel');c.hass={...c._hass};});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await touch.waitForTimeout(100);eq(await touch.evaluate(()=>touchCalls),1,'Touch tap survives an intervening HA update');
  }finally{await touch.close();}
  console.log('Pointer regression: 120/120 held mouse clicks and touch tap handled during state updates.');
  return {checks};
};
