/* Local-only notebook. The public worker status and all third-party pages are separate. */
'use strict';
(() => {
  const T=globalThis.FirstTrial, key='mirsad.first-trial', el=id=>document.getElementById(id);
  const text=(id,value)=>{const e=el(id);if(e.textContent!==value)e.textContent=value;};
  const show=(id,yes)=>{el(id).hidden=!yes;};
  const storageNote='تُحفظ هذه التجربة في هذا التبويب فقط لتصمد أمام تحديث الصفحة. قبل إغلاقه نزّل سجلّك إن أردت الاستئناف لاحقًا. السجل ليس مشفّرًا.';
  const memoryNote='تعذّر حفظ نسخة حديثة في هذا التبويب. السجل في الذاكرة الآن؛ نزّله قبل إغلاق الصفحة أو تحديثها.';
  let state=null,locked=false,backupUrl=null,store=null;
  function timer(ms) {
    const sec=Math.ceil(ms/1000);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  }
  function duration(ms) {
    const sec=Math.floor(ms/1000),days=Math.floor(sec/86400),hours=Math.floor(sec%86400/3600),min=Math.floor(sec%3600/60);
    return [days?days+' يوم':'',hours?hours+' س':'',min?min+' د':'',(!days&&!hours)?sec%60+' ث':''].filter(Boolean).join(' · ');
  }
  function rail(stage){for(const name of ['setup','watch','review'])el('step-'+name).classList.toggle('current',stage===name);}
  function plan(){
    if(state)return;
    el('begin').disabled=true;text('budget','حتى 30 دقيقة');
    if(locked){text('plan','تعذّرت استعادة السجل السابق. لا نبدأ فوقه تجربة جديدة؛ صحّح الساعة أو امسحه بنفسك.');return;}
    const b=el('balance').value,c=el('cost').value;
    if(!b.trim()||!c.trim()){text('plan','بانتظار الرقمين من شاشتك؛ لا توجد أرقام مفترضة.');return;}
    try{const f=T.fuel(b,c);
      text('plan',f.cycles?`تكفي النقاط لـ ${f.cycles} من 6 دورات في الاختبار: نافذة ${f.minutes} دقيقة، وليست مكافآت مكتسبة.`:'لا تكفي النقاط لدورة واحدة بهذا الإعداد. وفّر وقتك ولا تبدأ مؤقّتًا أو تشترِ نقاطًا لهذه التجربة.');
      text('budget',f.minutes+' دقيقة');el('begin').disabled=!f.cycles;
    }catch(e){text('plan',e.message);}
  }
  function recordButtons(){
    el('reset').disabled=!state&&!locked;
    show('export',!!state&&!!backupUrl);
    el('import').disabled=!!state||locked;
  }
  function makeBackup(){
    if(backupUrl)URL.revokeObjectURL(backupUrl);
    backupUrl=null;el('export').removeAttribute('href');
    if(state){try{backupUrl=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)+'\n'],{type:'application/json'}));el('export').href=backupUrl;}
      catch{text('file-status','تعذّر تجهيز ملف التنزيل في هذا المتصفّح.');}}
    recordButtons();
  }
  function persist(){
    if(!store){text('storage-hint',memoryNote);return;}
    try{if(state)store.setItem(key,JSON.stringify(state));else store.removeItem(key);text('storage-hint',storageNote);}
    catch{text('storage-hint',memoryNote);}
  }
  function selectState(next){state=next;locked=false;text('error','');text('file-status','');show('reset-choice',false);persist();makeBackup();render();}
  function allowNote(){el('note').disabled=!(el('confirm-receipt').checked&&el('coin').value.trim()&&el('quantity').value.trim());}
  function render(){
    if(!state){rail('setup');show('setup',true);for(const id of ['watching','review','noted'])show(id,false);
      text('phase-label','الخطوة 01 / قبل التشغيل');text('phase-title','هل يكفي رصيد DUTCHY؟');text('clock','—');text('meter-hint','المؤقّت متوقف. لا تُفتح تبويبات أو إعلانات تلقائيًا.');text('evidence','لم يبدأ الاختبار');plan();return;}
    let v;try{v=T.inspect(state,Date.now());}catch(e){
      for(const id of ['setup','watching','review','noted'])show(id,false);text('error',e.message);text('phase-title','تحقّق من ساعة الجهاز');text('phase-label','المتابعة متوقفة');text('clock','—');text('meter-hint','لا نحسب نتيجة عند اختلاف الساعة.');text('evidence','غير معروض');return;
    }
    const {phase}=v,on=phase==='watching',done=phase==='noted',pending=phase==='pending';
    rail(on?'watch':'review');show('setup',false);show('watching',on);show('review',!on&&!done);show('noted',done);show('pending',phase==='review');
    text('phase-label',on?'الخطوة 02 / قياس الوقت':'الخطوة 03 / نتيجة التجربة');
    text('phase-title',on?'نافذة التجربة جارية':done?'دوّنت أول وارد':pending?'الطلب معلّق، وليس دخلًا':'راجع سجل الوارد');
    text('clock',timer(v.remaining));text('budget',(v.window/60000)+' دقيقة');
    text('evidence',on?'لا وارد مسجّل':done?'وارد بحسب تأكيدك':pending?'طلب معلّق بحسب ملاحظتك':'لا وارد مسجّل');
    text('meter-hint',on?'الوقت محسوب منذ ضغطك زر البدء، وليس من رصد نشاط في الصنبور.':'انتهى قياس الوقت. لا يعني ذلك أن الصنبور توقف أو أرسل دفعة.');
    if(!on&&!done){text('review-prompt',pending?'لا تضِف وقتًا أو مالًا أثناء الانتظار. عند وصول الدفعة حقًا، دوّنها أدناه ولو في يوم آخر.':'إن كانت الميزة تعمل فأوقفها بنفسك عند نهاية الاختبار. إن لم تجد طلبًا أو واردًا فاترك السجل كما هو؛ لا يُحسب ذلك رفضًا أو قبضًا.');allowNote();}
    if(done){text('noted-amount',state.receipt.quantity+' '+state.receipt.coin);text('elapsed',duration(v.elapsed));text('lag',duration(v.untilNoted));}
  }
  for(const id of ['balance','cost'])el(id).addEventListener('input',()=>{text('error','');plan();});
  for(const id of ['coin','quantity','confirm-receipt'])el(id).addEventListener('input',allowNote);
  function action(id,fn){el(id).addEventListener('click',()=>{try{selectState(fn());}catch(e){text('error',e.message);render();}});}
  action('begin',()=>{if(state||locked)throw Error('يوجد سجل سابق.');return T.begin(el('balance').value,el('cost').value,Date.now());});
  action('finish',()=>T.finish(state,Date.now()));
  action('pending',()=>T.markPending(state,Date.now()));
  action('note',()=>T.noteReceipt(state,el('coin').value,el('quantity').value,el('confirm-receipt').checked,Date.now()));
  el('reset').addEventListener('click',()=>show('reset-choice',true));
  el('keep').addEventListener('click',()=>show('reset-choice',false));
  el('discard').addEventListener('click',()=>{
    for(const id of ['balance','cost','quantity','coin','import'])el(id).value='';el('confirm-receipt').checked=false;
    selectState(null);text('file-status','مُسحت التجربة من الواجهة. أي ملف نزّلته يبقى عندك.');
  });
  el('import').addEventListener('change',async()=>{
    const file=el('import').files[0];el('import').value='';if(!file)return;
    try{if(file.size>2048)throw Error('الملف أكبر من سجل واحد.');
      const s=T.restore(await file.text(),Date.now());
      if(state||locked)throw Error('لن نستبدل تجربة جارية. نزّلها ثم امسحها أولًا.');
      selectState(s);text('file-status','استُعيد سجل محلي، وليس هذا تحققًا من المعاملة.');
    }catch(e){text('file-status',e.name==='Error'?e.message:'تعذّرت قراءة ملف السجل.');}
  });
  try{store=window.sessionStorage;const saved=store.getItem(key);
    if(saved!==null){try{state=T.restore(saved,Date.now());}catch(e){locked=true;text('error',e.message);}}
    text('storage-hint',storageNote);
  }catch{store=null;text('storage-hint',memoryNote);}
  makeBackup();render();
  // Recompute from timestamps after tab suspension; no count of successful claims is inferred.
  setInterval(()=>{if(state&&!document.hidden)render();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
})();
