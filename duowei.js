/* ══════════════════════════════════════════════════════════════════════════
   带货工作台 · duowei 写库引擎（纯逻辑，不依赖 Obsidian → 可用 node 单测）
   ──────────────────────────────────────────────────────────────────────────
   依据（都实测过，别改）：
     · 文件结构：{ schemaVersion, id, name, fields[], records[], views, activeViewId, meta }
       记录形态：{ id, syncUid, values{字段id:值}, notePath, createdAt, updatedAt }
     · **关联（relation）的值 = 记录 id 的数组**，例：`fld_sp_mine = ["rec_mudwgnrv_35tfsd3"]`
     · ⚠️ 库内铁律：**relation 不是自动双向，两边都要写值**，否则 rollup 汇总为空
     · ⚠️ **.duowei 文件尾带一个换行** —— `JSON.stringify(obj,null,2)` 不带 → 会差 1 字节
     · 写回用「临时文件 + 改名」：避免半截写入把表写坏
   ══════════════════════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
function rid(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}
/** 形态对齐现有 id：rec_xxxxxxxx_xxxxxxx / sync_xxxxxxxx_xxxxxxx / opt_xxxxxxxx_xxxxxxx */
function newRecordId() { return "rec_" + rid(8) + "_" + rid(7); }
function newSyncUid() { return "sync_" + rid(8) + "_" + rid(7); }
function newOptionId() { return "opt_" + rid(8) + "_" + rid(7); }

function readTable(file) {
  const txt = fs.readFileSync(file, "utf8");
  const obj = JSON.parse(txt);
  if (!Array.isArray(obj.fields) || !Array.isArray(obj.records)) {
    throw new Error("不是预期的 duowei 结构：" + file);
  }
  return { obj, bytes: Buffer.byteLength(txt, "utf8"), text: txt };
}

/** 备份到**库外**目录（库内不留备份） */
function backupTable(file, backupDir) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  const dest = path.join(backupDir, path.basename(file, ".duowei") + "-写前-" + stamp + ".duowei");
  fs.copyFileSync(file, dest);
  return dest;
}

/** 写回：保留**文件尾换行** + 临时文件改名 */
function writeTable(file, obj) {
  const body = JSON.stringify(obj, null, 2);
  const tmp = file + ".tmp-write";
  fs.writeFileSync(tmp, body + "\n", "utf8"); // ← 尾换行不能少
  fs.renameSync(tmp, file);
  return fs.statSync(file).size;
}

/** 字段名 → 字段对象 */
function fieldByName(obj, name) {
  return obj.fields.find((f) => f.name === name) || null;
}

/** 单选字段：确保存在同名选项；返回选项 id（新增时 added=true） */
function ensureOption(field, name) {
  if (!Array.isArray(field.options)) field.options = [];
  let o = field.options.find((x) => x.name === name);
  if (o) return { id: o.id, added: false };
  o = { id: newOptionId(), name: name };
  field.options.push(o);
  return { id: o.id, added: true };
}

/** 造一条新记录（形态与现有记录逐键一致：id,syncUid,values,notePath,createdAt,updatedAt） */
function makeRecord(values, nowIso) {
  return {
    id: newRecordId(),
    syncUid: newSyncUid(),
    values: values,
    notePath: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

module.exports = {
  readTable, writeTable, backupTable, fieldByName, ensureOption, makeRecord,
  newRecordId, newSyncUid,
};
