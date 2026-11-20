const assert=require('node:assert/strict');
module.exports=async function(page){
  let checks=0;const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  await page.evaluate(()=>{
    window.androidCalls=[];
    window.demoHass={...window.demoHass,user:{id:'test-admin',is_admin:true},callWS:async msg=>{
      window.androidCalls.push(msg);
      if(msg.action==='list')return {ok:true,panels:[]};
      if(msg.action==='probe')return {ok:true,probe_token:'test-ticket',device:{manufacturer:'Demo',model:'Test Panel',android:'11',sdk:30,installed_version:null,device_owner:null}};
      if(msg.action==='install')return {ok:true,steps:['Приложение установлено','Адрес сохранён'],pin_needed:true,version:'1.3.0'};
      throw Error('Unexpected fake action');
    }};
    window.makeEditor().launch();
  });
  const editor=page.locator('hmi-room-panel-editor');await editor.locator('.android-trigger').click();
  const dialog=editor.locator('.android-setup');
  eq(await dialog.isVisible(),true,'Android wizard opens inside editor');
  eq(await dialog.locator('[data-install]').isDisabled(),true,'Installation requires a successful check');
  eq(await dialog.locator('input[type="password"]').count(),0,'No PIN or password is requested by the wizard');
  await dialog.locator('[data-host]').fill('192.0.2.10');await dialog.locator('[data-url]').fill('https://ha.example/panels/room');
  await dialog.locator('[data-probe]').click();await dialog.locator('[data-device]').waitFor({state:'visible'});
  eq(await page.evaluate(()=>window.androidCalls.some(m=>m.action==='install')),false,'Probe never starts installation');
  eq(await dialog.locator('[data-install]').isEnabled(),true,'Reviewed Android enables installation');
  await dialog.locator('[data-host]').fill('192.0.2.11');eq(await dialog.locator('[data-install]').isDisabled(),true,'Changing IP requires a new check');
  await dialog.locator('[data-host]').fill('192.0.2.10');await dialog.locator('[data-probe]').click();await dialog.locator('[data-device]').waitFor({state:'visible'});
  await dialog.screenshot({path:require('node:path').resolve(__dirname,'../docs/images/android-setup.png'),animations:'disabled'});
  await dialog.locator('[data-install]').click();await page.waitForFunction(()=>document.querySelector('hmi-room-panel-editor').shadowRoot.querySelector('[data-result]').textContent.includes('создайте PIN'));
  const install=await page.evaluate(()=>window.androidCalls.find(m=>m.action==='install'));
  eq(install.host,'192.0.2.10','Install uses the checked address');eq(install.url,'https://ha.example/panels/room','Install sends chosen dashboard URL');
  eq(install.full_kiosk,true,'Full kiosk is explicit in the request');eq(install.probe_token,'test-ticket','Install carries the successful probe ticket');
  eq('pin' in install||'password' in install,false,'PIN and credentials are never sent');
  await dialog.locator('[data-setup-close]').click();await editor.evaluate(e=>e.finish(false));
  await page.evaluate(()=>{window.demoHass={...window.demoHass,user:{id:'ordinary-user',is_admin:false}};window.androidCalls=[];window.makeEditor().launch();});
  await editor.locator('.android-trigger').click();eq(await editor.locator('.android-setup [data-probe]').isDisabled(),true,'Ordinary HA users cannot start a probe');
  eq(await page.evaluate(()=>window.androidCalls.length),0,'Ordinary users do not call management API');
  await editor.locator('.android-setup [data-setup-close]').click();await editor.evaluate(e=>e.finish(false));
  return {checks};
};
