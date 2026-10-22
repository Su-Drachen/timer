/* Personal observation desk. Credentials are read only from this browser's main-page configuration. */
(function(root){
  'use strict';
  var fields = ['GITHUB_USERNAME', 'GIST_ID', 'COMMENT_GIST_ID', 'GITHUB_PAT'];
  function readConfig() {
    var value = {};
    try { value = root.TimerConfig ? root.TimerConfig.read() : {}; } catch (_) { /* Missing storage behaves as an empty configuration. */ }
    var result = {};
    fields.forEach(function (field) { result[field] = typeof value[field] === 'string' ? value[field].trim() : ''; });
    return result;
  }
  var initial = readConfig();
  var invalidated = false;
  function validId(value) {
    return root.TimerConfig && typeof root.TimerConfig.isGistId === 'function' ? root.TimerConfig.isGistId(value) : /^[a-f0-9]{5,64}$/i.test(value);
  }
  var tokenReady = Boolean(initial.GITHUB_PAT && !/\s/.test(initial.GITHUB_PAT));
  var recordsReady = Boolean(validId(initial.GIST_ID) && tokenReady);
  var notesReady = Boolean(validId(initial.COMMENT_GIST_ID) && tokenReady);
  var changeMessage = '主页配置已更改。请重新打开此页后继续；当前页面不会再向旧配置发送请求。';
  function configStatus(message, warning) {
    document.getElementById('page6ConfigMessage').textContent = message;
    document.getElementById('page6ConfigStatus').classList.toggle('is-warning', Boolean(warning));
  }
  function lockActions() {
    document.body.classList.add('page6-config-locked');
    document.querySelectorAll('#refresh, #deskNotesRefresh, #deskNotesOpen, #mobileNoteOpen, #bookmarkNote, #deskSubmit, #deskDeleteConfirm, #deskOwnerImport, #deskOwnerForget, .record-note-button, .desk-note-reply, .desk-note-pin, .desk-note-delete, .desk-reply-manage, .desk-reply-delete-selected').forEach(function (element) { element.disabled = true; });
    configStatus(changeMessage, true);
  }
  function stableConfig() {
    if (invalidated) return false;
    var current = readConfig();
    if (fields.some(function (field) { return current[field] !== initial[field]; })) {
      invalidated = true;
      lockActions();
      return false;
    }
    return true;
  }
  function guard(area) {
    return stableConfig() && (area === 'records' ? recordsReady : notesReady);
  }
  function configurationError() {
    var error = new Error(invalidated ? changeMessage : '连接配置不完整或格式无效，请前往主页配置后重新打开此页。');
    error.safeMessage = true;
    return error;
  }
  function disableNotes() {
    ['deskNotesRefresh', 'deskNotesOpen', 'mobileNoteOpen', 'bookmarkNote', 'deskSubmit', 'deskOwnerImport'].forEach(function (id) { document.getElementById(id).disabled = true; });
    document.getElementById('deskNotesStatus').textContent = initial.COMMENT_GIST_ID ? '留言配置不完整或格式无效' : '尚未启用桌边纸条';
    document.getElementById('deskOwnerState').textContent = '配置留言连接后，可使用本机保存的作者身份。';
    var message = document.createElement('div');
    message.className = 'notes-unconfigured';
    message.textContent = initial.COMMENT_GIST_ID ? '请到主页检查留言 Gist ID 和访问令牌，再重新打开此页。' : '留言 Gist ID 为选填。需要查看或回复纸条时，在主页配置中补充即可；开笔记录仍可独立使用。';
    var link = document.createElement('a');
    link.href = 'pagemain.html?tab=gist&config=1';
    link.textContent = '前往主页配置 ↗';
    message.appendChild(link);
    document.getElementById('deskNotesList').replaceChildren(message);
  }
  function createNotesStore() {
    var store = root.TimerFeedbackCore.createStore({
      gistId: initial.COMMENT_GIST_ID,
      token: initial.GITHUB_PAT,
      fetchImpl: function (url, options) {
        if (!guard('notes')) return Promise.reject(configurationError());
        return root.fetch(url, options);
      }
    });
    return {
      load: async function () {
        if (!guard('notes')) throw configurationError();
        var result = await store.load();
        if (!guard('notes')) throw configurationError();
        return result;
      },
      append: async function (payload) {
        if (!guard('notes')) throw configurationError();
        var result = await store.append(payload);
        if (!guard('notes')) throw configurationError();
        return result;
      }
    };
  }
  ['page6AuthorName', 'page6FooterAuthor'].forEach(function (id) {
    document.getElementById(id).textContent = initial.GITHUB_USERNAME || '我的书桌';
  });
  configStatus(recordsReady ? (notesReady ? '已连接本机主页配置 · 仅进入页面或手动刷新时读取。' : '记录已连接 · 留言尚未配置，可在主页选填留言 Gist ID。') : '请先在主页配置有效的主项目 Gist ID 和访问令牌，再重新打开此页。', !recordsReady);
  root.addEventListener('storage', function (event) {
    if (event.key === 'observer-desk-author-key-v1') {
      invalidated = true;
      changeMessage = '本机作者钥匙已在其他页面改变。请重新打开此页，确认当前作者身份后继续。';
      lockActions();
      return;
    }
    if (event.key === null || event.key === 'timeRecorderConfig' || event.key === 'timeRecorderPat') stableConfig();
  });

  (function(){
    'use strict';
    var GIST_ID=initial.GIST_ID;
    var GITHUB_TOKEN=initial.GITHUB_PAT;
    var recordCacheKey="observer-record-times-v1:"+GIST_ID;
    var state={records:[],shown:6,descending:true,loading:false,day:null,view:'month',monthKey:todayCN().slice(0,7),monthKeys:[]};
    var $=function(id){return document.getElementById(id)};
    var weekdays=['周日','周一','周二','周三','周四','周五','周六'];
    function parse(time){var m=/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(time);if(!m)return null;var ms=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]-8,+m[5],+m[6]);return {time:time,year:+m[1],month:+m[2],day:+m[3],date:m[1]+'/'+m[2]+'/'+m[3],clock:m[4]+':'+m[5]+':'+m[6],ms:ms,weekday:weekdays[new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDay()]}}
    function todayCN(){var parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),p={};parts.forEach(function(x){p[x.type]=x.value});return p.year+'-'+p.month+'-'+p.day}
    function status(type,label){var el=$('status');el.className='status '+type;el.querySelector('span').textContent=label}
    function relative(ms){var days=Math.max(0,Math.floor((Date.now()-ms)/86400000));if(days===0)return '今天';if(days===1)return '昨天';if(days<30)return days+' 天前';if(days<365)return Math.floor(days/30)+' 个月前';return (days/365).toFixed(1)+' 年前'}
    function load(){
      if(state.loading)return;
      if(!guard('records')){
        status('error',invalidated?'配置已更改':'待配置');
        $('refresh').disabled=true;
        $('errorMessage').textContent=invalidated?changeMessage:'尚未配置有效的记录连接。请通过上方“前往主页配置”填写主项目 Gist ID 和访问令牌。';
        $('errorMessage').classList.add('show');
        return;
      }
      state.loading=true;$('refresh').disabled=true;status('','读取中');$('errorMessage').classList.remove('show');
      $('errorMessage').textContent='暂时无法读取写作记录。请检查网络及主页配置后，手动重试。';
      var controller=typeof AbortController==='function'?new AbortController():null;
      var timer=setTimeout(function(){if(controller)controller.abort()},15000);
      fetch('https://api.github.com/gists/'+GIST_ID,{cache:'no-store',signal:controller?controller.signal:undefined,headers:{Authorization:'Bearer '+GITHUB_TOKEN,Accept:'application/vnd.github+json'}})
      .then(function(response){if(!response.ok)throw new Error('GitHub '+response.status);return response.json()})
      .then(function(gist){
        var file=gist.files&&gist.files['records.json'];
        if(!file)throw new Error('Missing records.json');
        if(file.truncated){
          var raw=new URL(file.raw_url);
          if(raw.protocol!=='https:'||raw.hostname!=='gist.githubusercontent.com')throw new Error('Unexpected raw URL');
          if(!guard('records'))throw configurationError();
          return fetch(raw.href,{cache:'no-store',signal:controller?controller.signal:undefined}).then(function(response){if(!response.ok)throw new Error('Raw read failed');return response.text()});
        }
        if(typeof file.content!=='string')throw new Error('Invalid records.json');
        return file.content;
      }).then(function(content){
        if(!guard('records'))throw configurationError();
        var source=JSON.parse(content);if(!Array.isArray(source))throw new Error('Invalid records');
        state.records=source.map(function(item){return parse(item&&item.time)}).filter(Boolean).sort(function(a,b){return b.ms-a.ms});
        try{localStorage.setItem(recordCacheKey,JSON.stringify(state.records.map(function(item){return item.time})))}catch(_){}
        state.shown=6;updateYears();updateMonths();render();status('ok','已同步');
        window.dispatchEvent(new CustomEvent('observer:records',{detail:{records:state.records}}));
      }).catch(function(){status('error',invalidated?'配置已更改':state.records.length?'上次记录':'读取失败');if(invalidated)$('errorMessage').textContent=changeMessage;$('errorMessage').classList.add('show');if(!state.records.length){$('list').innerHTML='<div class="empty"><strong>暂时没能翻开记录本</strong>检查主页配置和网络后，重新打开或点击刷新记录。</div>'}})
      .finally(function(){clearTimeout(timer);state.loading=false;$('refresh').disabled=invalidated||!recordsReady});
    }
    function updateYears(){var field=$('year'),selected=field.value;field.innerHTML='<option value="all">全部年份</option>';Array.from(new Set(state.records.map(function(r){return r.year}))).sort(function(a,b){return b-a}).forEach(function(y){var option=document.createElement('option');option.value=y;option.textContent=y+' 年';field.appendChild(option)});field.value=Array.from(field.options).some(function(o){return o.value===selected})?selected:'all'}
    function updateMonths(){
      var today=todayCN(),year=+today.slice(0,4),month=+today.slice(5,7),start=Date.UTC(year,month-13,1),end=Date.UTC(year,month-1,1);
      if(state.records.length){var earliest=state.records[state.records.length-1],latest=state.records[0];start=Math.min(start,Date.UTC(earliest.year,earliest.month-1,1));end=Math.max(end,Date.UTC(latest.year,latest.month-1,1))}
      state.monthKeys=[];for(var ms=start;ms<=end;){var d=new Date(ms);state.monthKeys.push(d.toISOString().slice(0,7));ms=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}
      if(!state.monthKeys.includes(state.monthKey))state.monthKey=today.slice(0,7);
      var picker=$('monthPicker');picker.innerHTML='';state.monthKeys.forEach(function(key){var option=document.createElement('option');option.value=key;option.textContent=key.slice(0,4)+' 年 '+(+key.slice(5,7))+' 月';picker.appendChild(option)});picker.value=state.monthKey;
    }
    function filtered(){var q=$('search').value.trim().replace(/-/g,'/'),year=$('year').value;var list=state.records.filter(function(r){return(year==='all'||r.year===+year)&&(!state.day||r.date===state.day)&&(!q||r.date.includes(q)||r.time.includes(q))});if(!state.descending)list.reverse();return list}
    function render(){var records=state.records;$('total').textContent=records.length.toLocaleString('zh-CN');$('latest').textContent=records.length?relative(records[0].ms):'—';$('latestDetail').textContent=records.length?records[0].time:'没有记录';var now=Date.now(),recent=records.filter(function(r){return r.ms<=now&&r.ms>=now-30*86400000}).length;$('recent').textContent=recent;if(records.length)$('range').textContent=records[records.length-1].date+' 起';renderCalendar();renderList();
      var last=records[0];$('bookmarkDate').textContent=last?last.date.replaceAll('/','.'): '还没有开笔';
      $('bookmarkTime').textContent=last?last.clock:'等第一笔落下';$('bookmarkNote').disabled=!last||!notesReady||invalidated;
    }
    function renderCalendar(){
      $('yearView').hidden=state.view!=='year';$('monthView').hidden=state.view!=='month';$('viewToggle').textContent=state.view==='year'?'切换到月视图':'返回全年';$('viewToggle').setAttribute('aria-pressed',state.view==='month'?'true':'false');$('clearDay').hidden=!state.day;
      if(state.view==='month'){renderMonth();return}
      var today=todayCN(),end=Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10)),start=end-364*86400000,first=start-((new Date(start).getUTCDay()+6)%7)*86400000;
      var counts=Object.create(null);state.records.forEach(function(r){counts[r.date]=(counts[r.date]||0)+1});
      var grid=$('calendarGrid'),fragment=document.createDocumentFragment(),active=0;
      grid.innerHTML='';
      for(var ms=first;ms<=end;ms+=86400000){
        var iso=new Date(ms).toISOString().slice(0,10),date=iso.replace(/-/g,'/'),count=counts[date]||0,out=ms<start;
        if(!out&&count)active++;
        var cell=document.createElement('button');cell.type='button';cell.className='calendar-cell'+(out?' out':'')+(count?' level-'+Math.min(3,count):'')+(state.day===date?' selected':'');cell.dataset.date=date;cell.title=date+' · '+count+' 条记录';cell.setAttribute('aria-label',date+'，'+count+' 条记录');if(out)cell.disabled=true;fragment.appendChild(cell);
      }
      grid.appendChild(fragment);
      var labels=$('monthLabels');labels.innerHTML='';for(var i=11;i>=0;i--){var d=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1-i,1)),span=document.createElement('span');span.textContent=(d.getUTCMonth()+1)+' 月';labels.appendChild(span)}
      $('calendarSummary').textContent=active+' 个活跃日 · 过去一年';$('clearDay').hidden=!state.day;
    }
    function renderMonth(){
      var key=state.monthKey,year=+key.slice(0,4),month=+key.slice(5,7),first=Date.UTC(year,month-1,1),leading=(new Date(first).getUTCDay()+6)%7,days=new Date(Date.UTC(year,month,0)).getUTCDate(),today=todayCN().replace(/-/g,'/');
      var counts=Object.create(null);state.records.forEach(function(r){counts[r.date]=(counts[r.date]||0)+1});
      var grid=$('monthGrid'),fragment=document.createDocumentFragment(),total=0,active=0;grid.innerHTML='';
      for(var i=0;i<leading;i++){var blank=document.createElement('div');blank.className='month-blank';blank.setAttribute('aria-hidden','true');fragment.appendChild(blank)}
      for(var day=1;day<=days;day++){
        var date=key.replace('-','/')+'/'+String(day).padStart(2,'0'),count=counts[date]||0;if(count){total+=count;active++}
        var cell=document.createElement('button');cell.type='button';cell.className='month-day'+(count?' has-records level-'+Math.min(3,count):'')+(state.day===date?' selected':'')+(today===date?' today':'');cell.dataset.date=date;cell.title=date+' · '+count+' 条记录';cell.setAttribute('aria-label',date+'，'+count+' 条记录');
        var number=document.createElement('span');number.className='month-day-number';number.textContent=day;var detail=document.createElement('span');detail.className='month-day-count';detail.textContent=count?count+' 条记录':'';cell.append(number,detail);fragment.appendChild(cell);
      }
      grid.appendChild(fragment);$('monthPicker').value=key;var index=state.monthKeys.indexOf(key);$('prevMonth').disabled=index<=0;$('nextMonth').disabled=index>=state.monthKeys.length-1;$('calendarSummary').textContent=key.slice(0,4)+' 年 '+month+' 月 · '+active+' 个活跃日 · '+total+' 条记录';
    }
    function renderList(){
      var records=filtered(),shown=records.slice(0,state.shown),container=$('list');
      $('resultCount').textContent=(state.day?state.day+' · ':'')+records.length+' 次开笔';
      $('export').disabled=!records.length;container.innerHTML='';
      if(!records.length){container.innerHTML='<div class="empty"><strong>这里还没有开笔记录</strong>试试其他日期，或给书桌留张纸条。</div>'}
      else{
        var fragment=document.createDocumentFragment();shown.forEach(function(r){
          var row=document.createElement('div');row.className='entry';row.dataset.recordTime=r.time;
          var content=document.createElement('div'),date=document.createElement('div');date.className='entry-date';date.textContent=r.date;
          var weekday=document.createElement('span');weekday.className='entry-weekday';weekday.textContent=r.weekday;date.appendChild(weekday);
          var time=document.createElement('span');time.className='entry-time';time.textContent=r.clock+' 开笔';content.append(date,time);
          var actions=document.createElement('div');actions.className='entry-actions';
          var note=document.createElement('button');note.type='button';note.className='record-note-button';note.textContent='递张纸条 ↗';note.setAttribute('aria-label','关于 '+r.time+' 的开笔，递张纸条');
          note.disabled=!notesReady||invalidated;
          note.addEventListener('click',function(){if(window.DeskNotes)window.DeskNotes.open({recordTime:r.time})});actions.appendChild(note);
          var count=window.DeskNotes?window.DeskNotes.getCount(r.time):0;
          if(count){var see=document.createElement('button');see.type='button';see.className='record-note-count';see.textContent=count+' 条留言与回复';see.addEventListener('click',function(){window.DeskNotes.filterRecord(r.time);$('deskNotes').scrollIntoView({behavior:'smooth',block:'start'})});actions.appendChild(see)}
          row.append(content,actions);fragment.appendChild(row);
        });container.appendChild(fragment);
      }
      $('more').hidden=shown.length>=records.length;$('more').textContent='再翻几条记录 · 还剩 '+(records.length-shown.length)+' 条 ↓';
    }
    function exportCsv(){var records=filtered();if(!records.length)return;var csv='\uFEFFtime\r\n'+records.map(function(r){return '"'+r.time+'"'}).join('\r\n');var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='observer-'+todayCN()+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)}
    function selectDay(date){state.day=state.day===date?null:date;state.shown=6;$('year').value='all';$('search').value='';renderCalendar();renderList();$('records').scrollIntoView({behavior:'smooth',block:'start'})}
    function setMonth(key){if(!state.monthKeys.includes(key))return;state.monthKey=key;state.day=null;state.shown=6;renderCalendar();renderList()}
    window.ObserverRecords={
      getRecords:function(){return state.records.slice()},
      focusRecord:function(time){
        var record=state.records.find(function(item){return item.time===time});if(!record)return false;
        state.day=record.date;state.monthKey=record.date.slice(0,7).replace('/','-');state.view='month';
        $('year').value='all';$('search').value='';state.shown=Math.max(6,filtered().findIndex(function(item){return item.time===time})+1);renderCalendar();renderList();
        var row=Array.from($('list').children).find(function(item){return item.dataset.recordTime===time});
        if(row){row.classList.add('is-highlighted');row.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(function(){row.classList.remove('is-highlighted')},2600)}
        return true;
      }
    };
    window.addEventListener('desk:notes',renderList);
    $('bookmarkNote').addEventListener('click',function(){if(state.records.length&&window.DeskNotes)window.DeskNotes.open({recordTime:state.records[0].time})});
    if(recordsReady){try{var cached=JSON.parse(localStorage.getItem(recordCacheKey)||'[]');if(Array.isArray(cached)){state.records=cached.map(parse).filter(Boolean).sort(function(a,b){return b.ms-a.ms})}}catch(_){}}
    updateYears();updateMonths();render();
    $('refresh').addEventListener('click',load);$('search').addEventListener('input',function(){state.shown=6;renderList()});$('year').addEventListener('change',function(){state.shown=6;renderList()});$('sort').addEventListener('click',function(){state.descending=!state.descending;$('sort').textContent=state.descending?'最新优先 ↓':'最早优先 ↑';renderList()});$('more').addEventListener('click',function(){state.shown+=6;renderList()});$('export').addEventListener('click',exportCsv);
    $('calendarGrid').addEventListener('click',function(event){var cell=event.target.closest('.calendar-cell');if(cell&&!cell.disabled)selectDay(cell.dataset.date)});
    $('monthGrid').addEventListener('click',function(event){var cell=event.target.closest('.month-day');if(cell)selectDay(cell.dataset.date)});
    $('viewToggle').addEventListener('click',function(){state.view=state.view==='year'?'month':'year';if(state.view==='month'&&state.day){var key=state.day.slice(0,7).replace('/','-');if(state.monthKeys.includes(key))state.monthKey=key}renderCalendar()});
    $('monthPicker').addEventListener('change',function(){setMonth(this.value)});
    $('prevMonth').addEventListener('click',function(){var index=state.monthKeys.indexOf(state.monthKey);if(index>0)setMonth(state.monthKeys[index-1])});
    $('nextMonth').addEventListener('click',function(){var index=state.monthKeys.indexOf(state.monthKey);if(index>=0&&index<state.monthKeys.length-1)setMonth(state.monthKeys[index+1])});
    $('clearDay').addEventListener('click',function(){state.day=null;state.shown=6;renderCalendar();renderList()});load();
  })();

(function () {
  'use strict';

  function init() {
    var config = { commentGistId: initial.COMMENT_GIST_ID, token: initial.GITHUB_PAT, authorName: initial.GITHUB_USERNAME.slice(0, 24) };
    var ids = [
      'deskNotes', 'deskNotesStatus', 'deskNotesWarning', 'deskNotesFilter',
      'deskNotesFilterLabel', 'deskNotesClearFilter', 'deskNotesSort',
      'deskNotesRefresh', 'deskNotesOpen', 'deskNotesList', 'deskNotesMore',
      'deskOwnerState', 'deskOwnerImport', 'deskOwnerForget', 'deskOwnerStatus',
      'deskComposer', 'deskComposerPanel', 'deskComposerTitle', 'deskComposerClose',
      'deskComposerForm', 'deskComposerTarget', 'deskComposerTargetLabel',
      'deskComposerClearTarget', 'deskNickname', 'deskText', 'deskGestures',
      'deskSubmit', 'deskComposerStatus', 'deskDeleteDialog', 'deskDeletePanel',
      'deskDeleteTitle', 'deskDeleteSummary', 'deskDeleteIncludeRepliesOption',
      'deskDeleteIncludeReplies', 'deskDeleteIncludeRepliesLabel', 'deskDeleteDetail',
      'deskDeleteDisclosure', 'deskDeleteStatus', 'deskDeleteConfirm',
      'deskDeleteCancel', 'deskDeleteClose'
    ];
    var el = {};
    ids.forEach(function (id) { el[id] = document.getElementById(id); });
    if (ids.some(function (id) { return !el[id]; })) {
      console.error('Desk notes: required markup is missing.');
      return;
    }
    if (!root.TimerFeedbackCore || typeof root.TimerFeedbackCore.createStore !== 'function' || typeof root.TimerFeedbackCore.createAuth !== 'function') {
      el.deskNotesStatus.textContent = '留言功能暂时无法启动，请重新打开页面。';
      return;
    }

    if (!notesReady) { disableNotes(); return; }
    var store = createNotesStore();
    var auth = root.TimerFeedbackCore.createAuth(root.TimerFeedbackCore.authorPublicKey);
    var storagePrefix = 'observer.desk.' + String(config.commentGistId || 'notes') + '.';
    var gestureLabels = { coffee: '递一杯咖啡', light: '留一盏灯', sit: '在旁边坐坐' };
    var state = {
      rawComments: [], rawPins: [], rawDeletions: [], notes: [], byId: new Map(), roots: [],
      verified: new Set(), pinnedId: null, filter: null, shown: 10,
      expanded: new Set(), records: new Set(), recordsLoaded: false,
      loading: null, sending: false, pinning: false, open: false,
      restoreFocus: null, scrollY: 0, bodyStyle: null, revision: 0,
      confirmedNotes: new Map(), confirmedPins: new Map(), confirmedDeletions: new Map(), storageFailed: false,
      managerRootId: null, selectedReplies: new Set(), managerStatus: '',
      deleteOpen: false, deleting: false, deleteContext: null, deleteRestoreFocus: null,
      pendingDelete: null, pendingDeleteFingerprint: null
    };

    function readStorage(key) {
      try { return localStorage.getItem(storagePrefix + key); }
      catch (_) { state.storageFailed = true; return null; }
    }
    function writeStorage(key, value) {
      try { localStorage.setItem(storagePrefix + key, value); }
      catch (_) { state.storageFailed = true; }
    }
    function uuid() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes).map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
      }
      return 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    var ownerId = readStorage('ownerId');
    if (!ownerId) { ownerId = uuid(); writeStorage('ownerId', ownerId); }
    var guestNickname = (config.authorName || readStorage('nickname') || '作者').slice(0, 24);
    var draft = {
      nickname: guestNickname, text: '', gesture: null, recordTime: null,
      parentId: null, replyToName: null, pendingPayload: null, pendingFingerprint: null
    };
    try {
      var savedDraft = JSON.parse(readStorage('draft') || 'null');
      if (savedDraft && typeof savedDraft === 'object' && !Array.isArray(savedDraft)) {
        draft.nickname = typeof savedDraft.nickname === 'string' ? savedDraft.nickname.slice(0, 24) : guestNickname;
        draft.text = typeof savedDraft.text === 'string' ? savedDraft.text : '';
        draft.gesture = Object.prototype.hasOwnProperty.call(gestureLabels, savedDraft.gesture) ? savedDraft.gesture : null;
        draft.recordTime = typeof savedDraft.recordTime === 'string' ? savedDraft.recordTime : null;
        draft.parentId = typeof savedDraft.parentId === 'string' ? savedDraft.parentId : null;
        draft.replyToName = typeof savedDraft.replyToName === 'string' ? savedDraft.replyToName : null;
        draft.pendingPayload = savedDraft.pendingPayload && typeof savedDraft.pendingPayload === 'object' ? savedDraft.pendingPayload : null;
        draft.pendingFingerprint = typeof savedDraft.pendingFingerprint === 'string' ? savedDraft.pendingFingerprint : null;
      }
    } catch (_) { /* An invalid saved draft must not prevent loading the page. */ }
    if (config.authorName) draft.nickname = config.authorName;
    try {
      var savedDelete = JSON.parse(readStorage('pendingDelete') || 'null');
      if (savedDelete && savedDelete.payload && typeof savedDelete.fingerprint === 'string') {
        state.pendingDelete = savedDelete.payload;
        state.pendingDeleteFingerprint = savedDelete.fingerprint;
      }
    } catch (_) { /* A damaged pending action does not block the notes. */ }

    function persistDraft() { writeStorage('draft', JSON.stringify(draft)); }
    function invalidatePending() { draft.pendingPayload = null; draft.pendingFingerprint = null; }
    function own() { return auth.supported() && auth.isOwner(); }
    function canDelete(item) {
      return !!(item && !item.deleted && (own() ||
        (item.ownerId && item.ownerId === ownerId && !state.verified.has(item.id) &&
          !Object.prototype.hasOwnProperty.call(item.raw, 'authorProof'))));
    }
    function manageableReplies(root) {
      return root ? root.replies.filter(canDelete) : [];
    }
    function text(value) { return typeof value === 'string' ? value : ''; }
    function node(tag, className, content) {
      var item = document.createElement(tag);
      if (className) item.className = className;
      if (content !== undefined) item.textContent = String(content);
      return item;
    }
    function button(className, label, callback) {
      var item = node('button', className, label);
      item.type = 'button';
      item.addEventListener('click', callback);
      return item;
    }
    function dateValue(item) {
      var value = Date.parse(item.createdAt);
      return Number.isFinite(value) ? value : 0;
    }
    function oldestFirst(a, b) {
      return dateValue(a) - dateValue(b) || a.id.localeCompare(b.id);
    }
    function friendlyTime(value) {
      var time = Date.parse(value);
      if (!Number.isFinite(time)) return '时间未记录';
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(time));
    }
    function errorText(error) {
      // Do not display arbitrary HTTP bodies, which can contain request credentials.
      if (error && error.safeMessage === true && typeof error.message === 'string') return error.message;
      var code = error && Number(error.status || error.statusCode);
      if (code === 401 || code === 403) return '暂时没有写入权限，请联系作者检查连接设置。';
      if (code === 429) return '请求有点频繁，请稍后再试。';
      return '网络或连接暂时不可用，请稍后重试。';
    }
    function composerStatus(message, isError) {
      el.deskComposerStatus.textContent = message;
      el.deskComposerStatus.classList.toggle('is-error', !!isError);
      el.deskComposerStatus.setAttribute('role', isError ? 'alert' : 'status');
    }
    function feedStatus(message, isError) {
      el.deskNotesStatus.textContent = message;
      el.deskNotesStatus.classList.toggle('is-error', !!isError);
    }
    function announceNotes() {
      window.dispatchEvent(new CustomEvent('desk:notes', {
        detail: { count: state.notes.filter(function (item) { return !item.deleted; }).length, filter: state.filter }
      }));
    }
    function normalize(raw) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
      return {
        id: raw.id, parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
        replyToName: text(raw.replyToName), author: text(raw.author) || '朋友',
        text: text(raw.text), ownerId: text(raw.ownerId), createdAt: text(raw.createdAt),
        recordTime: typeof raw.recordTime === 'string' && raw.recordTime ? raw.recordTime : null,
        gesture: Object.prototype.hasOwnProperty.call(gestureLabels, raw.gesture) ? raw.gesture : null,
        deleted: raw.deleted === true, raw: raw, rootId: null, replies: []
      };
    }
    function rootFor(item) {
      var seen = new Set([item.id]);
      var current = item;
      while (current.parentId && state.byId.has(current.parentId)) {
        if (seen.has(current.parentId)) return item;
        seen.add(current.parentId);
        current = state.byId.get(current.parentId);
      }
      return current;
    }
    async function prepareData() {
      var revision = ++state.revision;
      var rawById = new Map();
      state.rawComments.forEach(function (raw) {
        if (raw && typeof raw.id === 'string') rawById.set(raw.id, raw);
      });
      var rawNotes = Array.from(rawById.values());
      var pins = state.rawPins.filter(function (pin) {
        return pin && typeof pin.id === 'string' && pin.kind === 'pin' &&
          (pin.targetId === null || typeof pin.targetId === 'string') && Number.isFinite(Date.parse(pin.createdAt));
      });
      var deletions = state.rawDeletions.filter(function (event) {
        return event && typeof event.id === 'string' && event.kind === 'delete' &&
          Array.isArray(event.targetIds) && event.targetIds.length > 0 && event.targetIds.length <= 500 &&
          event.targetIds.every(function (id) { return typeof id === 'string' && id.length > 0; }) &&
          new Set(event.targetIds).size === event.targetIds.length;
      });
      var checked = await Promise.all(rawNotes.concat(pins, deletions).map(async function (payload, index) {
        if (!auth.supported()) return null;
        try {
          if ((await auth.verify(payload)) !== true) return null;
          return { type: index < rawNotes.length ? 'note' : (index < rawNotes.length + pins.length ? 'pin' : 'delete'), payload: payload };
        }
        catch (_) { return null; }
      }));
      if (revision !== state.revision) return;
      state.verified = new Set(checked.filter(function (item) { return item && item.type === 'note'; }).map(function (item) { return item.payload.id; }));
      state.notes = rawNotes.map(normalize).filter(Boolean);
      state.byId = new Map(state.notes.map(function (item) { return [item.id, item]; }));
      var authorDeletes = new Set(checked.filter(function (item) { return item && item.type === 'delete'; }).map(function (item) { return item.payload; }));
      deletions.forEach(function (event) {
        event.targetIds.forEach(function (id) {
          var item = state.byId.get(id);
          if (!item) return;
          if (authorDeletes.has(event) || (!Object.prototype.hasOwnProperty.call(event, 'authorProof') && typeof event.ownerId === 'string' && event.ownerId &&
              item.ownerId && item.ownerId === event.ownerId && !state.verified.has(item.id) &&
              !Object.prototype.hasOwnProperty.call(item.raw, 'authorProof'))) item.deleted = true;
        });
      });
      state.roots = [];
      state.notes.forEach(function (item) {
        var root = rootFor(item);
        item.rootId = root.id;
        if (root.id === item.id) state.roots.push(item);
        else root.replies.push(item);
      });
      state.roots.forEach(function (item) { item.replies.sort(oldestFirst); });
      var verifiedPins = checked.filter(function (item) { return item && item.type === 'pin'; }).map(function (item) { return item.payload; }).sort(oldestFirst);
      var latestPin = verifiedPins[verifiedPins.length - 1];
      var pinned = latestPin && state.byId.get(latestPin.targetId);
      state.pinnedId = pinned && !pinned.deleted && pinned.rootId === pinned.id ? pinned.id : null;
      if (!state.deleting && !state.deleteOpen) pruneManagerSelection();
      render();
      renderTarget();
      announceNotes();
    }
    function showWarnings(warnings) {
      var messages = [];
      if (Array.isArray(warnings)) {
        Array.from(new Set(warnings.filter(function (message) { return typeof message === 'string' && message; }))).slice(0, 3).forEach(function (message) { messages.push(message); });
      }
      if (!auth.supported()) messages.push('此浏览器无法验证作者签名，作者标记和置顶暂不可用，也无法确认作者的删除操作，部分已删除内容可能仍显示；朋友仍可留言。');
      if (state.storageFailed) messages.push('浏览器未允许本地保存，关闭页面后草稿和昵称可能无法保留。');
      el.deskNotesWarning.textContent = messages.join(' ');
      el.deskNotesWarning.hidden = !messages.length;
    }
    function refresh() {
      if (!guard('notes')) {
        feedStatus(configurationError().message, true);
        return Promise.resolve({ ok: false });
      }
      if (state.loading) return state.loading;
      el.deskNotesRefresh.disabled = true;
      feedStatus('正在收取纸条…', false);
      state.loading = (async function () {
        try {
          var data = await store.load();
          var comments = Array.isArray(data.comments) ? data.comments : [];
          var pins = Array.isArray(data.pins) ? data.pins : [];
          var deletions = Array.isArray(data.deletions) ? data.deletions : [];
          var remoteIds = new Set(comments.map(function (item) { return item && item.id; }));
          state.confirmedNotes.forEach(function (item, id) {
            if (remoteIds.has(id)) state.confirmedNotes.delete(id);
            else comments = comments.concat([item]);
          });
          var pinIds = new Set(pins.map(function (item) { return item && item.id; }));
          state.confirmedPins.forEach(function (item, id) {
            if (pinIds.has(id)) state.confirmedPins.delete(id);
            else pins = pins.concat([item]);
          });
          var deletionIds = new Set(deletions.map(function (item) { return item && item.id; }));
          state.confirmedDeletions.forEach(function (item, id) {
            if (deletionIds.has(id)) state.confirmedDeletions.delete(id);
            else deletions = deletions.concat([item]);
          });
          state.rawComments = comments;
          state.rawPins = pins;
          state.rawDeletions = deletions;
          await prepareData();
          showWarnings(data.warnings);
          feedStatus('纸条已更新 · ' + state.notes.filter(function (item) { return !item.deleted; }).length + ' 条留言与回复', false);
          return { ok: true };
        } catch (error) {
          feedStatus('暂时没能收取新纸条，已显示的内容仍可查看。' + errorText(error), true);
          showWarnings([]);
          return { ok: false, error: error };
        } finally {
          state.loading = null;
          el.deskNotesRefresh.disabled = invalidated;
        }
      })();
      return state.loading;
    }
    function effectiveRecord(item) {
      var root = state.byId.get(item.rootId);
      return root && root.recordTime ? root.recordTime : item.recordTime;
    }
    function getCount(time) {
      return state.notes.filter(function (item) { return !item.deleted && effectiveRecord(item) === time; }).length;
    }
    function recordLink(time) {
      var missing = state.recordsLoaded && !state.records.has(time);
      var link = button('desk-note-record' + (missing ? ' desk-record-missing' : ''), '关于 ' + time + ' 的开笔' + (missing ? ' · 原记录暂不可用' : ''), function () {
        var observer = window.ObserverRecords;
        var found = observer && typeof observer.focusRecord === 'function' && observer.focusRecord(time);
        if (!found) feedStatus('原记录暂不可用，纸条仍保留当时引用的时间。', false);
      });
      return link;
    }
    function authorRow(item) {
      var row = node('div', 'desk-note-header');
      row.appendChild(node('span', 'desk-note-author', item.author));
      if (state.verified.has(item.id)) row.appendChild(node('span', 'desk-note-owner', '作者'));
      var timestamp = node('time', 'desk-note-time', friendlyTime(item.createdAt));
      if (Number.isFinite(Date.parse(item.createdAt))) timestamp.dateTime = new Date(item.createdAt).toISOString();
      row.appendChild(timestamp);
      return row;
    }
    function noteBody(item, isReply) {
      var wrapper = node('article', isReply ? 'desk-reply' : 'desk-note');
      wrapper.dataset.noteId = item.id;
      wrapper.appendChild(authorRow(item));
      if (isReply && item.replyToName) wrapper.appendChild(node('div', 'desk-note-reply-target', '回复 ' + item.replyToName));
      if (!isReply && item.recordTime) wrapper.appendChild(recordLink(item.recordTime));
      if (item.deleted) wrapper.appendChild(node('p', 'desk-note-text', '这张纸条已删除。'));
      else {
        if (item.gesture) wrapper.appendChild(node('div', 'desk-note-gesture', gestureLabels[item.gesture]));
        if (item.text) wrapper.appendChild(node('p', 'desk-note-text', item.text));
      }
      if (isReply && state.managerRootId === item.rootId && canDelete(item)) {
        var selectLabel = node('label', 'desk-reply-select-label');
        var selectBox = node('input', 'desk-reply-select');
        selectBox.type = 'checkbox';
        selectBox.dataset.replyId = item.id;
        selectBox.checked = state.selectedReplies.has(item.id);
        selectBox.disabled = state.deleting || state.deleteOpen;
        selectBox.addEventListener('change', function () {
          if (state.deleting || state.deleteOpen) { selectBox.checked = state.selectedReplies.has(item.id); return; }
          if (selectBox.checked && state.selectedReplies.size >= 500) {
            selectBox.checked = false;
            state.managerStatus = '一次最多选择 500 条回复，请分批删除。';
          } else {
            if (selectBox.checked) state.selectedReplies.add(item.id);
            else state.selectedReplies.delete(item.id);
            state.managerStatus = '';
          }
          render();
          var replacement = Array.from(el.deskNotesList.querySelectorAll('.desk-reply-select')).find(function (input) { return input.dataset.replyId === item.id; });
          if (replacement) replacement.focus({ preventScroll: true });
        });
        selectLabel.appendChild(selectBox);
        selectLabel.appendChild(node('span', '', '选择 ' + item.author + ' 的这条回复'));
        wrapper.insertBefore(selectLabel, wrapper.firstChild);
      }
      var actions = node('div', 'desk-note-actions');
      var root = state.byId.get(item.rootId);
      if (!item.deleted && !(root && root.deleted)) actions.appendChild(button('desk-note-reply', '回复', function () {
        openComposer({ parentId: item.id, replyToName: item.author });
      }));
      if (!isReply && own() && !item.deleted) {
        var pin = button('desk-note-pin', state.pinnedId === item.id ? '取下这张纸条' : '夹在桌边', function () { togglePin(item.id); });
        pin.disabled = state.pinning || state.deleting || state.deleteOpen;
        actions.appendChild(pin);
      }
      if (canDelete(item)) {
        var remove = button('desk-note-delete', '删除', function () { confirmSingleDelete(item.id); });
        remove.disabled = state.deleting || state.deleteOpen || state.sending;
        actions.appendChild(remove);
      }
      if (actions.childNodes.length) wrapper.appendChild(actions);
      return wrapper;
    }
    function pruneManagerSelection() {
      var root = state.byId.get(state.managerRootId);
      if (!root || !manageableReplies(root).length) {
        state.managerRootId = null;
        state.selectedReplies.clear();
        state.managerStatus = '';
        return;
      }
      state.selectedReplies.forEach(function (id) {
        var item = state.byId.get(id);
        if (!item || item.rootId !== root.id || !canDelete(item)) state.selectedReplies.delete(id);
      });
    }
    function replyManager(root) {
      var bar = node('div', 'desk-reply-manager');
      var candidates = manageableReplies(root);
      var locked = state.deleting || state.deleteOpen;
      bar.appendChild(node('span', 'desk-reply-selection-count', '已选 ' + state.selectedReplies.size + ' 条回复'));
      var actions = node('div', 'desk-reply-manager-actions');
      var allSelected = candidates.length > 0 && candidates.every(function (item) { return state.selectedReplies.has(item.id); });
      var all = button('desk-reply-select-all', allSelected ? '取消全选' : '全选', function () {
        if (state.deleting || state.deleteOpen) return;
        if (allSelected) state.selectedReplies.clear();
        else if (candidates.length <= 500) candidates.forEach(function (item) { state.selectedReplies.add(item.id); });
        render();
      });
      all.disabled = locked || (!allSelected && candidates.length > 500);
      actions.appendChild(all);
      var remove = button('desk-reply-delete-selected', '删除所选（' + state.selectedReplies.size + '）', function () {
        if (state.deleting || state.deleteOpen || !state.selectedReplies.size) return;
        openDeleteDialog({ mode: 'batch', rootId: root.id, baseIds: Array.from(state.selectedReplies), replyIds: [], role: own() });
      });
      remove.disabled = locked || !state.selectedReplies.size || state.sending;
      actions.appendChild(remove);
      var exit = button('desk-reply-manager-exit', '退出管理', function () {
        if (state.deleting || state.deleteOpen) return;
        state.managerRootId = null;
        state.selectedReplies.clear();
        state.managerStatus = '';
        render();
      });
      exit.disabled = locked;
      actions.appendChild(exit);
      bar.appendChild(actions);
      var message = state.managerStatus || (candidates.length > 500 ? '可管理回复超过 500 条，请逐条选择并分批删除。' : (own() ? '只删除勾选的回复，主纸条不在选择范围内。' : '只能选择本浏览器发布的回复，主纸条不在选择范围内。'));
      var status = node('p', 'desk-reply-manager-status', message);
      status.setAttribute('role', 'status');
      bar.appendChild(status);
      return bar;
    }
    function render() {
      var roots = state.roots.filter(function (item) {
        return (!item.deleted || item.replies.some(function (reply) { return !reply.deleted; })) &&
          (!state.filter || item.recordTime === state.filter || item.replies.some(function (reply) { return reply.recordTime === state.filter; }));
      });
      var descending = el.deskNotesSort.value !== 'oldest';
      roots.sort(function (a, b) {
        if (a.id === state.pinnedId) return -1;
        if (b.id === state.pinnedId) return 1;
        return descending ? oldestFirst(b, a) : oldestFirst(a, b);
      });
      el.deskNotesFilter.hidden = !state.filter;
      el.deskNotesFilterLabel.textContent = state.filter ? '只看 ' + state.filter + ' 的纸条' : '';
      var fragment = document.createDocumentFragment();
      if (!roots.length) fragment.appendChild(node('p', 'desk-empty', state.filter ? '这次开笔还没有纸条。可以留一句话，也可以回到全部纸条。' : '书桌边还没有纸条。随时可以留一句话。'));
      roots.slice(0, state.shown).forEach(function (item) {
        var card = noteBody(item, false);
        if (item.id === state.pinnedId) {
          card.classList.add('desk-note--pinned');
          card.insertBefore(node('div', 'desk-note-pinned-label', '夹在桌边'), card.firstChild);
        }
        var replies = item.replies.filter(function (reply) { return !reply.deleted; });
        var managing = state.managerRootId === item.id;
        if (managing) card.appendChild(replyManager(item));
        else if (manageableReplies(item).length) {
          var manage = button('desk-reply-manage', '批量删除回复', function () {
            if (state.deleting || state.deleteOpen || state.sending) return;
            state.managerRootId = item.id;
            state.selectedReplies.clear();
            state.managerStatus = '';
            state.expanded.add(item.id);
            render();
          });
          manage.disabled = state.deleting || state.deleteOpen || state.sending;
          card.appendChild(manage);
        }
        if (replies.length) {
          var list = node('div', 'desk-replies');
          list.id = 'desk-replies-' + item.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          var expanded = managing || state.expanded.has(item.id);
          (expanded ? replies : replies.slice(0, 2)).forEach(function (reply) { list.appendChild(noteBody(reply, true)); });
          card.appendChild(list);
          if (replies.length > 2 && !managing) {
            var toggle = button('desk-replies-toggle', expanded ? '收起回复' : '展开其余 ' + (replies.length - 2) + ' 条回复', function () {
              if (state.expanded.has(item.id)) state.expanded.delete(item.id);
              else state.expanded.add(item.id);
              render();
              var replacement = Array.from(el.deskNotesList.querySelectorAll('[data-toggle-root]')).find(function (element) { return element.dataset.toggleRoot === item.id; });
              if (replacement) replacement.focus({ preventScroll: true });
            });
            toggle.dataset.toggleRoot = item.id;
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.setAttribute('aria-controls', list.id);
            card.appendChild(toggle);
          }
        }
        fragment.appendChild(card);
      });
      el.deskNotesList.replaceChildren(fragment);
      el.deskNotesMore.hidden = roots.length <= state.shown;
      el.deskNotesMore.textContent = '再看 10 张纸条 · 还有 ' + Math.max(0, roots.length - state.shown) + ' 张';
      if (invalidated) lockActions();
    }
    function filterRecord(time) {
      state.filter = typeof time === 'string' && time ? time : null;
      state.shown = 10;
      render();
      el.deskNotes.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    function clearFilter() { state.filter = null; state.shown = 10; render(); }
    function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

    function lockPage() {
      state.scrollY = window.scrollY;
      state.bodyStyle = {
        overflow: document.body.style.overflow, position: document.body.style.position,
        top: document.body.style.top, width: document.body.style.width
      };
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + state.scrollY + 'px';
      document.body.style.width = '100%';
    }
    function unlockPage() {
      var prior = state.bodyStyle || {};
      document.body.style.overflow = prior.overflow || '';
      document.body.style.position = prior.position || '';
      document.body.style.top = prior.top || '';
      document.body.style.width = prior.width || '';
      window.scrollTo({ top: state.scrollY, left: 0, behavior: 'instant' });
    }
    function syncOwnerControls() {
      var busy = state.sending || state.deleting || state.deleteOpen || invalidated;
      el.deskOwnerImport.disabled = busy || !auth.supported();
      el.deskOwnerForget.disabled = busy;
    }
    function persistPendingDelete() {
      writeStorage('pendingDelete', state.pendingDelete ? JSON.stringify({
        payload: state.pendingDelete, fingerprint: state.pendingDeleteFingerprint
      }) : 'null');
    }
    function deleteStatus(message, isError) {
      el.deskDeleteStatus.textContent = message;
      el.deskDeleteStatus.classList.toggle('is-error', !!isError);
      el.deskDeleteStatus.setAttribute('role', isError ? 'alert' : 'status');
    }
    function selectedDeleteIds() {
      var context = state.deleteContext;
      if (!context) return [];
      return context.baseIds.concat(el.deskDeleteIncludeReplies.checked ? context.replyIds : []);
    }
    function renderDeleteDialog() {
      var context = state.deleteContext;
      if (!context) return;
      var ids = selectedDeleteIds();
      var roots = context.mode === 'root' ? 1 : 0;
      var replies = ids.length - roots;
      el.deskDeleteTitle.textContent = context.mode === 'batch' ? '删除选中的回复' : '确认删除';
      el.deskDeleteSummary.textContent = '将删除 ' + (roots ? roots + ' 张主纸条' + (replies ? '和 ' : '') : '') +
        (replies ? replies + ' 条回复' : '') + '，共 ' + ids.length + ' 条。';
      el.deskDeleteIncludeRepliesOption.hidden = context.mode !== 'root' || !context.replyIds.length;
      var tooMany = context.baseIds.length + context.replyIds.length > 500;
      el.deskDeleteIncludeReplies.disabled = state.deleting || tooMany;
      el.deskDeleteIncludeRepliesLabel.textContent = context.role ?
        '同时删除下方当前的 ' + context.replyIds.length + ' 条回复' :
        '同时删除下方由本浏览器发布的 ' + context.replyIds.length + ' 条回复（其他朋友的回复保留）';
      if (tooMany) el.deskDeleteIncludeRepliesLabel.textContent += '；合计超过 500 条，请先在批量管理中分批删除回复。';
      var scopeDetail = context.mode === 'root' ?
        (el.deskDeleteIncludeReplies.checked ? '只处理这次确认中列出的纸条与回复，新到的回复不会一起删除。' : '只删除主纸条，下方回复会保留。') :
        '只删除这次选中的 ' + replies + ' 条回复，主纸条和新到的回复会保留。';
      var preview = state.byId.get(context.mode === 'batch' ? context.rootId : context.baseIds[0]);
      var previewText = preview ? (preview.deleted ? '已删除的主纸条' : (preview.text || gestureLabels[preview.gesture] || '纸条')) : '';
      el.deskDeleteDetail.textContent = (preview ? (context.mode === 'batch' ? '所在讨论：' : '删除对象：') + preview.author.slice(0, 24) + ' · ' + previewText.replace(/\s+/g, ' ').slice(0, 70) + '\n' : '') + scopeDetail;
      el.deskDeleteDisclosure.textContent = '页面会隐藏所选内容，Gist 原始数据仍保留。';
      el.deskDeleteConfirm.textContent = state.deleting ? '正在删除…' : '删除所选（' + ids.length + '）';
      el.deskDeleteConfirm.disabled = state.deleting || !ids.length || ids.length > 500 || invalidated;
      el.deskDeleteCancel.disabled = state.deleting;
      el.deskDeleteClose.disabled = state.deleting;
      el.deskDeleteDialog.classList.toggle('is-deleting', state.deleting);
    }
    function openDeleteDialog(context) {
      if (state.deleting || state.sending || state.deleteOpen) return;
      if (state.open) closeComposer();
      state.deleteContext = {
        mode: context.mode, rootId: context.rootId, role: context.role,
        baseIds: context.baseIds.slice(), replyIds: context.replyIds.slice()
      };
      state.deleteRestoreFocus = document.activeElement;
      lockPage();
      state.deleteOpen = true;
      el.deskDeleteIncludeReplies.checked = false;
      el.deskDeleteDialog.hidden = false;
      el.deskDeletePanel.setAttribute('tabindex', '-1');
      deleteStatus('', false);
      renderDeleteDialog();
      syncOwnerControls();
      render();
      requestAnimationFrame(function () { if (state.deleteOpen) el.deskDeleteCancel.focus({ preventScroll: true }); });
    }
    function closeDeleteDialog(force) {
      if (!state.deleteOpen || (state.deleting && !force)) return;
      var context = state.deleteContext;
      state.deleteOpen = false;
      state.deleteContext = null;
      el.deskDeleteDialog.hidden = true;
      unlockPage();
      syncOwnerControls();
      pruneManagerSelection();
      render();
      if (state.deleteRestoreFocus && state.deleteRestoreFocus.isConnected && !state.deleteRestoreFocus.disabled) {
        state.deleteRestoreFocus.focus({ preventScroll: true });
      } else {
        var card = context && Array.from(el.deskNotesList.querySelectorAll('[data-note-id]')).find(function (item) { return item.dataset.noteId === context.rootId; });
        var fallback = card && (card.querySelector('.desk-reply-delete-selected:not([disabled])') || card.querySelector('.desk-reply-manage:not([disabled])') || card.querySelector('.desk-note-delete:not([disabled])'));
        (fallback || el.deskNotesOpen).focus({ preventScroll: true });
      }
    }
    function confirmSingleDelete(id) {
      var item = state.byId.get(id);
      if (!canDelete(item) || state.sending || state.deleting || state.deleteOpen) return;
      var root = rootFor(item);
      openDeleteDialog({
        mode: root.id === item.id ? 'root' : 'reply', rootId: root.id,
        baseIds: [item.id], replyIds: root.id === item.id ? manageableReplies(root).map(function (reply) { return reply.id; }) : [], role: own()
      });
    }
    async function submitDelete() {
      if (!guard('notes')) { deleteStatus(configurationError().message, true); return; }
      if (!state.deleteOpen || state.deleting || !state.deleteContext) return;
      var ids = selectedDeleteIds().slice();
      if (!ids.length || ids.length > 500) { deleteStatus('一次请选择 1–500 条内容。', true); return; }
      if (own() !== state.deleteContext.role) { deleteStatus('作者身份已改变，请关闭弹窗后重新选择。', true); return; }
      var remaining = ids.map(function (id) { return state.byId.get(id); }).filter(function (item) { return item && !item.deleted; });
      if (remaining.some(function (item) { return !canDelete(item); })) {
        deleteStatus('其中有内容已不可由当前身份删除，请关闭弹窗后重新选择。', true);
        return;
      }
      if (!remaining.length) {
        ids.forEach(function (id) { state.selectedReplies.delete(id); });
        state.pendingDelete = null; state.pendingDeleteFingerprint = null; persistPendingDelete();
        closeDeleteDialog(false);
        feedStatus('所选内容已经删除，无需再次提交。', false);
        return;
      }
      var fingerprint = JSON.stringify({ ids: ids.slice().sort(), ownerId: ownerId, owner: own() });
      state.deleting = true;
      syncOwnerControls();
      renderDeleteDialog();
      render();
      deleteStatus('正在保存删除操作…', false);
      var saved = false;
      try {
        var payload;
        if (state.pendingDelete && state.pendingDeleteFingerprint === fingerprint) payload = state.pendingDelete;
        else {
          payload = { id: uuid(), kind: 'delete', targetIds: ids, ownerId: ownerId, createdAt: new Date().toISOString() };
          if (own()) payload = await auth.sign(payload);
          state.pendingDelete = payload;
          state.pendingDeleteFingerprint = fingerprint;
          persistPendingDelete();
        }
        var result = await store.append(payload);
        saved = true;
        var savedPayload = result && result.id === payload.id ? result : payload;
        state.confirmedDeletions.set(payload.id, savedPayload);
        state.rawDeletions = state.rawDeletions.filter(function (item) { return item.id !== payload.id; }).concat([savedPayload]);
        ids.forEach(function (id) { state.selectedReplies.delete(id); });
        state.pendingDelete = null; state.pendingDeleteFingerprint = null; persistPendingDelete();
        await prepareData();
        closeDeleteDialog(true);
        feedStatus('所选的 ' + ids.length + ' 条内容已删除。', false);
        // Display the confirmed write locally; further reads require manual refresh.
      } catch (error) {
        if (saved) {
          deleteStatus('删除操作已保存，显示暂未更新。请关闭后刷新纸条。', false);
          feedStatus('删除操作已保存，显示暂未更新。请刷新纸条。', false);
        } else {
          persistPendingDelete();
          deleteStatus('尚未确认是否删除成功，选择已保留。请先手动刷新纸条确认送达情况，再重试。' + errorText(error), true);
        }
      } finally {
        state.deleting = false;
        syncOwnerControls();
        renderDeleteDialog();
        render();
      }
    }

    function syncDraftFromInputs() {
      draft.text = el.deskText.value;
      if (!own()) {
        draft.nickname = el.deskNickname.value;
        guestNickname = draft.nickname;
        writeStorage('nickname', guestNickname);
      }
    }
    function renderGestures() {
      Array.from(el.deskGestures.querySelectorAll('[data-gesture]')).forEach(function (item) {
        var selected = item.dataset.gesture === draft.gesture;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
    }
    function renderTarget() {
      var parts = [];
      if (draft.parentId) parts.push('回复 ' + (draft.replyToName || '这张纸条'));
      if (draft.recordTime) parts.push('关于 ' + draft.recordTime + ' 的开笔');
      el.deskComposerTarget.hidden = !parts.length;
      el.deskComposerTargetLabel.textContent = parts.join(' · ');
      el.deskComposerTitle.textContent = draft.parentId ? '回一张纸条' : '给书桌递张纸条';
      el.deskComposerClearTarget.textContent = '改为普通留言';
    }
    function fillComposer() {
      el.deskNickname.value = own() ? (config.authorName || '作者') : draft.nickname;
      el.deskNickname.readOnly = own();
      el.deskText.value = draft.text;
      renderTarget();
      renderGestures();
    }
    function setBusy(busy) {
      state.sending = busy;
      el.deskSubmit.disabled = busy || invalidated;
      el.deskSubmit.textContent = busy ? '正在递出…' : '递出纸条';
      el.deskText.disabled = busy;
      el.deskNickname.disabled = busy;
      el.deskComposerClearTarget.disabled = busy;
      syncOwnerControls();
      Array.from(el.deskGestures.querySelectorAll('button')).forEach(function (item) { item.disabled = busy; });
    }
    function focusableItems(panel) {
      return Array.from((panel || el.deskComposerPanel).querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(function (item) {
        return !item.closest('[hidden]') && item.getClientRects().length > 0;
      });
    }
    function openComposer(options) {
      if (!guard('notes')) { feedStatus(configurationError().message, true); return; }
      options = options || {};
      if (state.sending || state.deleting || state.deleteOpen) return;
      if (state.open) syncDraftFromInputs();
      var explicitRecord = Object.prototype.hasOwnProperty.call(options, 'recordTime');
      var explicitParent = Object.prototype.hasOwnProperty.call(options, 'parentId');
      var previousTarget = JSON.stringify([draft.recordTime, draft.parentId, draft.replyToName]);
      if (explicitParent && options.parentId) {
        var target = state.byId.get(String(options.parentId));
        if (!target || target.deleted) { feedStatus('这张纸条暂不可回复，请刷新后再试。', true); return; }
        var root = rootFor(target);
        if (root.deleted) { feedStatus('主纸条已删除，不能继续向这个讨论串回复。', true); return; }
        draft.parentId = root.id;
        draft.replyToName = target.author;
        draft.recordTime = root.recordTime;
      } else if (explicitRecord || explicitParent) {
        draft.parentId = null;
        draft.replyToName = null;
        draft.recordTime = typeof options.recordTime === 'string' && options.recordTime ? options.recordTime : null;
      }
      if (previousTarget !== JSON.stringify([draft.recordTime, draft.parentId, draft.replyToName])) invalidatePending();
      persistDraft();
      fillComposer();
      composerStatus(draft.pendingPayload ? '上次发送未确认；内容和身份未改变时会沿用同一编号，请先手动刷新纸条确认送达情况，再重试。' : '', false);
      if (!state.open) {
        state.restoreFocus = document.activeElement;
        lockPage();
        state.open = true;
        el.deskComposer.hidden = false;
        el.deskComposerPanel.setAttribute('tabindex', '-1');
      }
      requestAnimationFrame(function () {
        if (!state.open) return;
        (el.deskNickname.value.trim() ? el.deskText : el.deskNickname).focus({ preventScroll: true });
      });
    }
    function closeComposer() {
      if (!state.open) return;
      if (!state.sending) { syncDraftFromInputs(); persistDraft(); }
      state.open = false;
      el.deskComposer.hidden = true;
      unlockPage();
      if (state.restoreFocus && state.restoreFocus.isConnected) state.restoreFocus.focus({ preventScroll: true });
      else el.deskNotesOpen.focus({ preventScroll: true });
    }
    async function submit(event) {
      event.preventDefault();
      if (!guard('notes')) { composerStatus(configurationError().message, true); return; }
      if (state.sending || state.deleting || state.deleteOpen) return;
      syncDraftFromInputs();
      var author = (own() ? (config.authorName || '作者') : draft.nickname).trim();
      var message = draft.text.trim();
      if (!author || author.length > 24) { composerStatus('请填写 1–24 字的昵称。', true); el.deskNickname.focus(); return; }
      if (!message && !draft.gesture) { composerStatus('写一句话，或者选一个小动作。', true); el.deskText.focus(); return; }
      if (message.length > 2000) { composerStatus('纸条最多 2000 字，缩短一点再发送。', true); el.deskText.focus(); return; }
      if (draft.parentId && (!state.byId.has(draft.parentId) || state.byId.get(draft.parentId).deleted)) {
        composerStatus('原纸条已删除或暂不可用。可以稍后重试，或点“改为普通留言”。', true);
        return;
      }
      var fingerprint = JSON.stringify({
        author: author, text: message, gesture: draft.gesture, recordTime: draft.recordTime,
        parentId: draft.parentId, replyToName: draft.replyToName, owner: own(), ownerId: ownerId
      });
      setBusy(true);
      composerStatus('正在把纸条放到书桌上…', false);
      var saved = false;
      try {
        var payload;
        if (draft.pendingPayload && draft.pendingFingerprint === fingerprint) payload = draft.pendingPayload;
        else {
          payload = {
            id: uuid(), kind: 'note', parentId: draft.parentId,
            replyToName: draft.parentId ? draft.replyToName : null,
            author: author, text: message, ownerId: ownerId, createdAt: new Date().toISOString(),
            likes: 0, deleted: false, recordTime: draft.recordTime, gesture: draft.gesture
          };
          if (own()) payload = await auth.sign(payload);
          draft.pendingPayload = payload;
          draft.pendingFingerprint = fingerprint;
          persistDraft();
        }
        var result = await store.append(payload);
        saved = true;
        var savedPayload = result && result.id === payload.id ? result : payload;
        state.confirmedNotes.set(payload.id, savedPayload);
        state.rawComments = state.rawComments.filter(function (item) { return item.id !== payload.id; }).concat([savedPayload]);
        if (payload.parentId) state.expanded.add(payload.parentId);
        draft.text = '';
        draft.gesture = null;
        draft.recordTime = null;
        draft.parentId = null;
        draft.replyToName = null;
        invalidatePending();
        persistDraft();
        fillComposer();
        await prepareData();
        composerStatus('纸条已递出。', false);
        feedStatus('纸条已递出。', false);
        closeComposer();
        // Display the confirmed write locally; further reads require manual refresh.
      } catch (error) {
        if (saved) {
          composerStatus('纸条已保存，显示暂未更新。请刷新纸条查看。', false);
          feedStatus('纸条已保存，显示暂未更新。请刷新纸条查看。', false);
        } else {
          persistDraft();
          composerStatus('还没确认纸条是否送达，草稿已保留。请先手动刷新纸条确认送达情况，再重试。' + errorText(error), true);
          if (!state.open) feedStatus('纸条发送未确认，重新打开输入框可继续重试。', true);
        }
      } finally { setBusy(false); }
    }
    async function togglePin(id) {
      if (!guard('notes')) { feedStatus(configurationError().message, true); return; }
      if (!own() || state.pinning || state.deleting || state.deleteOpen) return;
      state.pinning = true;
      render();
      var saved = false;
      try {
        var event = await auth.sign({ id: uuid(), kind: 'pin', targetId: state.pinnedId === id ? null : id, createdAt: new Date().toISOString() });
        var result = await store.append(event);
        saved = true;
        var payload = result && result.id === event.id ? result : event;
        state.confirmedPins.set(payload.id, payload);
        state.rawPins.push(payload);
        await prepareData();
        feedStatus(payload.targetId ? '纸条已夹在桌边。' : '已取下这张纸条。', false);
        // Display the confirmed write locally; further reads require manual refresh.
      } catch (error) {
        feedStatus(saved ? '置顶设置已保存，显示暂未更新。' : '暂时没能确认置顶设置。' + errorText(error), !saved);
      } finally { state.pinning = false; render(); }
    }
    function renderOwner() {
      var isOwner = own();
      el.deskOwnerState.textContent = isOwner ? '作者钥匙已启用 · 回复会带作者标记' : '当前为本人昵称 · 尚未启用作者签名，认证标记和管理权限不可用';
      el.deskOwnerForget.hidden = !isOwner;
      syncOwnerControls();
      if (!auth.supported()) el.deskOwnerStatus.textContent = '此浏览器无法使用作者签名；请换一个支持的浏览器导入钥匙。';
      fillComposer();
      pruneManagerSelection();
      render();
    }
    async function importOwner(event) {
      if (!guard('notes')) return;
      var file = event.target.files && event.target.files[0];
      if (!file || state.sending || state.deleting || state.deleteOpen) return;
      el.deskOwnerImport.disabled = true;
      el.deskOwnerStatus.textContent = '正在检查作者钥匙…';
      try {
        if (file.size > 65536) throw new Error('Key file too large');
        await auth.importKey(await file.text());
        persistDraft();
        el.deskOwnerStatus.textContent = typeof auth.isPersistent === 'function' && auth.isPersistent() === false ? '作者钥匙已启用；此浏览器仅在本次打开期间保存作者身份，关闭后需要重新导入。' : '作者钥匙已启用。';
      } catch (_) { el.deskOwnerStatus.textContent = '没有导入成功，请确认选择的是这张书桌的作者钥匙文件。'; }
      finally { el.deskOwnerImport.value = ''; renderOwner(); }
    }
    async function forgetOwner() {
      if (!guard('notes')) return;
      if (state.sending || state.deleting || state.deleteOpen) return;
      await auth.forget();
      persistDraft();
      el.deskOwnerStatus.textContent = '已退出作者身份。';
      renderOwner();
    }
    function updateRecords(records) {
      if (!Array.isArray(records)) return;
      state.records = new Set(records.map(function (item) { return typeof item === 'string' ? item : item && item.time; }).filter(function (time) { return typeof time === 'string'; }));
      state.recordsLoaded = true;
      render();
    }

    el.deskNickname.maxLength = 24;
    el.deskText.maxLength = 2000;
    el.deskNotesOpen.addEventListener('click', function () { openComposer(); });
    el.deskNotesRefresh.addEventListener('click', refresh);
    el.deskNotesClearFilter.addEventListener('click', clearFilter);
    el.deskNotesSort.addEventListener('change', function () { state.shown = 10; render(); });
    el.deskNotesMore.addEventListener('click', function () { state.shown += 10; render(); });
    el.deskComposerClose.addEventListener('click', closeComposer);
    el.deskComposer.addEventListener('click', function (event) { if (event.target === el.deskComposer) closeComposer(); });
    el.deskComposerForm.addEventListener('submit', submit);
    el.deskComposerClearTarget.addEventListener('click', function () {
      draft.parentId = null; draft.replyToName = null; draft.recordTime = null;
      invalidatePending(); persistDraft(); renderTarget();
      composerStatus('现在是给书桌的普通留言，草稿内容已保留。', false);
    });
    [el.deskNickname, el.deskText].forEach(function (input) {
      input.addEventListener('input', function () { syncDraftFromInputs(); invalidatePending(); persistDraft(); });
    });
    el.deskGestures.addEventListener('click', function (event) {
      var target = event.target.closest('[data-gesture]');
      if (!target || !el.deskGestures.contains(target) || state.sending || !Object.prototype.hasOwnProperty.call(gestureLabels, target.dataset.gesture)) return;
      draft.gesture = draft.gesture === target.dataset.gesture ? null : target.dataset.gesture;
      invalidatePending(); persistDraft(); renderGestures();
    });
    el.deskOwnerImport.addEventListener('change', importOwner);
    el.deskOwnerForget.addEventListener('click', function () { forgetOwner().catch(function () { el.deskOwnerStatus.textContent = '暂时未能退出作者身份，请重试。'; }); });
    el.deskDeleteConfirm.addEventListener('click', submitDelete);
    el.deskDeleteCancel.addEventListener('click', function () { closeDeleteDialog(false); });
    el.deskDeleteClose.addEventListener('click', function () { closeDeleteDialog(false); });
    el.deskDeleteDialog.addEventListener('click', function (event) { if (event.target === el.deskDeleteDialog) closeDeleteDialog(false); });
    el.deskDeleteIncludeReplies.addEventListener('change', function () {
      if (state.deleting) return;
      deleteStatus('', false);
      renderDeleteDialog();
    });
    document.addEventListener('keydown', function (event) {
      if (!state.open && !state.deleteOpen) return;
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); if (state.deleteOpen) closeDeleteDialog(false); else closeComposer(); return; }
      if (event.key !== 'Tab') return;
      var panel = state.deleteOpen ? el.deskDeletePanel : el.deskComposerPanel;
      var items = focusableItems(panel);
      if (!items.length) { event.preventDefault(); panel.focus(); return; }
      var first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', function (event) {
      var panel = state.deleteOpen ? el.deskDeletePanel : (state.open ? el.deskComposerPanel : null);
      if (panel && !panel.contains(event.target)) {
        var items = focusableItems(panel);
        (items[0] || panel).focus();
      }
    });
    window.addEventListener('observer:records', function (event) { updateRecords(event.detail && event.detail.records); });
    window.addEventListener('pagehide', function () { if (state.open && !state.sending) syncDraftFromInputs(); persistDraft(); });
    window.DeskNotes = { open: openComposer, filterRecord: filterRecord, clearFilter: clearFilter, getCount: getCount, refresh: refresh };
    if (window.ObserverRecords && typeof window.ObserverRecords.getRecords === 'function') updateRecords(window.ObserverRecords.getRecords());
    fillComposer();
    render();
    Promise.resolve(auth.initialized).catch(function () {
      el.deskOwnerStatus.textContent = '已保存的作者钥匙暂不可用，可以重新导入。';
    }).then(function () { renderOwner(); return refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

(function(){
  'use strict';
  document.getElementById('mobileNoteOpen').addEventListener('click',function(){if(window.DeskNotes)window.DeskNotes.open()});
  document.querySelector('.owner-import').addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('deskOwnerImport').click()}});
  function fitKeyboard(){if(window.visualViewport)document.documentElement.style.setProperty('--desk-viewport-height',window.visualViewport.height+'px')}
  if(window.visualViewport){window.visualViewport.addEventListener('resize',fitKeyboard);fitKeyboard()}
})();
})(window);
