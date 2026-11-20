const assert=require('node:assert/strict');
module.exports=async function(page,url){
  let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
  await page.goto(url);await page.waitForFunction(()=>window.previewReady);await page.evaluate(()=>makeEditor().launch());
  const editor=page.locator('hmi-room-panel-editor');
  const baseline=await editor.evaluate(e=>JSON.stringify(e.draft.widgets.map(({id,x,y,w,h,entity,temperature_entity})=>({id,x,y,w,h,entity,temperature_entity}))));
  for(const design of ['calm','minimal','contrast'])for(const theme of ['dark','light']){
    await editor.locator('[data-design-choice]').selectOption(design);await editor.locator('[data-theme-choice]').selectOption(theme);await editor.locator('[data-cmd="apply-design"]').click();
    eq(await editor.evaluate(e=>[e.draft.design,e.draft.theme]),[design,theme],'Appearance selection saved');
    eq(await editor.evaluate(e=>JSON.stringify(e.draft.widgets.map(({id,x,y,w,h,entity,temperature_entity})=>({id,x,y,w,h,entity,temperature_entity})))),baseline,'Appearance preserves geometry and bindings');
    eq(await editor.evaluate(e=>{const canvas=e.dialog.querySelector('.canvas'),style=getComputedStyle(canvas);const luminance=hex=>{const a=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};const p=n=>style.getPropertyValue('--'+n).trim().replace('#','');const contrast=(a,b)=>{const x=luminance(p(a)),y=luminance(p(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};return ['bg','surface'].every(bg=>['text','muted'].every(fg=>contrast(bg,fg)>=4.5))&&contrast('active','accent')>=4.5;}),true,'Normal and secondary text pass 4.5:1 contrast');
    eq(await editor.evaluate(e=>e.draft.service_menu.widgets.every(w=>w.background===e.draft.background||w.background===e.dialog.querySelector('.canvas').style.getPropertyValue('--surface'))),true,'Service menu receives the same appearance');
  }
  await editor.locator('[data-cmd="undo"]').click();eq(await editor.evaluate(e=>e.draft.theme),'dark','Undo restores previous theme');
  await editor.locator('[data-cmd="redo"]').click();eq(await editor.evaluate(e=>e.draft.theme),'light','Redo restores light theme');
  await editor.locator('[data-cmd="add-page"]').click();await editor.locator('[data-cmd="add-menu"]').click();await editor.locator('[data-cmd="panel-size"]').click();
  const before=await editor.evaluate(e=>JSON.parse(JSON.stringify(e.draft)));
  await editor.locator('[data-size-preset]').selectOption('1024x600');await editor.locator('[data-apply-size]').click();
  eq(await editor.evaluate(e=>[e.draft.panel_width,e.draft.panel_height]),[1024,600],'Landscape preset applied');
  eq(await editor.evaluate(e=>e.draft.widgets.find(w=>w.id==='climate').w),Math.round(before.widgets.find(w=>w.id==='climate').w*1024/480),'Main widgets scaled to new width');
  eq(await editor.evaluate(e=>e.draft.pages[0].widgets[0].w),Math.round(before.pages[0].widgets[0].w*1024/480),'Additional screen scaled');
  eq(await editor.evaluate(e=>e.draft.service_menu.widgets.find(w=>w.type==='service_lock').w),Math.round(before.service_menu.widgets.find(w=>w.type==='service_lock').w*1024/480),'Service menu scaled');
  eq(await editor.evaluate(e=>e.draft.widgets.find(w=>w.id==='climate').entity),'climate.demo','Resize preserves device');
  await editor.locator('[data-cmd="undo"]').click();eq(await editor.evaluate(e=>JSON.stringify(e.draft)),JSON.stringify(before),'One undo restores all screen dimensions and geometry');
  await editor.locator('[data-cmd="redo"]').click();
  await editor.locator('[data-swap-size]').click();await editor.locator('[data-apply-size]').click();
  eq(await editor.evaluate(e=>[e.draft.panel_width,e.draft.panel_height]),[600,1024],'Swap creates portrait orientation');
  const rect=await editor.locator('.canvas').boundingBox();eq(Math.abs(rect.width/rect.height-600/1024)<.005,true,'Editor canvas has portrait proportions');
  await editor.locator('[data-panel-width]').fill('720');await editor.locator('[data-panel-height]').fill('1280');await editor.locator('[data-resize-mode]').selectOption('keep');
  const geometry=await editor.evaluate(e=>e.draft.widgets.map(w=>[w.x,w.y,w.w,w.h]));await editor.locator('[data-apply-size]').click();
  eq(await editor.evaluate(e=>e.draft.widgets.map(w=>[w.x,w.y,w.w,w.h])),geometry,'Expand canvas without resizing widgets');
  await editor.locator('[data-panel-width]').fill('100');await editor.locator('[data-apply-size]').click();eq(await editor.evaluate(e=>e.draft.panel_width),720,'Out-of-range dimension rejected');
  await editor.locator('[data-panel-width]').fill('720');
  await editor.locator('[data-add="sensor"]').click();await editor.locator('[data-field="x"]').fill('580');await editor.locator('[data-field="x"]').press('Tab');
  eq(await editor.evaluate(e=>e.widget.x),560,'Widget geometry uses canvas width beyond 480');
  await editor.locator('[data-cmd="duplicate"]').click();eq(await editor.evaluate(e=>e.widget.x>480),true,'Duplicate retains positions beyond 480');
  await editor.locator('[data-cmd="apply"]').click();
  const saved=await editor.evaluate(e=>e._config);eq(saved.panel_height,1280,'Apply persists custom dimensions');
  await editor.evaluate(e=>e.launch());eq(await editor.evaluate(e=>e.draft.widgets.some(w=>w.x>480)),true,'Reopening editor preserves extended geometry');
  await editor.evaluate(async(e,c)=>e.importFile(new File([JSON.stringify(c)],'layout.json',{type:'application/json'})),saved);
  eq(await editor.evaluate(e=>[e.draft.panel_width,e.draft.panel_height,e.draft.widgets.some(w=>w.x>480)]),[720,1280,true],'JSON import preserves dimensions and extended coordinates');
  await editor.evaluate(async(e,c)=>e.importFile(new File([JSON.stringify(c)],'legacy.json',{type:'application/json'})),before);
  eq(await editor.evaluate(e=>[e.draft.panel_width,e.draft.panel_height]),[480,480],'Old JSON without dimensions imports at 480 rather than inheriting the open canvas');
  await editor.evaluate(e=>e.finish(false));
  eq(await page.evaluate(config=>{const c=document.createElement('hmi-room-panel');c.setConfig(config);c.hass=demoHass;c.style.width='360px';document.body.append(c);const box=c.shadowRoot.querySelector('.desktop').getBoundingClientRect();const extended=c.config.widgets.some(w=>w.x>480),ok=Math.abs(box.width/box.height-720/1280)<.005;c.remove();return {ok,extended};},saved),{ok:true,extended:true},'Runtime retains custom dimensions and aspect ratio');
  await page.evaluate(()=>makeEditor({type:'custom:hmi-room-panel',panel_width:800,panel_height:480}).launch());
  await editor.locator('[data-template]').selectOption('blank');await editor.locator('[data-cmd="apply-template"]').click();
  eq(await editor.evaluate(e=>[e.draft.panel_width,e.draft.panel_height,e.draft.widgets.find(w=>w.type==='settings').x>480]),[800,480,true],'Applying template respects current canvas');
  await editor.evaluate(e=>e.finish(false));
  const android=await page.context().browser().newPage({viewport:{width:800,height:480},userAgent:'Android HomePanel test'});
  try{
    await android.goto(url);await android.waitForFunction(()=>window.previewReady);
    eq(await android.evaluate(()=>{const c=document.querySelector('hmi-room-panel');c.preview=false;c.setConfig({...c.config,panel_width:480,panel_height:800});const r=c.shadowRoot.querySelector('.screen').getBoundingClientRect();return Math.abs(r.width/r.height-.6)<.005&&r.left>=-.1&&r.top>=-.1&&r.right<=800.1&&r.bottom<=480.1;}),true,'Portrait layout fits Android landscape viewport without cropping');
    await android.setViewportSize({width:480,height:800});
    eq(await android.evaluate(()=>{const r=document.querySelector('hmi-room-panel').shadowRoot.querySelector('.screen').getBoundingClientRect();return Math.abs(r.width-480)<1&&Math.abs(r.height-800)<1;}),true,'Portrait Android uses the full matching viewport');
  }finally{await android.close();}
  return {checks};
};
