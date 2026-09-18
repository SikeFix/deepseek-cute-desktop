// Verify the packaged runtime, not the build machine's Node/npm installation.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const [node, bin] = process.argv.slice(2).map(p => resolve(p));
assert(node && bin, 'Usage: node smoke-runtime.mjs <bundled-node> <dsh-bin>');
const testDir = await mkdtemp(join(tmpdir(), 'deepseek-runtime-check-'));
const cwd = join(testDir, 'workspace'); await mkdir(cwd);
const env = {...process.env, DSH_HOME: join(testDir, 'dsh'), NO_COLOR: '1'};
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN/i.test(key)) delete env[key];
const child = spawn(node, [bin, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
let output = ''; let launchURL;
const capture = chunk => { output += chunk.toString(); const m=output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/); if(m) launchURL=m[1]; };
child.stdout.on('data', capture); child.stderr.on('data', capture);
let spawnError; child.on('error', e => {spawnError=e;});
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  for(let i=0;i<120 && !launchURL && child.exitCode === null && !spawnError;i++) await delay(500);
  assert(!spawnError, spawnError?.message);
  assert(launchURL, 'No authenticated URL from packaged runtime');
  const origin = new URL(launchURL).origin;
  const unauth = await fetch(origin); assert.equal(unauth.status, 401, 'Expected official authentication protection');
  const auth = await fetch(launchURL, {redirect:'manual'}); assert.equal(auth.status, 303, 'Launch token must exchange for session cookie');
  const cookie = auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '); assert(cookie, 'Missing session cookie');
  const page = await fetch(origin, {headers:{cookie}}); assert.equal(page.status,200);
  const html = await page.text(); assert.match(html, /<script|<html/i);
  const scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m=>m[1].replaceAll('&amp;', '&')); assert(scripts.length, 'Missing UI JavaScript');
  for(const src of scripts) {
    const asset = await fetch(new URL(src, origin), {headers:{cookie}}); assert.equal(asset.status,200, `Missing UI asset ${src}`);
    assert((await asset.text()).length>100, `Empty UI asset ${src}`);
  }
  await delay(1000); assert.equal(child.exitCode,null,'Runtime exited after serving UI');
  assert(!/ERR_MODULE_NOT_FOUND|failed to import loader|does not provide an export named/.test(output), 'Runtime dependency error');
  // Optional local UI review: retain the isolated test server until the caller stops it.
  if (process.env.DEEPSEEK_SMOKE_URL_FILE) {
    await writeFile(process.env.DEEPSEEK_SMOKE_URL_FILE, launchURL, {mode:0o600});
    console.log('PASS: packaged runtime, auth exchange and official UI assets; isolated preview is ready');
    await new Promise(r => process.once('SIGTERM', r));
  } else console.log('PASS: packaged runtime boots; unauthenticated request rejected; authenticated official UI and scripts served');
} catch(e) {
  console.error(output.replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]').slice(-12000));
  throw e;
} finally {
  child.kill();
  for(let i=0;i<20 && child.exitCode===null;i++) await delay(100);
  if(child.exitCode===null) child.kill('SIGKILL');
}
