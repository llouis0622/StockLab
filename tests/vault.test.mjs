import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createProfile,loginProfile,saveProfile,exportProfile,importProfile,checkEnvelope} from '../src/vault.js';
const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),clear:()=>map.clear()};
beforeEach(()=>map.clear());
test('profiles encrypt balances and passwords; wrong password cannot unlock',async()=>{
  const session=await createProfile('tester','correct-horse-42');const raw=map.get('stocklab.v1.tester');
  assert.ok(!raw.includes('correct-horse-42'));assert.ok(!raw.includes('10000000'));assert.ok(!raw.includes('holdings'));
  const unlocked=await loginProfile('tester','correct-horse-42');assert.equal(unlocked.account.cash.KRW,10000000);
  await assert.rejects(loginProfile('tester','wrong-password'));
  await assert.rejects(createProfile('tester','correct-horse-42'));
  await assert.rejects(createProfile('ab','abcdefgh'));await assert.rejects(createProfile('new_user','short'));
});
test('encrypted export/import round trip preserves trades, requires password and explicit overwrite',async()=>{
  const session=await createProfile('tester','correct-horse-42');session.account.journal.test={text:'내 비공개 학습 기록'};await saveProfile(session,session.account);
  const backup=exportProfile(session);assert.ok(!backup.includes('내 비공개'));await assert.rejects(importProfile(backup,'wrong-password'));
  await assert.rejects(importProfile(backup,'correct-horse-42'));
  map.clear();const restored=await importProfile(backup,'correct-horse-42');assert.equal(restored.account.journal.test.text,'내 비공개 학습 기록');
  const updated=await importProfile(backup,'correct-horse-42',true);assert.equal(updated.revision,2);
});
test('independent profiles and stale-tab writes remain isolated',async()=>{
  const one=await createProfile('one','password-one'),two=await createProfile('two','password-two');
  const stale=await loginProfile('one','password-one');one.account.lessons.push('orders');await saveProfile(one,one.account);
  await assert.rejects(saveProfile(stale,stale.account),/다른 탭/);assert.equal((await loginProfile('two','password-two')).account.lessons.length,0);
  await assert.rejects(loginProfile('one','password-two'));
});
test('tampered ciphertext and unbounded key derivation parameters are rejected',async()=>{
  const one=await createProfile('tester','password-one'),backup=JSON.parse(exportProfile(one));
  backup.iterations=1e12;assert.throws(()=>checkEnvelope(backup));backup.iterations=210000;
  backup.ciphertext='AAAA'+backup.ciphertext.slice(4);await assert.rejects(importProfile(JSON.stringify(backup),'password-one',true));
});
test('local-file lock rejection falls back without duplicating a write',async()=>{
  globalThis.window={navigator:{locks:{request(){const e=new Error('opaque origin');e.name='SecurityError';return Promise.reject(e);}}}};
  try {const session=await createProfile('local_file','password-one');assert.equal(session.revision,1);assert.equal(map.size,1);}
  finally {delete globalThis.window;}
});
