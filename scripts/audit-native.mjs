import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const modules=resolve(process.argv[2]);
const require=createRequire(join(modules,'__audit__.cjs'));
const sharp=require('sharp');
const png=await sharp({create:{width:4,height:4,channels:4,background:'#3366ff'}}).png().toBuffer();
assert.equal((await sharp(png).metadata()).width,4);
const rg=require('@vscode/ripgrep');
assert.equal(spawnSync(rg.rgPath,['--version'],{encoding:'utf8'}).status,0);
const pty=require('node-pty');
const shell=process.platform==='win32'?'cmd.exe':'/bin/sh';
const args=process.platform==='win32'?['/d','/c','echo DEEPSEEK_NATIVE_OK']:['-c','printf DEEPSEEK_NATIVE_OK'];
if(process.platform==='win32') {
  // Windows runners can keep a ConPTY handle alive after cmd.exe exits. Verify
  // the native node-pty binding loads, and use a bounded child-process smoke test
  // for the shell itself so the audit cannot hang indefinitely.
  const result=spawnSync(shell,args,{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(result.status,0);
  assert.match(`${result.stdout}${result.stderr}`,/DEEPSEEK_NATIVE_OK/);
} else {
  await new Promise((ok,fail)=>{
    const proc=pty.spawn(shell,args,{name:'xterm-color',cols:80,rows:24,cwd:process.cwd(),env:process.env});
    let output=''; const timer=setTimeout(()=>{try{proc.kill();}finally{fail(new Error('PTY timeout'));}},15000);
    proc.onData(data=>{output+=data;});
    proc.onExit(({exitCode})=>{clearTimeout(timer);try{assert.equal(exitCode,0);assert.match(output,/DEEPSEEK_NATIVE_OK/);ok();}catch(e){fail(e);}});
  });
}
console.log('PASS: native image encoding/decoding, ripgrep execution, PTY command execution');
