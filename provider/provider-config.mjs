#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

function readArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (key && value !== undefined) result[key] = value;
  }
  return result;
}

const args = readArgs(process.argv.slice(2));
const modulesPath = args.modules;
if (!modulesPath) throw new Error('missing --modules');
const require = createRequire(path.join(modulesPath, 'package.json'));
const yaml = require('js-yaml');

const settingsPath = args.settings || path.join(os.homedir(), '.dsh', 'settings.yaml');
fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
let settings = {};
if (fs.existsSync(settingsPath)) {
  const loaded = yaml.load(fs.readFileSync(settingsPath, 'utf8'));
  if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) settings = loaded;
}

if (args.provider === 'official') {
  settings['agent-default-model'] = {
    ...(settings['agent-default-model'] || {}),
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high'
  };
} else if (args.provider === 'qwen') {
  const baseURL = new URL(args.baseURL || 'https://ai-xtu.yangrucheng.eu.org/v1');
  if (baseURL.protocol !== 'https:') throw new Error('Qwen endpoint must use HTTPS');
  const model = (args.model || 'qwen3.8-27b').trim();
  if (!model) throw new Error('Qwen model must not be empty');
  const pi = settings['llm-pi-ai'] && typeof settings['llm-pi-ai'] === 'object'
    ? settings['llm-pi-ai'] : {};
  const providers = pi.providers && typeof pi.providers === 'object' ? pi.providers : {};
  providers['qwen-local'] = {
    displayName: '本地千问（兼容接口）',
    apiKeyEnv: 'QWEN_API_KEY',
    api: 'openai-responses',
    baseURL: baseURL.href.replace(/\/$/, ''),
    defaultContextWindow: 262144,
    defaultMaxTokens: 32768,
    defaultInput: ['text', 'image'],
    models: [{ id: model, name: model, input: ['text', 'image'] }]
  };
  settings['llm-pi-ai'] = { ...pi, providers };
  settings['agent-default-model'] = {
    ...(settings['agent-default-model'] || {}),
    provider: 'qwen-local',
    model
  };
}

const serialized = yaml.dump(settings, {
  noRefs: true,
  lineWidth: 120,
  sortKeys: false
});
const temporaryPath = `${settingsPath}.deepseek-cute-${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporaryPath, settingsPath);
console.log(JSON.stringify({ ok: true, provider: args.provider }));
