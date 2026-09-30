/*
 * 带货工作台 · Obsidian 插件
 * ------------------------------------------------------------------
 * B1（2026-09-29）：项目骨架 + 5 页路由 + 三页接真数据（只读）
 *   · 视图 = 已确认 HTML 高保真稿 → view.html / styles.css（视觉零改动；选择器根已改写为 .xhs-wb-root）
 *   · 交互 = 原稿脚本 → interact.js；执行期间劫持 document/window 事件注册，关视图时回收
 *   · 数据 = 真读 vault（笔记卡 / 模板卡 / 每日日志 / 30天启动清单）+ duowei 三表
 *   · 数据库页 / 知识库页 = 演示（页面上有「演示数据」标记 —— 演示内容一律带标记，不掩盖缺口）
 * 本批不含：任何写操作（B2/B4）· 笔记卡弹窗（B3）· 生成请求单与爆款采集（B3）· 搜索（B5）· 商品采集（B2）
 * 零构建：手写 CommonJS，不引入打包器。
 * ------------------------------------------------------------------
 */

const { Plugin, ItemView, Notice, Setting, PluginSettingTab, Modal } = require("obsidian");
const fs = require("fs");
const path = require("path");

const VIEW_TYPE = "xhs-workbench-view";
const PLUGIN_DIR = ".obsidian/plugins/xhs-workbench";
const ROOT_SEL = ".xhs-wb-root";
const DEFAULT_SETTINGS = { wbName: "带货工作台" };

const P = {
  wencang: "10-小红书带货/20-文案库",
  tplDir: "10-小红书带货/20-文案库/模板卡",
  todoDir: "10-小红书带货/20-文案库/待拆解",
  taskDir: "10-小红书带货/20-文案库/文案生成任务单",
  dailyDir: "10-小红书带货/00-行动看板/每日日志",
  plan: "10-小红书带货/00-行动看板/30天启动清单.md",
  dwArchive: "多维表格/测品档案.duowei",
  dwTrack: "多维表格/每日跟踪.duowei",
  dwMine: "多维表格/我的每日数据.duowei",
};
const DASH = "—"; // 后台还没有值（不是 0）
const UNFILLED = "未填"; // 没采到（不是 0）

/* ══════════════════ 通用工具 ══════════════════ */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const pad2 = (n) => String(n).padStart(2, "0");
const todayDate = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const todayISO = () => { const d = todayDate(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
const toDate = (s) => { const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysBetween = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);
const shortDate = (s) => { const d = toDate(s); return d ? pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) : String(s || ""); };
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const fmtInt = (v) => (num(v) == null ? null : num(v).toLocaleString("en-US"));
const fmt2 = (v) => (num(v) == null ? null : (Math.round(num(v) * 100) / 100).toFixed(2));
const fmtMoney = (v) => (num(v) == null ? null : "¥" + (Math.round(num(v) * 100) / 100).toFixed(2));
const unlink = (s) => String(s || "").replace(/\[\[/g, "").replace(/\]\]/g, "").trim();

function parseFM(text) {
  const m = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(":");
    if (i < 0) return;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  });
  return out;
}
function firstH1(t) { const m = String(t).match(/^#\s+(.+)$/m); return m ? m[1].trim() : ""; }
function bodyChars(t) {
  const m = String(t).match(/\*\*正文\*\*([\s\S]*?)(?=\n\*\*|\n##\s|$)/);
  return m ? m[1].replace(/\s/g, "").length : 0;
}

/** 模板长名 → 展示短名（与已确认稿的列宽一致）：`文字类-同品对标-前后状态对比-005` → `005 前后状态对比` */
function shortTpl(s) {
  const t = unlink(s);
  if (!t) return "";
  const p = t.split("-");
  if (p.length >= 4 && /^\d{1,3}$/.test(p[p.length - 1])) return p[p.length - 1] + " " + p[2];
  return t;
}

/** 按「四块标记」切笔记卡正文（先 `###` 小节 → 退回加粗行；与任务单模板 §六 ② 的口径一致） */
function parseCardBlocks(text) {
  let scope = String(text);
  const dz = scope.match(/##\s*草稿区([\s\S]*?)(?=\n##\s|$)/);
  if (dz) scope = dz[1];
  const parts = scope.split(/^\*\*([^*\n]+)\*\*[ \t]*$/m);
  const blocks = {};
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].trim();
    const body = (parts[i + 1] || "").trim();
    if (/封面/.test(label)) blocks.covers = body;
    else if (/标题/.test(label)) blocks.titles = body;
    else if (/正文/.test(label)) blocks.body = body;
    else if (/标签/.test(label)) blocks.tags = body;
  }
  return blocks;
}
const linesOf = (s) =>
  String(s || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && x !== "---")
    .map((x) => x.replace(/^[-*]\s*/, ""));
const numberedOf = (s) =>
  String(s || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => /^\d+[\.、)]\s*/.test(x))
    .map((x) => x.replace(/^\d+[\.、)]\s*/, ""));

/** 解析已确认的「30天启动清单」拿 Day N（不另建状态） */
function parsePlan(text) {
  const out = { day: null, remain: null, phase: null, base: null };
  if (!text) return out;
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*=\s*Day\s*0/);
  if (!m) return out;
  out.base = m[1];
  const d = daysBetween(todayDate(), toDate(m[1]));
  if (d < 0) return out;
  out.day = d;
  out.remain = Math.max(0, 30 - d);
  const rows = [];
  const re = /\|\s*\d+\.\s*([^|\n]+?)\s*\|\s*Day\s*(\d+)\s*-\s*(\d+)\s*\|/g;
  let r;
  while ((r = re.exec(text))) rows.push({ name: r[1].trim(), from: +r[2], to: +r[3] });
  const hit = rows.find((x) => d >= x.from && d <= x.to);
  if (hit) out.phase = hit.name;
  return out;
}

/** duowei 读取：values 的键是字段 id、单选值存的是 option id —— 一律按「字段名」取值，不写死 id */
function loadDuowei(text) {
  const o = JSON.parse(text);
  const byName = {};
  o.fields.forEach((f) => (byName[f.name] = f));
  const val = (rec, fname) => {
    const f = byName[fname];
    if (!f) return null;
    const raw = rec.values ? rec.values[f.id] : null;
    return raw === undefined || raw === null || raw === "" ? null : raw;
  };
  const opt = (rec, fname) => {
    const raw = val(rec, fname);
    if (raw == null) return null;
    const f = byName[fname];
    if (f && f.options) { const hit = f.options.find((x) => x.id === raw); return hit ? hit.name : raw; }
    return raw;
  };
  return { raw: o, fields: byName, records: o.records || [], val, opt };
}

function blkByTitle(scope, title) {
  return Array.from(scope.querySelectorAll(".blk")).find((b) => {
    const bt = b.querySelector(".bh .bt");
    return bt && bt.textContent.trim() === title;
  }) || null;
}
const setText = (el, v) => { if (el) el.textContent = v; };

/* ══════════════════ 视图 ══════════════════ */

class WorkbenchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.root = null;
    this.tracked = [];
    this._toastT = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return (this.plugin.settings && this.plugin.settings.wbName) || "带货工作台"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() {
    const host = this.contentEl;
    host.empty();
    host.addClass("xhs-wb-host");

    const dir = path.join(this.app.vault.adapter.getBasePath(), PLUGIN_DIR);
    let html = "", js = "";
    try {
      html = fs.readFileSync(path.join(dir, "view.html"), "utf8");
      js = fs.readFileSync(path.join(dir, "interact.js"), "utf8");
    } catch (e) {
      host.createDiv({ text: "带货工作台：读取 view.html / interact.js 失败 → " + e.message });
      return;
    }

    host.innerHTML = html;
    this.root = host.querySelector(ROOT_SEL);
    if (!this.root) { host.createDiv({ text: "带货工作台：view.html 里找不到 .xhs-wb-root" }); return; }

    const data = await this.plugin.loadSnapshot();
    this.data = data;
    this.renderAll(data);

    this.runInteract(js);
    this.bindOwn();
    this.bindSearch();
    this.markDemo();
    this.applyWbName();
    this.bindPickOnce();          // B2：选品池采集接线（一次性，事件委托）
    this.refreshPickStatus(data); // B2：采集按钮可用性 / 采写模式 / 上次采集
  }

  async onClose() { this.teardown(); }

  /* ───── 交互层：执行原稿脚本，并记录它注册在 document / window / ResizeObserver 上的东西 ───── */
  runInteract(src) {
    const tracked = this.tracked;
    const origDocAdd = document.addEventListener;
    const origWinAdd = window.addEventListener;
    const OrigRO = window.ResizeObserver;

    document.addEventListener = function (t, fn, opt) { tracked.push(["doc", t, fn, opt]); return origDocAdd.call(document, t, fn, opt); };
    window.addEventListener = function (t, fn, opt) { tracked.push(["win", t, fn, opt]); return origWinAdd.call(window, t, fn, opt); };
    if (OrigRO) {
      window.ResizeObserver = class extends OrigRO {
        constructor(cb) { super(cb); tracked.push(["ro", this]); }
      };
    }
    try {
      new Function(src)();
    } catch (e) {
      console.error("[xhs-workbench] interact.js 执行失败", e);
      new Notice("带货工作台：交互脚本执行失败（" + e.message + "）");
    } finally {
      document.addEventListener = origDocAdd;
      window.addEventListener = origWinAdd;
      if (OrigRO) window.ResizeObserver = OrigRO;
    }
  }

  teardown() {
    // 🔴 2026-09-30：视图卸载 / 插件禁用时务必关掉模板弹窗 —— 未关闭的 Obsidian Modal 会残留在
    //    keymap 栈上，其焦点容器会吃掉**全 Obsidian** 的输入焦点（详见 showAllTemplates 里的注释）。
    try { if (this._tplModal) { this._tplLeaving = true; this._tplModal.close(); } } catch { /* ignore */ }
    this._tplModal = null; this._tplWant = false; this._tplOpening = false;
    this.tracked.forEach((x) => {
      try {
        if (x[0] === "doc") document.removeEventListener(x[1], x[2], x[3]);
        else if (x[0] === "win") window.removeEventListener(x[1], x[2], x[3]);
        else if (x[0] === "ro" && x[1].disconnect) x[1].disconnect();
      } catch (e) { /* 忽略 */ }
    });
    this.tracked = [];
    if (this._toastT) clearTimeout(this._toastT);
  }

  /* ───── 我自己的委托绑定（在原稿脚本之后绑） ───── */
  bindOwn() {
    // 设置齿轮 → 插件设置页（PRD §2 全局元素 / 结构 §20.5）。
    // 用**捕获阶段**拦掉原稿挂在 #settingsBtn 上的「改名浮层」——原稿的监听器先注册，冒泡阶段压不住它。
    this.root.addEventListener("click", (e) => {
      if (!(e.target.closest && e.target.closest("#settingsBtn"))) return;
      e.preventDefault();
      e.stopPropagation();
      this.plugin.openSettings();
    }, true);

    this.root.addEventListener("click", (e) => {
      const el = e.target;
      // ── B3：笔记卡弹窗 · 状态分段（真写 frontmatter）──
      const seg = el.closest && el.closest("#noteModal .seg-b");
      if (seg) {
        e.preventDefault();
        e.stopPropagation();
        if (this.notePath) {
          const v = seg.textContent.trim();
          seg.parentElement.querySelectorAll(".seg-b").forEach((x) => x.classList.toggle("on", x === seg));
          this.setNoteStatus(this.notePath, v);
        }
        return;
      }
      // ── B3：创作台 · 爆款投喂 ──
      const feedBtn = el.closest && el.closest("#p-output .blk.bar button.btn.pri");
      if (feedBtn) { e.preventDefault(); e.stopPropagation(); this.doFeed(); return; }
      // ── B3.4：#p-output 里有两个 .btn.pri.full，按区块标题分发（B3.1 用宽选择器把「全部模板卡」也接成了复制 —— 老哥纠偏）──
      const cpBtn = el.closest && el.closest("#p-output button.btn.pri.full");
      if (cpBtn) {
        e.preventDefault(); e.stopPropagation();
        const blk = cpBtn.closest(".blk");
        const bt = blk ? blk.querySelector(".bh .bt") : null;
        const title = bt ? bt.textContent.trim() : "";
        if (title.indexOf("模板库") >= 0) { this.showAllTemplates(); return; }
        this.doRequestSheet(); return; // 生成请求单 · 复制提示词 + 任务单落盘
      }
      // ── B3.6：笔记卡列表的状态分段（原型里是纯视觉，真数据下要真筛 —— 老哥反馈）──
      const stb = el.closest && el.closest(".subtab");
      if (stb) {
        const blk = stb.closest(".blk");
        const bt = blk ? blk.querySelector(".bh .bt") : null;
        if (bt && bt.textContent.indexOf("笔记卡列表") >= 0) {
          stb.parentElement.querySelectorAll(".subtab").forEach((x) => x.classList.remove("on"));
          stb.classList.add("on");
          this._statusFilter = stb.textContent.trim();
          this.applyStatusFilter();
          return;
        }
      }
      // ── 去拆解 ›（B3.3 按 PRD 口径：打包 + 生成可 @ 的说明，不是打开笔记）──
      const dq = el.closest && el.closest("#p-today .met .lnk");
      if (dq) { e.preventDefault(); e.stopPropagation(); this.doUnpack(); return; }
      const pend = el.closest && el.closest("[data-pending]");
      if (pend) {
        e.preventDefault();
        e.stopPropagation();
        this.toast(pend.dataset.pendingText || pend.dataset.pending);
        return;
      }
      // ── B4：开始回填 ──
      const bf = el.closest && el.closest("[data-action=backfill]");
      if (bf) { e.preventDefault(); e.stopPropagation(); this.openBackfillModal(); return; }
      const go = el.closest && el.closest("[data-goto]");
      if (go) {
        e.preventDefault();
        e.stopPropagation();
        this.gotoPage(go.dataset.goto);
        // B4：去创作台时把在测品带入生成请求单（PRD 行 113「带品」）
        if (/去创作台/.test(go.textContent || "")) {
          const pin = this.backfillPinName();
          if (pin) this.setRequestPin(pin);
        }
        return;
      }
      const open = el.closest && el.closest("[data-file]");
      if (open) {
        e.preventDefault();
        this.app.workspace.openLinkText(open.dataset.file, "", false);
        return;
      }
      const note = el.closest && el.closest("[data-open-note]");
      if (note) {
        e.preventDefault();
        this.openNote(note.dataset.openNote);
      }
    });
    // 弹窗内：打开源文件（点遮罩/× 由原稿脚本负责关）
    const srcBtn = this.root.querySelector("#noteModal .m-head button.btn");
    if (srcBtn) srcBtn.addEventListener("click", () => { if (this.notePath) this.app.workspace.openLinkText(this.notePath, "", false); });
  }

  /** 笔记卡弹窗（PRD §17.2 / 结构 §12）：读真卡 → 按四块标记切块 → 每块一个复制按钮。
   *  复制按钮的点击由原稿脚本挂在 #mRows 上的委托处理，这里只负责填内容。 */
  async openNote(path) {
    const modal = this.root.querySelector("#noteModal");
    if (!modal) return;
    let txt = "";
    try { txt = await this.app.vault.adapter.read(path); } catch (e) { this.toast("读不到笔记卡：" + path); return; }
    const fm = parseFM(txt);
    const blk = parseCardBlocks(txt);
    setText(this.root.querySelector("#mT"), firstH1(txt) || path.split("/").pop().replace(/\.md$/, ""));
    setText(this.root.querySelector("#mS"), [fm["本品"] || "未标品名", shortTpl(fm["归属模板"]) || "未挂模板", "正文 " + bodyChars(txt) + " 字"].join(" · "));

    const grp = (label, rows, isBody) => {
      if (!rows.length) return "";
      return '<div class="cp-grp"><div class="cp-k">' + esc(label) + '</div><div class="cp-lines">' +
        rows.map((r) => '<div class="cp-line"><span class="tx' + (isBody ? " body" : "") + '">' + esc(r) + '</span>' +
          '<button class="btn" data-copy="' + esc(r) + '">复制</button></div>').join("") +
        "</div></div>";
    };
    const covers = linesOf(blk.covers);
    const titles = numberedOf(blk.titles);
    const tags = linesOf(blk.tags).join(" ");
    const rowsEl = this.root.querySelector("#mRows");
    const html = grp("标题", titles) + grp("封面大字", covers) + grp("正文", blk.body ? [blk.body] : [], true) + grp("标签", tags ? [tags] : []);
    if (rowsEl) {
      rowsEl.innerHTML = html || '<div class="cp-grp"><div class="cp-k">未填</div><div class="cp-lines"><div class="cp-line">' +
        '<span class="tx">这张卡没有按「四块标记」写（封面 N 版 / 标题 N 选 1 / 正文 / 标签）→ 解析不到。格式约束见任务单模板 §六 ②。</span>' +
        "</div></div></div>";
    }
    this.notePath = path;
    const st = String(fm["状态"] || "").trim();
    this.root.querySelectorAll("#noteModal .seg-b").forEach((x) => x.classList.toggle("on", x.textContent.trim() === st));
    modal.hidden = false;
  }

  gotoPage(id) {
    this.root.querySelectorAll(".nav").forEach((x) => x.classList.remove("on"));
    const nav = this.root.querySelector('.nav[data-p="' + id + '"]');
    if (nav) nav.classList.add("on");
    this.root.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== id));
    const wall = this.root.querySelector("#wall");
    if (wall) wall.hidden = id !== "p-today" && !this.root.classList.contains("wall-full");
  }

  toast(msg) {
    const t = this.root && this.root.querySelector("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (this._toastT) clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (t.hidden = true), 2400);
  }

  /* ───── 选品池：采集接线（B2） ─────
     稿里本来就有采集条（粘贴框 + 采写模式切换 + 采集按钮）与三处「去 duowei 编辑」→ 这里只接线。 */
  bindPickOnce() {
    if (this._pickBound) return;
    const pick = this.root.querySelector("#p-pick");
    if (!pick) return;
    this._pickBound = true;

    // 用**事件委托**：渲染会重写表格，逐个绑定会掉
    pick.addEventListener("click", (e) => {
      // 品名点击 → 打开测品档案.duowei（老哥 09-30：去多维表格看品级详情）
      const td = e.target && e.target.closest ? e.target.closest("td.t-title.link[data-openrecord]") : null;
      if (td) { e.preventDefault(); this.openDuoweiRecord(td.getAttribute("data-openrecord"), td.getAttribute("data-record-id")); return; }
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      const txt = (btn.textContent || "").trim();

      if (btn.closest(".capblk") && btn.classList.contains("pri")) { e.preventDefault(); this.doCollect(); return; }
      if (btn.closest(".capblk") && btn.classList.contains("subtab")) {
        e.preventDefault();
        const mode = txt.indexOf("变动") >= 0 ? "变动才采写" : "全部采写";
        const p = this.plugin.collector();
        if (!p || typeof p.setMode !== "function") { this.toast("采写模式由「小红书商品采集器」插件承载，当前不可用"); return; }
        Promise.resolve(p.setMode(mode)).then(() => { this.toast("采写模式 → " + mode); this.refreshPickStatus(this.data); });
        return;
      }
      if (/去\s*duowei/.test(txt)) {
        e.preventDefault();
        const blk = btn.closest(".blk");
        const title = blk && blk.querySelector(".bh .bt") ? blk.querySelector(".bh .bt").textContent : "";
        this.openDuoweiTable(/每日跟踪/.test(title) ? TABLE_TRACK : TABLE_ARCHIVE);
      }
    });
    // 粘贴框回车 = 采集
    const ipt = pick.querySelector(".capblk input.ipt");
    if (ipt) ipt.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.doCollect(); } });
  }

  /** 采集按钮能不能点、采写模式高亮、上次采集时间 —— 每次渲染后刷新（数据来自真表） */
  async refreshPickStatus(d) {
    const pick = this.root.querySelector("#p-pick");
    if (!pick) return;
    const cap = pick.querySelector(".capblk");
    const btn = cap ? cap.querySelector("button.btn.pri") : null;
    const ipt = cap ? cap.querySelector("input.ipt") : null;
    const modes = cap ? cap.querySelectorAll(".grp button.subtab") : [];

    const st = await this.plugin.collectorStatus();
    [btn, ipt].forEach((el) => {
      if (!el) return;
      el.disabled = !st.ok;
      el.title = st.ok ? "" : st.why;
      el.classList.toggle("wb-cap-off", !st.ok);
    });
    if (btn) btn.classList.toggle("wb-cap-off", !st.ok);
    // 不可用时在采集条里挂一行说明（不静默失败）
    if (cap) {
      let hint = cap.querySelector(".wb-cap-hint");
      if (!hint) { hint = cap.createDiv({ cls: "wb-cap-hint" }); }
      hint.setText(st.ok ? "" : "采集暂不可用：" + st.why + "（可先粘链接手填，写入路径一致）");
      hint.toggle(st.ok === false);
    }
    // 采写模式高亮：稿里第 1 个是「变动才采」、第 2 个是「全采」
    const isDiff = st.mode === "变动才采写";
    modes.forEach((m, i) => m.classList.toggle("on", i === (isDiff ? 0 : 1)));

    // 「上次采集」= 每日跟踪里最新那条的日期（真数据，不是稿里的硬编码）
    const last = pick.querySelector(".blk .bh .r");
    if (last && d && d.dw && d.dw.track && Array.isArray(d.dw.track.records)) {
      const T = d.dw.track;
      const dates = T.records
        .map((r) => (typeof T.val === "function" ? T.val(r, "日期") : null))
        .filter((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x))
        .sort();
      last.setText(dates.length ? "上次采集 " + dates[dates.length - 1] : "还没有采集记录");
    }
  }

  /** 采集 → 预览确认 → 写库 → 重渲染 */
  async doCollect() {
    const pick = this.root.querySelector("#p-pick");
    const ipt = pick ? pick.querySelector(".capblk input.ipt") : null;
    const link = ipt ? String(ipt.value || "").trim() : "";
    if (!link) { this.toast("先粘一个商品链接或商品 ID"); return; }
    const p = this.plugin.collector();
    if (!p) { new Notice("没装 / 没启用「小红书商品采集器」插件 → 采集不可用", 9000); return; }
    const st = await this.plugin.collectorStatus();
    if (!st.ok) { new Notice("采集器不可用：" + st.why, 10000); return; }

    this.toast("采集中…（本机脚本，几秒）");
    const res = await p.collect(link);
    if (!res.ok) { new Notice("采集失败：" + res.error, 12000); return; }
    new CollectConfirmModal(this.app, res, async (pinName, targets, pick, shopData) => {
      let c = res;
      if (res.kind === "shop") {
        // 店铺流程：选中的首页商品 + **补查详情接口**（到手价/发货地/店铺评分）→ 与单品同形
        const f = await this.plugin.enrichShopCollect(res, pick || 0);
        c = Object.assign({}, res, { archive: f.archive, track: f.track });
      } else if (targets.shop) {
        // 单品流程勾「店铺采集」：商品自带店铺链接 → 该店首页商品（B1 预览）+ 角标（B5）
        c = await this.plugin.mergeShopForItem(res, shopData);
      }
      const w = await this.plugin.createArchiveFromCollect(c, pinName, targets);
      if (!w.ok) { new Notice("写库失败：" + w.error, 14000); return; }
      const msg = "已写入 ✓\n" + (w.动作 || []).join("\n")
        + (w.变更 && w.变更.length ? "\n变更：" + w.变更.join("；") : "")
        + "\n（模式：" + w.模式 + "）";
      new Notice(msg, 10000);
      if (ipt) ipt.value = "";
      await this.reloadData();
    }, {
      hasArchive: (n) => { try { return this.plugin.archiveNames().indexOf(n) >= 0; } catch (e) { return true; } },
      shopFields: (pick) => this.plugin.shopCollectFields(res, pick),
      fetchShop: () => { const cp = this.plugin.collector(); return cp && res.店铺链接 ? cp.collectShop(res.店铺链接) : null; },
    }).open();
  }

  /** 点品名 → 打开对应多维表格并定位到你点的那一行（用 duowei-table 的 revealRecord = 弹出该行记录详情卡） */
  async openDuoweiRecord(source, recordId) {
    const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    const abs = this.plugin.dwFile(source);
    const rel = path.relative(base, abs).replace(/\\/g, "/");
    const f = this.app.vault.getAbstractFileByPath(rel);
    if (!f) { this.toast("找不到表文件：" + rel); return; }
    const vt = "duowei-table";
    let leaf = this.app.workspace.getLeavesOfType(vt).find((l) => l.view && l.view.file && l.view.file.path === f.path);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(f);
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const v = leaf.view;
    if (v && typeof v.revealRecord === "function") {
      if (v.revealRecord(recordId)) return;
      setTimeout(() => { try { v.revealRecord(recordId); } catch (e) { /* 记录还没加载完就再试一次 */ } }, 600);
      return;
    }
    this.toast("已打开「" + source + "」，但当前 duowei-table 版本不支持定位到行");
  }

  /** 「去 duowei 编辑」= 打开整张表（V1 口径） */
  async openDuoweiTable(name) {
    const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    const abs = this.plugin.dwFile(name);
    const rel = path.relative(base, abs).replace(/\\/g, "/");
    const f = this.app.vault.getAbstractFileByPath(rel);
    if (!f) { this.toast("找不到表文件：" + rel); return; }
    await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** 写库后重读数据并重渲染（不重挂交互层） */
  async reloadData() {
    try {
      const data = await this.plugin.loadSnapshot();
      this.data = data;
      this.renderAll(data);
    } catch (e) {
      this.toast("重读数据失败：" + (e && e.message ? e.message : String(e)));
    }
  }

  /* ───── 渲染总入口 ───── */
  renderAll(d) {
    this.renderHead();
    this.renderToday(d);
    this.renderOutput(d);
    this.renderPick(d);
    this.renderDep(d);
    this.markPending();
    if (this._pickBound) this.refreshPickStatus(d);   // B2：采集条状态（可用性 / 模式 / 上次采集）
  }

  renderHead() {
    const t = todayDate();
    const wd = ["日", "一", "二", "三", "四", "五", "六"][t.getDay()];
    setText(this.root.querySelector(".head .date"), `${t.getMonth() + 1}月${t.getDate()}日 星期${wd}`);
  }

  /* ───── 工作台（纯投影，自己不写东西） ───── */

  /* 药丸文案：按已确认稿的口径拼成「字段名 · 值」，并把值开头的状态符号去掉。
     依据（老哥 2026-09-29 拍板）：稿里写死的是「止损预警 · 数据未填」，
     而 `测品档案` 里那个**公式字段**的值是「⏸ 数据未填」（公式自带 ⏸/🔴/🟢 三种状态符号）。
     去掉 emoji 的理由：药丸自己已经有一个圆点标记（`<i></i>`），emoji 是重复标记。 */
  warnPill(v) {
    const s = v == null ? "" : String(v);
    const text = s.replace(/^[^\p{L}\p{N}]+/u, "").trim() || s.trim();
    return text ? "止损预警 · " + text : "无预警";
  }
  /* 该药丸要不要走橙色（`wr` = 需要你处理）：看公式值里的状态语义，
     而不是看文案里有没有「预警」二字 —— 表里的值「⏸ 数据未填」并不含「预警」，
     旧判据 `/预警/.test(值)` 会让该橙的变成灰。 */
  warnIsAlert(v) {
    return /未填|触发|换品|🔴|⏸|⚠/.test(v == null ? "" : String(v));
  }

  renderToday(d) {
    const draft = d.cards.filter((c) => String(c.fm["状态"] || "") === "草稿");
    const A = d.dw.archive;
    const testing = A ? A.records.filter((r) => A.opt(r, "分区") === "正在测") : [];

    const mets = this.root.querySelectorAll("#p-today .mrow .met");
    if (mets[0]) { setText(mets[0].querySelector(".v"), String(draft.length)); setText(mets[0].querySelector(".d"), "草稿待发"); }
    if (mets[1]) {
      setText(mets[1].querySelector(".v"), String(testing.length));
      setText(mets[1].querySelector(".d"), testing.length ? testing.map((r) => A.val(r, "品名")).join("、") : "尚无在测品");
    }
    if (mets[2]) setText(mets[2].querySelector(".v"), String(d.todo));
    if (mets[3]) {
      setText(mets[3].querySelector(".v"), d.dw.mineToday ? "已完成" : "未完成");
      setText(mets[3].querySelector(".d"), d.dw.mineToday ? "我的每日数据已有今日一行" : "我的每日数据缺今日一行");
    }

    // 路线图（Day N 读 30天启动清单；清单里没有基准就如实说）
    const dwrap = this.root.querySelector("#p-today .daywrap");
    if (dwrap) {
      const pl = d.plan || {};
      setText(dwrap.querySelector(".daynum"), pl.day == null ? DASH : String(pl.day));
      setText(dwrap.querySelector(".dayof"), "/ 30 天");
      const rest = dwrap.querySelector(".dayrest");
      if (rest) {
        rest.innerHTML = pl.day == null
          ? "启动清单里没找到「Day 0」基准"
          : `<b>${esc(pl.phase || "未匹配到阶段")}</b> · 剩 ${pl.remain} 天`;
      }
      const daysEl = dwrap.querySelector(".days");
      if (daysEl && pl.day != null) {
        daysEl.innerHTML = Array.from({ length: 30 }, (_, i) => {
          const n = i + 1;
          return '<i class="' + (n < pl.day ? "on" : n === pl.day ? "today" : "") + '"></i>';
        }).join("");
      }
    }

    // 在测品卡
    const blkTest = blkByTitle(this.root.querySelector("#p-today"), "在测品");
    if (blkTest) {
      const a = testing[0];
      if (a) {
        setText(blkTest.querySelector(".pname"), A.val(a, "品名"));
        const warn = A.val(a, "止损预警");
        const pill = blkTest.querySelector(".pill");
        if (pill) {
          pill.className = this.warnIsAlert(warn) ? "pill wr" : "pill";
          pill.innerHTML = "<i></i>" + esc(this.warnPill(warn));
        }
        const kv = blkTest.querySelector(".kv");
        if (kv) {
          const g = (n) => { const v = num(A.val(a, n)); return v == null ? UNFILLED : fmtInt(v); };
          kv.innerHTML =
            "累计笔记 " + g("累计发笔记数") + " · 订单 " + g("累计订单数") + " · 加购 " + g("最新累计加购") + "<br>" +
            "对标到手价 " + (fmt2(A.val(a, "对标到手价")) || UNFILLED) + " · 单件利润 " + (fmt2(A.val(a, "单件利润(元)")) || UNFILLED);
        }
      } else {
        setText(blkTest.querySelector(".pname"), "尚无在测品");
        const kv = blkTest.querySelector(".kv");
        if (kv) kv.textContent = "测品档案里没有「分区＝正在测」的记录";
      }
    }

    // 今晚回填
    const blkBack = blkByTitle(this.root.querySelector("#p-today"), "今晚回填");
    if (blkBack) {
      const rows = blkBack.querySelectorAll(".row");
      const setRow = (i, txt, state) => {
        const r = rows[i];
        if (!r) return;
        setText(r.querySelector(".tt"), txt);
        const p = r.querySelector(".pill");
        if (p) {
          p.className = state === "done" ? "pill ok" : "pill";
          p.innerHTML = "<i></i>" + (state === "done" ? "已填" : state === "write" ? "待写" : "待填");
        }
      };
      setRow(0, "笔记卡 YAML · " + draft.length + " 条", "todo");
      setRow(1, "我的每日数据 · 今日一行", d.dw.mineToday ? "done" : "todo");
      setRow(2, "每日日志 · 今日一条", d.daily.today ? "done" : "write");
    }

    // 待发布（前 3 条草稿）
    const blkPub = blkByTitle(this.root.querySelector("#p-today"), "待发布");
    if (blkPub) {
      const pill = blkPub.querySelector(".bh .pill.acc");
      if (pill) pill.innerHTML = "<i></i>草稿 " + draft.length;
      const r = blkPub.querySelector(".bh .r");
      if (r) r.textContent = "显示 " + Math.min(3, draft.length) + " 条 · 全部在创作台";
      const tb = blkPub.querySelector("tbody");
      if (tb) {
        const rows = draft.slice(0, 3);
        tb.innerHTML = rows.length
          ? rows.map((c) => '<tr>' +
              '<td class="tcell"><div class="t-title">' + esc(c.title || c.name) + '</div><div class="t-sub">' +
                esc(unlink(c.fm["归属模板"]) || "未挂模板") + " · " + esc(c.fm["本品"] || "未标品名") + " · 正文 " + c.chars + ' 字</div></td>' +
              '<td class="mut">' + esc(shortTpl(c.fm["归属模板"]) || DASH) + '</td>' +
              '<td class="r dash num">' + DASH + '</td><td class="r dash num">' + DASH + '</td>' +
              '<td class="cc"><span class="pill"><i></i>' + esc(c.fm["状态"] || UNFILLED) + '</span></td>' +
              '<td class="r"><button class="btn" data-open-note="' + esc(c.path) + '" style="padding:5px 12px">打开</button></td></tr>').join("")
          : '<tr><td colspan="6" class="mut">20-文案库 里没有「状态＝草稿」的笔记卡</td></tr>';
      }
    }

    // 尾部：待整理 = 待拆解真实计数；知识 / 工具本批未接 → 显式「—」
    const tail = this.root.querySelector("#p-today .tail");
    if (tail) tail.innerHTML = "待整理 " + d.todo + " · 知识 " + DASH + "（未接）· 工具 " + DASH + "（未接） &nbsp;→&nbsp; 知识库";
  }

  /* ───── 创作台 ───── */
  renderOutput(d) {
    const page = this.root.querySelector("#p-output");
    if (!page) return;
    const draft = d.cards.filter((c) => String(c.fm["状态"] || "") === "草稿");
    const pill = page.querySelector(".phead .pill.acc");
    if (pill) pill.innerHTML = "<i></i>草稿 " + draft.length;

    const blk = blkByTitle(page, "笔记卡列表");
    if (blk) {
      const p = blk.querySelector(".bh .pill.acc");
      if (p) p.innerHTML = "<i></i>共 " + d.cards.length + " 张";
      const tb = blk.querySelector("tbody");
      if (tb) {
        const sorted = d.cards.slice().sort((a, b) => String(b.fm["发布日期"] || "").localeCompare(String(a.fm["发布日期"] || "")));
        tb.innerHTML = sorted.length
          ? sorted.map((c) => {
              const g = (k) => (String(c.fm[k] || "").trim() === "" ? '<td class="r dash num">' + DASH + "</td>" : '<td class="r num">' + esc(c.fm[k]) + "</td>");
              return "<tr>" +
                '<td class="tcell"><div class="t-title">' + esc(c.title || c.name) + '</div><div class="t-sub">' +
                  esc(c.fm["本品"] || "未标品名") + " · 正文 " + c.chars + " 字</div></td>" +
                '<td class="mut">' + esc(shortTpl(c.fm["归属模板"]) || DASH) + "</td>" +
                g("曝光量") + g("阅读量") + g("点赞") + g("收藏") + g("评论") +
                '<td><span class="pill"><i></i>' + esc(c.fm["状态"] || UNFILLED) + "</span></td>" +
                '<td class="r"><button class="btn" data-open-note="' + esc(c.path) + '" style="padding:5px 12px">打开</button></td></tr>';
            }).join("")
          : '<tr><td colspan="9" class="mut">20-文案库 里还没有 type: note 的笔记卡</td></tr>';
      }
      this.applyStatusFilter(); // B3.6：重渲染后保持当前状态筛选
    }

    const blkTpl = blkByTitle(page, "模板库 · 战绩");
    if (blkTpl) {
      const r = blkTpl.querySelector(".bh .r");
      if (r) r.textContent = d.templates.length + " 张";
      const tb = blkTpl.querySelector("tbody");
      if (tb) {
        tb.innerHTML = d.templates.length
          ? d.templates.map((t) => "<tr>" +
              '<td class="tcell"><div class="t-title">' + esc(shortTpl(t.name) || unlink(t.fm["模板名"]) || t.name) + "</div></td>" +
              '<td class="mut">' + esc(t.fm["结构类型"] || UNFILLED) + "</td>" +
              '<td class="mut">' + esc(t.fm["来源"] || UNFILLED) + "</td>" +
              '<td class="r mut num">' + esc(t.fm["已测次数"] || "0") + "</td></tr>").join("")
          : '<tr><td colspan="4" class="mut">模板卡目录里没有卡片</td></tr>';
      }
    }

    this.populateRequestSheet(d); // B3：请求单三个下拉接真数据（每挂载一次）
  }

  /* ───── 创作台接线（B3）：爆款投喂 · 生成请求单 · 改状态 · 去拆解 ───── */

  /** 选题库解析：`## 组名` = 分组；表格行 `| # | 人群 | 场景 | 痛点切入 | 建议模板 | 状态 |` = 选项。
      状态=淘汰 的不进下拉。文件不存在（该品还没有选题库）→ 返回 null。 */
  parseTopicPool(品名) {
    if (!品名) return null;
    let txt;
    try {
      const base = this.app.vault.adapter.getBasePath();
      txt = fs.readFileSync(path.join(base, P.wencang, "选题库-" + 品名 + ".md"), "utf8");
    } catch (e) { return null; }
    const groups = [];
    let cur = null;
    txt.split(/\r?\n/).forEach((line) => {
      const h = line.match(/^##\s+(.+)$/);
      if (h) { cur = { title: h[1].trim(), options: [] }; groups.push(cur); return; }
      if (!cur || !/^\|/.test(line)) return;
      const body = line.split("|").map((s) => s.trim()).filter((s) => s !== "");
      if (body.length < 4) return;
      if (body[0] === "#" || body.every((s) => /^-+$/.test(s))) return; // 表头 / 分隔行
      if (/淘汰/.test(body[5] || "")) return;
      cur.options.push({ label: body[0] + " " + body[1] + (body[3] ? " · " + body[3] : ""), num: body[0], who: body[1], scene: body[2] || "", pain: body[3] || "" });
    });
    return groups.filter((g) => g.options.length);
  }

  /** 请求单的三个下拉接真数据（品 = 测品档案品名；模板 = 模板卡按结构类型分组；选题 = 选题库-<品>）。
      每次挂载只填一次 —— 之后 reloadData 不重置，保住你在请求单里填到一半的内容。 */
  populateRequestSheet(d) {
    if (this._reqBound) return;
    const page = this.root.querySelector("#p-output");
    const req = page && blkByTitle(page, "生成请求单");
    if (!req) return;
    this._reqBound = true;
    const sels = req.querySelectorAll(".frow select.sel");
    const selPin = sels[0], selTpl = sels[1], selTopic = sels[2];
    const pins = this.plugin.archiveNames();
    if (selPin && pins.length) {
      selPin.innerHTML = pins.map((p) => '<option value="' + esc(p) + '">' + esc(p) + "</option>").join("");
      // 默认选中「有选题库」的那个品（没有才落回第一个）
      const withPool = pins.find((p) => this.parseTopicPool(p));
      if (withPool) selPin.value = withPool;
      selPin.addEventListener("change", () => { this.fillTopicOptions(selPin.value); this.draftBrief(false); });
    }
    if (selTpl) {
      const byType = {};
      (d.templates || []).forEach((t) => {
        const k = String(t.fm["结构类型"] || "未分类");
        (byType[k] = byType[k] || []).push(t);
      });
      selTpl.innerHTML = Object.keys(byType).map((k) =>
        '<optgroup label="' + esc(k) + '">' +
        byType[k].map((t) => '<option value="' + esc(t.name) + '">' + esc(shortTpl(t.name) || t.name) + "</option>").join("") +
        "</optgroup>").join("");
      selTpl.addEventListener("change", () => this.draftBrief(false));
    }
    if (selTopic && selPin) {
      this.fillTopicOptions(selPin.value);
      selTopic.addEventListener("change", () => this.draftBrief(false));
    }
    // B3.2：初始就按「默认品 × 模板 × 选题」起草 5 条简述（替掉原型里的静态演示文案，静默）
    this.draftBrief(true);
    const feedIpt = page.querySelector(".blk.bar input.ipt");
    if (feedIpt) feedIpt.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.doFeed(); } });
  }

  /** 按「选题行 × 模板卡 × 合规底线」起草 5 条简述（B3.2 老哥定的交互：随选联动，换就整体重起草）。
      原料：选题库行（who/scene/pain）+ 模板名（定结构口径）+ 文案生成准则的合规底线（第③条固定）。
      覆盖策略（老哥选）：换任一项就整体重起草 —— 旧选题的简述对新选题没有意义，不留混拼。 */
  draftBrief(quiet) {
    const page = this.root.querySelector("#p-output");
    const req = page && blkByTitle(page, "生成请求单");
    if (!req) return;
    const sels = req.querySelectorAll(".frow select.sel");
    const ta = req.querySelector("textarea.ta");
    if (!ta || sels.length < 3) return;
    const selTpl = sels[1], selTopic = sels[2];
    let row = null;
    try { row = JSON.parse(selTopic.value); } catch (e) { row = null; }
    const tplName = String(selTpl.value || "");
    const tpl = ((this.data && this.data.templates) || []).find((t) => t.name === tplName);
    const tplLabel = tpl ? (tpl.fm["模板名"] || shortTpl(tpl.name) || tplName) : tplName;
    const who = row && row.who ? row.who : "【谁】";
    const scene = row && row.scene ? row.scene : "【什么场景】";
    const pain = row && row.pain ? row.pain : "【什么痛点】";
    const isTime = /时间线/.test(tplLabel);
    const isBefore = /前后|改造/.test(tplLabel);
    const isList = /清单/.test(tplLabel);
    const isPain = /痛点/.test(tplLabel);
    let only, value, cta;
    if (isTime) {
      only = "只讲「" + pain + "的那一晚，我把睡前那件事换掉之后发生了什么」（按时间顺序记，不夹产品介绍）";
      value = "为什么用时间线记，而不是功能介绍";
      cta = "你睡前最后一件事是什么？";
    } else if (isBefore) {
      only = "只讲「" + pain + "——用之前 vs 用之后」，前后按同一个标准记";
      value = "为什么用前后对比，而不是空口说好";
      cta = "你猜差别在哪？评论区说说";
    } else if (isList) {
      only = "只讲「" + pain + "，能照抄的几步」（每步一个动作）";
      value = "为什么给可抄的清单，而不是泛泛建议";
      cta = "这几步里你已经在做哪一步？";
    } else if (isPain) {
      only = "只讲「" + pain + " → 我的一个做法」";
      value = "为什么只给一个做法，而不是面面俱到";
      cta = "你会先试哪一步？";
    } else {
      only = "只讲「" + pain + "」这一件事";
      value = "这个结构为什么对这件事有用";
      cta = "你也有这种情况吗？评论区说说";
    }
    ta.value = [
      "- 写给谁看：" + who + "——" + scene + "、" + pain,
      "- 这条只做什么：" + only,
      "- 这条不展开什么：不科普成分、不提价格、不劝人买、不写医疗功效词（合规底线见 文案生成准则）",
      "- 观众要听懂：" + value,
      "- 结尾互动：" + cta,
    ].join("\n");
    if (!quiet) this.toast("已按「选题 × 模板」重起草 5 条简述（可改）");
  }

  fillTopicOptions(品名) {
    const page = this.root.querySelector("#p-output");
    const req = page && blkByTitle(page, "生成请求单");
    if (!req) return;
    const selTopic = req.querySelectorAll(".frow select.sel")[2];
    if (!selTopic) return;
    const groups = this.parseTopicPool(品名);
    if (!groups || !groups.length) {
      selTopic.innerHTML = '<option value="">（该品还没有选题库：' + esc(品名 || "—") + "）</option>";
      return;
    }
    selTopic.innerHTML = groups.map((g) =>
      '<optgroup label="' + esc(g.title) + '">' +
      g.options.map((o) => '<option value="' + esc(JSON.stringify(o)) + '">' + esc(o.label) + "</option>").join("") +
      "</optgroup>").join("");
  }

  /** 爆款投喂：粘贴笔记链接 → xhs-importer-pro 抓正文+图片 → 落 20-文案库/待拆解/。
      去重依据（老哥定的）：这篇的笔记链接已经存在于 待拆解/ 某个文件的 frontmatter 里 → 不再导。 */
  async doFeed() {
    const page = this.root.querySelector("#p-output");
    const ipt = page ? page.querySelector(".blk.bar input.ipt") : null;
    const raw = ipt ? String(ipt.value || "").trim() : "";
    if (!raw) { this.toast("先粘一条小红书笔记链接（整段分享文案也行）"); return; }
    const urls = raw.match(/https?:\/\/[^\s，,、；;）)】\]]+/g) || [];
    const url = urls.find((u) => /xiaohongshu\.com|xhslink/i.test(u));
    if (!url) { new Notice("没在粘贴内容里找到小红书链接（xhslink / xiaohongshu.com）", 9000); return; }
    const importer = this.app.plugins.getPlugin("xhs-importer-pro");
    if (!importer || typeof importer.importXHSNote !== "function") { new Notice("没装 / 没启用「XHS Importer Pro」插件 → 爆款投喂不可用", 9000); return; }
    const dup = await this.findFeedDup(url);
    if (dup) { new Notice("这篇已经投喂过 → " + dup, 10000); return; }
    this.toast("投喂中…（抓正文 + 下载图片，可能十几秒）");
    let r;
    try { r = await importer.importXHSNote(url, true, {}); }
    catch (e) { new Notice("投喂失败：" + (e && e.message ? e.message : e), 12000); return; }
    if (r && r.ok) {
      new Notice("已投喂 ✓ → " + r.path, 12000);
      if (ipt) ipt.value = "";
      await this.reloadData();
    } else if (r && r.skipped) {
      new Notice("这篇已经导入过（去重）→ " + (r.title || ""), 9000);
    } else {
      new Notice("投喂失败：" + ((r && r.error) || "未知"), 12000);
    }
  }

  async findFeedDup(url) {
    const folder = this.app.vault.getAbstractFileByPath(P.todoDir);
    if (!folder || !folder.children) return null;
    const needle = url.replace(/\/+$/, "");
    for (const f of folder.children) {
      if (f.extension !== "md") continue;
      try {
        const head = (await this.app.vault.cachedRead(f)).slice(0, 1500);
        if (head.indexOf(needle) >= 0) return f.path;
      } catch (e) { /* 读不了的就跳过 */ }
    }
    return null;
  }

  /** 生成请求单：校验 5 条 → 组装任务单 → 落盘 + 复制提示词（提示词 = 一段导语 + 任务单全文，含 §六 结构约束） */
  async doRequestSheet() {
    const page = this.root.querySelector("#p-output");
    const req = page && blkByTitle(page, "生成请求单");
    if (!req) return;
    const sels = req.querySelectorAll(".frow select.sel");
    const 品 = sels[0] ? sels[0].value : "";
    const tplName = sels[1] ? sels[1].value : "";
    const cntIpt = req.querySelector(".frow input.ipt");
    const 条数 = Math.max(1, parseInt(cntIpt && cntIpt.value, 10) || 3);
    const ta = req.querySelector("textarea.ta");
    const brief = (ta ? ta.value : "").trim();
    if (!品) { new Notice("先选「品」"); return; }
    if (!tplName) { new Notice("先选「模板」"); return; }
    let 选题 = null;
    try { 选题 = JSON.parse(sels[2] ? sels[2].value : "null"); } catch (e) { 选题 = null; }
    const need = ["写给谁看", "这条只做什么", "这条不展开什么", "观众要听懂", "结尾互动"];
    const missing = need.filter((k) => !new RegExp("-\\s*" + k + "：\\s*\\S").test(brief));
    if (missing.length) { new Notice("这 5 条还没填完（缺：" + missing.join("、") + "）—— 填完才可复制", 10000); return; }

    const t = todayDate();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate());
    const ymd2 = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
    const prefix = "任务单-" + 品 + "-" + ymd + "-";
    let nn = 1;
    try {
      const tf = this.app.vault.getAbstractFileByPath(P.taskDir);
      if (tf && tf.children) nn = tf.children.filter((f) => f.name.indexOf(prefix) === 0).length + 1;
    } catch (e) { /* 目录还没有 → 01 */ }
    const fname = prefix + pad(nn) + ".md";
    const taskPath = P.taskDir + "/" + fname;
    const tplLink = "[[" + tplName + "]]";
    const selRow = 选题 ? (选题.num + " " + 选题.who + (选题.scene ? " · " + 选题.scene : "") + (选题.pain ? " · " + 选题.pain : "")) : "（未抽）";

    // §六 结构约束直接从任务单模板里取 —— 模板改了约束跟着变，不在代码里存第二份
    let six = "（读不到任务单模板的 §六 —— 请照 `_模板-任务单.md` §六 的结构约束产出）";
    try {
      const base = this.app.vault.adapter.getBasePath();
      const tplTxt = fs.readFileSync(path.join(base, P.taskDir, "_模板-任务单.md"), "utf8");
      const i = tplTxt.indexOf("## 六、");
      if (i >= 0) six = tplTxt.slice(i).trim();
    } catch (e) { /* 用兜底文案 */ }

    const content = [
      "---",
      "创建日期: " + ymd2,
      "本品: " + 品,
      "归属模板: " + tplLink,
      "条数: " + 条数,
      "状态: 待生成",
      "---",
      "",
      "# 任务单 · " + 品 + " · " + ymd2,
      "",
      "## 一、生成参数",
      "",
      "| 项 | 值 |",
      "|---|---|",
      "| 品 | " + 品 + " |",
      "| 模板 | " + tplLink + " |",
      "| 条数 | " + 条数 + " |",
      "| 选题 | " + selRow + " |",
      "",
      "## 二、简述与参考（5 条 —— **AI 起草，老哥只审改**）",
      "",
      brief,
      "",
      "## 三、依据文件（生成时必读）",
      "",
      "- [[选题库-" + 品 + "]]",
      "- " + tplLink,
      "- [[文案生成准则]]",
      "- [[受众地图-睡眠赛道-20260924]]",
      "- IMA 两库：《小红书带货分享》逐字稿 +《核心观点提炼版》",
      "- ⚠️ 合规：见 [[选题库-" + 品 + "]] 尾部的「合规提醒」—— **只写状态词，不写症状词**",
      "",
      "## 四、本次选题（从该品选题库抽）",
      "",
      "| # | 人群 | 场景 | 痛点切入 |",
      "|---|---|---|---|",
      选题 ? ("| " + [选题.num, 选题.who, 选题.scene, 选题.pain].map((s) => s || "—").join(" | ") + " |") : "|  |  |  |  |",
      "",
      "## 五、输出（生成后回填）",
      "",
      "| # | 笔记卡 | 状态 |",
      "|---|---|---|",
      "|  |  |  |",
      "",
      six,
      "",
    ].join("\n") + "\n";

    try { await this.app.vault.create(taskPath, content); }
    catch (e) { new Notice("任务单落盘失败：" + (e && e.message ? e.message : e), 12000); return; }

    const prompt = "请严格按下面这份任务单生成笔记卡：\n" +
      "· 条数严格 = " + 条数 + "，不多不少；\n" +
      "· 每篇 = 一个笔记卡文件，写进 `10-小红书带货/20-文案库/`（命名照任务单 §六④，序号接着现有最大号往后排）；\n" +
      "· 生成完把文件名回填进任务单的「五、输出」（任务单：" + taskPath + "）。\n" +
      "\n—————— 任务单全文 ——————\n\n" + content;
    try { await navigator.clipboard.writeText(prompt); }
    catch (e) {
      new Notice("任务单已落盘但复制失败 → 已帮你打开任务单，手动全选复制即可", 12000);
      this.app.workspace.openLinkText(taskPath, "", false);
      return;
    }
    new Notice("已复制提示词 ✓ 任务单已落盘 → " + fname, 12000);
    const r2 = req.querySelector(".bh .r");
    if (r2) r2.textContent = "已复制 ✓ 已落盘 " + fname;
  }

  /** 笔记卡弹窗里的状态分段：真写 frontmatter 的 状态 字段（不挪文件位置） */
  async setNoteStatus(p, value) {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (!f) { this.toast("找不到笔记卡：" + p); return; }
    try {
      let txt = await this.app.vault.read(f);
      if (/^状态:.*$/m.test(txt)) txt = txt.replace(/^状态:.*$/m, "状态: " + value);
      else txt = txt.replace(/^---\n/, "---\n状态: " + value + "\n");
      await this.app.vault.modify(f, txt);
      this.toast("状态 → " + value + " ✓（已写入 frontmatter）");
      await this.reloadData();
    } catch (e) { new Notice("改状态失败：" + (e && e.message ? e.message : e), 10000); }
  }

  /** 「全部模板卡 ›」（B3.4 + B3.5c 老哥定稿的弹窗归属）：
      弹窗属于工作台 —— 活动页签是工作台时可见；跳到源文件时画面正常跳转、弹窗只是暂时看不见；
      切回工作台弹窗还在（展开状态保留）。可见性由 active-leaf-change 驱动，DOM 不销毁。 */
  async showAllTemplates() {
    const tpls = (this.data && this.data.templates) || [];
    if (!tpls.length) { new Notice("模板卡目录是空的（20-文案库/模板卡/）"); return; }
    if (this._tplOpening) return;   // 防并发：快速切页签时别开出两个弹窗（多出来的那个会变残留 scope）
    this._tplOpening = true;
    const m = new Modal(this.app);
    m.titleEl.setText("模板库 · 全部 " + tpls.length + " 张");
    const tplTip = m.contentEl.createEl("p", { cls: "mod-muted" });
    tplTip.createEl("div", { text: "点一张卡展开详情；「打开源文件」看全文。" });
    tplTip.createEl("div", { text: "换品时模板卡一格不动 —— 瓶颈是素材。" });
    for (const t of tpls) {
      const fm = t.fm || {};
      const det = m.contentEl.createEl("details", { cls: "wb-tpl" });
      det.open = !!(this._tplExpanded && this._tplExpanded[t.path]);
      det.addEventListener("toggle", () => { (this._tplExpanded = this._tplExpanded || {})[t.path] = det.open; });
      const sum = det.createEl("summary");
      sum.createSpan({ cls: "wb-tpl-name", text: shortTpl(t.name) || t.name });
      sum.createSpan({
        cls: "wb-tpl-meta",
        text: (fm["结构类型"] || "?") + " · " + (fm["来源"] || "?") + " ｜ 已测 " + (fm["已测次数"] || 0) + " · 出单 " + (fm["累计出单"] || 0) + (fm["最佳点击率"] ? " · 最佳点击率 " + fm["最佳点击率"] : ""),
      });
      const body = det.createDiv({ cls: "wb-tpl-body" });
      let txt = "";
      try { txt = await this.app.vault.read(this.app.vault.getAbstractFileByPath(t.path)); } catch (e) { /* 读不了就只显示 frontmatter */ }
      const section = (title) => {
        if (!txt) return "";
        const i = txt.indexOf("## " + title);
        if (i < 0) return "";
        const rest = txt.slice(i + title.length + 3);
        const j = rest.indexOf("\n## ");
        return rest.slice(0, j < 0 ? 420 : Math.min(j, 420)).trim();
      };
      const tbl = body.createEl("table", { cls: "wb-ctb" });
      [
        ["钩子类型 / 封面拍法", (fm["钩子类型"] || "—") + " · " + (fm["封面拍法"] || "—")],
        ["图位用途", fm["图位用途"] || "—"],
        ["来源账号 / 素材", (fm["来源账号"] || "—") + (fm["素材路径"] ? " · " + fm["素材路径"] : "")],
        ["状态", fm["状态"] || "—"],
      ].forEach(([k, v]) => {
        const tr = tbl.createEl("tr");
        tr.createEl("td", { text: k, cls: "k" });
        tr.createEl("td", { text: String(v) });
      });
      const sk = section("标题骨架");
      if (sk) body.createEl("div", { cls: "wb-tpl-sec", text: "【标题骨架】\n" + sk });
      const slot = section("可变槽位");
      if (slot) body.createEl("div", { cls: "wb-tpl-sec", text: "【可变槽位】\n" + slot });
      const bar = body.createDiv({ cls: "wb-cbar" });
      // B3.5c：画面正常跳转到源文件；弹窗不关 —— 可见性交给下面的 active-leaf-change
      bar.createEl("button", { text: "打开源文件" }).onclick = () => { this.app.workspace.openLinkText(t.path, "", false); };
    }
    // 弹窗可见性跟随工作台页签（B3.5c 老哥定稿：隐藏≠关闭、DOM 与展开状态保留）。
    // 🔴 2026-09-30 修：**不能只 display:none** —— 未关闭的 Obsidian Modal 会把 keymap scope
    //    一直挂在栈上，它的焦点容器（tabFocusContainerEl）会吃掉「工作台之外」的一切焦点
    //    → 全 Obsidian 的输入框都打不了字/粘不进（老哥报的「选品池采集框点不动」就是它）。
    //    所以离开工作台时**真正 close()**，回到工作台时按 `_tplExpanded` 记的展开状态重建
    //    —— 用户看到的效果不变（切回还在、展开也还在），但 scope 不再残留。
    this._tplModal = m;
    this._tplWant = true;
    this._tplExpanded = this._tplExpanded || {};
    m.onClose = () => {
      this._tplOpening = false;
      if (this._tplModal !== m) return;
      this._tplModal = null;
      if (!this._tplLeaving) this._tplWant = false;   // 用户自己关的 → 不再自动重开
      this._tplLeaving = false;
    };
    if (!this._tplLeafBound) {
      this._tplLeafBound = true;
      this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
        this.sweepStaleModalScopes();
        const a = leaf || (this.app.workspace.getActiveLeaf ? this.app.workspace.getActiveLeaf() : null);
        const isMine = !!(a && a.view && a.view.getViewType() === VIEW_TYPE);
        if (isMine) { if (this._tplWant && !this._tplModal) this.showAllTemplates(); }
        else if (this._tplModal) { this._tplLeaving = true; this._tplModal.close(); }
      }));
    }
    m.open();
    this._tplOpening = false;
  }

  /** 安全网（2026-09-30）：清掉「已从 DOM 摘除、却仍挂在 keymap 栈上」的 Modal scope。
      这种残留 scope 会吃掉**全 Obsidian** 的输入焦点（机制见 showAllTemplates 里的注释）。
      只在「焦点容器已断开连接（!isConnected）」时才动手 —— 正常开着的弹窗不受影响，
      只回收名副其实的垃圾。切换页签时顺带跑一次。 */
  sweepStaleModalScopes() {
    try {
      const km = this.app.keymap;
      if (!km || typeof km.getWindowStack !== "function") return;
      const st = km.getWindowStack(window);
      if (!st || !Array.isArray(st.prevScopes)) return;
      const stale = (s) => {
        const tf = s && s.tabFocusContainerEl;
        return !!(tf && tf.nodeType === 1 && !tf.isConnected);
      };
      for (let i = st.prevScopes.length - 1; i >= 0; i--) if (stale(st.prevScopes[i])) st.prevScopes.splice(i, 1);
      let guard = 0;
      while (stale(st.scope) && guard++ < 10) {
        if (st.prevScopes.length) st.scope = st.prevScopes.pop();
        else break;
      }
    } catch { /* Obsidian 内部结构变了就安静跳过，不影响正常使用 */ }
  }

  /** 笔记卡列表 · 状态筛选（B3.6 老哥反馈）：按行内状态 pill 过滤；「全部」全显；
      刷新（reloadData 重渲染）后保持当前筛选；无该状态卡片时显示空态提示行。 */
  applyStatusFilter() {
    const page = this.root.querySelector("#p-output");
    const blk = page && blkByTitle(page, "笔记卡列表");
    if (!blk) return;
    const tb = blk.querySelector("tbody");
    if (!tb) return;
    const f = this._statusFilter || "全部";
    let visible = 0;
    const rows = Array.from(tb.rows);
    rows.forEach((tr) => {
      const pill = tr.querySelector(".pill");
      if (!pill) { tr.style.display = ""; return; } // 总空态行（无状态）始终显示
      const show = f === "全部" || pill.textContent.trim() === f;
      tr.style.display = show ? "" : "none";
      if (show) visible++;
    });
    // 总空态行 = 没有 .pill 的行（renderOutput 的 colspan 空态；注意 .mut 类被"归属模板"列复用，不能拿类名判断）
    const hasRealEmpty = rows.some((tr) => !tr.querySelector(".pill") && !tr.hasAttribute("data-empty-filter"));
    let tip = tb.querySelector("tr[data-empty-filter]");
    if (!visible && !hasRealEmpty && !tip) {
      tip = tb.insertRow();
      tip.setAttribute("data-empty-filter", "1");
      tip.innerHTML = '<td colspan="9" class="mut">状态＝' + esc(f) + " 的笔记卡还没有</td>";
    } else if (tip && (visible || hasRealEmpty)) {
      tip.remove();
    } else if (tip && !visible) {
      tip.querySelector("td").textContent = "状态＝" + esc(f) + " 的笔记卡还没有"; // 空态 → 空态：文案跟着换
    }
  }

  /* ══════════ B4 · 回填台（PRD §4.6：跨三处的唯一写入点；流程 1 步 6-8） ══════════ */

  /** 待回填卡 = 已发布 且 发布日期非空 且 发布 ≥1 天（T+1 起，含逾期未填的）；标注「发布第 N 天」 */
  backfillDueCards() {
    const today = new Date(todayLocal());
    return (this.data.cards || [])
      .filter((c) => c.fm["状态"] === "已发布" && /^\d{4}-\d{2}-\d{2}$/.test(String(c.fm["发布日期"] || "")))
      .map((c) => {
        const pub = new Date(c.fm["发布日期"]);
        const n = Math.round((today - pub) / 86400000);
        return Object.assign({}, c, { tDay: n, due: [1, 3, 7].indexOf(n) >= 0 });
      })
      .filter((c) => c.tDay >= 1)
      .sort((a, b) => b.tDay - a.tDay);
  }

  /** 「开始回填」→ 合并表单（一次抄完三处 a/b/c，PRD §4.6）。提交后先出归集确认卡，点头才写。 */
  openBackfillModal() {
    const due = this.backfillDueCards();
    const testing = ((this.data.dw || {}).archive || { records: [] });
    const B = {};
    const m = new Modal(this.app);
    m.titleEl.setText("22:00 回填台（一次抄完三处）");
    const c = m.contentEl;
    const bfTip = c.createEl("p", { cls: "mod-muted" });
    bfTip.createEl("div", { text: "会写三处：" });
    bfTip.createEl("div", { text: "① 笔记卡 —— YAML 9 指标 + 漏斗诊断" });
    bfTip.createEl("div", { text: "② duowei「我的每日数据」—— 今天那行" });
    bfTip.createEl("div", { text: "③ 每日日志 —— 快照 + backfilled" });
    bfTip.createEl("div", { text: "提交后出确认卡，点头才写。" });

    // ── a 笔记卡 ──
    c.createEl("h4", { text: "① 笔记卡（已发布 · T+1 起，含逾期未填）" });
    if (!due.length) {
      c.createEl("p", { cls: "mod-muted", text: "没有已发布的笔记卡 —— 先在弹窗里把卡改成「已发布 + 发布日期」，第二天起这里就能回填。" });
    }
    const cardForms = [];
    due.forEach((cd) => {
      const det = c.createEl("details", { cls: "wb-tpl" });
      det.open = true;
      const sum = det.createEl("summary");
      const cb = sum.createEl("input"); cb.type = "checkbox"; cb.checked = true; cb.className = "wb-bf-check";
      sum.createSpan({ cls: "wb-tpl-name", text: cd.title || cd.name });
      sum.createSpan({ cls: "wb-tpl-meta", text: "发布 " + cd.fm["发布日期"] + " · 第 " + cd.tDay + " 天" + (cd.due ? " · 今日到期" : " · 逾期未填") + " · " + (unlink(cd.fm["归属模板"]) || "无模板") });
      const body = det.createDiv({ cls: "wb-tpl-body" });
      const grid = body.createDiv({ cls: "wb-bf-grid" });
      const METRICS = ["曝光量", "阅读量", "点赞", "收藏", "评论", "转发", "商品点击", "订单", "GMV"];
      const inputs = {};
      METRICS.forEach((k) => {
        const cell = grid.createDiv({ cls: "wb-bf-cell" });
        cell.createSpan({ cls: "wb-bf-k", text: k });
        const i = cell.createEl("input"); i.type = "number"; i.min = "0"; i.placeholder = "—";
        inputs[k] = i;
      });
      const ctr = grid.createDiv({ cls: "wb-bf-cell" });
      ctr.createSpan({ cls: "wb-bf-k", text: "点击率（自动）" });
      const ctrSpan = ctr.createSpan({ cls: "wb-bf-ctr", text: "—" });
      const recalc = () => {
        const ex = parseFloat(inputs["曝光量"].value), rd = parseFloat(inputs["阅读量"].value);
        ctrSpan.textContent = ex > 0 && !isNaN(rd) ? ((rd / ex) * 100).toFixed(2) + "%" : "—";
      };
      inputs["曝光量"].addEventListener("input", recalc);
      inputs["阅读量"].addEventListener("input", recalc);
      // 漏斗诊断（48h 填）：5 行 × 数据 / 高中低 / 原因
      body.createEl("div", { cls: "wb-bf-sec", text: "漏斗诊断（48h 填，定位卡在哪一层）" });
      const FUNNEL = ["曝光", "阅读（点击率）", "互动（赞藏评转）", "商品点击", "订单"];
      const CAUSE = ["平台给没给量 → 选题 / 标签 / 账号权重", "封面 + 标题", "正文内容与共鸣", "挂车位置 / 价格锚点", "详情页 / 评价 / 评论区维护"];
      const ftbl = body.createEl("table", { cls: "wb-ctb" });
      const frows = FUNNEL.map((name, idx) => {
        const tr = ftbl.createEl("tr");
        tr.createEl("td", { text: name, cls: "k" });
        const tdData = tr.createEl("td");
        const iData = tdData.createEl("input"); iData.type = "text"; iData.placeholder = "数据"; iData.style.width = "88px";
        const tdLv = tr.createEl("td");
        const iLv = tdLv.createEl("select");
        ["", "高", "中", "低"].forEach((o) => iLv.createEl("option", { text: o || "—" }));
        const tdWhy = tr.createEl("td");
        const iWhy = tdWhy.createEl("input"); iWhy.type = "text"; iWhy.value = CAUSE[idx]; iWhy.style.width = "150px";
        return { name, iData, iLv, iWhy };
      });
      cardForms.push({ card: cd, check: cb, inputs, frows });
    });

    // ── b 我的每日数据 ──
    c.createEl("h4", { text: "② duowei「我的每日数据」· 今天那行" });
    const pinName = this.backfillPinName();
    const bForm = {};
    const bGrid = c.createDiv({ cls: "wb-bf-grid" });
    const mkNum = (key, label) => {
      const cell = bGrid.createDiv({ cls: "wb-bf-cell" });
      cell.createSpan({ cls: "wb-bf-k", text: label });
      const i = cell.createEl("input"); i.type = "number"; i.placeholder = "—";
      bForm[key] = i;
    };
    const dwM = this.data.dw && this.data.dw.mine;
    // loadDuowei 包装对象没有 fieldByName 方法（那是写库引擎的 API）——fields 本身就按字段名索引
    const optNames = (fieldName) => {
      try {
        const f = dwM.fields ? dwM.fields[fieldName] : null;
        const names = f && f.options ? f.options.map((o) => o.name) : [];
        (dwM.records || []).forEach((r) => { const v = dwM.opt ? dwM.opt(r, fieldName) : null; if (v != null && names.indexOf(v) < 0) names.push(v); });
        return names;
      } catch (e) { return []; }
    };
    const mkSel = (key, label, names) => {
      const cell = bGrid.createDiv({ cls: "wb-bf-cell" });
      cell.createSpan({ cls: "wb-bf-k", text: label });
      const s = cell.createEl("select");
      s.createEl("option", { text: "—" });
      names.forEach((n) => s.createEl("option", { text: n }));
      bForm[key] = s;
    };
    mkSel("账号", "账号", optNames("账号"));
    mkNum("累计加购", "累计加购");
    mkNum("今日笔记数", "今日笔记数");
    mkNum("出单笔记数", "出单笔记数");
    mkNum("有阅读笔记数", "有阅读笔记数");
    mkNum("昨日订单数", "昨日订单数");
    mkNum("新竞争者", "新竞争者");
    (function () {
      const cell = bGrid.createDiv({ cls: "wb-bf-cell", cls: "wb-bf-cell wb-bf-wide" });
      cell.createSpan({ cls: "wb-bf-k", text: "判断与明日动作" });
      const i = cell.createEl("input"); i.type = "text"; i.placeholder = "如：继续测 T+3，明天再发 2 篇";
      bForm["判断与明日动作"] = i;
    })();
    const bfAuto = c.createEl("p", { cls: "mod-muted" });
    bfAuto.createEl("div", { text: "自动：日期＝今天 · 品＝在测品「" + (pinName || "—") + "」" });
    bfAuto.createEl("div", { text: "不用填：利润（公式自动算）" });

    const bar = c.createDiv({ cls: "wb-cbar" });
    bar.createEl("button", { text: "取消" }).onclick = () => m.close();
    bar.createEl("button", { text: "下一步：确认卡", cls: "mod-cta" }).onclick = () => {
      if (!pinName) { new Notice("没有在测品（测品档案「分区＝正在测」）→ 回填行挂不上 relation，先去选品池把品改成「正在测」", 12000); return; }
      // 收集 → 归集确认卡（流程 1 步 8：点头才写）
      const picked = cardForms.filter((x) => x.check.checked);
      const err = [];
      picked.forEach((x) => {
        const anyVal = Object.keys(x.inputs).some((k) => String(x.inputs[k].value).trim() !== "");
        const anyF = x.frows.some((fr) => String(fr.iData.value).trim() !== "");
        if (!anyVal && !anyF) err.push(x.card.title || x.card.name);
      });
      if (err.length) { new Notice("这些卡勾了但一格没填（要么填，要么取消勾选）：\n" + err.join("、"), 10000); return; }
      this.openBackfillConfirm(m, picked, bForm, pinName);
    };
    m.open();
  }

  backfillPinName() {
    try {
      const A = this.data.dw.archive;
      const rec = (A.records || []).find((r) => A.opt(r, "分区") === "正在测");
      if (!rec) return "";
      const f = A.fields ? A.fields["品名"] : null; // 包装对象的 fields 按字段名索引（非数组）
      return f ? (rec.values[f.id] || "") : "";
    } catch (e) { return ""; }
  }

  /** 归集确认卡（流程 1 步 8）：列出将写入的四处摘要 + 模板卡战绩变化，点头才写。 */
  openBackfillConfirm(formModal, picked, bForm, pinName) {
    const today = todayLocal();
    const summary = [];
    picked.forEach((x) => {
      const vals = {};
      Object.keys(x.inputs).forEach((k) => { if (String(x.inputs[k].value).trim() !== "") vals[k] = x.inputs[k].value; });
      const ex = parseFloat(x.inputs["曝光量"].value), rd = parseFloat(x.inputs["阅读量"].value);
      if (ex > 0 && !isNaN(rd)) vals["点击率"] = ((rd / ex) * 100).toFixed(2) + "%";
      summary.push({ card: x.card, vals, frows: x.frows.filter((fr) => String(fr.iData.value).trim() !== "" || String(fr.iWhy.value).trim() !== (fr.name === "曝光" ? "平台给没给量 → 选题 / 标签 / 账号权重" : fr.name === "阅读（点击率）" ? "封面 + 标题" : fr.name === "互动（赞藏评转）" ? "正文内容与共鸣" : fr.name === "商品点击" ? "挂车位置 / 价格锚点" : "详情页 / 评价 / 评论区维护")) });
    });
    const bVals = {};
    ["账号"].forEach((k) => { if (bForm[k].selectedIndex > 0) bVals[k] = bForm[k].options[bForm[k].selectedIndex].text; });
    ["累计加购", "今日笔记数", "出单笔记数", "有阅读笔记数", "昨日订单数", "新竞争者"].forEach((k) => { if (String(bForm[k].value).trim() !== "") bVals[k] = bForm[k].value; });
    if (String(bForm["判断与明日动作"].value).trim() !== "") bVals["判断与明日动作"] = bForm["判断与明日动作"].value;

    const m = new Modal(this.app);
    m.titleEl.setText("确认写入（点头才写）");
    const c = m.contentEl;
    c.createEl("h4", { text: "① 笔记卡（" + summary.length + " 张）" });
    summary.forEach((s) => {
      c.createEl("div", { text: "· " + (s.card.title || s.card.name) + "：" + Object.keys(s.vals).map((k) => k + " " + s.vals[k]).join(" · ") + (s.frows.length ? " + 漏斗诊断 " + s.frows.length + " 行" : "") });
    });
    if (!summary.length) c.createEl("div", { cls: "mod-muted", text: "（未勾选任何卡）" });
    c.createEl("h4", { text: "② duowei「我的每日数据」" });
    const bfSum = c.createEl("div", { cls: "mod-muted" });
    bfSum.createEl("div", { text: "日期 " + today + " · 品 " + (pinName || "—") });
    if (Object.keys(bVals).length) Object.keys(bVals).forEach((k) => bfSum.createEl("div", { text: k + " " + bVals[k] }));
    else bfSum.createEl("div", { text: "（本次不填业务数字）" });
    c.createEl("h4", { text: "③ 每日日志" });
    c.createEl("div", { text: "今天那篇的「数据快照」追加一行 + backfilled → true（日志不存在则按模板创建）" });
    // 模板卡战绩归集（按 归属模板 聚合本批卡）
    const byTpl = {};
    summary.forEach((s) => {
      const t = unlink(s.card.fm["归属模板"]) || "（无模板）";
      (byTpl[t] = byTpl[t] || []).push(s);
    });
    c.createEl("h4", { text: "④ 模板卡战绩（归集）" });
    const tplPlan = [];
    Object.keys(byTpl).forEach((t) => {
      const cards = byTpl[t];
      const sumOrd = cards.reduce((a, s) => a + (parseFloat(s.vals["订单"]) || 0), 0);
      const bestCtr = cards.reduce((a, s) => Math.max(a, parseFloat(s.vals["点击率"]) || 0), 0);
      const bestEye = cards.reduce((a, s) => Math.max(a, parseFloat(s.vals["曝光量"]) || 0), 0);
      const tpl = (this.data.templates || []).find((t2) => unlink(t2.fm["模板名"]) === t || t2.name === t);
      const cur = tpl ? tpl.fm : {};
      const plan = {
        name: t, path: tpl ? tpl.path : null,
        已测次数: (parseInt(cur["已测次数"], 10) || 0) + "→" + ((parseInt(cur["已测次数"], 10) || 0) + cards.length),
        累计出单: (parseInt(cur["累计出单"], 10) || 0) + "→" + ((parseInt(cur["累计出单"], 10) || 0) + sumOrd),
        最佳小眼睛: bestEye ? ((parseInt(cur["最佳小眼睛"], 10) || 0) + "→" + Math.max(parseInt(cur["最佳小眼睛"], 10) || 0, bestEye)) : null,
        最佳点击率: bestCtr ? ((cur["最佳点击率"] || "—") + "→" + bestCtr.toFixed(2) + "%") : null,
        最近使用: today,
      };
      tplPlan.push(plan);
      c.createEl("div", { text: "· " + t + "：已测次数 " + plan.已测次数 + " · 累计出单 " + plan.累计出单 + (plan.最佳点击率 ? " · 最佳点击率 " + plan.最佳点击率 : "") + (plan.最佳小眼睛 ? " · 最佳小眼睛 " + plan.最佳小眼睛 : "") });
    });

    const bar = c.createDiv({ cls: "wb-cbar" });
    bar.createEl("button", { text: "返回修改" }).onclick = () => { m.close(); };
    bar.createEl("button", { text: "确认写入", cls: "mod-cta" }).onclick = async () => {
      m.close();
      formModal.close();
      try {
        const r = await this.doBackfill(summary, bVals, pinName, tplPlan);
        new Notice(r.ok ? "回填完成 ✓\n" + r.动作.join("\n") : "回填失败：" + r.error, r.ok ? 12000 : 16000);
        if (r.ok) await this.reloadData();
      } catch (e) { new Notice("回填失败：" + (e && e.message ? e.message : e), 16000); }
    };
    m.open();
  }

  /** 执行四处写入（写回三纪律：表开着先拦 → 库外备份 → 写前重读 → 写后回读校验） */
  async doBackfill(summary, bVals, pinName, tplPlan) {
    const P2 = this.plugin || this; // 视图调用时 dw/dwFile/openDuoweiFiles 都在插件上
    const dw = P2.dw;
    if (!dw) return { ok: false, error: "写库引擎（duowei.js）没载入" };
    const fM = P2.dwFile("我的每日数据");
    const fA = P2.dwFile(TABLE_ARCHIVE);
    const today = todayLocal();
    const 动作 = [];

    // ① duowei 表开着先拦（我的每日数据 + 测品档案：relation 双向都要写）
    const open = P2.openDuoweiFiles();
    const conflict = [fM, fA].filter((f) => open.indexOf(path.resolve(f)) >= 0);
    if (conflict.length) return { ok: false, error: "请先关掉这些表的标签页再写：" + conflict.map((f) => path.basename(f)).join("、") };

    // ② 库外备份
    let backups = [];
    try { backups.push(dw.backupTable(fM, BACKUP_ROOT)); backups.push(dw.backupTable(fA, BACKUP_ROOT)); }
    catch (e) { return { ok: false, error: "备份失败，已中止（不动表）：" + (e && e.message ? e.message : String(e)) }; }

    const undoFiles = []; // {path, existed, bakPath}  —— vault 文件回滚用
    try {
      // ③ b：我的每日数据（写前重读）
      const M0 = dw.readTable(fM).obj;
      const A0 = dw.readTable(fA).obj;
      const nowIso = new Date().toISOString();
      const F = (o, n) => { const f = o.fields.find((x) => x.name === n); if (!f) throw new Error("表里没有字段：" + n); return f; };
      const fDate = F(M0, "日期"), fAcc = F(M0, "账号"), fPin = F(M0, "品"), fNew = F(M0, "新竞争者");
      const numKeys = ["累计加购", "今日笔记数", "出单笔记数", "有阅读笔记数", "昨日订单数", "新竞争者"];
      // 一次性迁移：新竞争者原来是「无/有」单选，老哥 09-30 定为填数字 → singleSelect 转 number（表里该列无存量值，无损）
      if (fNew.type === "singleSelect") {
        delete fNew.options;
        fNew.type = "number";
        动作.push("「新竞争者」字段：无/有 单选 → 数字（09-30 定，可填有几个）");
      }
      // 品 relation：找档案里 品名=pinName 的行
      const aNameF = F(A0, "品名");
      const recA = A0.records.find((r) => r.values[aNameF.id] === pinName);
      if (!recA) return { ok: false, error: "测品档案里没有「" + pinName + "」这行，无法挂 relation", 备份: backups };
      const fMine = F(A0, "我的数据");
      const curMine = Array.isArray(recA.values[fMine.id]) ? recA.values[fMine.id] : []; // 写前快照（回读校验用）
      let recM = M0.records.find((r) => r.values[fDate.id] === today && (r.values[fPin.id] || []).indexOf(recA.id) >= 0);
      const isNewM = !recM;
      if (recM) {
        if (bVals["账号"] !== undefined) recM.values[fAcc.id] = dw.ensureOption(fAcc, bVals["账号"]).id;
        numKeys.forEach((k) => { if (bVals[k] !== undefined) recM.values[F(M0, k).id] = parseFloat(bVals[k]); });
        if (bVals["判断与明日动作"] !== undefined) recM.values[F(M0, "判断与明日动作").id] = bVals["判断与明日动作"];
        recM.updatedAt = nowIso;
        动作.push("我的每日数据 更新 " + today + " 那行");
      } else {
        const tv = {};
        tv[fDate.id] = today;
        if (bVals["账号"] !== undefined) tv[fAcc.id] = dw.ensureOption(fAcc, bVals["账号"]).id;
        numKeys.forEach((k) => { if (bVals[k] !== undefined) tv[F(M0, k).id] = parseFloat(bVals[k]); });
        if (bVals["判断与明日动作"] !== undefined) tv[F(M0, "判断与明日动作").id] = bVals["判断与明日动作"];
        tv[fPin.id] = [recA.id];
        recM = dw.makeRecord(tv, nowIso);
        M0.records.push(recM);
        // relation 双向（B2.5 教训：两边都要写；档案侧是「我的数据」字段 → append 不覆盖）
        recA.values[fMine.id] = curMine.concat([recM.id]);
        recA.updatedAt = nowIso;
        动作.push("我的每日数据 新增 " + today + " 一行（品→" + pinName + "）");
      }
      M0.meta.updatedAt = nowIso; A0.meta.updatedAt = nowIso;
      dw.writeTable(fM, M0);
      dw.writeTable(fA, A0);
      // 回读校验（b）：期望 relation = 新增时 append，更新时维持原值
      const M2 = dw.readTable(fM).obj, A2 = dw.readTable(fA).obj;
      const m2 = M2.records.find((r) => r.id === recM.id);
      const a2 = A2.records.find((r) => r.id === recA.id);
      const fMine2 = F(A2, "我的数据");
      if (!m2) return { ok: false, error: "回读不到我的每日数据新行", 备份: backups };
      const expectMine = isNewM ? curMine.concat([recM.id]) : curMine;
      if (JSON.stringify(a2.values[fMine2.id] || []) !== JSON.stringify(expectMine)) {
        return { ok: false, error: "档案侧「我的数据」回读不一致（relation 双向失败）", 备份: backups };
      }
      动作.push("duowei 回读校验 ✓（行在 · relation 双向 · 记录 " + (M0.records.length - (isNewM ? 1 : 0)) + "→" + M2.records.length + "）");

      // ④ a：笔记卡 YAML + 漏斗诊断（vault 写）
      for (const s of summary) {
        const f = this.app.vault.getAbstractFileByPath(s.card.path);
        if (!f) throw new Error("找不到笔记卡：" + s.card.path);
        undoFiles.push({ path: s.card.path, existed: true, content: await this.app.vault.read(f) });
        let txt = await this.app.vault.read(f);
        Object.keys(s.vals).forEach((k) => {
          const re = new RegExp("^(" + k + "):.*$", "m");
          if (re.test(txt)) txt = txt.replace(re, k + ": " + s.vals[k]);
          else txt = txt.replace(/^(---\n[\s\S]*?\n---)/m, "$1\n" + k + ": " + s.vals[k]);
        });
        if (s.frows.length) {
          const newTbl = ["## 漏斗诊断（48h 填，定位卡在哪一层）", "", "| 环节 | 数据 | 高/中/低 | 原因 |", "| --- | --- | --- | --- |"]
            .concat(s.frows.map((fr) => "| " + fr.name + " | " + (String(fr.iData.value).trim() || "—") + " | " + (fr.iLv.value || "—") + " | " + (String(fr.iWhy.value).trim() || "—") + " |")).join("\n");
          const i = txt.indexOf("## 漏斗诊断");
          if (i >= 0) {
            const after = txt.slice(i);
            const j = after.indexOf("\n## ", 1);
            txt = txt.slice(0, i) + newTbl + (j >= 0 ? "\n\n" + after.slice(j + 1) : "\n");
          } else {
            txt = txt.replace(/\s*$/, "\n\n" + newTbl + "\n");
          }
        }
        await this.app.vault.modify(f, txt);
        动作.push("笔记卡「" + (s.card.title || s.card.name) + "」YAML " + Object.keys(s.vals).length + " 键" + (s.frows.length ? " + 漏斗诊断表" : ""));
      }

      // ⑤ c：每日日志（不存在则按模板创建）+ backfilled
      const dailyDir = this.app.vault.getAbstractFileByPath(P.dailyDir);
      let log = dailyDir && dailyDir.children ? dailyDir.children.find((f) => f.extension === "md" && (async () => false)() === false && (f.basename.startsWith("Day") || true) && (() => { try { return true; } catch (e) { return false; } })()) : null;
      // 按 frontmatter date==今天 找（读一遍）
      let logFile = null;
      if (dailyDir && dailyDir.children) {
        for (const f of dailyDir.children) {
          if (f.extension !== "md" || /_模板-/.test(f.name)) continue;
          try {
            const t = await this.app.vault.read(f);
            if ((t.match(/^date:\s*(\S+)/m) || [])[1] === today) { logFile = f; break; }
          } catch (e) { /* 跳过 */ }
        }
      }
      const snapLine = "- " + today + "：" + (Object.keys(bVals).length ? Object.keys(bVals).map((k) => k + " " + bVals[k]).join(" · ") : "（业务数字未填）") + " · 品 " + (pinName || "—");
      if (logFile) {
        undoFiles.push({ path: logFile.path, existed: true, content: await this.app.vault.read(logFile) });
        let t = await this.app.vault.read(logFile);
        if (/^backfilled:.*$/m.test(t)) t = t.replace(/^backfilled:.*$/m, "backfilled: true");
        const iHead = t.indexOf("## 数据快照");
        if (iHead >= 0) {
          const after = t.slice(iHead);
          const j = after.indexOf("\n## ", 1);
          t = t.slice(0, iHead) + after.slice(0, j < 0 ? undefined : j).replace(/\s*$/, "\n") + snapLine + "\n" + (j >= 0 ? after.slice(j + 1) : "");
        } else {
          t = t.replace(/\s*$/, "\n\n## 数据快照（22:00 回填）\n" + snapLine + "\n");
        }
        await this.app.vault.modify(logFile, t);
        动作.push("每日日志「" + logFile.name + "」快照 +1 · backfilled=true");
      } else {
        let tplTxt = "";
        try { tplTxt = await this.app.vault.read(this.app.vault.getAbstractFileByPath(P.dailyDir + "/_模板-每日日志.md")); } catch (e) {}
        if (!tplTxt) throw new Error("每日日志模板不存在，无法创建今天那篇");
        const dayLabel = (this.data.plan && this.data.plan.day != null) ? "Day" + String(this.data.plan.day).padStart(2, "0") : "Day??";
        undoFiles.push({ path: P.dailyDir + "/" + dayLabel + "-回填.md", existed: false });
        let t = tplTxt
          .replace(/^day:.*$/m, "day: " + dayLabel)
          .replace(/^date:.*$/m, "date: " + today)
          .replace(/^backfilled:.*$/m, "backfilled: true")
          .replace(/Day XX/g, dayLabel);
        t = t.replace(/(## 数据快照（22:00 回填）[\s\S]*?)(?=\n## )/, "$1\n" + snapLine + "\n");
        await this.app.vault.create(P.dailyDir + "/" + dayLabel + "-回填.md", t);
        动作.push("每日日志 新建「" + dayLabel + "-回填.md」（backfilled=true · 快照 1 行）");
      }

      // ⑥ 模板卡战绩（归集，流程 1 步 8：确认卡已点头）
      for (const plan of tplPlan) {
        if (!plan.path) continue;
        const f = this.app.vault.getAbstractFileByPath(plan.path);
        if (!f) continue;
        undoFiles.push({ path: plan.path, existed: true, content: await this.app.vault.read(f) });
        let t = await this.app.vault.read(f);
        const put = (k, v) => {
          const re = new RegExp("^(" + k + "):.*$", "m");
          if (re.test(t)) t = t.replace(re, k + ": " + v);
          else t = t.replace(/^(---\n[\s\S]*?\n---)/m, "$1\n" + k + ": " + v);
        };
        const setNum = (k, planVal) => {
          if (planVal == null) return;
          const parts = String(planVal).split("→");
          put(k, parts[parts.length - 1]);
        };
        setNum("已测次数", plan.已测次数);
        setNum("累计出单", plan.累计出单);
        setNum("最佳小眼睛", plan.最佳小眼睛);
        if (plan.最佳点击率) put("最佳点击率", String(plan.最佳点击率).split("→").pop());
        put("最近使用", today);
        if (!/首次使用:\s*\S/.test(t)) put("首次使用", today);
        await this.app.vault.modify(f, t);
        动作.push("模板卡「" + plan.name + "」战绩归集（已测次数 " + plan.已测次数 + "）");
      }

      // ⑦ 全局回读：三表之外没有 duowei；vault 文件由 Notice 汇总
      return { ok: true, 动作, 备份: backups };
    } catch (e) {
      // 失败回滚：vault 文件逐个还原
      for (const u of undoFiles) {
        try {
          const f = this.app.vault.getAbstractFileByPath(u.path);
          if (u.existed && f) await this.app.vault.modify(f, u.content);
          else if (!u.existed && f) await this.app.vault.delete(f);
        } catch (e2) { console.error("[xhs-workbench] 回滚失败：" + u.path, e2); }
      }
      // duowei：从备份还原
      try {
        for (const b of backups) { /* backupTable 返回备份路径；直接从备份覆盖 */
          const src = typeof b === "string" ? b : (b && b.path);
          if (src && fs.existsSync(src)) {
            const name = path.basename(src).replace(/^.*?-(写前-[0-9]+)\.duowei$/, "");
            // 备份文件名形如 <表名>-写前-<时间戳>..duowei —— 按表名匹配还原
            const base = path.basename(src);
            const tblName = base.split("-写前-")[0];
            const target = P2.dwFile(tblName);
            if (target) fs.copyFileSync(src, target);
          }
        }
      } catch (e2) { console.error("[xhs-workbench] duowei 回滚失败", e2); }
      return { ok: false, error: "写入失败，已回滚：" + (e && e.message ? e.message : String(e)) };
    }
  }

  /** 去创作台时把在测品带入生成请求单（PRD 行 113「带品」） */
  setRequestPin(品名) {
    if (!品名) return;
    const req = blkByTitle(this.root.querySelector("#p-output"), "生成请求单");
    if (!req) return;
    const selPin = req.querySelectorAll(".frow select.sel")[0];
    if (!selPin) return;
    const has = Array.from(selPin.options).some((o) => o.value === 品名);
    if (!has) return; // 档案里没这个品就不硬塞
    selPin.value = 品名;
    selPin.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** 「去拆解 ›」（B3.3 老哥纠偏，按 PRD 行 113 的确认口径）：
      不是打开笔记 —— 是「打包 待拆解/ 全部文件 + 生成一段可 @ 的说明」，
      用户贴进对话让 AI 批量拆解。一次触发多篇，单次上限 ≤10（结构文档 §4.4），
      输出逐篇独立（人在环）。拆解口径全部引用库内已确认规则，不新造。 */
  async doUnpack() {
    const folder = this.app.vault.getAbstractFileByPath(P.todoDir);
    const md = folder && folder.children ? folder.children.filter((f) => f.extension === "md") : [];
    if (!md.length) { new Notice("待拆解是空的 —— 先去创作台「爆款采集」投喂", 8000); return; }
    const sorted = md.slice().sort((a, b) => (a.stat.mtime || 0) - (b.stat.mtime || 0)); // FIFO：先采先拆，不饿死老文件
    const LIMIT = 10; // 结构文档 §4.4：单次上限 ≤10
    const batch = sorted.slice(0, LIMIT);
    const rest = sorted.length - batch.length;
    const lines = [];
    for (const f of batch) {
      let link = "";
      try {
        const txt = await this.app.vault.read(f);
        const m = txt.match(/^笔记链接:\s*(\S+)\s*$/m);
        if (m) link = "（" + m[1] + "）";
      } catch (e) { /* 读不了就只给路径 */ }
      lines.push((lines.length + 1) + ". " + f.path + link);
    }
    const instr = "请批量拆解「" + P.todoDir + "」里的 " + batch.length + " 篇爆款"
      + (rest > 0 ? "（另有 " + rest + " 篇超出单次上限 10，下一批再拆）" : "") + "：\n\n"
      + lines.join("\n")
      + "\n\n拆解要求（库内已确认口径）：\n"
      + "1. 三轴打标 + 封面大字（**看图**记入 cover_text）+ 合规定级 + 必答「本次有没有可抽象的框架？」\n"
      + "2. 拆解格式以 `10-小红书带货/20-文案库/_模板-爆款拆解卡.md` 为唯一权威；汇总写入 `10-小红书带货/20-文案库/拆解汇总-<批次>.md`（一行一篇）\n"
      + "3. 输出逐篇独立 —— 每篇一份拆解，可逐篇检查；单篇可打回重拆\n"
      + "4. 立卡门槛：同品对标须同类 ≥2 篇；跨类目 / 通用方法论单篇即可（status: 待测）\n"
      + "5. 全部拆完后：原文移入 `10-小红书带货/20-文案库/拆解原文/`，`待拆解/` 清空";
    try { await navigator.clipboard.writeText(instr); }
    catch (e) { new Notice("复制失败 —— 请手动记录 待拆解/ 里的文件名", 9000); return; }
    new Notice("已复制拆解指令 ✓（" + batch.length + " 篇）→ 去对话粘贴发送；拆完原文会移入 拆解原文/", 14000);
  }

  /* ───── 选品池 ───── */
  renderPick(d) {
    const page = this.root.querySelector("#p-pick");
    if (!page) return;
    const A = d.dw.archive, T = d.dw.track;
    const testing = A ? A.records.filter((r) => A.opt(r, "分区") === "正在测") : [];
    const cand = A ? A.records.filter((r) => A.opt(r, "分区") === "候选池") : [];
    const stats = page.querySelectorAll(".statbar .stat .n");
    setText(stats[0], String(testing.length));
    setText(stats[1], String(T ? T.records.length : 0));
    setText(stats[2], String(cand.length));

    const a = testing[0];
    const tcName = page.querySelector(".tc-name");
    if (tcName) setText(tcName, a ? A.val(a, "品名") : "尚无在测品");
    const tcTop = page.querySelector(".tc-top");
    if (tcTop && a) {
      const pills = tcTop.querySelectorAll(".pill");
      const warn = A.val(a, "止损预警");
      if (pills[0]) {
        pills[0].className = this.warnIsAlert(warn) ? "pill wr" : "pill";
        pills[0].innerHTML = "<i></i>" + esc(this.warnPill(warn));
      }
      if (pills[1]) pills[1].innerHTML = "<i></i>" + esc(A.opt(a, "需求类型") || UNFILLED);
    }
    const kpi6 = page.querySelector(".kpi6");
    if (kpi6) {
      // 「上架天数」优先用「上架日期」**实时算**（今天 − 上架日期）——
      // 「上架天数」字段是**采集当天的快照**，不再采就一直停在那个数（会过期）；
      // 没有「上架日期」时才回退到快照值兜底。
      const shelfDays = a ? (() => {
        const d = String(A.val(a, "上架日期") || "").replace(/[./]/g, "-");
        const t = d ? new Date(d + "T00:00:00").getTime() : NaN;
        if (Number.isFinite(t)) {
          const n = Math.floor((Date.now() - t) / 86400000);
          if (n >= 0) return n + " 天";
        }
        const s = num(A.val(a, "上架天数"));
        return s == null ? null : s + " 天";
      })() : null;
      const vals = a
        ? [["对标到手价", fmt2(A.val(a, "对标到手价"))], ["1688 成本", fmt2(A.val(a, "1688成本"))],
           ["毛利", fmt2(A.val(a, "毛利(元)"))], ["单件利润", fmt2(A.val(a, "单件利润(元)"))],
           ["累计笔记", fmtInt(A.val(a, "累计发笔记数"))], ["累计订单", fmtInt(A.val(a, "累计订单数"))],
           ["上架天数", shelfDays]]
        : [];
      kpi6.innerHTML = vals.length
        ? vals.map((v) => '<div class="kpi"><div class="k">' + v[0] + '</div><div class="v num">' + (v[1] == null ? UNFILLED : esc(v[1])) + "</div></div>").join("")
        : '<div class="kpi"><div class="k">在测品</div><div class="v">无</div></div>';
    }
    const tcFoot = page.querySelector(".tc-foot");
    if (tcFoot && a) {
      const parts = [["对标账号", A.val(a, "对标账号")], ["对标店铺", A.val(a, "对标店铺")], ["来源", A.opt(a, "来源")],
        ["店铺评分", fmt2(A.val(a, "店铺评分"))], ["发货地", A.val(a, "发货地")]].filter((p) => p[1] != null);
      tcFoot.textContent = parts.map((p) => p[0] + " " + p[1]).join(" · ") + "（均采自商品）· 止损预警只在本页出现";
    }

    const blkCand = blkByTitle(page, "候选品");
    if (blkCand) {
      const p = blkCand.querySelector(".bh .pill.acc");
      if (p) p.innerHTML = "<i></i>" + cand.length + " 个";
      const tb = blkCand.querySelector("tbody");
      if (tb) {
        tb.innerHTML = cand.length
          ? cand.map((r) => {
              const cell = (n, f) => {
                const v = f ? f(A.val(r, n)) : A.val(r, n);
                return v == null ? '<td class="r dash num">' + UNFILLED + "</td>" : '<td class="r num">' + esc(v) + "</td>";
              };
              return '<tr><td class="t-title link" data-openrecord="测品档案" data-record-id="' + esc(r.id) + '">' + esc(A.val(r, "品名")) + "</td>" +
                cell("对标到手价", fmtMoney) + cell("1688成本", fmtMoney) + cell("毛利(元)", fmtMoney) + cell("单件利润(元)", fmtMoney) +
                cell("店铺评分", fmt2) + cell("上架天数") + cell("开店天数") +
                '<td class="mut">' + esc(A.val(r, "对标账号") || DASH) + "</td></tr>";
            }).join("")
          : '<tr><td colspan="9" class="mut">测品档案里没有「分区＝候选池」的记录</td></tr>';
      }
      const tail = blkCand.querySelector(".tail");
      if (tail) tail.innerHTML = '取自 <strong>测品档案.duowei</strong> · 只列 <strong>分区＝候选池</strong> 的品（<strong>已归档的不属于候选品</strong>）· 编辑一律跳 duowei<br>上架天数／开店天数 为空即显示「' + UNFILLED + '」（<strong>不是 0</strong>）';
    }

    const blkTr = blkByTitle(page, "每日跟踪");
    if (blkTr) {
      const rows = T ? T.records.slice().sort((x, y) => String(T.val(y, "日期") || "").localeCompare(String(T.val(x, "日期") || ""))) : [];
      const p = blkTr.querySelector(".bh .pill.acc");
      if (p) p.innerHTML = "<i></i>" + rows.length + " 条";
      const tb = blkTr.querySelector("tbody");
      if (tb) {
        tb.innerHTML = rows.length
          ? rows.map((r) => {
              const c = (n) => { const v = num(T.val(r, n)); return v == null ? '<td class="r dash num">' + DASH + "</td>" : '<td class="r num">' + esc(fmtInt(v)) + "</td>"; };
              const buy = T.val(r, "对标24h购买数");
              const buyCell = num(buy) == null ? '<td class="r dash">' + UNFILLED + "</td>" : '<td class="r num">' + esc(fmtInt(buy)) + "</td>";
              return '<tr><td class="mut num">' + esc(shortDate(T.val(r, "日期"))) + "</td>" +
                '<td class="t-title link" data-openrecord="每日跟踪" data-record-id="' + esc(r.id) + '">' + esc(T.opt(r, "品名") || UNFILLED) + "</td>" +
                c("对标总单量") + c("对标今日单量") + buyCell +
                '<td class="mut">' + esc(T.val(r, "备注") || DASH) + "</td></tr>";
            }).join("")
          : '<tr><td colspan="6" class="mut">每日跟踪表里还没有记录</td></tr>';
      }
    }
  }

  /* ───── B5 · 搜索 A/B（PRD 行 233：V1 只做 笔记+模板+选题，全库 D 留后） ───── */
  bindSearch() {
    const sIn = this.root.querySelector("#searchIn");
    const sPan = this.root.querySelector("#searchPanel");
    if (!sIn || !sPan || sIn._bs) return;
    sIn._bs = 1;
    sIn.placeholder = "搜索笔记 / 模板 / 选题…"; // 原 placeholder 是全库 D 的口径
    // 类型按钮重映射：原稿 4 类是全库 D 的（全部/笔记/图片/表格）→ A/B 的（全部/笔记/模板/选题），图标不动
    const remap = { all: "all", note: "note", image: "tpl", table: "topic" };
    const titles = { all: "全部", note: "笔记", tpl: "模板", topic: "选题" };
    sPan.querySelectorAll(".sr-f").forEach((b) => {
      if (remap[b.dataset.t]) { b.dataset.t = remap[b.dataset.t]; b.title = titles[b.dataset.t] || b.title; }
    });
    let timer = null;
    sIn.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.runSearch(sIn.value.trim()), 220);
    });
    sPan.addEventListener("click", (e) => {
      const it = e.target.closest && e.target.closest(".sr-item");
      if (!it || !it.dataset.stype) return;
      const type = it.dataset.stype, path = it.dataset.path;
      if (type === "note") { sPan.hidden = true; sIn.value = ""; this.openNote(path); return; }
      if (type === "topic") {
        sPan.hidden = true; sIn.value = "";
        this.gotoPage("p-output");
        const req = blkByTitle(this.root.querySelector("#p-output"), "生成请求单");
        if (req) {
          const sSel = req.querySelectorAll(".frow select.sel")[2];
          const o = Array.from(sSel.options).find((x) => x.value === path);
          if (o) { sSel.value = path; sSel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        return;
      }
      sPan.hidden = true; sIn.value = "";
      this.app.workspace.openLinkText(path, "", false);
    });
  }

  ICONS = {
    note: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    tpl: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>',
    topic: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  runSearch(q) {
    const sPan = this.root.querySelector("#searchPanel");
    const list = sPan.querySelector(".sr-list");
    const d = this.data || {};
    const typeFilter = (sPan.querySelector(".sr-f.on") || {}).dataset ? sPan.querySelector(".sr-f.on").dataset.t : "all";
    const results = [];
    if (q) {
      const kw = q.toLowerCase();
      (d.cards || []).forEach((c) => {
        const hay = ((c.title || "") + " " + (c.fm["本品"] || "") + " " + (c.fm["归属模板"] || "")).toLowerCase();
        if (hay.indexOf(kw) >= 0) results.push({ stype: "note", path: c.path, title: c.title || c.name, sub: "笔记 · " + (c.fm["本品"] || "未标品名") });
      });
      (d.templates || []).forEach((t) => {
        const hay = (t.name + " " + (t.fm["模板名"] || "") + " " + (t.fm["结构类型"] || "")).toLowerCase();
        if (hay.indexOf(kw) >= 0) results.push({ stype: "tpl", path: t.path, title: shortTpl(t.name) || t.name, sub: "模板 · " + (t.fm["结构类型"] || "?") + " · " + (t.fm["来源"] || "?") });
      });
      const req = blkByTitle(this.root.querySelector("#p-output"), "生成请求单");
      const pin = req ? (req.querySelectorAll(".frow select.sel")[0] || {}).value : "";
      const pool = this.parseTopicPool(pin || this.backfillPinName());
      (pool || []).forEach((g) => g.options.forEach((o) => {
        if ((o.label || "").toLowerCase().indexOf(kw) >= 0) results.push({ stype: "topic", path: JSON.stringify(o), title: o.label, sub: "选题 · " + g.title });
      }));
    }
    const shown = results.filter((r) => typeFilter === "all" || r.stype === typeFilter);
    list.innerHTML = shown.length
      ? shown.slice(0, 20).map((r) =>
          '<div class="sr-item" data-stype="' + r.stype + '" data-path="' + esc(r.path) + '">' +
          '<span class="sr-ic">' + this.ICONS[r.stype] + '</span>' +
          '<span class="sr-tx"><span class="sr-t">' + esc(r.title) + '</span><span class="sr-s">' + esc(r.sub) + '</span></span></div>').join("")
      : '<div class="sr-item" style="cursor:default"><span class="sr-tx"><span class="sr-t mod-muted">' +
        (q ? "没有匹配的笔记 / 模板 / 选题" : "输入关键词，搜已确认的 A/B 范围（笔记 + 模板 + 选题）") + '</span></span></div>';
  }

  /* ───── 依赖状态（§18.7）：只探测能真探测的；开放外部命令（opencli/Edge）V1 简化 ───── */
  renderDep(d) {
    const list = this.root.querySelector(".dep-list");
    if (!list) return;
    const pm = this.app.plugins;
    const col = pm.getPlugin("xhs-product-search");
    const items = [
      { label: "duowei", ok: !!(d.dw.ok.archive && d.dw.ok.track && d.dw.ok.mine), tip: d.dw.ok.err || "三张表可读" },
      { label: "importer", ok: !!pm.getPlugin("xhs-importer-pro"), tip: pm.getPlugin("xhs-importer-pro") ? "xhs-importer-pro 已启用" : "xhs-importer-pro 未启用 → 爆款投喂不可用" },
      { label: "collector", ok: !!col, tip: col ? "xhs-product-search 已启用（内置采集引擎，采集条可自检）" : "xhs-product-search 未启用 → 商品采集置灰" },
      { label: "opencli", ok: null, tip: "外部命令（Edge/扩展/登录号）—— V1 简化不探测（PRD §6.2 允许），创作者同步为演示" },
    ];
    list.innerHTML = items.map((i) =>
      '<span class="dep-i" title="' + esc(i.tip) + '"><i class="' + (i.ok === true ? "d" : i.ok === false ? "d wr" : "d mut-dot") + '"></i>' + esc(i.label) + "</span>").join("");
  }

  /* ───── 工作台名称（存在插件设置里，实时同步到侧栏标题） ───── */
  applyWbName() {
    const name = (this.plugin.settings && this.plugin.settings.wbName) || "带货工作台";
    setText(this.root.querySelector(".side-title"), name);
  }

  /* ───── 演示标记 + 未接线按钮（演示数据必须一眼看得出来） ───── */
  markDemo() {
    const put = (hostEl, text) => { if (hostEl && !hostEl.querySelector(".demo-tag")) hostEl.createSpan({ cls: "demo-tag", text }); };
    put(this.root.querySelector("#p-data .phead > div"), "演示数据");
    put(this.root.querySelector("#p-know .phead > div"), "演示数据");
  }

  markPending() {
    // 09-30：原先这里标了 ["#layoutBtn","V1 不做（布局固定）"] —— 但布局弹层早已实装
    //（整页壁纸 + 自定义图片壁纸），留着会让人点「布局」时多弹一个假的「V1 不做」toast。已摘。
    // 「去创作台」本批就能切页；「开始回填」留给 B4
    this.root.querySelectorAll("#p-today button.btn.pri.full").forEach((b) => {
      b.removeAttribute("data-pending"); // B4：开始回填本批接线
      if (/回填/.test(b.textContent)) b.setAttribute("data-action", "backfill");
      else b.setAttribute("data-goto", "p-output");
    });
    this.root.querySelectorAll("#p-pick .tc-acts button.btn, #p-pick .bhr button.btn").forEach((b) => {
      if (/创作台/.test(b.textContent)) { b.removeAttribute("data-pending"); b.setAttribute("data-goto", "p-output"); }
    });
  }
}

/* ══════════════════ 插件设置页（齿轮入口 · PRD §2 / 结构 §20.5） ══════════════════ */

class WorkbenchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("工作台名称")
      .setDesc("显示在左侧导航顶部与页签标题上，可随时改。")
      .addText((t) =>
        t.setValue(this.plugin.settings.wbName).onChange(async (v) => {
          this.plugin.settings.wbName = v.trim() || DEFAULT_SETTINGS.wbName;
          await this.plugin.saveSettings();
          this.plugin.applyNameToViews();
        })
      );
    containerEl.createEl("div", {
      cls: "setting-item-description",
      text: "壁纸已支持整页与自定义图片：工作台右上角「布局」→ 壁纸。依赖状态实时探测等其余设置项在后续版本加入。",
    });
  }
}

/* ══════════════════ 插件 ══════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   批次 2 · 选品池写库 + 采集对接（2026-09-29）
   ──────────────────────────────────────────────────────────────────────────
   依据：结构文档 §13.3 采集规格 / §13.4 字段最终落位 / §13.5 采集写入策略
     · 固定/低频 → 测品档案（一品一行）· 变动（每天）→ 每日跟踪（一天一行）
     · 采写模式：全采 / 变动才采（固定项 diff 命中才写，并在每日跟踪备注记一句）
     · **relation 双向都要写值**（否则 rollup 汇总为空）
     · 写回三纪律：写前重读 → 表开着先拦住 → 写后回读校验；**保留文件尾换行**
   ⚠️ 字段一律**按名字**解析（不写死字段 id），这样表结构改 id 也不会断；
      只有「选项名」（候选池 / 小红书市集）与「表名」是常量。
   ══════════════════════════════════════════════════════════════════════════ */
const DW_DIRNAME = "多维表格";            // vault 下的目录（三张表都在这儿）
const TABLE_ARCHIVE = "测品档案";
const TABLE_TRACK = "每日跟踪";
const OPT_DISTRICT_CAND = "候选池";        // 分区：候选池
const OPT_SOURCE_XHS = "小红书市集";       // 来源
const BACKUP_ROOT = "D:/Documents/work buddy/_backups"; // **库外**备份（库内不留）

function todayLocal() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/* ── 采集结果确认弹窗：显示将写入的字段 + 让老哥给这个品起名（品名 = 我方给品起的名字，必须由人定） ── */
class CollectConfirmModal extends Modal {
  constructor(app, res, onSubmit, ctx) {
    super(app);
    this.res = res;
    this.onSubmit = onSubmit;
    this.ctx = ctx || {};
    this.name = "";
    this.tg = { archive: true, track: true, shop: false };
    this.pick = 0; // 店铺流程：选中的首页商品下标
    this.shopData = null; this.shopLoading = false; // 单品流程勾「店铺采集」后的店铺数据
  }
  onOpen() {
    const { contentEl } = this;
    const r = this.res;
    const isShop = r.kind === "shop";
    contentEl.createEl("h3", { text: isShop ? "店铺采集确认（确认后才写库）" : "采集结果确认（确认后才写库）" });
    if (isShop) {
      const shopTip = contentEl.createEl("p", { cls: "mod-muted" });
      shopTip.createEl("div", { text: "店铺「" + ((r.shop && r.shop.店铺名) || "—") + "」· 首页可见商品 " + (r.products || []).length + " 个" });
      shopTip.createEl("div", { text: "下面选一个作为对标商品。" });
    } else {
      contentEl.createEl("p", { cls: "mod-muted", text: "商品 ID " + (r.itemId || "—") + " · 抓取时间 " + (r.抓取时间 || "—") });
    }

    new Setting(contentEl)
      .setName("品名（我方给这个品起的名字）")
      .setDesc("必填。这也是判重的依据 —— 已存在同名档案时走「二次采集」路径，不会重复建行。")
      .addText((t) => t.setPlaceholder(isShop ? "例：星星人转转摆件" : "例：舒眠精油").onChange((v) => { this.name = v.trim(); }));

    // 店铺流程：先选商品（预览表随选中项联动）
    if (isShop) {
      contentEl.createEl("h4", { text: "该店首页可见商品（点选一个）" });
      const box = contentEl.createDiv({ cls: "wb-shop-list" });
      (r.products || []).forEach((p, i) => {
        const lab = box.createEl("label", { cls: "wb-shop-row" });
        const radio = lab.createEl("input", { type: "radio" });
        radio.name = "wb-shop-pick";
        radio.checked = i === this.pick;
        radio.onchange = () => { this.pick = i; this.renderTables(); };
        lab.createSpan({ text: "¥" + (p.价格 ?? "?") + " · 已售 " + (p.已售原文 || (p.已售 ?? "?")) + " · 上架 " + (p.上架日期 || "?") + "（" + (p.上架天数 ?? "?") + "天）· " + ((p.标题 || "（无标题）").slice(0, 40)) });
      });
      box.createEl("p", { cls: "mod-muted", text: "确认写入时会按选中商品再查一次详情接口：到手价 / 发货地 / 店铺评分 自动按详情补全。" });
    }

    // 预览表（店铺流程随选中商品联动；单品流程勾「店铺采集」后追加该店商品列表与角标）
    this.boxA = contentEl.createDiv();
    this.boxShop = contentEl.createDiv();
    this.boxT = contentEl.createDiv();
    this.renderTables = () => {
      let archive, track;
      if (isShop) {
        const f = this.ctx.shopFields ? this.ctx.shopFields(this.pick) : { archive: {}, track: {} };
        archive = f.archive; track = f.track;
      } else {
        archive = Object.assign({}, r.archive);
        if (this.tg.shop && this.shopData && this.shopData.shop) {
          archive["对标店铺"] = this.shopData.shop.店铺名 || archive["对标店铺"];
          const mine = (this.shopData.products || []).find((x) => x.item_id && r.itemId && x.item_id === r.itemId);
          if (mine && mine.角标) archive["商品角标"] = mine.角标;
        }
        track = r.track;
      }
      const fill = (box, title, obj) => {
        box.empty();
        box.createEl("h4", { text: title });
        const t = box.createEl("table", { cls: "wb-ctb" });
        Object.keys(obj).forEach((k) => {
          const tr = t.createEl("tr");
          tr.createEl("td", { text: k, cls: "k" });
          tr.createEl("td", { text: obj[k] == null ? "（留空）" : String(obj[k]) });
        });
      };
      fill(this.boxA, "→ 测品档案（固定/低频）", archive);
      // B1：该店首页可见商品 —— 预览参考，不写库（老哥 09-29 定）
      this.boxShop.empty();
      if (!isShop && this.tg.shop) {
        if (this.shopLoading) this.boxShop.createEl("h4", { text: "→ 该店首页可见商品（获取中…）" });
        else if (this.shopData) {
          this.boxShop.createEl("h4", { text: "→ 该店首页可见商品（预览参考 · 不写库）" });
          const t = this.boxShop.createEl("table", { cls: "wb-ctb" });
          (this.shopData.products || []).slice(0, 6).forEach((p) => {
            const tr = t.createEl("tr");
            tr.createEl("td", { text: "该店商品", cls: "k" });
            tr.createEl("td", { text: "¥" + (p.价格 ?? "?") + " · 已售 " + (p.已售原文 || (p.已售 ?? "?")) + " · " + ((p.标题 || "").slice(0, 30)) });
          });
        }
      }
      fill(this.boxT, "→ 每日跟踪（变动）", track);
    };
    this.renderTables();

    // 写哪些表：勾选 = 写（B2.5 老哥定的交互 —— 档案完善后，复采可只勾每日跟踪）
    contentEl.createEl("h4", { text: "写入哪些表（勾选 = 写）" });
    new Setting(contentEl)
      .setName("→ 测品档案（固定/低频）")
      .addToggle((t) => { t.setValue(true); t.onChange((v) => { this.tg.archive = v; }); });
    new Setting(contentEl)
      .setName("→ 每日跟踪（变动）")
      .addToggle((t) => { t.setValue(true); t.onChange((v) => { this.tg.track = v; }); });
    // 🔴 实测（Obsidian 1.12.7）：setValue(true) 不回填初始勾选态（input.checked 仍为 false）
    //    → 显式补一次；只补上面两个（下面的「店铺采集」默认不勾，不能被误勾上）
    Array.prototype.forEach.call(contentEl.querySelectorAll(".checkbox-container"), (c) => {
      const inp = c.querySelector("input[type=checkbox]");
      if (inp && !inp.checked) { inp.checked = true; c.classList.add("is-checked"); }
    });
    if (!isShop) {
      new Setting(contentEl)
        .setName("→ 店铺采集（该店首页商品列表 + 商品角标）")
        .setDesc("数据来自这个商品自带的店铺链接；不需要就不勾。")
        .addToggle((t) => { t.setValue(false); t.onChange(async (v) => {
          this.tg.shop = v;
          if (!v) { this.shopData = null; this.renderTables(); return; }
          if (this.ctx.fetchShop && !this.shopData) {
            this.shopLoading = true; this.renderTables();
            const s = await this.ctx.fetchShop();
            this.shopLoading = false;
            if (s && s.ok) this.shopData = s;
            else new Notice("店铺采集失败：" + ((s && s.error) || "未知"), 9000);
          }
          this.renderTables();
        }); });
    }

    const bar = contentEl.createDiv({ cls: "wb-cbar" });
    bar.createEl("button", { text: "取消" }).onclick = () => this.close();
    bar.createEl("button", { text: "确认写入", cls: "mod-cta" }).onclick = () => {
      if (!this.name) { new Notice("请先填「品名」——它是我方给这个品起的名字，也是判重依据"); return; }
      if (!this.tg.archive && !this.tg.track) { new Notice("「测品档案 / 每日跟踪」至少勾一个"); return; }
      if (!this.tg.archive && this.ctx.hasArchive && !this.ctx.hasArchive(this.name)) {
        new Notice("品名「" + this.name + "」还没有档案 —— 只写每日跟踪需要先有档案（勾上「测品档案」先建档），或检查品名");
        return;
      }
      this.close();
      this.onSubmit(this.name, { archive: this.tg.archive, track: this.tg.track, shop: this.tg.shop }, this.pick, this.shopData);
    };
  }
  onClose() { this.contentEl.empty(); }
}

class XhsWorkbenchPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.dw = this.loadDwLib();   // duowei 写库引擎（纯逻辑模块，可独立用 node 单测）
    this.registerView(VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this));
    this.addSettingTab(new WorkbenchSettingTab(this.app, this));
    this.addRibbonIcon("layout-dashboard", "打开带货工作台", () => this.activateView());
    this.addCommand({ id: "open-xhs-workbench", name: "打开带货工作台", callback: () => this.activateView() });
    console.log("[xhs-workbench] loaded");
  }

  /* 🔴 2026-09-30：卸载（禁用 / 更新插件）时把工作台视图的模板弹窗关掉 ——
     未关闭的 Obsidian Modal 会残留在 keymap 栈上，它的焦点容器会吃掉**全 Obsidian** 的输入焦点
     （老哥报「工作台里输入框点不动 / 粘不进」就是这个机制，详见 showAllTemplates 里的注释）。 */
  onunload() {
    try {
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => {
        try {
          const v = l.view;
          if (v && v._tplModal) { v._tplLeaving = true; v._tplModal.close(); }
          if (v) { v._tplWant = false; v._tplOpening = false; }
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 档案里已有的品名清单（确认弹窗预检「只写每日跟踪」是否可行；表很小，同步读） */
  archiveNames() {
    if (!this.dw) return [];
    try {
      const A = this.dw.readTable(this.dwFile(TABLE_ARCHIVE)).obj;
      const nf = this.dw.fieldByName(A, "品名");
      return A.records.map((r) => r.values[nf.id]).filter(Boolean);
    } catch (e) { return []; }
  }

  /** 商品流程勾「店铺采集」：用商品**自带**的店铺链接抓店铺页 → 合并 对标店铺 / 商品角标（B2.8）。
      商品不在首页可见列表里时拿不到角标 → 保留单品接口的值（可能为空，不猜）。 */
  async mergeShopForItem(res, shopData) {
    if (!shopData || !shopData.ok) return res;
    const shop = shopData.shop || {};
    const mine = (shopData.products || []).find((x) => x.item_id && res.itemId && x.item_id === res.itemId);
    return Object.assign({}, res, {
      archive: Object.assign({}, res.archive, {
        "对标店铺": shop.店铺名 || res.archive["对标店铺"],
        "商品角标": (mine && mine.角标) || res.archive["商品角标"] || null,
      }),
      shopPreview: shopData, // 仅预览用（B1），不写库
    });
  }

  /** 店铺采集 → 选定某个首页商品后，归一成与单品 collect 相同的 archive/track 形状（B2.5） */
  shopCollectFields(res, pick) {
    const p = (res.products || [])[pick] || {};
    return {
      archive: {
        "商品标题": p.标题 || null,
        "商品售价": p.价格,          // 店铺页只有一口价
        "对标到手价": null,          // 店铺页没有到手价 → 留空（不猜）
        "发货地": null,
        "店铺评分": null,
        "上架天数": p.上架天数,
        "上架日期": p.上架日期 || null,                 // 09-30：店铺首页商品带这个
        "对标店铺": (res.shop && res.shop.店铺名) || null,
        "来源": "小红书市集",
        "店铺总销量": (res.shop && res.shop.店铺总销量 != null) ? res.shop.店铺总销量 : null,  // 09-30
        "粉丝数": (res.shop && res.shop.粉丝数 != null) ? res.shop.粉丝数 : null,             // 09-30
      },
      track: { "商品销量": p.已售 }, // 店铺页的已售是**商品级**（比单品接口的 SKU 级准）
    };
  }

  /** 店铺流程确认写入前：按选中商品**补查一次详情接口**，把 到手价/发货地/店铺评分 补全
      （B2.6，老哥问"店铺评分采不到吗" → 详情接口里有 sellerScore，店铺页没有）。
      补全失败不挡写入 —— 退回店铺页字段。 */
  async enrichShopCollect(res, pick) {
    const base = this.shopCollectFields(res, pick);
    const cp = this.collector();
    const picked = (res.products || [])[pick] || {};
    if (!cp || !picked.item_id) return base;
    try {
      const item = await cp.collect(picked.item_id);
      if (item && item.ok) {
        const A = base.archive, ia = item.archive || {};
        if (ia["商品标题"]) A["商品标题"] = ia["商品标题"];
        if (ia["商品售价"] != null) A["商品售价"] = ia["商品售价"];
        if (ia["对标到手价"] != null) A["对标到手价"] = ia["对标到手价"];
        if (ia["发货地"]) A["发货地"] = ia["发货地"];
        if (ia["店铺评分"] != null) A["店铺评分"] = ia["店铺评分"];
        if (ia["上架天数"] != null) A["上架天数"] = ia["上架天数"];
        if (ia["上架日期"]) A["上架日期"] = ia["上架日期"];   // 09-30
        A["对标店铺"] = A["对标店铺"] || ia["店铺名"] || null;  // 09-30：采集插件的「店铺名」
        if (base.track["商品销量"] == null && item.track) base.track["商品销量"] = item.track["商品销量"];
        base.补全来源 = "商品详情接口 " + (item.itemId || "");
      }
    } catch (e) { /* 保留店铺页字段 */ }
    return base;
  }

  /* ─────────────── duowei 写库（B2） ─────────────── */

  /** 插件自身目录 —— ⚠️ 不能用 __dirname：实测 Obsidian 加载插件时它不等于插件目录 */
  pluginDir() {
    const d = (this.manifest && this.manifest.dir) || "";
    if (!d) return null;
    if (path.isAbsolute(d)) return d;
    const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    return base ? path.join(base, d) : null;
  }
  loadDwLib() {
    const cands = [];
    const base = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    if (base) cands.push(path.join(base, PLUGIN_DIR, "duowei.js")); // 与 mount 读 view.html 同一条路径（已验证可用）
    const dir = this.pluginDir();
    if (dir) cands.push(path.join(dir, "duowei.js"));
    if (typeof __dirname === "string" && __dirname) cands.push(path.join(__dirname, "duowei.js"));
    for (const p of cands) {
      try { if (fs.existsSync(p)) return require(p); } catch (e) { console.error("[xhs-workbench] duowei.js 载入失败:", p, e); }
    }
    console.error("[xhs-workbench] duowei.js 找不到，试过:", cands);
    return null;
  }
  dwRoot() {
    const a = this.app.vault.adapter;
    const base = a.getBasePath ? a.getBasePath() : "";
    return path.join(base, DW_DIRNAME);
  }
  dwFile(name) { return path.join(this.dwRoot(), name + ".duowei"); }

  /** 三纪律之二：表在标签页里开着就拦住（编辑器内存态会覆盖我们的写入） */
  openDuoweiFiles() {
    const a = this.app.vault.adapter;
    const base = a.getBasePath ? a.getBasePath() : "";
    const out = [];
    this.app.workspace.iterateAllLeaves((l) => {
      const f = l.view && l.view.file;
      if (f && f.path && /\.duowei$/i.test(f.path)) out.push(path.resolve(base, f.path));
    });
    return out;
  }

  /** 采集插件（独立插件，实例方法调用；**不用 require** —— A2 实测必失败） */
  collector() {
    const p = this.app.plugins.getPlugin("xhs-product-search");
    return (p && typeof p.collect === "function") ? p : null;
  }
  async collectorStatus() {
    const p = this.collector();
    if (!p) return { ok: false, why: "没装 / 没启用「小红书商品采集器」插件" };
    try {
      const d = await p.checkDeps();
      return d.ok
        ? { ok: true, version: d.version, scriptSource: d.scriptSource, mode: (typeof p.mode === "function" ? p.mode() : null) }
        : { ok: false, why: (d.problems || []).join("；") };
    } catch (e) {
      return { ok: false, why: "自检失败：" + (e && e.message ? e.message : String(e)) };
    }
  }

  /**
   * 建档 / 二次采集 —— 主流程。写库三纪律全在这：写前重读 → 表开着先拦 → 写后回读校验。
   * @param c      采集插件 collect() 的返回
   * @param pinName 品名（我方给品起的名字，判重依据）
   */
  async createArchiveFromCollect(c, pinName, targets) {
    const dw = this.dw;
    if (!dw) return { ok: false, error: "写库引擎（duowei.js）没载入，无法写库" };
    const fA = this.dwFile(TABLE_ARCHIVE), fT = this.dwFile(TABLE_TRACK);
    if (!fs.existsSync(fA) || !fs.existsSync(fT)) return { ok: false, error: "找不到表文件：" + fA + " ／ " + fT };

    // 勾选哪些表写（B2.5，老哥定的交互）：都勾 = 都写；复采时可以只勾「每日跟踪」
    const tg = targets && typeof targets === "object" ? targets : { archive: true, track: true };
    const wArchive = tg.archive !== false, wTrack = tg.track !== false;
    if (!wArchive && !wTrack) return { ok: false, error: "「测品档案 / 每日跟踪」至少要勾一个" };

    // ① 表开着先拦住
    const open = this.openDuoweiFiles();
    const conflict = [fA, fT].filter((f) => open.indexOf(path.resolve(f)) >= 0);
    if (conflict.length) {
      return { ok: false, error: "请先关掉这些表的标签页再写（否则编辑器内存态会盖掉写入）：" + conflict.map((f) => path.basename(f)).join("、") };
    }

    // ② 备份（库外，库内不留）
    const backups = [];
    try {
      backups.push(dw.backupTable(fA, BACKUP_ROOT));
      backups.push(dw.backupTable(fT, BACKUP_ROOT));
    } catch (e) {
      return { ok: false, error: "备份失败，已中止（不动表）：" + (e && e.message ? e.message : String(e)) };
    }

    // ③ 写前重读（不拿旧内存态）
    let A, T;
    try { A = dw.readTable(fA).obj; T = dw.readTable(fT).obj; }
    catch (e) { return { ok: false, error: "读表失败：" + (e && e.message ? e.message : String(e)), 备份: backups }; }
    const nA0 = A.records.length, nT0 = T.records.length;

    const F = (o, n) => {
      const f = dw.fieldByName(o, n);
      if (!f) throw new Error("表「" + o.name + "」里没有字段「" + n + "」");
      return f;
    };
    const optOf = (f, n) => {
      const o = (f.options || []).find((x) => x.name === n);
      if (!o) throw new Error("字段「" + f.name + "」没有选项「" + n + "」");
      return o.id;
    };

    let mode = "全部采写";
    const cp = this.collector();
    if (cp && typeof cp.mode === "function") mode = cp.mode();
    const diffOnly = mode !== "全部采写";

    const nowIso = new Date().toISOString();
    const today = todayLocal();
    const result = { ok: true, 模式: mode, 备份: backups, 动作: [], 变更: [] };

    try {
      // 每日跟踪的「品名」是**单选** → 新商品必须新增选项（否则写进去是空）
      const tNameF = F(T, "品名");
      const opt = dw.ensureOption(tNameF, pinName);
      if (opt.added) result.动作.push("每日跟踪.品名 新增选项「" + pinName + "」");

      const aNameF = F(A, "品名");
      let recA = A.records.find((r) => r.values[aNameF.id] === pinName);
      const recANew = !recA;

      // 只写「每日跟踪」的前提：档案已存在（每日跟踪.品 要指向档案行）
      if (!wArchive && recANew) {
        return { ok: false, error: "品名「" + pinName + "」还没有测品档案 —— 只写每日跟踪需要先有档案：把「测品档案」也勾上先建档，或检查品名", 备份: backups };
      }

      // 固定项（→ 测品档案）
      const fixed = [];
      const put = (name, v) => { const f = F(A, name); if (v !== null && v !== undefined) fixed.push({ f: f, v: v }); };
      put("商品标题", c.archive["商品标题"]);
      put("商品售价", c.archive["商品售价"]);
      put("对标到手价", c.archive["对标到手价"]);
      put("发货地", c.archive["发货地"]);
      put("店铺评分", c.archive["店铺评分"]);
      put("上架天数", c.archive["上架天数"]);
      put("上架日期", c.archive["上架日期"]);   // 09-30 老哥定（与上架天数并存）
      put("对标店铺", c.archive["对标店铺"] || c.archive["店铺名"]);   // 店铺采集/采集插件的「店铺名」→ 这一列
      // B2.8（老哥选定的 4 个新列，09-29 加）：
      put("SKU数", c.archive["SKU数"]);
      put("选中SKU", c.archive["选中SKU"]);
      put("店铺链接", c.archive["店铺链接"]);
      put("商品角标", c.archive["商品角标"]);   // 单品接口没有时，勾「店铺采集」从店铺页补
      // 09-30 老哥定（店铺三件套的另两个；「店铺名」落到上面的「对标店铺」）：
      put("店铺总销量", c.archive["店铺总销量"]);
      put("粉丝数", c.archive["粉丝数"]);

      if (!wArchive) {
        result.动作.push("测品档案：本次未勾选 → 跳过（档案保持不动）");
      } else if (recANew) {
        const values = {};
        values[aNameF.id] = pinName;
        values[F(A, "分区").id] = optOf(F(A, "分区"), OPT_DISTRICT_CAND);
        values[F(A, "来源").id] = optOf(F(A, "来源"), OPT_SOURCE_XHS);
        values[F(A, "入库日期").id] = today;
        fixed.forEach((x) => { values[x.f.id] = x.v; });
        recA = dw.makeRecord(values, nowIso);
        A.records.push(recA);
        result.动作.push("测品档案 新增「" + pinName + "」（分区=" + OPT_DISTRICT_CAND + "）");
      } else {
        fixed.forEach((x) => {
          const old = recA.values[x.f.id];
          if (old === x.v) return;
          if (!recANew) {
            recA.values[x.f.id] = x.v;
            if (old !== undefined) result.变更.push(x.f.name + " " + old + " → " + x.v);
          }
        });
        recA.updatedAt = nowIso;
        result.动作.push(diffOnly ? "测品档案 已有档案（变动才采：只写变了的固定项）" : "测品档案 已有档案（全采：固定项覆盖一遍）");
      }

      // 变动项（→ 每日跟踪）：今天已有该品的行就更新，否则新增（不勾「每日跟踪」就整段跳过）
      // 🔴 09-30 修：写入目标 = 「对标总单量」（**界面显示的那一列**）。
      //    「商品销量」与它同义、且卡片不显示该列（老哥 09-27 21:39 裁定）——
      //    之前写进了 `商品销量` → 数据落盘了但用户永远看不到，被判"没写进去"。
      const tDateF = F(T, "日期"), tPinF = F(T, "品"), tSoldF = F(T, "对标总单量"), tMemoF = F(T, "备注");
      const sold = c.track ? c.track["商品销量"] : null;
      let recT = null, tExisted = false;
      if (!wTrack) {
        result.动作.push("每日跟踪：本次未勾选 → 跳过");
      } else {
        const tNameOpt = optOf(tNameF, pinName);
        recT = T.records.find((r) => r.values[tDateF.id] === today && (r.values[tPinF.id] || []).indexOf(recA.id) >= 0);
        if (!recT) recT = T.records.find((r) => r.values[tDateF.id] === today && r.values[tNameF.id] === tNameOpt);
        tExisted = !!recT;

        if (!recT) {
          const tv = {};
          tv[tDateF.id] = today;
          tv[tPinF.id] = [recA.id];
          tv[tNameF.id] = tNameOpt;
          if (sold !== null && sold !== undefined) tv[tSoldF.id] = sold;
          recT = dw.makeRecord(tv, nowIso);
          T.records.push(recT);
          result.动作.push("每日跟踪 新增 " + today + " 一行（对标总单量 " + sold + "）");
        } else {
          if (sold !== null && sold !== undefined) recT.values[tSoldF.id] = sold;
          recT.updatedAt = nowIso;
          result.动作.push("每日跟踪 更新 " + today + " 那行（对标总单量 " + sold + "）");
        }
        // 变动才采：把 diff 记进备注（§13.5）
        if (diffOnly && result.变更.length) {
          const note = "采集 diff：" + result.变更.join("；");
          recT.values[tMemoF.id] = recT.values[tMemoF.id] ? recT.values[tMemoF.id] + " ｜ " + note : note;
        }
      }

      // relation（🔴 B2.5 修正）：「测品档案.我的数据」指向的是**「我的每日数据」表**
      // —— 之前这里把「每日跟踪」的行 id 写进去 = 写错表（会覆盖与我的每日数据的关联）。
      //    档案 ↔ 跟踪 之间只有单向字段：每日跟踪.品 → 档案（与库内既有数据约定一致）。
      if (wTrack) recT.values[tPinF.id] = [recA.id];

      if (wArchive) { A.meta = A.meta || {}; A.meta.updatedAt = nowIso; }
      if (wTrack) { T.meta = T.meta || {}; T.meta.updatedAt = nowIso; }
      A.name = A.name || TABLE_ARCHIVE; T.name = T.name || TABLE_TRACK;

      // ④ 写（临时文件 + 改名，保留文件尾换行）—— 只写勾选了的表
      if (wArchive) dw.writeTable(fA, A);
      if (wTrack) dw.writeTable(fT, T);

      // ⑤ 回读校验
      const A2 = dw.readTable(fA).obj, T2 = dw.readTable(fT).obj;
      const a2 = A2.records.find((r) => r.id === recA.id);
      const t2 = wTrack ? T2.records.find((r) => r.id === recT.id) : null;
      const checks = {
        档案记录回读到: wArchive ? !!a2 : "（跳过）",
        跟踪记录回读到: wTrack ? !!t2 : "（跳过）",
        档案品名: a2 ? a2.values[aNameF.id] : null,
        跟踪日期: t2 ? t2.values[tDateF.id] : null,
        跟踪销量: t2 ? t2.values[tSoldF.id] : null,
        跟踪侧关联: t2 ? (t2.values[tPinF.id] || []) : [],
        档案记录数: nA0 + " → " + A2.records.length,
        跟踪记录数: nT0 + " → " + T2.records.length,
        字段数未变: A2.fields.length === A.fields.length && T2.fields.length === T.fields.length,
        记录数增量符合预期: (A2.records.length - nA0) === (recANew ? 1 : 0) && (T2.records.length - nT0) === (wTrack && !tExisted ? 1 : 0),
        档案我的数据未被误动: true, // 下面对照写前备份实查
        文件尾仍是换行: fs.readFileSync(fA, "utf8").slice(-1) === "\n" && fs.readFileSync(fT, "utf8").slice(-1) === "\n",
      };
      // 护栏：「我的数据」指向「我的每日数据」表，采集写库不允许碰它
      try {
        const old = JSON.parse(fs.readFileSync(backups[0], "utf8"));
        const mf = dw.fieldByName(old, "我的数据");
        const oldRec = old.records.find((x) => x.id === recA.id);
        const mineBefore = oldRec ? oldRec.values[mf.id] : undefined;
        checks.档案我的数据未被误动 = JSON.stringify(a2 ? a2.values[mf.id] : undefined) === JSON.stringify(mineBefore);
      } catch (e2) { /* 备份读不了就跳过这一项 */ }
      const bad = [];
      if (wArchive && !checks.档案记录回读到) bad.push("档案记录回读不到");
      if (wTrack && !checks.跟踪记录回读到) bad.push("跟踪记录回读不到");
      if (wTrack && (checks.跟踪侧关联 || [])[0] !== recA.id) bad.push("跟踪侧关联不对");
      if (checks.档案我的数据未被误动 === false) bad.push("档案.我的数据 被误改了");
      if (!checks.字段数未变) bad.push("字段数变了");
      if (!checks.记录数增量符合预期) bad.push("记录数增量不对");
      if (!checks.文件尾仍是换行) bad.push("文件尾换行丢了");
      result.校验 = checks;
      result.archiveId = recA.id;
      result.trackId = recT ? recT.id : null;
      result.选项新增 = opt.added;
      if (bad.length) { result.ok = false; result.error = "回读校验没过：" + bad.join("、"); }
      return result;
    } catch (e) {
      return { ok: false, error: "写库中止：" + (e && e.message ? e.message : String(e)), 备份: backups };
    }
  }
  /** 齿轮点开的就是这个：Obsidian 设置 → 本插件页签 */
  openSettings() {
    const s = this.app.setting;
    if (s && s.openTabById) {
      s.open();
      s.openTabById(this.manifest.id);
    } else new Notice("打不开设置面板");
  }
  applyNameToViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => {
      if (l.view && typeof l.view.applyWbName === "function") l.view.applyWbName();
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /* ───── 数据读取层（只读） ───── */
  async loadSnapshot() {
    const ad = this.app.vault.adapter;
    const read = async (p) => { try { return await ad.read(p); } catch (e) { return null; } };
    const list = async (p) => { try { const r = await ad.list(p); return r && r.files ? r.files : []; } catch (e) { return []; } };

    const snap = { cards: [], templates: [], todo: 0, plan: null, daily: { count: 0, today: false }, dw: { ok: {} } };

    snap.plan = parsePlan(await read(P.plan));

    for (const f of await list(P.wencang)) {
      if (!/\.md$/.test(f) || /\/_模板-/.test(f)) continue;
      const txt = await read(f);
      if (txt == null) continue;
      const fm = parseFM(txt);
      if (fm.type !== "note") continue;
      snap.cards.push({ path: f, name: f.split("/").pop(), fm, title: firstH1(txt), chars: bodyChars(txt) });
    }
    for (const f of await list(P.tplDir)) {
      if (!/\.md$/.test(f) || /\/_模板-/.test(f)) continue;
      const txt = await read(f);
      if (txt == null) continue;
      const fm = parseFM(txt);
      if (fm.type !== "template") continue;
      snap.templates.push({ path: f, name: f.split("/").pop().replace(/\.md$/, ""), fm });
    }

    snap.todo = (await list(P.todoDir)).filter((f) => /\.md$/.test(f)).length;
    const dailies = (await list(P.dailyDir)).filter((f) => /\.md$/.test(f) && !/\/_模板-/.test(f));
    snap.daily = { count: dailies.length, today: dailies.some((f) => f.endsWith(todayISO() + ".md")) };

    snap.dw.ok.archive = await this.loadDw(snap, "archive", P.dwArchive);
    snap.dw.ok.track = await this.loadDw(snap, "track", P.dwTrack);
    snap.dw.ok.mine = await this.loadDw(snap, "mine", P.dwMine);
    const m = snap.dw.mine;
    snap.dw.mineToday = m ? m.records.some((r) => String(m.val(r, "日期") || "").startsWith(todayISO())) : false;

    return snap;
  }

  async loadDw(snap, key, file) {
    try {
      snap.dw[key] = loadDuowei(await this.app.vault.adapter.read(file));
      return true;
    } catch (e) {
      snap.dw[key] = null;
      snap.dw.ok.err = "duowei 读取失败：" + file + " — " + (e && e.message ? e.message : e);
      console.error("[xhs-workbench] duowei 读取失败", file, e);
      return false;
    }
  }
}

module.exports = XhsWorkbenchPlugin;
