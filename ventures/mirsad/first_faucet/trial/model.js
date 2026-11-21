/* Personal, offline observation of one trial. No browser, faucet or wallet APIs. */
'use strict';
(function (root, make) {
  const api = Object.freeze(make());
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FirstTrial = api;
})(globalThis, function () {
  const VERSION = 1, RULES = 'final-autoclaim/coin/2026-11-18', CYCLE_MS = 300000, MAX = 6;
  const fail = msg => { throw new Error(msg); };
  const requireThat = (condition, msg) => { if (!condition) fail(msg); };
  const isTime = t => Number.isSafeInteger(t) && t >= 0 && t < 253402300800000;
  function keys(obj, expected) {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
      Object.keys(obj).length === expected.length && expected.every(k => Object.hasOwn(obj, k));
  }
  function numberText(input, precision, zero) {
    requireThat(typeof input === 'string' && input.length <= 40, 'أدخل رقمًا قصيرًا من دون فواصل آلاف.');
    const raw = input.trim().replace(/[٠-٩]/g, c => String(c.charCodeAt(0)-1632))
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0)-1776)).replace(/٫/g, '.');
    requireThat(new RegExp('^\\d{1,12}(?:\\.\\d{1,' + precision + '})?$').test(raw),
      'استخدم أرقامًا ونقطة عشرية فقط، وحتى ' + precision + ' منازل بعد النقطة.');
    const [whole, frac = ''] = raw.split('.');
    const a = whole.replace(/^0+(?=\d)/, ''), b = frac.replace(/0+$/, '');
    requireThat(zero || a !== '0' || b !== '', 'يجب أن تكون القيمة أكبر من صفر.');
    return b ? a+'.'+b : a;
  }
  function units(value) {
    const [a,b=''] = value.split('.');
    return BigInt(a+b.padEnd(6,'0'));
  }
  function fuel(balanceInput, costInput) {
    const balance=numberText(balanceInput,6,true), cost=numberText(costInput,6,false);
    const maxCycles=units(balance)/units(cost);
    const cycles=maxCycles>=BigInt(MAX)?MAX:Number(maxCycles);
    return {balance, cost, cycles, minutes: cycles*5};
  }
  function coinCode(input) {
    requireThat(typeof input === 'string' && /^[A-Za-z][A-Za-z0-9]{1,9}$/.test(input.trim()), 'أدخل رمز العملة فقط، مثل LTC، دون اسم أو عنوان.');
    const code = input.trim().toUpperCase();
    requireThat(code !== 'DUTCHY', 'نقاط DUTCHY داخل الموقع ليست واردًا إلى FaucetPay.');
    return code;
  }
  function begin(balance, cost, now) {
    requireThat(isTime(now),'وقت الجهاز غير صالح.');
    const f = fuel(balance,cost);
    requireThat(f.cycles>0,'الرصيد الذي أدخلته لا يغطّي دورة واحدة.');
    return {version:VERSION,rules:RULES,balance:f.balance,cost:f.cost,start:now,stop:null,pending:null,receipt:null};
  }
  const deadline = s => s.start + fuel(s.balance,s.cost).cycles*CYCLE_MS;
  function inspect(s, now) {
    requireThat(isTime(now) && now >= (s.receipt?.notedAt ?? s.pending ?? s.stop ?? s.start), 'ساعة الجهاز أسبق من آخر حدث. صحّح الوقت قبل متابعة السجل.');
    const end=s.stop ?? deadline(s), elapsed=Math.min(now,end)-s.start;
    const phase=s.receipt?'noted':s.pending!==null?'pending':now>=end?'review':'watching';
    return {phase, elapsed, remaining:Math.max(0,end-now), window:deadline(s)-s.start,
      untilNoted:s.receipt?s.receipt.notedAt-s.start:null};
  }
  function finish(s,now) {
    requireThat(inspect(s,now).phase==='watching','انتهت نافذة المتابعة بالفعل.');
    return {...s,stop:now};
  }
  function markPending(s,now) {
    requireThat(inspect(s,now).phase==='review','راجع نتيجة النافذة أولًا؛ لا يُسجَّل الطلب مرتين.');
    return {...s,pending:now};
  }
  function noteReceipt(s,coin,quantity,confirmed,now) {
    const phase=inspect(s,now).phase;
    requireThat(phase==='review'||phase==='pending','أَنْهِ المتابعة أولًا. هذه البطاقة لدفعة واحدة فقط.');
    requireThat(confirmed===true,'لا تُسجّل الوارد إلا بعد رؤيته مكتملًا من هذا الصنبور في FaucetPay.');
    return {...s,receipt:{coin:coinCode(coin),quantity:numberText(quantity,18,false),notedAt:now}};
  }
  function restore(raw,now) {
    requireThat(typeof raw==='string' && raw.length<=2048,'الملف أكبر من بطاقة تجربة واحدة.');
    let v;try {v=JSON.parse(raw);} catch {fail('ملف غير صالح. اختر نسخة JSON من هذه البطاقة.');}
    requireThat(keys(v,['version','rules','balance','cost','start','stop','pending','receipt']) && v.version===VERSION && v.rules===RULES,
      'صيغة مختلفة أو نسخة قواعد غير مدعومة. لم نغيّر سجلك.');
    const validTime = (t,from) => isTime(now) && isTime(t) && t>=from && t<=now;
    requireThat(validTime(v.start,0),'تاريخ البداية غير صالح أو يسبقُه وقت الجهاز.');
    let s=begin(v.balance,v.cost,v.start);
    if(v.stop!==null){requireThat(validTime(v.stop,s.start) && v.stop<deadline(s),'وقت نهاية النافذة غير صالح.');s=finish(s,v.stop);}
    const end=s.stop ?? deadline(s);
    if(v.pending!==null){requireThat(validTime(v.pending,end),'توقيت الطلب غير متّسق.');s=markPending(s,v.pending);}
    if(v.receipt!==null){
      requireThat(keys(v.receipt,['coin','quantity','notedAt']) && validTime(v.receipt.notedAt,s.pending ?? end),'قيد الوارد غير متّسق.');
      // Restore a previous owner's note, not a new or independently verified transfer.
      s=noteReceipt(s,v.receipt.coin,v.receipt.quantity,true,v.receipt.notedAt);
    }
    return s;
  }
  return {VERSION,RULES,MAX,CYCLE_MS,fuel,begin,inspect,finish,markPending,noteReceipt,restore};
});
