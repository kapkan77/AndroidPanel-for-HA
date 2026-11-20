/* Local Home Assistant room panel. No third-party assets or stored credentials. */
(() => {
  const TAG = 'hmi-room-panel';
  const ICONS = { settings:'cog-outline', minus:'minus', plus:'plus', light:'lamp-outline', water:'air-humidifier', power:'power', down:'chevron-down', heat:'fire', window:'window-closed-variant', back:'arrow-left', shield:'shield-lock-outline', auto:'auto-mode', moon:'weather-night', wind:'weather-windy', waves:'waves', clock:'clock-outline' };
  const icon = name => `<ha-icon icon="mdi:${ICONS[name] || name}"></ha-icon>`;
  const isValid = state => state && !['unknown','unavailable'].includes(state.state);
  const timezoneFor = (config,hass) => config.timezone || hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  function inNight(date, start, end, timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', {timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
    const n = Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
    const minutes = time => Number(time.split(':')[0])*60+Number(time.split(':')[1]);
    const a=minutes(start), b=minutes(end);
    return a===b || (a<b ? n>=a && n<b : n>=a || n<b);
  }
  /* @grid-core */
  /* @grid-templates */
  /* @grid-provisioner */
  class HmiRoomPanel extends HTMLElement {
    static get version(){return '0.3.0';}
    constructor() {
      super(); this.attachShadow({mode:'open'}); this.lastTouch=Date.now(); this.clockPreview=false; this.clockShown=false; this.busy=false;
      this.onNativeAdmin=()=>this.open('settings'); this.onNativeState=()=>this.refreshNativeState();
      this.shadowRoot.addEventListener('pointerdown',e=>{this.swipeClickPending=false;if(this.preview)return;if(this.clockShown){this.clockPreview=false;this.lastTouch=Date.now();this.wokeAt=Date.now();this.setClock(false);e.preventDefault();e.stopImmediatePropagation();}else this.lastTouch=Date.now();},true);
      this.shadowRoot.addEventListener('click',e=>{if(this.preview||this.swipeClickPending||Date.now()-(this.wokeAt||0)<450){this.swipeClickPending=false;e.preventDefault();e.stopImmediatePropagation();}},true);
      this.shadowRoot.addEventListener('pointerdown',e=>this.beginSwipe(e),true);
      this.shadowRoot.addEventListener('pointermove',e=>this.moveSwipe(e),{capture:true,passive:false});
      this.shadowRoot.addEventListener('pointerup',e=>this.endSwipe(e),true);
      this.shadowRoot.addEventListener('pointercancel',()=>this.gesture=null,true);
    }
    static getConfigElement(){return document.createElement('hmi-room-panel-editor');}
    static getStubConfig(){return panelTemplate('climate-comfort','Новая комната');}
    get preview(){return !!this._preview;}
    set preview(value){const changed=this._preview!==!!value;this._preview=!!value;if(changed&&this.config){this.build();this.update();}}
    setConfig(config) {
      const legacy=!config.widgets&&['heating','temperature','humidity','co2','voc','nightlight','humidifier','window'].every(key=>/^[a-z_]+\.[a-z0-9_]+$/.test(config[key]||''));
      this.config={room:'Комната',night_start:'00:00',night_end:'08:00',idle_seconds:60,...config};
      this.config.pages=normalizePages(config.pages||[],this.config);this.activePage='main';this.menuHistory=[];
      if(config.widgets)this.config.widgets=splitHeaderWidgets(config.widgets,this.config);
      else if(!legacy||this.config.pages.length){this.config.widgets=initialWidgets(this.config);if(config.design||config.theme)applyDesign(this.config,config.design||'calm',config.theme||'dark');}
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.config.night_start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.config.night_end))throw new Error('Укажите время в формате ЧЧ:ММ');
      new Intl.DateTimeFormat('ru-RU',{timeZone:timezoneFor(this.config,this._hass)});
      this.config.idle_seconds=clamp(finite(this.config.idle_seconds,60),10,3600);
      this.build(); if(this._hass) this.update();
    }
    set hass(hass) { this._hass=hass; if(this.config) this.update(); }
    getCardSize() {return 8;}
    connectedCallback() {
      this.timer=setInterval(()=>this.tick(),1000);
      window.addEventListener('hmi-admin',this.onNativeAdmin); window.addEventListener('hmi-kiosk-state',this.onNativeState);
      this.ensureDialog(); this.tick(); this.refreshNativeState();
    }
    disconnectedCallback(){clearInterval(this.timer);window.removeEventListener('hmi-admin',this.onNativeAdmin);window.removeEventListener('hmi-kiosk-state',this.onNativeState);this.shadowRoot.querySelector('dialog')?.close();}
    ensureDialog(){const d=this.shadowRoot.querySelector('dialog');if(d&&this.isConnected&&!d.open){try{d.showModal();}catch(_){requestAnimationFrame(()=>this.ensureDialog());}}}
    q(s){return this.shadowRoot.querySelector(s);}
    all(s){return this.shadowRoot.querySelectorAll(s);}
    build(){
      const android=!this.preview&&/Android|HmiKiosk/.test(navigator.userAgent);
      this.shadowRoot.innerHTML=`<style>${CSS}${GRID_CSS}</style>${android?'<dialog aria-label="Панель умного дома">':'<div class="desktop">'}<main class="screen"><div class="legacy-main">
        <header><div><strong class="room"></strong><small>Климат и комфорт</small></div><button class="icon" data-settings aria-label="Служебное меню">${icon('settings')}</button></header>
        <section class="thermostat"><span class="muted current-label">Сейчас в комнате</span><div class="temperature"><span data-current>—</span><small data-temperature-unit>°C</small></div><div class="adjust"><button data-step="-1" aria-label="Уменьшить температуру">${icon('minus')}</button><div><small>Желаемая</small><strong data-target>—</strong></div><button data-step="1" aria-label="Увеличить температуру">${icon('plus')}</button></div></section>
        <section class="air"><div><small>Влажность</small><strong><span data-humidity>—</span><em data-unit="humidity">%</em></strong></div><div><small>CO₂</small><strong><span data-co2>—</span><em data-unit="co2">ppm</em></strong></div><div><small>VOC</small><strong><span data-voc>—</span><em data-unit="voc">ppb</em></strong></div></section>
        <section class="device"><button class="device-label" data-open="light">${icon('light')}<span><strong>Ночник</strong><small data-light-status>—</small></span></button><button class="power" data-light aria-label="Включить или выключить ночник" aria-pressed="false">${icon('power')}</button></section>
        <section class="device"><button class="device-label" data-open="humidifier">${icon('water')}<span><strong>Увлажнитель</strong><small data-water>—</small></span></button><button class="mode" data-open="modes"><span data-mode>—</span>${icon('down')}</button><button class="power" data-humidifier aria-label="Включить или выключить увлажнитель" aria-pressed="false">${icon('power')}</button></section>
        <footer><button class="heat" data-heat aria-pressed="false">${icon('heat')}<span>Обогрев</span></button><span class="window">${icon('window')}<span data-window>—</span></span><ha-icon class="protection" icon="mdi:shield-lock-outline" aria-label="Состояние защиты"></ha-icon></footer>
        </div><div class="free-grid" hidden></div><nav class="page-dots" hidden aria-label="Экраны панели"></nav><div class="menu-chrome" hidden><button data-page-back aria-label="Назад">${icon('back')}</button><strong data-page-title></strong></div><section class="overlay" data-overlay="grid-details" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong data-grid-title></strong></header><div class="overlay-content" data-grid-details></div></section>
        <section class="overlay" data-overlay="modes" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong>Режим увлажнителя</strong></header><div class="overlay-content mode-list"></div></section>
        <section class="overlay" data-overlay="humidifier" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong>Увлажнитель</strong></header><div class="overlay-content">${icon('water')}<strong data-humidifier-name>Увлажнитель</strong><div class="details"><div><small>Вода</small><strong data-detail-water>—</strong></div><div><small>Цель</small><strong data-detail-target>—</strong></div></div><button class="wide" data-open="modes">Режим: <span data-mode>—</span></button></div></section>
        <section class="overlay" data-overlay="light" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong>Ночник</strong></header><div class="overlay-content">${icon('light')}<strong data-light-name>Свет</strong><button class="wide" data-light>${icon('power')}<span data-light-action>Включить</span></button></div></section>
        <section class="overlay service-overlay" data-overlay="settings" hidden><div class="legacy-settings" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong>Служебное меню</strong></header><div class="overlay-content settings"><label class="switch"><span>Защита от детей</span><input type="checkbox" data-child-lock><span class="track"></span></label><small data-native-status>Киоск ещё не подключён</small><p>Ночные часы: <span data-schedule></span><br>После минуты без касаний</p><button class="wide" data-preview>${icon('clock')}Показать часы</button><button class="wide" data-exit hidden>Выйти из киоска</button></div></div><div class="free-grid service-grid"></div></section>
        <section class="overlay security-overlay" data-overlay="security" hidden><header><button class="icon" data-close aria-label="Назад">${icon('back')}</button><strong data-security-title></strong></header><div data-security-content></div></section>
        <section class="clock" hidden aria-label="Ночная заставка"><time data-clock></time><div data-date></div><div class="clock-temperature"><span data-clock-temp>—</span>°<small>В комнате</small></div></section>
        <div class="notice" hidden role="status" aria-live="polite"></div>
      </main>${android?'</dialog>':'</div>'}`;
      this.q('.room').textContent=this.config.room;
      this.q('[data-schedule]').textContent=`${this.config.night_start}–${this.config.night_end}`;
      this.q('[data-schedule]').parentElement.lastChild.textContent=`После ${this.config.idle_seconds} с без касаний`;
      this.q('dialog')?.addEventListener('cancel',e=>e.preventDefault()); this.ensureDialog();
      this.all('[data-step]').forEach(b=>b.addEventListener('click',()=>this.adjust(Number(b.dataset.step))));
      this.all('[data-light]').forEach(b=>b.addEventListener('click',()=>this.toggle('nightlight','light')));
      this.q('[data-humidifier]').addEventListener('click',()=>this.toggle('humidifier','fan'));
      this.q('[data-heat]').addEventListener('click',()=>{const s=this.entity('heating');this.service('climate','set_hvac_mode',{entity_id:this.config.heating,hvac_mode:s?.state==='off'?'heat':'off'});});
      this.all('[data-open]').forEach(b=>b.addEventListener('click',()=>this.open(b.dataset.open)));
      this.all('[data-close]').forEach(b=>b.addEventListener('click',()=>this.close()));
      this.q('[data-settings]').addEventListener('click',()=>{if(window.HmiKiosk)window.HmiKiosk.requestSettings();else this.open('settings');});
      this.q('[data-child-lock]').addEventListener('change',e=>{if(window.HmiKiosk)window.HmiKiosk.setChildLock(e.target.checked);this.refreshNativeState();});
      this.q('[data-exit]').addEventListener('click',()=>window.HmiKiosk?.exitKiosk());
      this.q('[data-preview]').addEventListener('click',()=>this.previewClock());
      const grid=this.q('.free-grid');grid.hidden=!this.config.widgets;this.q('.screen').classList.toggle('grid-mode',!!this.config.widgets);
      const size=panelSize(this.config);this.style.setProperty('--panel-aspect',`${size.width} / ${size.height}`);this.style.setProperty('--panel-ratio',size.width/size.height);this.style.setProperty('--panel-max',Math.max(640,size.width)+'px');
      themeStyle(this.q('.screen'),this.config);this.q('.screen').style.setProperty('--bg',color(this.config.background,palette(this.config).bg));
      grid.addEventListener('click',e=>{const b=e.target.closest('[data-action]'),w=this.widgets.find(w=>w.id===b?.closest('[data-widget-id]')?.dataset.widgetId);if(w&&b&&!b.disabled)this.widgetAction(w,b.dataset.action,Number(b.dataset.direction));});
      this.q('.service-grid').addEventListener('click',e=>{const b=e.target.closest('[data-action]'),w=this._serviceWidgets?.find(w=>w.id===b?.closest('[data-widget-id]')?.dataset.widgetId);if(w&&b&&!b.disabled)this.widgetAction(w,b.dataset.action,Number(b.dataset.direction),b.dataset.target);});
      this.q('[data-page-back]').onclick=()=>this.navigate('back');
      this.q('.page-dots').addEventListener('click',e=>{const b=e.target.closest('[data-page-id]');if(b)this.navigate(b.dataset.pageId);});
      this.renderServiceMenu();this.renderGrid();
      this.refreshNativeState();
    }
    entity(key){return this._hass?.states[this.config[key]];}
    number(key,decimals=0){const s=this.entity(key);const n=Number(s?.state);return isValid(s)&&Number.isFinite(n)?n.toFixed(decimals).replace('.',','):'—';}
    update(){
      if(!this.q('.screen'))return;
      const heat=this.entity('heating'), light=this.entity('nightlight'), hum=this.entity('humidifier');
      this.q('[data-current]').textContent=this.number('temperature',1);this.q('[data-clock-temp]').textContent=this.number('temperature',1);
      const target=Number(heat?.attributes.temperature);this.q('[data-target]').textContent=Number.isFinite(target)?target.toFixed(1).replace('.',',')+'°':'—';
      this.q('[data-temperature-unit]').textContent=this.entity('temperature')?.attributes.unit_of_measurement||this._hass?.config?.unit_system?.temperature||'°C';
      for(const key of ['humidity','co2','voc']){this.q('[data-'+key+']').textContent=this.number(key,0);this.q('[data-unit="'+key+'"]').textContent=this.entity(key)?.attributes.unit_of_measurement||'';}
      this.all('[data-light]').forEach(b=>b.setAttribute('aria-pressed',String(light?.state==='on')));
      this.q('[data-light-status]').textContent=isValid(light)?(light.state==='on'?'Включён':'Выключен'):'Недоступен';
      this.q('[data-light-action]').textContent=light?.state==='on'?'Выключить':'Включить';
      this.q('[data-humidifier]').setAttribute('aria-pressed',String(hum?.state==='on'));
      this.q('[data-heat]').setAttribute('aria-pressed',String(isValid(heat)&&heat.state!=='off'));
      this.q('[data-humidifier-name]').textContent=hum?.attributes.friendly_name||'Увлажнитель';this.q('[data-light-name]').textContent=light?.attributes.friendly_name||'Свет';
      const water=Number(hum?.attributes.water_level), goal=Number(hum?.attributes.target_humidity);
      this.q('[data-water]').textContent=isValid(hum)&&Number.isFinite(water)?'Вода '+water+'%':'Нет данных';
      this.q('[data-detail-water]').textContent=Number.isFinite(water)?water+'%':'—';this.q('[data-detail-target]').textContent=Number.isFinite(goal)?goal+'%':'—';
      const mode=hum?.attributes.preset_mode;this.all('[data-mode]').forEach(e=>e.textContent=({Auto:'Авто',Low:'Тихо',Mid:'Средний',High:'Макс.'})[mode]||'Режим');
      const win=this.entity('window');this.q('[data-window]').textContent=isValid(win)?(win.state==='on'?'Окно открыто':'Окно закрыто'):'Окно: нет данных';
      this.all('[data-step], [data-heat]').forEach(b=>b.disabled=this.busy||!isValid(heat));
      this.all('[data-light]').forEach(b=>b.disabled=this.busy||!isValid(light));this.q('[data-humidifier]').disabled=this.busy||!isValid(hum);
      const modes=hum?.attributes.preset_modes||[];const list=this.q('.mode-list');if(list.dataset.modes!==JSON.stringify(modes)){list.textContent='';modes.forEach(value=>{const b=document.createElement('button');b.textContent=({Auto:'Авто',Low:'Тихо',Mid:'Средний',High:'Максимальный'})[value]||value;b.dataset.preset=value;b.addEventListener('click',()=>{this.service('fan','set_preset_mode',{entity_id:this.config.humidifier,preset_mode:value});this.close();});list.append(b);});list.dataset.modes=JSON.stringify(modes);}list.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===mode)));
      this.renderGrid();this.renderServiceMenu();if(this.alarmCard)this.alarmCard.hass=this._hass;this.refreshAlarmStatus();
    }
    get currentPage(){return this.config.pages?.find(p=>p.id===this.activePage);}
    get widgets(){return this.currentPage?.widgets||this.config.widgets||[];}
    pageList(){return [{id:'main',title:this.config.main_title||'Главный'},...(this.config.pages||[]).filter(p=>p.kind==='page')];}
    renderGrid(){
      if(!this.q('.free-grid')||!this.config.widgets)return;
      patchMarkup(this.q('.free-grid'),this.widgets.map(w=>widgetMarkup(w,this._hass,this.config)).join(''));
      this.q('.free-grid').style.setProperty('--bg',color(this.currentPage?.background,color(this.config.background,palette(this.config).bg)));
      const menu=this.currentPage?.kind==='menu',list=this.pageList(),dots=this.q('.page-dots');dots.hidden=menu||list.length<2;
      patchMarkup(dots,list.map(p=>`<button data-page-id="${esc(p.id)}" class="${p.id===this.activePage?'active':''}" title="${esc(p.title)}" aria-label="${esc(p.title)}" aria-current="${p.id===this.activePage}"></button>`).join(''));
      this.q('.menu-chrome').hidden=!menu;this.q('[data-page-title]').textContent=this.currentPage?.title||'';
    }
    navigate(id){
      if(this.preview)return;
      if(id==='service'){if(window.HmiKiosk)window.HmiKiosk.requestSettings();else this.open('settings');return;}
      if(id==='back')id=this.menuHistory.pop()||'main';
      else if(id!=='main'&&!this.config.pages?.some(p=>p.id===id)){this.notice('Выберите экран или меню в конструкторе');return;}
      else if(this.config.pages?.find(p=>p.id===id)?.kind==='menu')this.menuHistory.push(this.activePage||'main');else this.menuHistory=[];
      this.close();this.activePage=id;this.renderGrid();
    }
    beginSwipe(e){
      this.gesture=null;if(this.preview||this.clockShown||this.config.swipe===false||this.currentPage?.kind==='menu'||this.pageList().length<2||e.isPrimary===false)return;
      if(!e.target.closest?.('.free-grid')||[...this.all('[data-overlay]')].some(el=>!el.hidden))return;
      this.gesture={id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),scale:480/this.q('.screen').getBoundingClientRect().width};
    }
    moveSwipe(e){const g=this.gesture;if(!g||g.id!==e.pointerId)return;const dx=(e.clientX-g.x)*g.scale,dy=(e.clientY-g.y)*g.scale;if(Math.abs(dx)>20&&Math.abs(dx)>Math.abs(dy)*1.5){g.moved=true;this.swipeClickPending=true;e.preventDefault();}}
    endSwipe(e){const g=this.gesture;this.gesture=null;if(!g||g.id!==e.pointerId)return;const dx=(e.clientX-g.x)*g.scale,dy=(e.clientY-g.y)*g.scale;if(g.moved)this.swipeClickPending=true;if(Math.abs(dx)<60||Math.abs(dy)>Math.abs(dx)*.5||Date.now()-g.time>1200)return;const pages=this.pageList(),index=pages.findIndex(p=>p.id===(this.activePage||'main')),next=pages[index+(dx<0?1:-1)];if(next){e.preventDefault();this.swipeClickPending=true;this.navigate(next.id);}}
    renderServiceMenu(){
      const grid=this.q('.service-grid');if(!grid)return;this._serviceWidgets=serviceWidgets(this.config);patchMarkup(grid,this._serviceWidgets.map(w=>widgetMarkup(w,this._hass,{...this.config,_native:this.nativeState})).join(''));grid.style.setProperty('--bg',color(this.config.service_menu?.background,color(this.config.background,palette(this.config).bg)));
    }
    previewClock(){this.close();this.clockPreview=true;this.previewUntil=Date.now()+120000;this.setClock(true);this.tick();}
    async service(domain,service,data){
      if(this.preview||!this._hass)return;
      const run=async()=>{this.busy=true;this.update();try{await this._hass.callService(domain,service,typeof data==='function'?data():data);}catch(e){this.notice('Не удалось выполнить: '+(e.message||'нет связи'));}finally{this.busy=false;this.update();}};
      this.serviceQueue=(this.serviceQueue||Promise.resolve()).then(run,run);return this.serviceQueue;
    }
    widgetAction(w,action,direction,target){
      if(this.preview)return;
      if(action.startsWith('service_')){
        if(this.q('[data-overlay="settings"]').hidden)return;
        if(action==='service_back')this.close();
        else if(action==='service_clock')this.previewClock();
        else if(action==='service_exit')window.HmiKiosk?.exitKiosk();
        else if(action==='service_pin'){if(typeof window.HmiKiosk?.openPinSettings==='function')window.HmiKiosk.openPinSettings();else this.notice('Обновите приложение киоска для настройки PIN');}
        else if(action==='service_lock'){window.HmiKiosk?.setChildLock(!this.nativeState?.locked);this.refreshNativeState();}
        else if(action==='service_link')this.navigate(target);return;
      }
      const state=this._hass?.states[w.entity],domain=w.entity?.split('.')[0];
      if(action==='navigate'){this.navigate(w.target||'');return;}
      if(action==='alarm'){this.openAlarm(w);return;}
      if(action==='keypad'){this.openKeypad(w);return;}
      if(action==='settings'){if(window.HmiKiosk)window.HmiKiosk.requestSettings();else this.open('settings');return;}
      if(action==='details'||action==='modes'){this.widgetDetails(w,action==='modes');return;}
      if(!isValid(state))return;
      if(action==='step'){
        const a=state.attributes,current=Number(a.temperature);if(domain!=='climate'||!Number.isFinite(current))return;
        const step=Number(a.target_temp_step)||.1;
        const temperature=Math.round(clamp(current+(direction<0?-1:1)*step,Number(a.min_temp??5),Number(a.max_temp??35))*100)/100;
        this.service('climate','set_temperature',{entity_id:w.entity,temperature});
      }else if(action==='toggle'){
        if(domain==='climate'){const modes=state.attributes.hvac_modes||['heat','off'];if(modes.includes('off'))this.service(domain,'set_hvac_mode',{entity_id:w.entity,hvac_mode:state.state==='off'?(modes.includes('heat')?'heat':modes.find(m=>m!=='off')):'off'});}
        else if(['light','fan','humidifier','switch','input_boolean'].includes(domain))this.service(domain,state.state==='on'?'turn_off':'turn_on',{entity_id:w.entity});
        else if(['scene','script'].includes(domain))this.service(domain,'turn_on',{entity_id:w.entity});
        else if(['button','input_button'].includes(domain))this.service(domain,'press',{entity_id:w.entity});
      }
    }
    async openAlarm(w){
      if(this.preview||!isValid(this._hass?.states[w.entity]))return;this.open('security');const token=this.securityToken;this.q('[data-security-title]').textContent=w.label||'Сигнализация';const content=this.q('[data-security-content]');content.textContent='Загрузка…';
      try{const helpers=await window.loadCardHelpers();if(token!==this.securityToken)return;const card=helpers.createCardElement({type:'alarm-panel',entity:w.entity,states:['arm_home','arm_away','arm_night']});card.hass=this._hass;content.textContent='';content.append(card);this.alarmCard=card;}catch(_){if(token===this.securityToken)content.textContent='Не удалось открыть сигнализацию. Проверьте подключение.';}
    }
    openKeypad(w){
      if(this.preview)return;this.open('security');this.q('[data-security-title]').textContent=w.label||'Введите код';const box=this.q('[data-security-content]');
      box.innerHTML=`<div class="pin-entry"><input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off" aria-label="Код" placeholder="Введите код"><p data-pin-status role="status"></p><div class="pin-pad">${['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(d=>`<button data-digit="${d}">${d}</button>`).join('')}</div><button class="wide" data-pin-submit>${esc(w.entity?.startsWith('alarm_control_panel.')?(ALARM_ACTIONS[w.alarm_action||'alarm_disarm']?.title||'Снять с охраны'):'Подтвердить')}</button></div>`;
      const input=box.querySelector('input');input.oninput=()=>{input.value=input.value.replace(/\D/g,'').slice(0,12);this.lastTouch=Date.now();};
      box.querySelectorAll('[data-digit]').forEach(b=>b.onclick=()=>{if(input.disabled)return;input.value=b.dataset.digit==='C'?'':b.dataset.digit==='⌫'?input.value.slice(0,-1):(input.value+b.dataset.digit).slice(0,12);this.lastTouch=Date.now();});
      box.querySelector('[data-pin-submit]').onclick=()=>this.submitPin(w);input.onkeydown=e=>{if(e.key==='Enter')this.submitPin(w);};this.pinTouched=Date.now();
    }
    async submitPin(w){
      if(this.preview)return;const box=this.q('[data-security-content]'),input=box.querySelector('input'),status=box.querySelector('[data-pin-status]');if(!input||input.disabled)return;
      delete status.dataset.valid;
      if(!/^(script|alarm_control_panel)\.[a-z0-9_]+$/.test(w.entity||'')){status.textContent='Выберите сигнализацию или сценарий в конструкторе';return;}
      if(!/^\d{1,12}$/.test(input.value)){status.textContent='Введите цифровой код';return;}
      const alarm=w.entity.startsWith('alarm_control_panel.'),action=Object.hasOwn(ALARM_ACTIONS,w.alarm_action)?w.alarm_action:'alarm_disarm';
      if(alarm&&!isValid(this._hass?.states[w.entity])){input.value='';status.textContent='Сигнализация недоступна';return;}
      if(alarm&&this._hass.states[w.entity].state===ALARM_ACTIONS[action].state){input.value='';status.textContent=ALARM_NAMES[ALARM_ACTIONS[action].state];return;}
      const token=this.securityToken,code=input.value;input.value='';input.disabled=true;status.textContent='Проверка…';
      try{
        if(alarm){this.alarmRequest={entity:w.entity,expected:ALARM_ACTIONS[action].state,deadline:Date.now()+30000,token};status.textContent='Ожидание состояния сигнализации…';await this._hass.callService('alarm_control_panel',action,{entity_id:w.entity,code});if(token!==this.securityToken)return;this.refreshAlarmStatus();return;}
        const result=await this._hass.callWS({type:'call_service',domain:'script',service:w.entity.split('.')[1],service_data:{code},return_response:true});if(token!==this.securityToken)return;const valid=result?.response?.valid;if(typeof valid!=='boolean')throw new Error('response_format');status.textContent=valid?'Код принят':'Неверный код';status.dataset.valid=String(valid);
      }catch(e){if(token!==this.securityToken)return;this.alarmRequest=null;status.textContent=e.message==='response_format'?'Сценарий должен вернуть valid: true или valid: false':'Не удалось проверить код или выполнить команду';}finally{if(token===this.securityToken&&!this.alarmRequest)input.disabled=false;}
    }
    refreshAlarmStatus(){const r=this.alarmRequest;if(!r||r.token!==this.securityToken)return;const status=this.q('[data-pin-status]'),input=this.q('.pin-entry input');if(!status||!input)return;const state=this._hass?.states[r.entity]?.state;if(state===r.expected){status.textContent=ALARM_NAMES[state]||state;status.dataset.valid='true';this.alarmRequest=null;input.disabled=false;}else if(Date.now()>r.deadline){status.textContent='Статус не изменился. Проверьте код и связь.';delete status.dataset.valid;this.alarmRequest=null;input.disabled=false;}}
    widgetDetails(w,onlyModes){
      this.open('grid-details');const state=this._hass?.states[w.entity],a=state?.attributes||{},domain=w.entity?.split('.')[0],box=this.q('[data-grid-details]');
      this.q('[data-grid-title]').textContent=w.label||a.friendly_name||'Устройство';box.textContent='';
      const line=document.createElement('p');line.textContent=isValid(state)?(onlyModes?'Выберите режим':`Состояние: ${state.state==='on'?'включён':state.state==='off'?'выключен':state.state}${a.water_level!=null?' · Вода '+a.water_level+'%':''}${a.target_humidity!=null?' · Цель '+a.target_humidity+'%':''}`):'Устройство недоступно';box.append(line);
      for(const mode of a.preset_modes||a.available_modes||[]){const b=document.createElement('button');b.className='wide';b.textContent=MODE_NAMES[mode]||mode;b.disabled=!isValid(state);b.setAttribute('aria-pressed',String((a.preset_mode||a.mode)===mode));b.onclick=()=>{if(['fan','humidifier'].includes(domain))this.service(domain,domain==='fan'?'set_preset_mode':'set_mode',{entity_id:w.entity,[domain==='fan'?'preset_mode':'mode']:mode});this.close();};box.append(b);}
      if(!onlyModes){const b=document.createElement('button');b.className='wide';b.textContent=state?.state==='on'?'Выключить':'Включить';b.disabled=!isValid(state);b.onclick=()=>{this.widgetAction(w,'toggle');this.close();};box.append(b);}
    }
    toggle(key,domain){const e=this.entity(key);if(isValid(e))this.service(domain,e.state==='on'?'turn_off':'turn_on',{entity_id:this.config[key]});}
    adjust(direction){const e=this.entity('heating');if(!isValid(e))return;const a=e.attributes;const current=Number(a.temperature);if(!Number.isFinite(current))return;const value=Math.round(Math.max(Number(a.min_temp??5),Math.min(Number(a.max_temp??35),current+direction*Number(a.target_temp_step||.1)))*10)/10;this.service('climate','set_temperature',{entity_id:this.config.heating,temperature:value});}
    close(){const settings=this.q('[data-overlay="settings"]');if(!this.preview&&settings&&!settings.hidden){try{window.HmiKiosk?.endAdminSession();}catch(_){}}this.securityToken=(this.securityToken||0)+1;this.alarmCard=null;this.alarmRequest=null;const security=this.q('[data-security-content]');if(security)security.textContent='';this.all('[data-overlay]').forEach(e=>e.hidden=true);this.lastTouch=Date.now();}
    open(name){this.close();const e=this.q('[data-overlay="'+name+'"]');if(e)e.hidden=false;this.refreshNativeState();}
    refreshNativeState(){
      if(!this.q('[data-child-lock]')||this.preview)return;
      let state={owner:false,locked:false};try{if(window.HmiKiosk)state=JSON.parse(window.HmiKiosk.getState());}catch(_){}
      this.nativeState=state;this.renderServiceMenu();
      this.q('[data-child-lock]').checked=!!state.locked;this.q('[data-child-lock]').disabled=!state.owner;
      this.q('[data-native-status]').textContent=state.owner?(state.locked?'Выход и настройки защищены PIN':'Защита выключена'):(window.HmiKiosk?'Режим киоска ещё не настроен':'Защита управляется на самой панели');
      this.q('.protection').style.opacity=state.owner&&state.locked?'1':'.25';this.q('[data-exit]').hidden=!window.HmiKiosk;
    }
    setClock(visible){if(this.preview)return;if(visible){const idle=this.lastTouch;this.close();this.lastTouch=idle;}this.clockShown=visible;this.q('.clock').hidden=!visible;try{window.HmiKiosk?.setBrightness(visible ? clamp(finite(this.config.night_brightness,4.5),1,100)/100 : clamp(finite(this.config.day_brightness,40),1,100)/100);}catch(_){} }
    tick(){if(this.preview||!this.config||!this.q('.clock'))return;const now=new Date();this.refreshAlarmStatus();if(!this.q('[data-overlay="security"]').hidden&&Date.now()-this.lastTouch>45000)this.close();if(this.clockPreview&&Date.now()>this.previewUntil)this.clockPreview=false;const night=inNight(now,this.config.night_start,this.config.night_end,timezoneFor(this.config,this._hass));const show=this.clockPreview||(night&&Date.now()-this.lastTouch>=this.config.idle_seconds*1000);if(show!==this.clockShown)this.setClock(show);this.q('[data-clock]').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:timezoneFor(this.config,this._hass),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);this.q('[data-date]').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:timezoneFor(this.config,this._hass),weekday:'long',day:'numeric',month:'long'}).format(now);if(this.widgets.some(w=>w.type==='clock'))this.renderGrid();}
    notice(text){const e=this.q('.notice');e.textContent=text;e.hidden=false;clearTimeout(this.noticeTimer);this.noticeTimer=setTimeout(()=>e.hidden=true,5000);}
  }
  const CSS=responsiveCss(`
    :host{display:block;color-scheme:dark;font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .desktop,dialog{container-type:inline-size}
    *{box-sizing:border-box} [hidden]{display:none!important}
    dialog{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:hidden;background:#101418;color:#f1f3f5}dialog::backdrop{background:#101418}
    .desktop{width:100%;max-width:var(--panel-max,640px);aspect-ratio:var(--panel-aspect,1);margin:auto;overflow:hidden;border-radius:18px}.screen{--bg:#101418;--surface:#1c2228;--text:#f1f3f5;--muted:#a2adb6;--accent:#f4b679;--active:#3d2b1d;container-type:inline-size;position:relative;width:100%;height:100%;padding:3.3cqi;display:grid;grid-template-rows:8.3cqi 1fr 12.9cqi 11.7cqi 11.7cqi 9.2cqi;gap:1.45cqi;overflow:hidden;background:var(--bg);color:var(--text);font-size:3.3cqi;line-height:1.2}
    dialog .screen{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(100vw,calc(100dvh * var(--panel-ratio,1)));height:auto;aspect-ratio:var(--panel-aspect,1)}
    button{font:inherit;color:inherit;border:0;background:var(--surface);display:inline-flex;align-items:center;justify-content:center;gap:1.6cqi;border-radius:2.9cqi;min-height:9.2cqi;cursor:pointer;-webkit-tap-highlight-color:transparent}button:active{filter:brightness(.85)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #f4b679;outline-offset:2px}strong{font-weight:500}small{font-size:2.7cqi;color:var(--muted)}ha-icon{--mdc-icon-size:4.6cqi;flex-shrink:0}header{display:flex;align-items:center;justify-content:space-between}header>div{display:flex;flex-direction:column;gap:.8cqi}header strong{font-size:4.6cqi}.icon{width:9.2cqi;height:9.2cqi;padding:0}.muted{color:var(--muted)}
    .thermostat{min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1cqi}.current-label{font-size:2.7cqi}.temperature{font-size:13.5cqi;letter-spacing:-.035em;font-weight:500;line-height:1.02}.temperature small{font-size:5.2cqi;vertical-align:top;line-height:1.55;margin-left:.7cqi;letter-spacing:0}.adjust{display:flex;align-items:center;gap:6.3cqi}.adjust>button{width:12cqi;height:10.2cqi}.adjust>div{min-width:19cqi;display:flex;flex-direction:column;text-align:center;gap:.4cqi}.adjust strong{font-size:5.6cqi}.adjust small{font-size:2.5cqi}
    .air{display:grid;grid-template-columns:repeat(3,1fr);align-items:center;background:var(--surface);padding:1.4cqi .6cqi;border-radius:3.3cqi}.air>div{display:flex;flex-direction:column;align-items:center;gap:1cqi}.air strong{font-size:5cqi;white-space:nowrap}.air small{font-size:2.5cqi}.air em{font-size:2.3cqi;color:var(--muted);font-style:normal;margin-left:.6cqi}
    .device{display:flex;align-items:center;gap:1.6cqi;background:var(--surface);padding:1.2cqi 1.7cqi;border-radius:3.1cqi;min-width:0}.device-label{flex:1;min-width:0;justify-content:flex-start;background:none;padding:0 .6cqi;gap:2cqi;text-align:left}.device-label>ha-icon{color:var(--muted)}.device-label>span{display:flex;flex-direction:column;gap:.6cqi;min-width:0}.device-label strong{font-size:3.2cqi}.device-label small{font-size:2.3cqi}.power{width:9.2cqi;height:9.2cqi;padding:0;flex-shrink:0;background:var(--bg);color:var(--muted)}.power[aria-pressed=true]{background:var(--active);color:var(--accent)}.mode{font-size:2.8cqi;flex-shrink:0;padding:0 1.7cqi;background:var(--bg);gap:.8cqi}.mode ha-icon{--mdc-icon-size:2.9cqi}
    footer{display:flex;align-items:center;justify-content:space-between;gap:2cqi}.heat{font-size:2.6cqi;min-width:22.5cqi;padding:0 2.5cqi;color:var(--muted)}.heat[aria-pressed=true]{background:var(--active);color:var(--accent)}.heat ha-icon{--mdc-icon-size:3.8cqi}.window{display:flex;align-items:center;gap:1.2cqi;font-size:2.5cqi;color:var(--muted)}.window ha-icon{--mdc-icon-size:3.3cqi}.protection{--mdc-icon-size:3.7cqi;color:var(--muted)}
    .overlay,.clock{position:absolute;inset:0;background:var(--bg);z-index:5;padding:3.3cqi;display:flex;flex-direction:column}.overlay header{justify-content:flex-start;gap:2.5cqi;min-height:9.2cqi}.overlay header strong{font-size:3.5cqi}.overlay-content{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3.8cqi}.overlay-content>ha-icon{--mdc-icon-size:9cqi;color:#8ed4db}.mode-list{align-items:stretch;gap:2cqi}.mode-list button{min-height:12.5cqi;justify-content:flex-start;padding:0 4cqi}.mode-list button[aria-pressed=true]{background:var(--active);color:var(--accent)}.details{display:flex;gap:11cqi}.details>div{display:flex;flex-direction:column;text-align:center;gap:1.7cqi}.details strong{font-size:6.3cqi}.wide{padding:0 4cqi;min-height:10.4cqi}.settings{gap:3cqi;text-align:center}.settings p{font-size:2.9cqi;line-height:1.65;color:var(--muted)}.switch{display:flex;align-items:center;justify-content:space-between;width:100%;background:var(--surface);padding:3cqi;border-radius:3cqi;gap:2cqi;position:relative}.switch input{position:absolute;right:4cqi;opacity:0;width:9.2cqi;height:9.2cqi}.track{width:9.6cqi;height:5.6cqi;background:#333e48;border-radius:3cqi;padding:.6cqi}.track:after{content:'';display:block;width:4.4cqi;height:4.4cqi;background:var(--text);border-radius:50%}.switch input:checked+.track{background:var(--accent)}.switch input:checked+.track:after{transform:translateX(4cqi);background:var(--bg)}
    .clock{z-index:20;align-items:center;justify-content:center;background:#000;color:#92979d;padding:6cqi;text-align:center;gap:3cqi;touch-action:none}.clock time{font-size:19cqi;letter-spacing:-.035em;font-weight:400;line-height:1.05}.clock [data-date]{font-size:3.5cqi;color:#666e76}.clock-temperature{font-size:7.5cqi;margin-top:4cqi;color:#7e8993}.clock-temperature small{display:block;font-size:2.5cqi;margin-top:1cqi;color:#5c6670}.notice{position:absolute;z-index:30;bottom:4cqi;left:4cqi;right:4cqi;background:#512820;color:#fff;padding:3cqi;border-radius:2cqi;font-size:3cqi}
    .page-dots{position:absolute;bottom:1cqi;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:1.5cqi;padding:1cqi 1.8cqi;border-radius:3cqi;background:#101418cc}.page-dots button{min-height:0;width:1.7cqi;height:1.7cqi;min-width:0;padding:0;border-radius:50%;background:#64717c}.page-dots button.active{background:#f4b679}.menu-chrome{position:absolute;top:0;left:0;right:0;padding:1.6cqi 3.3cqi;display:flex;align-items:center;gap:2.5cqi;z-index:4;background:#101418ef;font-size:4cqi}.menu-chrome button{min-height:8cqi;width:8cqi}.service-overlay{padding:0!important}.service-links{display:flex;flex-direction:column;gap:2cqi;max-height:24cqi;overflow:auto}.security-overlay{overflow:auto;--primary-text-color:#f1f3f5;--secondary-text-color:#a2adb6;--ha-card-background:#1c2228;--card-background-color:#1c2228;--ha-color-form-background:#101418;--input-fill-color:#101418;--mdc-text-field-ink-color:#f1f3f5;--mdc-theme-surface:#1c2228}.security-overlay header{flex-shrink:0}.security-overlay [data-security-content]{flex:1;min-height:0;padding-top:2cqi}.pin-entry{height:100%;display:flex;flex-direction:column;align-items:center;gap:2cqi;padding:1cqi 4cqi}.pin-entry input{font:inherit;font-size:6cqi;color:#f1f3f5;background:#1c2228;border:1px solid #536170;border-radius:2cqi;padding:2cqi;width:100%;text-align:center;letter-spacing:1cqi}.pin-entry p{font-size:3cqi;min-height:4cqi;margin:0;color:#bac7d2;letter-spacing:0}.pin-entry p[data-valid=true]{color:#8cd5b1}.pin-entry p[data-valid=false]{color:#ffb8ac}.pin-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:2cqi;width:100%;flex:1;min-height:0}.pin-pad button{font-size:5.5cqi;min-height:10cqi}.pin-entry>[data-pin-submit]{width:100%;background:#f4b679;color:#211b14}
    @media(max-height:610px){.current-label{display:none}.temperature{font-size:12cqi}.thermostat{gap:.5cqi}}
    .page-dots,.menu-chrome{background:var(--bg);color:var(--text)}.page-dots button.active{background:var(--accent)}.security-overlay{--primary-text-color:var(--text);--secondary-text-color:var(--muted);--ha-card-background:var(--surface);--card-background-color:var(--surface);--ha-color-form-background:var(--bg);--input-fill-color:var(--bg);--mdc-text-field-ink-color:var(--text);--mdc-theme-surface:var(--surface)}.pin-entry input{background:var(--surface);color:var(--text)}.pin-entry p{color:var(--muted)}.pin-entry>[data-pin-submit]{background:var(--accent);color:var(--bg)}
  `);
  /* @grid-editor */
  if(!customElements.get(TAG))customElements.define(TAG,HmiRoomPanel);
  window.customCards=window.customCards||[];if(!window.customCards.some(card=>card.type===TAG))window.customCards.push({type:TAG,name:'Панель комнаты',description:'Панель любого размера с визуальным конструктором',preview:true});
})();
