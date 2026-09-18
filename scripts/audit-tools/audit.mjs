import fs from 'node:fs';
import path from 'node:path';
import {createRequire, isBuiltin} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import semver from 'semver';
import {resolve as resolveImport} from 'import-meta-resolve';
const modules = path.resolve(process.argv[2]);
const output = process.argv[3];
const packages=[]; const failures=[]; const optional=[]; const dynamic=[];
function scanModules(dir) {
  for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
    if(e.name.startsWith('.') || !e.isDirectory()) continue;
    const p=path.join(dir,e.name);
    if(e.name.startsWith('@')) { for(const s of fs.readdirSync(p)) addPackage(path.join(p,s)); }
    else addPackage(p);
  }
}
function addPackage(dir) {
  const file=path.join(dir,'package.json'); if(!fs.existsSync(file)) return;
  const pkg=JSON.parse(fs.readFileSync(file,'utf8')); packages.push({dir,pkg});
  if(fs.existsSync(path.join(dir,'node_modules'))) scanModules(path.join(dir,'node_modules'));
}
function findDependency(name, from) {
  for(let dir=from; ; dir=path.dirname(dir)) {
    const file=path.join(dir,'node_modules',name,'package.json');
    if(fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8'));
    if(path.dirname(dir)===dir) return null;
  }
}
scanModules(modules);
let edges=0; let imports=0; let files=0;
for (const {dir,pkg} of packages) {
  for(const [kind,deps] of Object.entries({dependencies:pkg.dependencies,peerDependencies:pkg.peerDependencies,optionalDependencies:pkg.optionalDependencies})) {
    for(const [name,range] of Object.entries(deps||{})) {
      edges++;
      const opt=kind==='optionalDependencies'||name in (pkg.optionalDependencies||{})||kind==='peerDependencies'&&pkg.peerDependenciesMeta?.[name]?.optional;
      const installed=findDependency(name,dir);
      const problem=!installed?'missing':semver.validRange(range)&&!semver.satisfies(installed.version,range,{includePrerelease:true})?`version ${installed.version} does not satisfy ${range}`:null;
      if(problem) (opt?optional:failures).push({package:pkg.name,dependency:name,kind,problem});
    }
  }
  // Parse official server-side JavaScript with an AST, avoiding comments, docs,
  // generated browser imports and tests. Relative files must exist too.
  if(!pkg.name?.startsWith('@deepseek-ai/')) continue;
  const lib=path.join(dir,'lib'); if(!fs.existsSync(lib)) continue;
  function walk(directory) {
    for(const e of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,e.name);
      if(e.isDirectory()) { if(!['types','client','node_modules'].includes(e.name)) walk(file); continue; }
      if(!/\.(mjs|cjs|js)$/.test(e.name)||/\.(test|spec)\./.test(e.name)||e.name==='client.js')continue;
      const source=fs.readFileSync(file,'utf8'); let ast;
      try{ast=parse(source,{ecmaVersion:'latest',sourceType:pkg.type==='module'?'module':'script',allowReturnOutsideFunction:true});}
      catch(error){failures.push({file:path.relative(modules,file),problem:`parse: ${error.message}`});continue;}
      files++; const req=createRequire(pathToFileURL(file));
      function visit(node, guarded=false) {
        if(!node||typeof node!=='object')return;
        const inTry=guarded||node.type==='TryStatement';
        let spec; let cjs=false;
        if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)) spec=node.source?.value;
        if(node.type==='CallExpression'&&node.callee?.name==='require') {spec=node.arguments[0]?.value;cjs=true;}
        if((node.type==='ImportExpression'||cjs)&&typeof spec!=='string')dynamic.push({file:path.relative(modules,file),line:source.slice(0,node.start).split('\n').length});
        if(typeof spec==='string'&&!isBuiltin(spec)) {
          imports++;
          try {
            const resolved=cjs?req.resolve(spec):resolveImport(spec,pathToFileURL(file).href);
            if(resolved.startsWith('file:')&&!fs.existsSync(fileURLToPath(resolved))) throw new Error('resolved file absent');
          } catch(error) {
            const item={file:path.relative(modules,file),import:spec,problem:error.code||error.message};
            (inTry?optional:failures).push(item);
          }
        }
        for(const [key,value]of Object.entries(node))if(key!=='parent') {
          if(Array.isArray(value))value.forEach(v=>visit(v,inTry));else if(value?.type)visit(value,inTry);
        }
      }
      visit(ast);
    }
  }
  walk(lib);
}
const report={platform:process.platform,arch:process.arch,packages:packages.length,deepseekPackages:packages.filter(p=>p.pkg.name.startsWith('@deepseek-ai/')).length,dependencyEdges:edges,serverFiles:files,staticImports:imports,failures,optionalUnavailable:optional,dynamicImports:dynamic,inventory:packages.map(({dir,pkg})=>({name:pkg.name,version:pkg.version,path:path.relative(modules,dir)}))};
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,inventory:undefined,optionalUnavailable:optional.length,dynamicImports:dynamic.length},null,2));
if(failures.length)process.exitCode=1;
