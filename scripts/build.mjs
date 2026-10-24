import {mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),dist=path.join(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const file of ['index.html','favicon.svg','.nojekyll','src','styles'])await cp(path.join(root,file),path.join(dist,file),{recursive:true});
const modules=['market.js','trading.js','vault.js','lessons.js','charts.js','app.js'];
let bundle='"use strict";\nconst __modules = Object.create(null);\n';
for(const filename of modules){
  const source=await readFile(path.join(root,'src',filename),'utf8');
  const names=[...source.matchAll(/export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)/g)].map(m=>m[1]);
  const body=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g,(_,bindings,dependency)=>`const {${bindings}} = __modules[${JSON.stringify(dependency)}];`)
    .replace(/\bexport\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/g,'');
  bundle+=`__modules[${JSON.stringify(filename)}] = (() => {\n${body}\nreturn {${names.join(',')}};\n})();\n`;
}
let html=await readFile(path.join(root,'index.html'),'utf8');
for(const css of ['app.css','responsive.css'])html=html.replace(`<link rel="stylesheet" href="./styles/${css}">`,`<style>\n${await readFile(path.join(root,'styles',css),'utf8')}\n</style>`);
const favicon=(await readFile(path.join(root,'favicon.svg'))).toString('base64');
html=html.replace('href="./favicon.svg"',`href="data:image/svg+xml;base64,${favicon}"`)
  .replace("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
  .replace('<script type="module" src="./src/app.js"></script>',()=>`<script>\n${bundle.replace(/<\/script/gi,'<\\/script')}\n</script>`)
  .replace('파일 더블클릭 대신 GitHub Pages 또는 로컬 서버로 접속합니다.','최신 브라우저에서 JavaScript와 기기 저장소 사용을 허용해주세요.');
await writeFile(path.join(root,'StockLab.html'),html);
console.log('Built dist/ and standalone StockLab.html (no third-party dependencies)');
