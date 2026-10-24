import {newAccount, validateAccount} from './trading.js';
const PREFIX = 'stocklab.v1.';
const ITERATIONS = 210000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => btoa(Array.from(bytes, b=>String.fromCharCode(b)).join(''));
const bytes = str => Uint8Array.from(atob(str), c=>c.charCodeAt(0));
const aad = username => enc.encode('stocklab:v1:' + username);
// Use browser-origin locks; Node's experimental navigator.locks has a different
// lifecycle inside test workers. Revision checks also protect the fallback.
const withLock = async (name, fn) => {
  const locks = globalThis.window?.navigator?.locks;
  if (!locks) return fn();
  let entered = false;
  try { return await locks.request(PREFIX + name, () => { entered = true; return fn(); }); }
  catch (error) {
    // Some local-file contexts expose Web Locks but reject opaque origins.
    // Only fall back when no critical section has started; never repeat writes.
    if (!entered && ['SecurityError','NotSupportedError'].includes(error.name)) return fn();
    throw error;
  }
};
const storage = () => globalThis.localStorage;

function checkUsername(value) {
  const username = String(value).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('아이디는 영문 소문자·숫자·밑줄 3~20자로 입력해주세요.');
  return username;
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length<8 || password.length>128) throw new Error('비밀번호는 8~128자로 입력해주세요.');
}
function read(username) {
  const raw = storage().getItem(PREFIX + username);
  if (!raw) return null;
  try { return checkEnvelope(JSON.parse(raw)); } catch {throw new Error('저장된 프로필을 읽을 수 없습니다. 백업으로 복원해주세요.');}
}
export function checkEnvelope(v) {
  if (!v || v.format !== 'stocklab-encrypted-v1' || checkUsername(v.username)!==v.username || v.iterations!==ITERATIONS || !Number.isSafeInteger(v.revision) || v.revision<1 || typeof v.ciphertext!=='string' || v.ciphertext.length>14000000) throw new Error('Stock Lab 암호화 백업 파일이 아닙니다.');
  if (bytes(v.salt).length!==16 || bytes(v.iv).length!==12 || bytes(v.ciphertext).length<16) throw new Error('백업 파일이 손상되었습니다.');
  return v;
}
async function derive(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('암호화를 사용하려면 HTTPS 또는 localhost 주소로 접속해주세요.');
  const material = await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encrypt(account,key,salt,revision) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(account.username)},key,enc.encode(JSON.stringify(account)));
  return {format:'stocklab-encrypted-v1',username:account.username,iterations:ITERATIONS,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted)),revision,savedAt:Date.now()};
}
async function decrypt(envelope,password) {
  const salt = bytes(envelope.salt), key = await derive(password,salt);
  let plain;
  try {plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:aad(envelope.username)},key,bytes(envelope.ciphertext));}
  catch {throw new Error('비밀번호가 일치하지 않거나 백업 파일이 손상되었습니다.');}
  const account = validateAccount(JSON.parse(dec.decode(plain)));
  if (account.username !== envelope.username) throw new Error('프로필 아이디가 일치하지 않습니다.');
  return {account,key,salt,revision:envelope.revision};
}
function write(username,envelope) {
  try {storage().setItem(PREFIX+username,JSON.stringify(envelope));}
  catch {throw new Error('기기에 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해주세요. 변경은 적용되지 않았습니다.');}
}
export async function createProfile(username,password) {
  username = checkUsername(username); checkPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await derive(password,salt), account = newAccount(username);
  const envelope = await encrypt(account,key,salt,1);
  return withLock(username,()=>{
    if (read(username)) throw new Error('이 기기에 이미 있는 아이디입니다. 로그인해주세요.');
    write(username,envelope); return {account,key,salt,revision:1};
  });
}
export async function loginProfile(username,password) {
  username = checkUsername(username); const envelope = read(username);
  if (!envelope) throw new Error('이 브라우저에 없는 아이디입니다. 프로필을 만들거나 백업을 복원해주세요.');
  return decrypt(envelope,password);
}
export async function saveProfile(session,account) {
  validateAccount(account);
  return withLock(account.username,async()=>{
    const expectedRevision = session.revision;
    const envelope = await encrypt(account,session.key,session.salt,expectedRevision+1);
    const current = read(account.username);
    if (!current || current.revision!==expectedRevision) throw new Error('다른 탭에서 프로필이 변경되었습니다. 다시 로그인해주세요.');
    write(account.username,envelope); session.revision=envelope.revision; session.account=account; return account;
  });
}
export function exportProfile(session) {
  const envelope = read(session.account.username);
  if (!envelope || envelope.revision!==session.revision) throw new Error('다시 로그인한 뒤 백업해주세요.');
  return JSON.stringify(envelope,null,2);
}
export async function importProfile(text,password,replace=false) {
  if (text.length>14000000) throw new Error('백업 파일이 너무 큽니다.');
  let envelope; try {envelope=checkEnvelope(JSON.parse(text));} catch {throw new Error('유효한 Stock Lab 백업 파일을 선택해주세요.');}
  const session = await decrypt(envelope,password);
  return withLock(envelope.username,async()=>{
    const current=read(envelope.username);
    if (current && !replace) throw new Error('같은 아이디가 있습니다. 덮어쓰기를 선택해야 복원할 수 있습니다.');
    const next = await encrypt(session.account,session.key,session.salt,(current?.revision || 0)+1);
    write(envelope.username,next); session.revision=next.revision; return session;
  });
}
export function isProfileKey(key) {return typeof key==='string' && key.startsWith(PREFIX);}
