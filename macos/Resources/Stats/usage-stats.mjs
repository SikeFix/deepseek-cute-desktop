#!/usr/bin/env node
/**
 * DeepSeek Cute · 本地 Token 使用量统计
 *
 * 扫描 ~/.dsh/sessions/ 下每个工作区与会话的 session.jsonl.zstd(DSH 内核本地日志),
 * 统计累计/每日/每模型的 Token 用量、聊天时长与连续使用天数。
 * 纯本地运行, 不经过任何云端; 后端离线时也能工作。
 *
 * 用法:
 *   node usage-stats.mjs --out <cache.json> [--refresh]
 *
 * 缓存按 (mtime + size) 指纹增量更新; 结果写入 --out, 并打印到 stdout。
 * 需要 Node 22.15+ (内置 zlib.zstdDecompressSync; 会话文件为多帧 zstd, 由本地解码循环处理)。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key) args[key] = argv[i + 1] ?? '';
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const outPath = args.out || path.join(os.homedir(), 'usage-stats.json');
const forceRefresh = args.refresh === '1' || args.refresh === 'true';
const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions');

/**
 * 按 zstd 规范走位(只读块头, 不解压)求一帧的结束字节偏移。
 * 帧结构: 魔数(4) + FHD(1) + [窗口描述符] + [字典ID] + [FCS] + 块序列 + [校验和]。
 * 块头 3 字节: bit0=Last_Block, bit1-2=类型(0原始/1RLE/2压缩/3保留),
 * bit3-19=块大小。返回 -1 表示无法定位(截断/格式不符)。
 */
function zstdFrameEnd(buf, from) {
  // FHD 位布局(RFC 8878 表3): bit7-6=Frame_Content_Size_Flag, bit5=Single_Segment_Flag,
  // bit3=保留(必须0), bit2=Content_Checksum_Flag, bit1-0=Dictionary_ID_Flag。
  // FCS 字段大小(表4): flag0 时 singleSeg→1字节 / 否则→无; flag1→2; flag2→4; flag3→8。
  // 块头 3 字节(表9): bit0=Last_Block, bit1-2=Block_Type(0原始/1RLE/2压缩/3保留),
  // bit3-23=Block_Size(21 位)。
  let p = from;
  const need = (n) => p + n <= buf.length;
  if (!need(5) || buf.readUInt32LE(p) !== 0xfd2fb528) return -1;
  p += 4;
  const fhd = buf[p++];
  if (fhd & 0x08) return -1; // 保留位必须为 0
  const fcsFlag = (fhd >> 6) & 0x3;
  const singleSeg = (fhd >> 5) & 0x1;
  const checksum = (fhd >> 2) & 0x1;
  const dictFlag = fhd & 0x3;
  if (!singleSeg) { if (!need(1)) return -1; p += 1; } // Window_Descriptor
  if (dictFlag) { const dl = [0, 1, 2, 4][dictFlag]; if (!need(dl)) return -1; p += dl; }
  const fl = singleSeg ? [1, 2, 4, 8][fcsFlag] : [0, 2, 4, 8][fcsFlag];
  if (!need(fl)) return -1;
  p += fl;
  while (true) {
    if (!need(3)) return -1;
    const b0 = buf[p], b1 = buf[p + 1], b2 = buf[p + 2];
    const last = b0 & 1;
    const type = (b0 >> 1) & 0x3;
    const size = ((b0 | (b1 << 8) | (b2 << 16)) & 0x7ffff8) >> 3;
    p += 3;
    if (type === 1) { if (!need(1)) return -1; p += 1; }
    else if (type === 0 || type === 2) { if (!need(size)) return -1; p += size; }
    else return -1; // 保留类型 = 损坏
    if (last) {
      if (checksum) { if (!need(4)) return -1; p += 4; } // Content_Checksum
      return p;
    }
  }
}

/**
 * 解码多帧 zstd 文件。
 * DSH 内核每次 flush 追加一个独立 zstd 帧, 而 Node 内置 zstdDecompressSync
 * 只解第一帧就停; 且压缩数据内部常出现与帧魔数相同的 4 字节
 * (48MB 日志里有 14 万处), 不能按魔数盲切。
 * 主路径: 用 zstdFrameEnd 走位找到每个帧的精确边界, 每帧只解码一次,
 * 总耗时 ≈ 解码一次整个文件。若文件写入中被截断, 丢弃解不出的尾部帧。
 * 回退路径: 走位失败时(格式意外), 按魔数候选终点做二分 —— "截到 starts[g]
 * 能否完整解出第一帧" 随 g 单调递增(解压器只读第一帧), O(log n) 次解码定位。
 */
function zstdDecodeMultiFrame(buf) {
  // 主路径: 块头走位
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const end = zstdFrameEnd(buf, pos);
    if (end <= pos) break;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(pos, end))); } catch { break; }
    pos = end;
  }
  if (out.length) return Buffer.concat(out);
  // 回退: 魔数 + 二分
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  if (buf.length < 4 || !buf.subarray(0, 4).equals(magic)) throw new Error('not a zstd file');
  const starts = [0];
  let i = 4;
  while (true) {
    i = buf.indexOf(magic, i);
    if (i === -1) break;
    starts.push(i);
    i += 4;
  }
  const tryFrame = (from, to) => zlib.zstdDecompressSync(buf.subarray(from, to));
  const out2 = [];
  for (let f = 0; f < starts.length; f += 1) {
    let ok = false;
    try { tryFrame(starts[f], buf.length); ok = true; } catch { ok = false; }
    if (!ok) break; // 尾部截断
    let lo = f + 1;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const end = mid < starts.length ? starts[mid] : buf.length;
      let success = false;
      try { tryFrame(starts[f], end); success = true; } catch { success = false; }
      if (success) hi = mid; else lo = mid + 1;
    }
    const end = lo < starts.length ? starts[lo] : buf.length;
    let frame;
    try { frame = tryFrame(starts[f], end); } catch { break; }
    out2.push(frame);
    f = lo - 1;
  }
  if (!out2.length) throw new Error('not a zstd file');
  return Buffer.concat(out2);
}

/** 本地时区的 YYYY-MM-DD */
function dayKey(tsMs) {
  const d = new Date(tsMs);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function listSessionFiles() {
  if (!fs.existsSync(sessionsRoot)) return [];
  const files = [];
  let workspaces = [];
  try { workspaces = fs.readdirSync(sessionsRoot, { withFileTypes: true }); } catch { return []; }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsDir = path.join(sessionsRoot, ws.name);
    let sessions = [];
    try { sessions = fs.readdirSync(wsDir, { withFileTypes: true }); } catch { continue; }
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      const sDir = path.join(wsDir, s.name);
      let entries = [];
      try { entries = fs.readdirSync(sDir); } catch { continue; }
      const name = entries.find((f) => f.endsWith('.jsonl.zstd'));
      if (!name) continue;
      const full = path.join(sDir, name);
      try {
        const st = fs.statSync(full);
        files.push({ full, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* skip */ }
    }
  }
  // 控制扫描量: 按修改时间取最近 4000 个
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, 4000);
}

/**
 * 解析单个会话日志。
 * 事件模型(来自 dsh 内核):
 *   session                 头(id/createdAt/cwd)
 *   assistant/message       一条助手消息, data.message.source = {provider, model}
 *   assistant/chunk         data.chunk.usage = {inputTokens, outputTokens}(每步最终用量)
 *   turn/start · turn/end   每一轮的开始/结束时刻
 */
function parseSession(file) {
  const stat = {
    tokensIn: 0, tokensOut: 0,
    perDay: new Map(),
    perModel: new Map(),
    perProvider: new Map(),
    turns: 0, maxTurnMs: 0,
    firstTs: null, lastTs: null,
  };
  let text;
  try {
    const buf = fs.readFileSync(file.full);
    text = zstdDecodeMultiFrame(buf).toString('utf8');
  } catch {
    return null; // 文件被锁/损坏时跳过, 下次重试
  }
  let lastMessage = null;
  let turnStart = 0;
  for (const line of text.split('\n')) {
    if (!line || line[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = ev.type;
    if (t === 'session') {
      stat.firstTs = ev.createdAt ?? stat.firstTs;
      continue;
    }
    const ts = typeof ev.time === 'number' ? ev.time : null;
    if (ts) {
      stat.firstTs = stat.firstTs == null ? ts : Math.min(stat.firstTs, ts);
      stat.lastTs = stat.lastTs == null ? ts : Math.max(stat.lastTs, ts);
    }
    if (t === 'assistant/message') {
      const src = ev.data?.message?.source || {};
      lastMessage = {
        provider: src.provider || 'unknown',
        model: src.model || 'unknown',
        ts,
      };
    } else if (t === 'assistant/chunk' && ev.data?.chunk?.usage) {
      const u = ev.data.chunk.usage;
      const inp = Number(u.inputTokens) || 0;
      const outp = Number(u.outputTokens) || 0;
      if (inp <= 0 && outp <= 0) continue;
      stat.tokensIn += inp;
      stat.tokensOut += outp;
      const total = inp + outp;
      const when = ts ?? lastMessage?.ts ?? file.mtimeMs;
      const key = dayKey(when);
      stat.perDay.set(key, (stat.perDay.get(key) || 0) + total);
      const model = lastMessage?.model || 'unknown';
      stat.perModel.set(model, (stat.perModel.get(model) || 0) + total);
      const provider = lastMessage?.provider || 'unknown';
      stat.perProvider.set(provider, (stat.perProvider.get(provider) || 0) + total);
    } else if (t === 'turn/start' && typeof ts === 'number') {
      turnStart = ts;
    } else if (t === 'turn/end' && typeof ts === 'number') {
      stat.turns += 1;
      if (turnStart > 0) stat.maxTurnMs = Math.max(stat.maxTurnMs, ts - turnStart);
    }
  }
  return stat;
}

function streaks(perDay) {
  const days = new Set(perDay.keys());
  if (!days.size) return { current: 0, longest: 0 };
  const sorted = [...days].sort();
  const parse = (s) => new Date(s + 'T00:00:00');
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const diff = (parse(sorted[i]) - parse(sorted[i - 1])) / 86400000;
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // 当前连续: 从昨天或今天往回数
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  let anchor = days.has(today) ? today : (days.has(yesterday) ? yesterday : null);
  let current = 0;
  if (anchor) {
    current = 1;
    let cursor = parse(anchor).getTime();
    while (days.has(dayKey(cursor - 86400000))) {
      current += 1;
      cursor -= 86400000;
    }
  }
  return { current, longest };
}

function main() {
  const startedAt = Date.now();
  let cache = null;
  if (!forceRefresh) {
    try { cache = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { cache = null; }
  }
  const files = listSessionFiles();
  const fileFinger = cache?.files && typeof cache.files === 'object' ? cache.files : {};
  const parsedFiles = cache?.parsedFiles || {};
  const staleFinger = {};
  const dayMap = new Map();
  const modelMap = new Map();
  const providerMap = new Map();
  let totalIn = 0, totalOut = 0, turns = 0;
  let maxTurnMs = 0, maxSessionMs = 0;
  let scanned = 0, cached = 0, failed = 0;

  const add = (map, key, val) => map.set(key, (map.get(key) || 0) + val);

  for (const f of files) {
    const fp = `${f.mtimeMs.toFixed(0)}:${f.size}`;
    staleFinger[f.full] = fp;
    const prev = parsedFiles[f.full];
    if (prev && prev.fingerprint === fp) {
      // 命中缓存
      addModelMaps(prev.stat);
      cached += 1;
      continue;
    }
    const stat = parseSession(f);
    if (!stat) { failed += 1; delete parsedFiles[f.full]; continue; }
    parsedFiles[f.full] = {
      fingerprint: fp,
      stat: {
        tokensIn: stat.tokensIn, tokensOut: stat.tokensOut, turns: stat.turns,
        maxTurnMs: stat.maxTurnMs, maxSessionMs: statSessionMs(stat),
        perDay: [...stat.perDay.entries()], perModel: [...stat.perModel.entries()],
        perProvider: [...stat.perProvider.entries()],
      },
    };
    addModelMaps(stat);
    scanned += 1;
  }
  function addModelMaps(stat) {
    totalIn += stat.tokensIn;
    totalOut += stat.tokensOut;
    turns += stat.turns;
    maxTurnMs = Math.max(maxTurnMs, stat.maxTurnMs);
    maxSessionMs = Math.max(maxSessionMs, statSessionMs(stat));
    for (const [k, v] of stat.perDay) add(dayMap, k, v);
    for (const [k, v] of stat.perModel) add(modelMap, k, v);
    for (const [k, v] of stat.perProvider) add(providerMap, k, v);
  }
  function statSessionMs(stat) {
    return stat.firstTs && stat.lastTs ? Math.max(0, stat.lastTs - stat.firstTs) : 0;
  }

  // 清理已不存在的文件指纹
  for (const key of Object.keys(parsedFiles)) {
    if (!files.some((f) => f.full === key)) delete parsedFiles[key];
  }

  const perDay = Object.fromEntries([...dayMap.entries()].sort());
  const totalTokens = totalIn + totalOut;
  const { current, longest } = streaks(dayMap);
  const result = {
    generatedAt: Date.now(),
    totalTokens,
    inputTokens: totalIn,
    outputTokens: totalOut,
    peakDayTokens: dayMap.size ? Math.max(...dayMap.values()) : 0,
    longestTurnMinutes: Math.round(maxTurnMs / 60000),
    longestSessionMinutes: Math.round(maxSessionMs / 60000),
    currentStreak: current,
    longestStreak: longest,
    turns,
    sessions: Object.keys(parsedFiles).length,
    perDay,
    perModel: Object.fromEntries([...modelMap.entries()].sort((a, b) => b[1] - a[1])),
    perProvider: Object.fromEntries([...providerMap.entries()].sort((a, b) => b[1] - a[1])),
    meta: { scanned, cached, failed, elapsedMs: Date.now() - startedAt },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const payload = JSON.stringify({ files: staleFinger, parsedFiles, result });
  fs.writeFileSync(outPath, payload, { mode: 0o600 });
  process.stdout.write(JSON.stringify(result, null, 2));
}

main();
