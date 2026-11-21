'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const set=(id,value)=>{const node=el(id);if(node.textContent!==value)node.textContent=value;};
  const node=(tag,text,cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const clock=s=>new Date(s*1000).toISOString().slice(11,19);
  const utc=s=>s==null?'—':new Date(s*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
  const reasons={no_snapshot:'تعذّرت قراءة ملفّ الحدود.',stale_snapshot:'لقطة الحدود أقدم من سبعة أيام.',inactive_listing:'اللقطة لا تُظهر الصنبور بحالة نشطة.',no_quote:'لا توجد نشرة سعر صالحة.',stale_quote:'نشرة السعر أقدم من يومين أو تاريخها غير صالح.'};
  const labels={snapshot_read:'قُرئت لقطة الدليل وحدود السحب المحلية وتحقّق العامل من بياناتها.',snapshot_invalid:'تعذّرت قراءة اللقطة المحلية. لم تُستبدل بأرقام تجريبية.',quote_download:'جلب العامل نشرة الأسعار عبر الشبكة، وطابق بصمة الملف، وقرأ أسعار BCH وLTC وDOGE.',quote_unchanged:'فُحص إصدار النشرة عبر الشبكة؛ النسخة والبصمة لم تتغيّرا.'};
  let state=null,seen=0,connected=false,busy=false,routesKey=null,eventsKey=null;
  function badge(text,style){set('connection',text);el('connection').className='badge '+style;}
  function eventText(e){
    if(e.kind==='compared')return `قورنت ثلاثة مسارات. المبلغ الافتراضي يغطي الحدّ والرسم في ${e.detail} من 3. لم يحدث تحويل.`;
    if(e.kind==='hold')return 'المقارنة متوقفة: '+(reasons[e.detail]||'بيانات غير كافية.');
    if(e.kind==='quote_error')return 'تعذّر فحص نشرة السعر'+(e.detail?' (HTTP '+e.detail+')':'')+'؛ جُدولت إعادة المحاولة.';
    if(e.kind==='no_change')return 'فُحصت اللقطة والصلاحية؛ المدخلات لم تتغيّر. لا طلب خارجي ولا حساب جديد.'+(e.count>1?' عدد الفحوص المحلية المتتالية: '+e.count+'.':'');
    return labels[e.kind]||'حدث غير معروف.';
  }
  function showEvents(events){
    const key=JSON.stringify(events);if(key===eventsKey)return;eventsKey=key;
    el('events').replaceChildren(...events.map(e=>{const li=document.createElement('li'),t=node('time',clock(e.at));t.dateTime=new Date(e.at*1000).toISOString();t.title=utc(e.at);li.append(t,node('span',eventText(e)));return li;}));
  }
  function showRoutes(s){
    const key=JSON.stringify([s.estimate,s.hold,s.source_error]);if(key===routesKey)return;routesKey=key;
    const out=el('routes'),c=s.estimate;
    el('result').classList.toggle('hold',!c||s.source_error);
    if(!c){set('result','لا مقارنة الآن: '+(reasons[s.hold]||'بانتظار بيانات صالحة.'));out.replaceChildren();return;}
    set('result',(s.source_error?'تعذّر التحديث؛ باستخدام آخر نشرة صالحة: ':'على أساس نشرة السعر: ')+c.covered+' من '+c.rows.length+' يغطي الحدّ الخارجي والرسم حسابيًا. ليس إثبات استلام.');
    out.replaceChildren(...c.rows.map(r=>{
      const li=node('li','','route'),head=node('div','','routehead'),ticker=node('bdi',r.coin,'ticker');
      head.append(ticker,node('span',r.covers_minimum_and_fee?'يكفي حسابيًا':'لا يكفي','verdict'+(r.covers_minimum_and_fee?' yes':'')));
      const list=document.createElement('dl');
      for(const [label,value] of [['الحدّ الخارجي',r.normal_minimum+' '+r.coin],['الرسم العادي',r.normal_fee+' '+r.coin],['قيمتهما معًا ≈',r.external_test_usd+' USD']]){
        const row=document.createElement('div');row.append(node('dt',label),node('dd',value));list.append(row);
      }
      li.append(head,list);return li;
    }));
  }
  function render(s){
    state=s;seen=performance.now();connected=true;
    if(!s.ready){routesKey=eventsKey=null;['cycle','checked','countdown','last-source','next-source','faucet-floor'].forEach(id=>set(id,'—'));el('routes').replaceChildren();el('events').replaceChildren(node('li','بانتظار الدورة الأولى.'));set('result','بانتظار بيانات صالحة للمقارنة.');set('listing','بانتظار فحص اللقطة المحلية.');set('facts-age','');set('market','لم تُقرأ النشرة بعد.');badge(s.server_time-s.started<75?'العامل يجلب أول قراءة…':'لا توجد دورة مؤكدة بعد','');return;}
    const f=s.facts,q=s.quote;
    set('cycle',String(s.cycle));set('checked',clock(s.checked_at));set('last-source',utc(s.last_source_success));set('next-source',utc(s.next_source_check));
    set('faucet-floor',f?f.faucet_to_faucetpay_min_usd+' USD':'غير متاح');showRoutes(s);showEvents(s.events);
    set('listing',f?'في تاريخ المراجعة عرض الدليل '+f.profile_users_paid+' مستخدمًا مدفوعًا لهم، وبلغ إجمالي المدفوع في أسبوع العرض '+f.profile_week_paid_usd+' USD لجميع المستخدمين. لا تُنسب هذه الأرقام لك.':'لم يمكن التحقق من اللقطة المحلية.');
    set('facts-age',f?'تاريخ مراجعة الدليل والحدود: '+f.reviewed_utc_day+' UTC. لا يعيد العامل جلب صفحات الصنبور.'+(f.age_days>7?' اللقطة قديمة.':''):'');
    set('market',q?'تاريخ النشرة '+q.date+' UTC. على سبيل المثال: 1 LTC ≈ '+q.usd_per_coin.LTC+' USD. النشرة يومية وليست سعر تسوية لحظيًا.':'لم يحصل العامل على نشرة صالحة.');
    tick();
  }
  function tick(){
    if(!connected||!state?.ready){set('countdown','—');return;}
    const elapsed=performance.now()-seen,now=state.server_time+elapsed/1000;
    if(elapsed>15000||now-state.checked_at>75){badge('لا توجد دورة حديثة مؤكدة','offline');set('countdown','—');return;}
    badge(state.source_error?'العامل متصل · مصدر السعر متعذّر':state.hold?'العامل متصل · المقارنة متوقفة':'العامل متصل · رصد فقط',state.source_error||state.hold?'':'online');
    set('countdown',Math.max(0,Math.ceil(state.next_cycle-now))+' ث');
  }
  async function update(){
    if(busy)return;busy=true;const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),6000);
    try{const r=await fetch('/api/status',{credentials:'omit',cache:'no-store',signal:ctl.signal});if(!r.ok)throw Error('offline');const s=await r.json();if(typeof s.ready!=='boolean'||!Number.isFinite(s.server_time)||(s.ready&&(!Number.isInteger(s.cycle)||!Array.isArray(s.events))))throw Error('invalid');render(s);}
    catch{connected=false;badge(state?.ready?'انقطع الاتصال · المعروض آخر قراءة':'تعذّر الاتصال بالعامل','offline');set('countdown','—');}
    finally{clearTimeout(timer);busy=false;}
  }
  update();setInterval(()=>{if(!document.hidden)update();},5000);setInterval(tick,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
})();
