// Controller/HTML generation tests in an isolated VM. This is not browser or
// visual testing: no rendering engine, network, or real user storage is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function harness(){
  const html=fs.readFileSync(new URL('../StockLab.html',import.meta.url),'utf8');
  const script=html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];assert.ok(script);
  const nodes=new Map(),listeners=new Map(),windowListeners=new Map(),stored=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:({'#order-type':'market','#order-qty':'1','#limit-price':'1'})[id]||'',open:false,disabled:false,
    classList:{add(){},remove(){},toggle(){}},addEventListener(){},focus(){},append(){},remove(){},showModal(){this.open=true},close(){this.open=false},setAttribute(){},click(){},getBoundingClientRect(){return {top:0,left:0,right:800,bottom:600}}});return nodes.get(id);};
  const context=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,structuredClone,atob,btoa,URL,Blob,
    setTimeout(){return 1},setInterval(){return 1},matchMedia:()=>({matches:false}),location:{hash:'#market'},
    navigator:{},localStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)},
    document:{querySelector:node,querySelectorAll:()=>[],addEventListener:(k,fn)=>listeners.set(k,fn),createElement:()=>node('created'),activeElement:{tagName:'BODY'},body:{classList:{add(){},remove(){}}}},
    window:{addEventListener:(k,fn)=>windowListeners.set(k,fn),scrollTo(){}},
    FormData:class{constructor(form){this.fields=form.fields}get(key){return this.fields[key]??null}}
  });
  new vm.Script(script,{filename:'StockLab.html'}).runInContext(context,{timeout:5000});
  const click=async(action,extra={})=>listeners.get('click')({target:{closest:()=>({dataset:{action,...extra},disabled:false})}});
  const submit=async(id,fields,extras={})=>listeners.get('submit')({preventDefault(){},target:{id,fields,dataset:{},querySelector:()=>node('submit'),classList:{contains:()=>false},...extras}});
  const route=name=>{context.location.hash='#'+name;windowListeners.get('hashchange')();};
  return {node,click,submit,route,html,context};
}
test('standalone bundle generates all four public views without runtime errors',()=>{
  const h=harness();assert.match(h.node('#app').innerHTML,/오늘의 시장을 읽어보세요/);assert.match(h.node('#stock-rows').innerHTML,/KR001/);
  for(const [route,title]of [['portfolio','첫 번째 포트폴리오'],['journal','거래의 이유를 기록'],['learn','시장가와 지정가']]){h.route(route);assert.ok(h.node('#app').innerHTML.includes(title));}
  assert.ok(!h.html.includes('src="./src/app.js"'));assert.ok(!h.html.includes('href="./styles/'));
});
test('signup, market orders, portfolio, journal escaping, and learning persist through controllers',async()=>{
  const h=harness();await h.click('signup');assert.match(h.node('#modal').innerHTML,/프로필 만들기/);
  await h.submit('auth-form',{username:'vm_tester',password:'test-only-credentials',confirm:'test-only-credentials'},{dataset:{mode:'signup'}});
  assert.match(h.node('#app').innerHTML,/vm_tester/);assert.equal(h.node('#modal').open,false);
  await h.submit('order-form',{type:'market',qty:'2',limitPrice:'1'});h.route('portfolio');assert.match(h.node('#app').innerHTML,/2주/);assert.match(h.node('#app').innerHTML,/새온반도체/);
  h.route('journal');const id=h.node('#app').innerHTML.match(/data-trade-id="([^"]+)"/)[1];
  await h.submit('journal-form',{text:'<script>bad()</script> & 학습',feeling:'calm'},{dataset:{tradeId:id},classList:{contains:x=>x==='journal-form'}});
  assert.ok(h.node('#app').innerHTML.includes('&lt;script&gt;bad()&lt;/script&gt; &amp; 학습'));assert.ok(!h.node('#app').innerHTML.includes('<script>bad()'));
  h.route('learn');await h.click('quiz',{id:'orders',value:'1'});assert.match(h.node('#app').innerHTML,/정답이에요/);assert.match(h.node('#app').innerHTML,/1 <span>\/ 6/);
  await h.click('logout');assert.ok(!h.node('#app').innerHTML.includes('vm_tester'));
  await h.submit('auth-form',{username:'vm_tester',password:'test-only-credentials'},{dataset:{mode:'login'}});h.route('portfolio');assert.match(h.node('#app').innerHTML,/2주/);
});
