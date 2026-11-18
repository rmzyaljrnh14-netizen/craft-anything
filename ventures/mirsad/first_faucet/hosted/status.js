'use strict';
(async () => {
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  const utc = t => t == null ? '—' : new Date(t*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
  const make = (tag, content, cls) => { const e=document.createElement(tag);e.textContent=content;if(cls)e.className=cls;return e; };
  const holds = {no_snapshot:'ملفّ الحدود غير متاح.',stale_snapshot:'لقطة الحدود أقدم من سبعة أيام وتحتاج مراجعة.',inactive_listing:'اللقطة لا تعرض الصنبور نشطًا.',no_quote:'لم تتوفر نشرة سعر صالحة.',stale_quote:'نشرة السعر قديمة.'};
  const ctl = new AbortController(), timeout = setTimeout(()=>ctl.abort(),24000);
  try {
    const r=await fetch('/api/status',{credentials:'omit',signal:ctl.signal});
    if(!r.ok)throw Error(); const s=await r.json();
    if(s.mode!=='on-demand'||!Number.isSafeInteger(s.checked_at))throw Error();
    set('checked',utc(s.last_source_success)); set('quote',s.quote_day||'—');set('facts',s.reviewed_day||'—');
    if(!s.estimate){set('state','المقارنة متوقفة: '+(holds[s.hold]||'لا توجد بيانات صالحة.'));return;}
    const rows=s.estimate.rows;
    set('state',(s.source_error?'تعذّر تحديث المصدر؛ حسب آخر نشرة صالحة: ':'')+'مبلغ '+s.estimate.floor_usd+' USD يغطي الحدّ والرسم حسابيًا في '+s.estimate.covered+' من '+rows.length+' مسارات.');
    document.getElementById('routes').replaceChildren(...rows.map(row=>{
      const box=make('li','','route'), title=make('div','','routehead');
      title.append(make('bdi',row.coin,'ticker'),make('span',row.covers_minimum_and_fee?'يكفي حسابيًا':'لا يكفي','verdict'+(row.covers_minimum_and_fee?' yes':'')));
      const dl=make('dl','');for(const [k,v] of [['الحدّ',row.normal_minimum+' '+row.coin],['الرسم',row.normal_fee+' '+row.coin],['قيمتهما ≈',row.external_test_usd+' USD']]){
        const line=make('div','');line.append(make('dt',k),make('dd',v));dl.append(line);
      }box.append(title,dl);return box;
    }));
  } catch {set('state','تعذّرت قراءة الرصد العام. دفتر تجربتك لا يعتمد على هذه الخدمة.');}
  finally {clearTimeout(timeout);}
})();
