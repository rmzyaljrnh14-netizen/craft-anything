'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const now = Date.UTC(2026,10,18,14), minute = 60000, day = 1440*minute;
const start=()=>M.begin('٨٠','٢٠',now);

test('only complete funded cycles, capped at six; no paid claims or default balance',()=>{
  assert.equal(M.fuel('80','20').minutes,20);
  assert.equal(M.fuel('000٨٫١','۰٫۹').cycles,6);
  assert.equal(M.fuel('0.3','0.1').cycles,3); // decimal arithmetic, not floating point
  assert.equal(M.fuel('0.999999','1').cycles,0);
  assert.equal(M.fuel('999999999999.999999','0.000001').minutes,30);
  assert.throws(()=>M.begin('0','20',now));
  for(const [b,c] of [['','1'],['1','0'],['-8','1'],['1,000','2'],['1e5','1'],['1.0000001','1'],['٠٫٥','٫١'],['1','٢٬٠٠٠']])assert.throws(()=>M.fuel(b,c));
});
test('a hidden tab uses elapsed timestamps; reaching the deadline never records an incoming payment',()=>{
  const s=start(); assert.equal(s.receipt,null);assert.equal(s.pending,null);
  assert.equal(M.inspect(s,now+9*minute).remaining,11*minute);
  assert.equal(M.inspect(s,now+20*minute-1).phase,'watching');
  const end=M.inspect(s,now+20*minute);assert.equal(end.phase,'review');assert.equal(end.remaining,0);
  assert.equal(M.inspect(s,now+4*day).elapsed,20*minute);assert.equal(s.receipt,null);
  assert.throws(()=>M.inspect(s,now-1));assert.throws(()=>M.finish(s,now+20*minute));
});
test('early review changes only the local window; pending is optional and never an amount',()=>{
  const s=start();assert.throws(()=>M.markPending(s,now));
  const stopped=M.finish(s,now+3*minute);assert.equal(M.inspect(stopped,now+7*minute).elapsed,3*minute);
  const pending=M.markPending(stopped,now+11*minute);assert.equal(pending.receipt,null);
  assert.equal(M.inspect(pending,now+day).phase,'pending');assert.throws(()=>M.markPending(pending,now+day));
  assert.throws(()=>M.inspect(pending,now+10*minute));
});
test('one owner-reported receipt, even next day; wall time is distinct from observed timebox',()=>{
  const s=start(),t=now+2*day;assert.throws(()=>M.noteReceipt(s,'LTC','1',true,now+1));
  for(const args of [['LTC','1',false],['DUTCHY','7',true],['ltc','0',true],['LTC','1e-8',true],['an address','1',true],['BCH','1','yes']])assert.throws(()=>M.noteReceipt(s,...args,t));
  const noted=M.noteReceipt(s,'ltc','٠٫٠٠٠٠٠٠٠١',true,t);
  assert.deepEqual(noted.receipt,{coin:'LTC',quantity:'0.00000001',notedAt:t});
  const view=M.inspect(noted,t+day);assert.equal(view.phase,'noted');assert.equal(view.elapsed,20*minute);
  assert.equal(view.untilNoted,2*day);assert.throws(()=>M.noteReceipt(noted,'LTC','2',true,t+day));
  assert.equal(M.noteReceipt(s,'ETH','0.000000000000000001',true,t).receipt.quantity,'0.000000000000000001');
});
test('round-trip every stage with a small versioned record; starting a fresh tab does not invent a session',()=>{
  const s=start(),stopped=M.finish(s,now+minute),pending=M.markPending(stopped,now+2*minute);
  for(const record of [s,stopped,pending,M.noteReceipt(pending,'BCH','0.5',true,now+day)]){
    const raw=JSON.stringify(record,null,2);assert.ok(Buffer.byteLength(raw)<2048);assert.deepEqual(M.restore(raw,now+day),record);
  }
  assert.throws(()=>M.restore('',now));
});
test('reject unknown schema/rules, extra personal fields, malformed/future chronology and zero fuel',()=>{
  const s=start(),t=now+30*minute;
  for(const patch of [{version:2},{rules:'other'},{wallet:'not-collected'},{balance:'0'},{cost:0},{start:t+1},{stop:now-1},{stop:now+20*minute},{pending:now+19*minute},{pending:t+1},
                    {pending:t,receipt:{coin:'LTC',quantity:'1',notedAt:t-1}},{receipt:{coin:'LTC',quantity:'1',notedAt:t,user:'none'}}]){
    assert.throws(()=>M.restore(JSON.stringify({...s,...patch}),t));
  }
  for(const raw of ['{}','null','[]',' '.repeat(2049)])assert.throws(()=>M.restore(raw,t));
});
