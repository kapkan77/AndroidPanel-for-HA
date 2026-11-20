  // Logical coordinates are always 480×480, independent of the browser zoom.
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = (value,fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const color = (s,fallback) => /^#[0-9a-f]{3,8}$/i.test(s||'') ? s : fallback;
  const TYPES = {header:'Заголовок комнаты',thermostat:'Термостат',sensor:'Показатель',light:'Свет',humidifier:'Увлажнитель',button:'Кнопка устройства',window:'Окно / дверь',text:'Текст',clock:'Часы',navigation:'Открыть экран / меню',alarm:'Сигнализация HA',keypad:'Цифровая клавиатура',settings:'Служебное меню',shape:'Подложка'};
  const DEFAULT_ICONS={light:'mdi:lamp-outline',humidifier:'mdi:air-humidifier',settings:'mdi:cog-outline',window:'mdi:window-closed-variant',button:'mdi:power',navigation:'mdi:arrow-right',alarm:'mdi:shield-home-outline',keypad:'mdi:dialpad'};
  const SERVICE_TYPES={service_back:'Назад из меню',service_title:'Заголовок меню',service_lock:'Защита от детей',service_status:'Состояние киоска',service_schedule:'Ночное расписание',service_pin:'PIN и доступ',service_clock:'Показать ночные часы',service_exit:'Выход из киоска',service_links:'Ссылки меню'};
  Object.assign(TYPES,SERVICE_TYPES);
  Object.assign(DEFAULT_ICONS,{service_back:'mdi:arrow-left',service_lock:'mdi:shield-lock-outline',service_pin:'mdi:shield-key-outline',service_clock:'mdi:clock-outline',service_exit:'mdi:exit-to-app'});
  const REQUIRED_SERVICE_TYPES=['service_back','service_lock','service_pin','service_exit'];
  const widgetIcon = (name,extra='') => /^mdi:[a-z0-9-]+$/.test(name||'') ? `<ha-icon icon="${esc(name)}" ${extra}></ha-icon>` : '';
  function normalizeWidget(input,index=0) {
    const type=Object.hasOwn(TYPES,input.type)?input.type:'sensor';
    const w=clamp(finite(input.w,160),32,480),h=clamp(finite(input.h,64),32,480);
    return {...input,id:String(input.id||'widget_'+index).replace(/[^a-zA-Z0-9_-]/g,'_'),type,
      x:clamp(finite(input.x,16),0,480-w),y:clamp(finite(input.y,16),0,480-h),w,h,
      font_size:clamp(finite(input.font_size,type==='thermostat'?64:22),8,120),
      label_size:clamp(finite(input.label_size,13),8,48),icon_size:clamp(finite(input.icon_size,24),8,96),
      radius:clamp(finite(input.radius,16),0,80),background:color(input.background,type==='thermostat'||type==='header'||type==='text'||type==='clock'||type==='window'?'#101418':'#1c2228'),
      color:color(input.color,'#f1f3f5'),icon_color:color(input.icon_color,'#a2adb6'),icon:input.icon ?? DEFAULT_ICONS[type] ?? '',visible:input.visible!==false};
  }
  function normalizeWidgets(widgets) {
    if(!Array.isArray(widgets)||widgets.length>40)throw new Error('На экране может быть не более 40 элементов');
    const ids=new Set();
    return widgets.map((w,i)=>{if(!w||typeof w!=='object'||Array.isArray(w))throw new Error('Неверный элемент макета');const n=normalizeWidget(w,i);while(ids.has(n.id))n.id+='_'+i;ids.add(n.id);return n;});
  }
  function normalizePages(pages=[]) {
    if(!Array.isArray(pages)||pages.length>9)throw new Error('Можно добавить не более 9 экранов и меню');
    const ids=new Set(['main','service']);return pages.map((p,i)=>{if(!p||typeof p!=='object')throw new Error('Неверный экран');let id=String(p.id||'page_'+i).replace(/[^a-zA-Z0-9_-]/g,'_');while(ids.has(id))id+='_'+i;ids.add(id);return {...p,id,title:String(p.title||'Экран '+(i+2)).slice(0,80),kind:p.kind==='menu'?'menu':'page',widgets:splitHeaderWidgets(p.widgets||[])};});
  }
  function splitHeaderWidgets(widgets){
    const list=normalizeWidgets(widgets),ids=new Set(list.map(w=>w.id)),out=[];
    for(const original of list){const w={...original};if(w.type==='header'&&w.show_settings!==false){let id=w.id+'_settings';while(ids.has(id))id+='_gear';ids.add(id);const size=Math.min(44,w.h,Math.max(32,w.w/3)),gear=normalizeWidget({id,type:'settings',x:w.x+w.w-size,y:w.y,w:size,h:w.h,label:'',icon_size:w.icon_size,background:'#1c2228',radius:12,visible:w.visible});w.w=Math.max(32,w.w-size-8);w.show_settings=false;out.push(w,gear);}else out.push(w);}return out;
  }
  function initialServiceWidgets(c){
    const menu=c.service_menu||{},links=!!menu.links?.length;
    return normalizeWidgets([
      {id:'service_back',type:'service_back',x:16,y:16,w:44,h:44,label:'',radius:12},
      {id:'service_title',type:'service_title',x:72,y:16,w:392,h:44,label:menu.title||'Служебное меню',font_size:18,background:'#101418'},
      {id:'service_lock',type:'service_lock',x:16,y:links?88:96,w:448,h:56,label:'Защита от детей',font_size:16},
      {id:'service_status',type:'service_status',x:16,y:links?152:160,w:448,h:32,font_size:13,background:'#101418',color:'#a2adb6'},
      {id:'service_schedule',type:'service_schedule',x:16,y:links?192:208,w:448,h:links?40:48,font_size:14,background:'#101418',color:'#a2adb6'},
      {id:'service_pin',type:'service_pin',x:96,y:links?240:272,w:288,h:48,label:'PIN и доступ',font_size:16},
      {id:'service_clock',type:'service_clock',x:96,y:links?296:328,w:288,h:48,label:'Показать часы',font_size:16,visible:menu.show_clock_preview!==false},
      {id:'service_exit',type:'service_exit',x:96,y:links?352:392,w:288,h:48,label:'Выйти из киоска',font_size:16},
      ...(links?[{id:'service_links',type:'service_links',x:16,y:416,w:448,h:48,font_size:15}]:[])
    ]);
  }
  function serviceWidgets(c){
    const defaults=initialServiceWidgets(c),list=c.service_menu?.widgets?normalizeWidgets(c.service_menu.widgets):defaults;
    const missing=REQUIRED_SERVICE_TYPES.filter(type=>!list.some(w=>w.type===type));if(list.length+missing.length>40)throw new Error('Оставьте место для кнопок возврата, защиты и выхода');
    for(const type of REQUIRED_SERVICE_TYPES){const found=list.find(w=>w.type===type);if(found)found.visible=true;else{const added={...defaults.find(w=>w.type===type)};while(list.some(w=>w.id===added.id))added.id+='_system';if(type==='service_pin'){const free=p=>!list.some(w=>w.visible&&w.type!=='shape'&&p.x<w.x+w.w&&p.x+p.w>w.x&&p.y<w.y+w.h&&p.y+p.h>w.y);if(!free(added)){find:for(let y=64;y+added.h<=480;y+=8)for(let x=16;x+added.w<=480;x+=8){const candidate={...added,x,y};if(free(candidate)){Object.assign(added,candidate);break find;}}}}list.push(added);}}
    return list;
  }
  const ALARM_NAMES={disarmed:'Снята с охраны',armed_home:'Охрана: дома',armed_away:'Охрана: никого нет',armed_night:'Ночная охрана',arming:'Постановка на охрану',pending:'Ожидание',triggered:'Тревога',disarming:'Снятие с охраны'};
  const ALARM_ACTIONS={alarm_disarm:{title:'Снять с охраны',state:'disarmed'},alarm_arm_home:{title:'Охрана: дома',state:'armed_home'},alarm_arm_away:{title:'Охрана: никого нет',state:'armed_away'},alarm_arm_night:{title:'Ночная охрана',state:'armed_night'}};
  function initialWidgets(c) {
    return normalizeWidgets([
      {id:'header',type:'header',x:16,y:16,w:396,h:40,label:c.room||'Комната',font_size:22,show_settings:false},
      {id:'settings',type:'settings',x:420,y:16,w:44,h:40,label:'',icon_size:24,radius:12},
      {id:'climate',type:'thermostat',x:16,y:64,w:448,h:176,entity:c.heating,temperature_entity:c.temperature,label:'Сейчас в комнате',font_size:64},
      {id:'humidity',type:'sensor',x:16,y:248,w:144,h:64,entity:c.humidity,label:'Влажность',font_size:24},
      {id:'co2',type:'sensor',x:168,y:248,w:144,h:64,entity:c.co2,label:'CO₂',font_size:24},
      {id:'voc',type:'sensor',x:320,y:248,w:144,h:64,entity:c.voc,label:'VOC',font_size:24},
      {id:'nightlight',type:'light',x:16,y:320,w:448,h:56,entity:c.nightlight,label:'Ночник',font_size:16},
      {id:'humidifier',type:'humidifier',x:16,y:384,w:448,h:56,entity:c.humidifier,label:'Увлажнитель',font_size:16},
      {id:'window',type:'window',x:264,y:448,w:200,h:32,entity:c.window,label:'Окно',font_size:12,icon_size:16},
      {id:'heat',type:'button',x:16,y:448,w:128,h:32,entity:c.heating,label:'Обогрев',font_size:12,icon_size:18,icon:'mdi:fire'}
    ]);
  }
  const MODE_NAMES={Auto:'Авто',Low:'Тихо',Mid:'Средний',High:'Макс.'};
  function widgetMarkup(w,hass,c) {
    const state=hass?.states?.[w.entity], a=state?.attributes||{}, valid=isValid(state), on=valid&&!['off','closed','idle'].includes(state.state);
    const label=w.label||a.friendly_name||TYPES[w.type], ico=widgetIcon(w.icon);
    const name=`<span class="gw-name">${esc(label)}</span>`, power=`<button data-action="toggle" class="gw-power" aria-label="${esc(label)}: включить / выключить" aria-pressed="${on}" ${valid?'':'disabled'}>${widgetIcon('mdi:power')}</button>`;
    const num=(v,d=0)=>Number.isFinite(Number(v))&&v!=null?Number(v).toFixed(d).replace('.',','):'—';
    let body='';
    if(w.type==='header')body=`<div class="gw-title"><strong>${esc(label)}</strong><small>${esc(w.subtitle??'Климат и комфорт')}</small></div>`;
    else if(w.type==='settings')body=`<button class="gw-fill" data-action="settings" aria-label="Служебное меню">${ico}${w.label?name:''}</button>`;
    else if(w.type==='service_back'||w.type==='service_clock'||w.type==='service_exit')body=`<button class="gw-fill" data-action="${w.type}" aria-label="${esc(w.label||TYPES[w.type])}">${ico}${w.label?name:''}</button>`;
    else if(w.type==='service_title')body=`<strong class="gw-text">${esc(w.label||c.service_menu?.title||'Служебное меню')}</strong>`;
    else if(w.type==='service_status')body=`<span class="gw-text">${esc(c._native?.owner?(c._native.locked?'Выход и настройки защищены PIN':'Защита выключена'):'Защита управляется на самой панели')}</span>`;
    else if(w.type==='service_schedule')body=`<span class="gw-text">${esc(`Ночные часы: ${c.night_start||'00:00'}–${c.night_end||'08:00'}\nПосле ${c.idle_seconds||60} с без касаний`)}</span>`;
    else if(w.type==='service_lock')body=`<button class="gw-fill gw-lock" data-action="service_lock" role="switch" aria-checked="${!!c._native?.locked}" ${c._native?.owner?'':'disabled'}>${ico}${name}<span class="gw-toggle"></span></button>`;
    else if(w.type==='service_pin')body=`<button class="gw-fill gw-security" data-action="service_pin" ${c._native?.pinUiVersion>=2?'':'disabled'}>${ico}<span>${name}<small>${esc(c._native?.pinUiVersion>=2?(c._native.pinGraceSeconds>0?'Не запрашивать: ':'')+(c._native.pinGraceLabel||'Запрашивать каждый раз'):'Настраивается на самой панели')}</small></span></button>`;
    else if(w.type==='service_links')body=`<div class="gw-links">${(c.service_menu?.links||[]).map(id=>c.pages?.find(p=>p.id===id)).filter(Boolean).map(p=>`<button data-action="service_link" data-target="${esc(p.id)}">${esc(p.title)}</button>`).join('')}</div>`;
    else if(w.type==='navigation')body=`<button class="gw-fill" data-action="navigate">${ico}${name}</button>`;
    else if(w.type==='alarm'||w.type==='keypad')body=`<button class="gw-fill gw-security" data-action="${w.type}" ${w.type==='alarm'&&!valid?'disabled':''}>${ico}<span>${name}<small>${esc(w.type==='alarm'?(valid?(ALARM_NAMES[state.state]||state.state):'Выберите сигнализацию'):'Ввести код')}</small></span></button>`;
    else if(w.type==='thermostat'){
      const temp=w.temperature_entity?hass?.states?.[w.temperature_entity]:null;
      const current=w.temperature_entity?(isValid(temp)?temp.state:null):a.current_temperature;
      const temperatureUnit=temp?.attributes?.unit_of_measurement||a.unit_of_measurement||hass?.config?.unit_system?.temperature||'°C';
      body=`<small>${esc(label)}</small><strong class="gw-value">${num(current,1)}<sup>${esc(temperatureUnit)}</sup></strong><div class="gw-adjust"><button data-action="step" data-direction="-1" aria-label="Уменьшить температуру" ${valid?'':'disabled'}>${widgetIcon('mdi:minus')}</button><span><small>Желаемая</small><b>${num(a.temperature,1)}°</b></span><button data-action="step" data-direction="1" aria-label="Увеличить температуру" ${valid?'':'disabled'}>${widgetIcon('mdi:plus')}</button></div>`;
    }else if(w.type==='sensor'){
      const n=Number(state?.state), value=valid?(Number.isFinite(n)?num(n,clamp(finite(w.decimals,0),0,3)):state.state):'—';
      body=`<small>${ico}${esc(label)}</small><strong class="gw-value">${esc(value)}<em>${esc(w.unit||a.unit_of_measurement||'')}</em></strong>`;
    }else if(w.type==='light'||w.type==='humidifier'){
      body=`<button class="gw-device-label" data-action="details">${ico}<span>${name}<small>${valid?(w.type==='humidifier'?(Number.isFinite(Number(a.water_level))?'Вода '+esc(a.water_level)+'%':on?'Включён':'Выключен'):on?'Включён':'Выключен'):'Недоступен'}</small></span></button>`;
      if(w.type==='humidifier')body+=`<button class="gw-mode" data-action="modes" ${valid?'':'disabled'}>${esc(MODE_NAMES[a.preset_mode||a.mode]||a.preset_mode||a.mode||'Режим')}${widgetIcon('mdi:chevron-down')}</button>`;
      body+=power;
    }else if(w.type==='button')body=`<button class="gw-fill" data-action="toggle" aria-pressed="${on}" ${valid?'':'disabled'}>${ico}${name}</button>`;
    else if(w.type==='window')body=`${ico}<span>${esc(label)}: ${valid?(state.state==='on'?'открыто':'закрыто'):'нет данных'}</span>`;
    else if(w.type==='clock')body=`<strong class="gw-value">${esc(new Intl.DateTimeFormat('ru-RU',{timeZone:timezoneFor(c,hass),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()))}</strong>${w.show_date===false?'':`<small>${esc(new Intl.DateTimeFormat('ru-RU',{timeZone:timezoneFor(c,hass),day:'numeric',month:'long'}).format(new Date()))}</small>`}`;
    else if(w.type==='text')body=`${ico}<span class="gw-text">${esc(w.text??w.label??'Ваш текст')}</span>`;
    const style=`left:${w.x/4.8}%;top:${w.y/4.8}%;width:${w.w/4.8}%;height:${w.h/4.8}%;--wf:${w.font_size/4.8}cqi;--wl:${w.label_size/4.8}cqi;--wi:${w.icon_size/4.8}cqi;--wr:${w.radius/4.8}cqi;--wb:${w.background};--wc:${w.color};--wic:${w.icon_color}`;
    return `<div class="grid-widget gw-${w.type}${w.visible?'':' gw-hidden'}" style="${style}" data-widget-id="${esc(w.id)}"><div class="gw-content">${body}</div></div>`;
  }
  const GRID_CSS=`
    .legacy-main{display:contents}.grid-mode{display:block!important;padding:0!important}.grid-mode>.legacy-main{display:none}.free-grid{position:absolute;inset:0;container-type:inline-size;overflow:hidden;background:var(--bg,#101418);color:#f1f3f5;font-family:system-ui,sans-serif;line-height:1.2;font-variant-numeric:tabular-nums;touch-action:pan-y}.gw-security>span{display:flex;flex-direction:column;gap:1cqi;text-align:left}.gw-lock{justify-content:flex-start!important}.gw-lock .gw-name{flex:1;text-align:left}.gw-toggle{flex-shrink:0;display:block;width:10cqi;height:5.8cqi;background:#495766;border-radius:4cqi;padding:.6cqi;box-sizing:border-box}.gw-toggle:after{content:'';display:block;width:4.6cqi;height:4.6cqi;border-radius:50%;background:#f1f3f5}.gw-lock[aria-checked=true] .gw-toggle{background:#f4b679}.gw-lock[aria-checked=true] .gw-toggle:after{transform:translateX(4.2cqi);background:#101418}.gw-links{height:100%;width:100%;overflow:auto;display:flex;flex-direction:column;gap:1cqi}.gw-links button{min-height:8cqi!important}
    .grid-widget{position:absolute;color:var(--wc);font-size:var(--wf);border-radius:var(--wr);background:var(--wb);overflow:hidden;box-sizing:border-box}.gw-hidden{display:none}.gw-content{display:flex;align-items:center;justify-content:center;gap:1.7cqi;height:100%;width:100%;min-width:0;box-sizing:border-box;padding:1.3cqi 1.7cqi}.grid-widget button{display:inline-flex;align-items:center;justify-content:center;gap:1.7cqi;flex-shrink:0;min-height:0;margin:0;border:0;border-radius:2.5cqi;padding:1.7cqi;background:#101418;color:inherit;font:inherit;cursor:pointer}.grid-widget button:disabled{opacity:.4}.grid-widget button[aria-pressed=true]{background:#3d2b1d;color:#f4b679}.grid-widget ha-icon{--mdc-icon-size:var(--wi);color:var(--wic);flex-shrink:0}.grid-widget button[aria-pressed=true] ha-icon{color:inherit}.grid-widget strong{font-size:inherit;font-weight:500}.grid-widget small{font-size:var(--wl);color:#a2adb6;display:flex;align-items:center;gap:1cqi}.grid-widget .gw-value{font-size:var(--wf);line-height:1.1;white-space:nowrap}.grid-widget em{font-size:var(--wl);font-style:normal;margin-left:.8cqi;color:#a2adb6}.grid-widget sup{font-size:.38em;vertical-align:top;position:relative;top:.25em;margin-left:.4cqi}.grid-widget .gw-fill{width:100%;height:100%;background:none;padding:0}.gw-header .gw-content{justify-content:space-between}.gw-title{min-width:0;display:flex;flex-direction:column;gap:1cqi}.gw-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gw-thermostat .gw-content,.gw-sensor .gw-content,.gw-clock .gw-content{flex-direction:column;gap:1.2cqi}.gw-adjust{display:flex;align-items:center;justify-content:center;gap:6cqi;font-size:5.6cqi}.gw-adjust button{width:12cqi;height:10cqi;background:#1c2228}.gw-adjust>span{display:flex;flex-direction:column;align-items:center;min-width:18cqi;gap:.6cqi}.gw-adjust b{font-weight:500}.gw-device-label{background:none!important;flex:1;min-width:0;justify-content:flex-start!important;text-align:left;padding:0!important}.gw-device-label>span{display:flex;flex-direction:column;gap:.8cqi;min-width:0}.gw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gw-power{width:9.2cqi;height:9.2cqi}.gw-mode{font-size:var(--wl)!important;height:9.2cqi}.gw-mode ha-icon{--mdc-icon-size:3cqi}.gw-text{white-space:pre-wrap;text-align:center}.gw-window .gw-content{gap:1cqi}.gw-window span{white-space:nowrap}.gw-shape{pointer-events:none}
  `;
