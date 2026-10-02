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

const { Plugin, ItemView, Notice, Setting, PluginSettingTab, Modal, SuggestModal, TFolder, setIcon } = require("obsidian");
const fs = require("fs");
const path = require("path");

const VIEW_TYPE = "xhs-workbench-view";
const PLUGIN_DIR = ".obsidian/plugins/xhs-workbench";
const ROOT_SEL = ".xhs-wb-root";
const DEFAULT_SETTINGS = {
  wbName: "带货工作台",
  backupRoot: "",
  // V2 批 3.5（2026-10-01）：同步引擎改内嵌，原 `creatorScript` 废弃
  autoSyncOn: false,        // 「每天自动同步」开关
  autoSyncTime: "22:00",    // 自动同步时刻（HH:MM）
  creatorNode: "",          // 留空 = 自动探测 node.exe
  creatorOpencli: "",       // 留空 = 自动探测 opencli 的 main.js
  // V2 批 4（2026-10-01）：知识库页的收录白名单（空 = 用默认 5 个领域目录）
  incDirs: [],
  // ✏️ 2026-10-02 18:12 —— 老哥定：**图标固定用 rocket**，不要设置项（已删掉那个输入框 + 相关方法）
  ribbonIcon: "rocket",
  openOnStartup: false,     // 打开 Obsidian 时自动打开工作台（相当于"首页"）
};

/* @@INLINE-ASSETS-BEGIN@@ */
/* 本块由 工作台工具/inline-assets.py 生成 —— 勿手改；
   改 view.html / interact.js / duowei.js 后重跑脚本即可。 */
const INLINE_VIEW_HTML = "<!-- ⚠️ 本文件由 _UI稿/工作台-A改进版-20260926.html 于 B1 迁移而来（2026-09-29）。\n     视觉零改动；从此刻起「运行版 = 本文件」，原稿冻结为视觉参考，不要再改原稿。 -->\n<div class=\"xhs-wb-root wall-full\" id=\"xhs-wb-view\">\n<div class=\"shell top\">\n\n  <!-- 壁纸：默认「顶部模式」，所以初始就排在导航条之上（切到左侧模式时由 JS 搬回 main 内） -->\n  <div class=\"wall\" id=\"wall\">\n    <button class=\"wall-btn\" id=\"wallBtn\">更换壁纸</button>\n  </div>\n\n  <aside class=\"side\" id=\"side\">\n    <div class=\"side-head\">\n      <span class=\"side-title\">带货工作台</span>\n      <button class=\"side-toggle\" id=\"sideToggle\" aria-label=\"收起或展开左侧导航\" title=\"收起 / 展开\">‹</button>\n    </div>\n    <span class=\"nav on\" data-p=\"p-today\"><i class=\"nav-ic\">工</i><span class=\"nav-tx\">工作台</span></span>\n    <span class=\"nav\" data-p=\"p-output\"><i class=\"nav-ic\">创</i><span class=\"nav-tx\">创作台</span></span>\n    <span class=\"nav\" data-p=\"p-pick\"><i class=\"nav-ic\">选</i><span class=\"nav-tx\">选品池</span></span>\n    <span class=\"nav\" data-p=\"p-data\"><i class=\"nav-ic\">数</i><span class=\"nav-tx\">数据库</span></span>\n    <span class=\"nav\" data-p=\"p-know\"><i class=\"nav-ic\">知</i><span class=\"nav-tx\">知识库</span></span>\n    <div class=\"side-foot\">\n      <div class=\"sf-acct\">账号1</div>\n      <div class=\"sf-day\">Day 5/30</div>\n      <div class=\"dep-list\">\n        <span class=\"dep-i\"><i class=\"d\"></i>duowei</span>\n        <span class=\"dep-i\"><i class=\"d\"></i>importer</span>\n        <span class=\"dep-i\"><i class=\"d wr\"></i>opencli · 小木鱼</span>\n        <span class=\"dep-t\">同步 21:13</span>\n      </div>\n    </div>\n  </aside>\n\n  <main class=\"main\">\n    <div class=\"head\">\n      <div class=\"search\">\n        <svg class=\"search-ic\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"\n             stroke-width=\"2\" stroke-linecap=\"round\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.6-3.6\"/></svg>\n        <input class=\"search-in\" id=\"searchIn\" type=\"text\" placeholder=\"搜索整个库…\">\n\n        <div class=\"search-panel\" id=\"searchPanel\" hidden>\n          <div class=\"sr-filters\">\n            <button class=\"sr-f on\" data-t=\"all\" title=\"全部\">\n              <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></svg>\n            </button>\n            <button class=\"sr-f\" data-t=\"note\" title=\"笔记\">\n              <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/></svg>\n            </button>\n            <button class=\"sr-f\" data-t=\"image\" title=\"图片\">\n              <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg>\n            </button>\n            <button class=\"sr-f\" data-t=\"table\" title=\"表格\">\n              <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18M9 3v18\"/></svg>\n            </button>\n          </div>\n\n          <div class=\"sr-list\">\n            <div class=\"sr-item\" data-t=\"note\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">前后状态对比-不信精油-041</span><span class=\"sr-s\">笔记 · 20-文案库</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"note\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">_模板-爆款拆解卡</span><span class=\"sr-s\">笔记 · 20-文案库</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"note\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">受众地图-睡眠赛道-20260924</span><span class=\"sr-s\">笔记 · 20-文案库</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"image\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">01-创作看板-工作台</span><span class=\"sr-s\">图片 · _UI参考</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"image\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">02-创作看板-选题池</span><span class=\"sr-s\">图片 · _UI参考</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"table\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18M9 3v18\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">测品档案</span><span class=\"sr-s\">表格 · 多维表格</span></span>\n            </div>\n            <div class=\"sr-item\" data-t=\"table\">\n              <span class=\"sr-ic\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18M9 3v18\"/></svg></span>\n              <span class=\"sr-tx\"><span class=\"sr-t\">每日跟踪</span><span class=\"sr-s\">表格 · 多维表格</span></span>\n            </div>\n          </div>\n        </div>\n      </div>\n      <div class=\"head-r\">\n        <div class=\"head-top\">\n          <span class=\"date\">9月25日 星期五</span>\n          <button class=\"btn\" id=\"layoutBtn\">布局</button>\n        <button class=\"btn ic\" id=\"settingsBtn\" title=\"工作台设置\" aria-label=\"打开工作台设置\">\n          <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"\n               stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n            <circle cx=\"12\" cy=\"12\" r=\"3\"></circle>\n            <path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\"></path>\n          </svg>\n        </button>\n        </div>\n        <div class=\"layout-pop\" id=\"layoutPop\" hidden>\n          <div class=\"lp-t\">导航位置</div>\n          <div class=\"seg\">\n            <button class=\"seg-b on\" data-pos=\"top\">顶部</button>\n            <button class=\"seg-b\" data-pos=\"left\">左侧</button>\n          </div>\n\n          <div class=\"lp-t mt\">壁纸</div>\n          <button class=\"lp-wall-btn\" id=\"wallBtn2\">换一张壁纸（官方渐变）</button>\n          <button class=\"lp-wall-btn\" id=\"wallImgBtn\">选择图片做壁纸…</button>\n          <input type=\"file\" id=\"wallImgFile\" accept=\"image/png,image/jpeg,image/webp,image/gif\" style=\"display:none\" />\n\n          <div class=\"lp-t mt\">今天页的位置 · 4 个</div>\n          <div class=\"lp-now\">\n            <div class=\"lp-item\"><span>当前路线图</span><button class=\"lp-swap\">换</button></div>\n            <div class=\"lp-item\"><span>在测品</span><button class=\"lp-swap\">换</button></div>\n            <div class=\"lp-item\"><span>今晚回填</span><button class=\"lp-swap\">换</button></div>\n            <div class=\"lp-item\"><span>待发布队列</span><button class=\"lp-swap\">换</button></div>\n          </div>\n\n          <div class=\"lp-t mt\">轻量速览 · 4 个（从别的页搬进来）</div>\n          <div class=\"lp-pool\">\n            <button class=\"pool\">今日数据速览<i>测品</i></button>\n            <button class=\"pool\">对标动态<i>测品</i></button>\n            <button class=\"pool\">候选品速览<i>测品</i></button>\n            <button class=\"pool\">知识库收件箱<i>知识库</i></button>\n          </div>\n\n          <div class=\"lp-t mt\">功能入口 · 3 个（会把今天页撑厚）</div>\n          <div class=\"lp-pool\">\n            <button class=\"pool\">爆款采集入口<i>出稿</i></button>\n            <button class=\"pool\">商品采集入口<i>测品</i></button>\n            <button class=\"pool\">模板库战绩<i>出稿</i></button>\n          </div>\n\n          <div class=\"lp-hint\">拖模块之间的竖线可调列宽；也可以点模块标题旁的「换」，直接从这个池子里挑。</div>\n        </div>\n        <div class=\"settings-pop\" id=\"settingsPop\" hidden>\n          <div class=\"lp-t\">工作台名称</div>\n          <input class=\"sp-in\" id=\"wbName\" type=\"text\" value=\"带货工作台\">\n          <div class=\"lp-hint\">显示在左侧导航顶部，可随时改。</div>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"page\" id=\"p-today\">\n    <div class=\"mrow\">\n      <div class=\"met hero\"><div class=\"k\">待发布</div><div class=\"v num\">10</div><div class=\"d\">草稿待发</div></div>\n      <div class=\"met\"><div class=\"k\">在测品</div><div class=\"v num\">1</div><div class=\"d\">舒眠精油</div></div>\n      <div class=\"met\"><div class=\"k\">待拆解</div><div class=\"v num\">1</div><div class=\"d\">采一篇算一篇 · <button class=\"lnk\">去拆解 ›</button></div></div>\n      <div class=\"met alert\"><div class=\"k\">今日回填</div><div class=\"v\">未完成</div><div class=\"d\">后台已自动同步</div></div>\n    </div>\n\n    <div class=\"cols\">\n      <div class=\"blk\">\n        <div class=\"bh\"><div class=\"bt\">当前路线图</div><button class=\"swp\">换</button></div>\n        <div class=\"daywrap\">\n          <div class=\"dayhead\">\n            <span class=\"daynum num\">5</span><span class=\"dayof\">/ 30 天</span>\n            <span class=\"dayrest\"><b>基建周</b> · 剩 25 天</span>\n          </div>\n          <div class=\"days\">\n            <i class=\"on\"></i><i class=\"on\"></i><i class=\"on\"></i><i class=\"on\"></i><i class=\"today\"></i>\n            <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>\n            <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>\n            <i></i><i></i><i></i><i></i><i></i>\n          </div>\n          <div class=\"dayscale\"><span>Day 1</span><span>Day 30</span></div>\n        </div>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\"><div class=\"bt\">在测品</div><div class=\"grp\"><span class=\"r\">1 个</span><button class=\"swp\">换</button></div></div>\n        <div class=\"pname\">舒眠精油</div>\n        <div style=\"margin-bottom:12px\"><span class=\"pill wr\"><i></i>止损预警 · 数据未填</span></div>\n        <div class=\"kv\">累计笔记 0 · 订单 0 · 加购 0<br>对标到手价 18.90 · 单件利润 14.57</div>\n        <div class=\"sp\"></div>\n        <button class=\"btn pri full\">去创作台</button>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\"><div class=\"bt\">今晚回填</div><div class=\"grp\"><span class=\"r\">22:00 前</span><button class=\"swp\">换</button></div></div>\n        <div class=\"row\"><span class=\"d1\">今天</span><span class=\"tt\">笔记卡 YAML · 10 条</span><span class=\"pill\"><i></i>待填</span></div>\n        <div class=\"row\"><span class=\"d1\">今天</span><span class=\"tt\">我的每日数据 · 今日一行</span><span class=\"pill\"><i></i>待填</span></div>\n        <div class=\"row\"><span class=\"d1\">今天</span><span class=\"tt\">每日日志 · 今日一条</span><span class=\"pill\"><i></i>待写</span></div>\n        <div class=\"sp\"></div>\n        <button class=\"btn pri full\">开始回填</button>\n      </div>\n    </div>\n\n    <div class=\"blk\">\n      <div class=\"bh\">\n        <div style=\"display:flex;align-items:baseline;gap:10px\"><div class=\"bt\">待发布</div><span class=\"pill acc\"><i></i>草稿 10</span></div>\n        <div class=\"grp\"><span class=\"r\">显示 3 条 · 全部在创作台</span><button class=\"swp\">换</button></div>\n      </div>\n      <table class=\"tb\">\n        <!-- 状态列 86 → 104：数值列后新增了 40px 沟，86px 放不下药丸（实测溢出 12px） -->\n        <colgroup><col><col style=\"width:112px\"><col style=\"width:70px\"><col style=\"width:70px\"><col style=\"width:104px\"><col style=\"width:64px\"></colgroup>\n        <thead><tr><th>笔记</th><th>归属模板</th><th class=\"r\">曝光</th><th class=\"r\">阅读</th><th class=\"cc\">状态</th><th></th></tr></thead>\n        <tbody>\n          <tr>\n            <td class=\"tcell\"><div class=\"t-title\">躺下脑子还在开会，我换了睡前这件事</div><div class=\"t-sub\">004 时间线 · 生成于 09-24 01:41 · 舒眠精油</div></td>\n            <td class=\"mut\">004 时间线</td><td class=\"r dash num\">—</td><td class=\"r dash num\">—</td>\n            <td class=\"cc\"><span class=\"pill\"><i></i>草稿</span></td><td class=\"r\"><button class=\"btn\" style=\"padding:5px 12px\">打开</button></td>\n          </tr>\n          <tr>\n            <td class=\"tcell\"><div class=\"t-title\">白天吵完的架，晚上终于不重播了</div><div class=\"t-sub\">004 时间线 · 生成于 09-24 01:41 · 舒眠精油</div></td>\n            <td class=\"mut\">004 时间线</td><td class=\"r dash num\">—</td><td class=\"r dash num\">—</td>\n            <td class=\"cc\"><span class=\"pill\"><i></i>草稿</span></td><td class=\"r\"><button class=\"btn\" style=\"padding:5px 12px\">打开</button></td>\n          </tr>\n          <tr>\n            <td class=\"tcell\"><div class=\"t-title\">睡过去那一刻，我是真的不记得</div><div class=\"t-sub\">004 时间线 · 生成于 09-24 01:41 · 舒眠精油</div></td>\n            <td class=\"mut\">004 时间线</td><td class=\"r dash num\">—</td><td class=\"r dash num\">—</td>\n            <td class=\"cc\"><span class=\"pill\"><i></i>草稿</span></td><td class=\"r\"><button class=\"btn\" style=\"padding:5px 12px\">打开</button></td>\n          </tr>\n        </tbody>\n      </table>\n    </div>\n\n    <div class=\"tail\">待整理 3 · 知识 42 · 工具 12 &nbsp;→&nbsp; 知识库</div>\n    </div><!-- /p-today -->\n\n    <!-- ═══════ 2 · 创作台（出稿）═══════ -->\n    <div class=\"page\" id=\"p-output\" hidden>\n\n      <div class=\"phead\">\n        <div>\n          <div class=\"pt\">创作台</div>\n          <div class=\"ps\">爆款投喂 → 拆解 → 抽模板卡 → 生成笔记卡</div>\n        </div>\n        <span class=\"pill acc\"><i></i>草稿 10</span>\n      </div>\n\n      <div class=\"blk bar\">\n        <span class=\"bt\">爆款采集</span>\n        <input class=\"ipt\" placeholder=\"粘贴小红书笔记链接…\">\n        <button class=\"btn pri\">采集</button>\n        <span class=\"r\" style=\"margin-left:auto\">→ 落 20-文案库/待拆解/</span>\n      </div>\n\n      <div class=\"cols2\">\n        <div class=\"blk\">\n          <div class=\"bh\"><div class=\"bt\">生成请求单</div><span class=\"r\">5 条填完才可复制</span></div>\n          <div class=\"frow\">\n            <label>品</label><select class=\"sel\"><option>舒眠精油</option></select>\n            <label>模板</label><select class=\"sel\">\n              <optgroup label=\"实拍类\">\n                <option>004 时间线助眠体验</option>\n                <option>003 改造对比</option>\n              </optgroup>\n              <optgroup label=\"文字类\">\n                <option>005 前后状态对比</option>\n                <option>002 清单合集</option>\n                <option>001 痛点加方案</option>\n              </optgroup>\n            </select>\n            <label>选题</label><select class=\"sel\">\n              <optgroup label=\"一、首批开测（10 条）\">\n                <option>⭐1 加班白领 · 躺下脑子还停不下来</option>\n                <option>⭐2 协调/对接岗 · 脑子一直回放白天的争执</option>\n                <option>⭐9 倒班/夜班 · 天亮了反而睡不着</option>\n                <option>⭐14 浅眠党 · 一有动静就醒，醒了就睡不着</option>\n                <option>⭐16 多梦 · 乱七八糟的梦做完比没睡还累</option>\n                <option>⭐26 爱美女生 · 睡不好憔悴到粉底都盖不住</option>\n                <option>⭐31 喂夜奶的妈妈 · 身体累成狗，脑子却醒着</option>\n                <option>⭐35 出差党 · 换个地方就睡不好</option>\n                <option>⭐41 不信精油的人 · 一瓶精油能有多厉害？（怀疑者打脸）</option>\n                <option>⭐49 独居年轻人 · 明知道该睡了但就是不想睡</option>\n              </optgroup>\n              <optgroup label=\"A 职场压力（7 条）\">\n                <option>3 项目赶工期 · 连着一周凌晨两点睡</option>\n                <option>4 新晋主管 · 白天强撑，晚上焦虑</option>\n                <option>5 销售 · 明天见大客户，今晚睡不着</option>\n                <option>6 刚入职新人 · 反复回想白天说错的话</option>\n                <option>7 远程办公 · 工作生活没边界，晚上静不下来</option>\n                <option>8 打工人 · 一想到明天上班就清醒</option>\n                <option>12 夜班客服 · 说了一晚上话，脑子停不下来</option>\n              </optgroup>\n              <optgroup label=\"B 倒班/夜班（4 条）\">\n                <option>10 倒班工人 · 作息来回倒，躺下就清醒</option>\n                <option>11 网约车司机 · 神经还兴奋着</option>\n                <option>13 值班应急岗 · 怕来电话，一晚睡不实</option>\n                <option>47 赶工手作人 · 白天黑夜彻底颠倒</option>\n              </optgroup>\n              <optgroup label=\"C 浅眠易醒（3 条）\">\n                <option>15 浅眠党 · 四点准时醒，之后睡不着</option>\n                <option>17 合租室友 · 别人一动我就醒</option>\n                <option>19 怕黑开灯睡 · 有光就睡不实</option>\n              </optgroup>\n              <optgroup label=\"D 焦虑思绪（5 条）\">\n                <option>22 爱操心 · 白天的小事晚上全冒出来</option>\n                <option>23 完美主义 · 反复回想白天说错的话</option>\n                <option>24 想太多 · 选择困难想到睡不着</option>\n                <option>25 打工人 · 一周里最难入睡的一晚</option>\n                <option>50 换季/雨天 · 越躺越清醒</option>\n              </optgroup>\n              <optgroup label=\"E 颜值/状态（4 条）\">\n                <option>27 爱上镜 · 黑眼圈遮不住</option>\n                <option>28 痘肌 · 睡不好第二天必冒痘（**只写状态，不写功效**）</option>\n                <option>29 职场人 · 蔫得像被雨淋透</option>\n                <option>30 聚会回来 · 被说状态差</option>\n              </optgroup>\n              <optgroup label=\"F 带娃家庭（3 条）\">\n                <option>32 陪写作业 · 气到心跳快，躺下睡不着</option>\n                <option>33 哄睡成功后 · 好不容易自由了，却睡不着</option>\n                <option>34 全职妈妈 · 晚上才是自己的时间，舍不得睡</option>\n              </optgroup>\n              <optgroup label=\"G 出行场景（2 条）\">\n                <option>36 长途火车/飞机 · 睡不实</option>\n                <option>37 认床 · 陌生环境睡不着</option>\n              </optgroup>\n              <optgroup label=\"H 情侣/同住（3 条）\">\n                <option>38 作息不同 · 对方晚睡，自己跟着晚</option>\n                <option>39 被打呼吵 · 半夜被吵醒就再也睡不着</option>\n                <option>40 异地恋 · 聊完太兴奋睡不着</option>\n              </optgroup>\n              <optgroup label=\"I 理性党（3 条）\">\n                <option>42 内服替代 · 想找**外用**的放松方式（**不提药效对比**）</option>\n                <option>43 用过别家 · 之前买的没感觉，这次换了家</option>\n                <option>44 手环党 · 深睡时间太短，想改善作息</option>\n              </optgroup>\n              <optgroup label=\"J 特殊场景（5 条）\">\n                <option>18 恋家 · 离开自己的床就睡不好</option>\n                <option>45 健身党 · 神经兴奋放不下来</option>\n                <option>46 短视频熬夜党 · 说好 10 点睡，刷着刷着又 1 点</option>\n                <option>48 节后调整 · 生物钟乱了</option>\n                <option>20 备考学生 · 越逼自己睡越清醒</option>\n                <option>21 备考家长 · 孩子睡不好，自己跟着熬</option>\n              </optgroup>\n              <optgroup label=\"K 嗅觉通感（4 条 · 源自 #10 请大数据）\">\n                <option>51 对气味敏感的人 · 闻不到味道就放松不下来</option>\n                <option>52 出差党 · 陌生的味道让人躺不住</option>\n                <option>53 一天都在听人说话的人 · 只想闻点干净的、谁也别说话</option>\n                <option>54 挑礼物的人 · 送什么她都闻得出好坏</option>\n              </optgroup>\n              <optgroup label=\"L 可验证证据（3 条 · 源自 #11 连续一个月）\">\n                <option>55 戴手环的人 · 深睡时长一直上不去</option>\n                <option>56 同事眼里的变化 · 被追问是不是换了护肤品</option>\n                <option>57 上班打卡族 · 睡够了，全勤奖没了也值</option>\n              </optgroup>\n              <optgroup label=\"M 前后对照（2 条 · 源自 #9 低能量女生）\">\n                <option>58 一晚醒好几次的人 · ❌以前一晚醒 2-3 次 → ✅现在一觉到闹钟响</option>\n                <option>59 四点准时醒的人 · 醒了就再也睡不着，天亮才困</option>\n              </optgroup>\n              <optgroup label=\"N 低成本续命（2 条 · 源自 #9 结尾）\">\n                <option>60 加班到深夜的人 · 护肤太贵，睡够才是低成本续命</option>\n                <option>61 不想花钱的人 · 助眠仪太贵，先试试这个</option>\n              </optgroup>\n            </select>\n            <label>条数</label><input class=\"ipt\" value=\"3\">\n          </div>\n          <div class=\"five\">\n            <div class=\"lp-t\">简述与参考 · AI 先起草，你只审改（5 条缺一不可，填完才可复制）</div>\n            <textarea class=\"ta\" rows=\"6\">- 写给谁看：凌晨刷手机停不下来、白天还要上班的人\n- 这条只做什么：只讲「我把睡前那件事换掉之后发生了什么」\n- 这条不展开什么：不科普成分、不提价格、不劝人买\n- 观众要听懂：为什么用时间线，而不是功能介绍\n- 结尾互动：你睡前最后一件事是什么</textarea>\n            <div class=\"lp-hint\">自检：把这条念出来，换个人照着写也能写出同一篇 → 合格；听完还得问\"那到底不写什么\" → 不合格。</div>\n          </div>\n          <button class=\"btn pri full\">复制提示词 → 去 OB 对话面板生成</button>\n        </div>\n\n        <div class=\"blk\">\n          <div class=\"bh\"><div class=\"bt\">模板库 · 战绩</div><span class=\"r\">5 张</span></div>\n          <table class=\"tb\">\n            <colgroup><col><col style=\"width:78px\"><col style=\"width:88px\"><col style=\"width:56px\"></colgroup>\n            <thead><tr><th>模板</th><th>结构类型</th><th>来源</th><th class=\"r\">已测</th></tr></thead>\n            <tbody>\n              <tr><td class=\"tcell\"><div class=\"t-title\">004 时间线助眠体验</div></td><td class=\"mut\">实拍类</td><td class=\"mut\">同品对标</td><td class=\"r mut num\">0</td></tr>\n              <tr><td class=\"tcell\"><div class=\"t-title\">003 改造对比</div></td><td class=\"mut\">实拍类</td><td class=\"mut\">通用方法论</td><td class=\"r mut num\">0</td></tr>\n              <tr><td class=\"tcell\"><div class=\"t-title\">005 前后状态对比</div></td><td class=\"mut\">文字类</td><td class=\"mut\">同品对标</td><td class=\"r mut num\">0</td></tr>\n              <tr><td class=\"tcell\"><div class=\"t-title\">002 清单合集</div></td><td class=\"mut\">文字类</td><td class=\"mut\">通用方法论</td><td class=\"r mut num\">0</td></tr>\n              <tr><td class=\"tcell\"><div class=\"t-title\">001 痛点加方案</div></td><td class=\"mut\">文字类</td><td class=\"mut\">通用方法论</td><td class=\"r mut num\">0</td></tr>\n            </tbody>\n          </table>\n          <div class=\"sp\"></div>\n          <button class=\"btn pri full\">全部模板卡 ›</button>\n        </div>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\">\n          <div style=\"display:flex;align-items:baseline;gap:10px\"><div class=\"bt\">笔记卡列表</div><span class=\"pill acc\"><i></i>待发布 10</span></div>\n          <div class=\"grp\">\n            <button class=\"subtab on\">全部</button><button class=\"subtab\">草稿</button><button class=\"subtab\">已发布</button><button class=\"subtab\">已归档</button>\n            <input class=\"search-in\" type=\"text\" placeholder=\"搜索…\" style=\"width:140px;height:28px;font-size:12px\">\n          </div>\n        </div>\n        <table class=\"tb\">\n          <colgroup><col><col style=\"width:118px\"><col style=\"width:62px\"><col style=\"width:62px\"><col style=\"width:44px\"><col style=\"width:44px\"><col style=\"width:44px\"><col style=\"width:104px\"><col style=\"width:76px\"></colgroup>\n          <thead><tr><th>笔记</th><th>归属模板</th><th class=\"r\">曝光</th><th class=\"r\">阅读</th><th class=\"r\">赞</th><th class=\"r\">藏</th><th class=\"r\">评</th><th>状态</th><th></th></tr></thead>\n          <tbody>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">我本来是来打假的</div><div class=\"t-sub\">舒眠精油 · 正文 314 字</div></td>\n              <td class=\"mut\">005 前后状态对比</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"0\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">睡够八小时还是累，问题可能不在时长</div><div class=\"t-sub\">舒眠精油 · 正文 265 字</div></td>\n              <td class=\"mut\">005 前后状态对比</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"1\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">以前一晚醒三四次，现在能睡到天亮</div><div class=\"t-sub\">舒眠精油 · 正文 329 字</div></td>\n              <td class=\"mut\">005 前后状态对比</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"2\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">睡不好那阵子，粉底都盖不住我这张脸</div><div class=\"t-sub\">舒眠精油 · 正文 289 字</div></td>\n              <td class=\"mut\">005 前后状态对比</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"3\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">白天吵完的架，晚上终于不重播了</div><div class=\"t-sub\">舒眠精油 · 正文 374 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"4\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">下夜班回家，天亮了我反而睡不着</div><div class=\"t-sub\">舒眠精油 · 正文 359 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"5\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">换张床就睡不好的人，出差是酷刑</div><div class=\"t-sub\">舒眠精油 · 正文 290 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"6\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">像断电一样沉，一觉到天亮</div><div class=\"t-sub\">舒眠精油 · 正文 424 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"7\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">喂完夜奶，宝宝睡回去了，我醒了</div><div class=\"t-sub\">舒眠精油 · 正文 326 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"8\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">睡过去那一刻，我是真的不记得</div><div class=\"t-sub\">舒眠精油 · 正文 350 字</div></td>\n              <td class=\"mut\">004 时间线助眠体验</td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td><td class=\"r dash num\">&mdash;</td>\n              <td><span class=\"pill\"><i></i>草稿</span></td>\n              <td class=\"r\"><button class=\"btn\" data-open data-i=\"9\" style=\"padding:5px 12px\">打开</button></td>\n            </tr>\n          </tbody>\n        </table>\n        <div class=\"tail\">曝光／阅读／赞／藏／评 5 列直接并排 = 「自动同步」的兑现处（以前要手抄）· <strong>「—」= 后台还没有值，不是 0</strong></div>\n      </div>\n    </div>\n\n    <!-- ═══════ 3 · 选品池（测品）═══════ -->\n    <div class=\"page\" id=\"p-pick\" hidden>\n\n      <div class=\"phead\">\n        <div>\n          <div class=\"pt\">选品池</div>\n          <div class=\"ps\">判定与进度一眼可见 · 采集入口常驻最上方</div>\n        </div>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\">\n          <div class=\"bt\">商品数据采集</div>\n          <span class=\"r\">上次采集 09-22 22:04</span>\n        </div>\n        <div class=\"capnote\">商品链接采单品 · <strong>整段分享文案也能粘</strong> · 店铺链接采该店首页商品（选一个建候选品）· <strong>写哪张表可勾选 · 勾「店铺采集」= 顺带该店商品列表与角标</strong> · 笔记采集在创作台</div>\n        <div class=\"capblk\">\n          <input class=\"ipt\" placeholder=\"粘贴商品/店铺链接、分享文案或商品 ID…\">\n          <span class=\"cap-lb\">采写模式</span>\n          <div class=\"grp\">\n            <button class=\"subtab on\">变动才采</button><button class=\"subtab\">全采</button>\n          </div>\n          <button class=\"btn pri\">采集</button>\n        </div>\n      </div>\n\n      <div class=\"statbar\">\n        <span class=\"stat\"><span class=\"k\">在测品</span><span class=\"n\">1</span></span>\n        <span class=\"stat\"><span class=\"k\">每日跟踪</span><span class=\"n\">12</span></span>\n        <span class=\"stat\"><span class=\"k\">候选品</span><span class=\"n\">2</span></span>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"tc-top\">\n          <span class=\"tc-name\">舒眠精油</span>\n          <span class=\"pill wr\"><i></i>止损预警 · 数据未填</span>\n          <span class=\"pill\"><i></i>全年长销</span>\n          <span class=\"tc-acts\">\n            <button class=\"btn\">去创作台</button>\n            <button class=\"btn\">去 duowei 编辑</button>\n          </span>\n        </div>\n        <div class=\"kpi6 kpi-7\">\n          <div class=\"kpi\"><div class=\"k\">对标到手价</div><div class=\"v num\">18.90</div></div>\n          <div class=\"kpi\"><div class=\"k\">1688 成本</div><div class=\"v num\">3.20</div></div>\n          <div class=\"kpi\"><div class=\"k\">毛利</div><div class=\"v num\">15.70</div></div>\n          <div class=\"kpi\"><div class=\"k\">单件利润</div><div class=\"v num\">14.57</div></div>\n          <div class=\"kpi\"><div class=\"k\">累计笔记</div><div class=\"v num\">0</div></div>\n          <div class=\"kpi\"><div class=\"k\">累计订单</div><div class=\"v num\">0</div></div>\n          <div class=\"kpi\"><div class=\"k\">上架天数</div><div class=\"v num\">43 天</div></div>\n        </div>\n        <div class=\"tc-foot\">对标账号 桃子味的小困意 · 对标店铺 夜禾安的店 · 来源 千帆榜单 · 店铺评分 4.71 · 发货地 福建泉州（均采自商品）· 止损预警只在本页出现</div>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\">\n          <div style=\"display:flex;align-items:baseline;gap:10px\"><div class=\"bt\">候选品</div><span class=\"pill acc\"><i></i>2 个</span></div>\n          <div class=\"bhr\">\n            <span class=\"r\">只显示重点数据 · 不显示止损预警</span>\n            <button class=\"btn\" style=\"padding:5px 12px\">去 duowei 编辑 ›</button>\n          </div>\n        </div>\n        <table class=\"tb\">\n          <!-- 同一套骨架（尾部文字列同为 22%）。9 列：品级固定数据一屏看完 -->\n          <colgroup><col style=\"width:12%\"><col style=\"width:9.5%\"><col style=\"width:9.5%\"><col style=\"width:9%\"><col style=\"width:9.5%\"><col style=\"width:9%\"><col style=\"width:9.5%\"><col style=\"width:10%\"><col style=\"width:22%\"></colgroup>\n          <thead><tr><th>品名</th><th class=\"r\">对标到手价</th><th class=\"r\">1688成本</th><th class=\"r\">毛利</th><th class=\"r\">单件利润</th><th class=\"r\">店铺评分</th><th class=\"r\">上架天数</th><th class=\"r\">开店天数</th><th>对标账号</th></tr></thead>\n          <tbody>\n            <tr><td class=\"t-title link\" title=\"打开该条记录\">星星人转转摆件</td><td class=\"r num\">¥19.90</td><td class=\"r num\">¥10.00</td><td class=\"r num\">¥9.90</td><td class=\"r num\">¥8.71</td><td class=\"r num\">4.62</td><td class=\"r dash num\">未填</td><td class=\"r dash num\">未填</td><td class=\"mut\">贝贝xww</td></tr>\n            <tr><td class=\"t-title link\" title=\"打开该条记录\">星空小夜灯</td><td class=\"r num\">¥49.00</td><td class=\"r num\">¥28.00</td><td class=\"r num\">¥21.00</td><td class=\"r num\">¥18.06</td><td class=\"r num\">4.72</td><td class=\"r dash num\">未填</td><td class=\"r dash num\">未填</td><td class=\"mut\">钱途超哇塞</td></tr>\n          </tbody>\n        </table>\n        <div class=\"tail\">取自 <strong>测品档案.duowei</strong> · 只列 <strong>分区＝候选池</strong> 的品（<strong>已归档的不属于候选品</strong>）· 编辑一律跳 duowei<br><strong>上架天数／开店天数 目前为空</strong> —— 库里 5 条记录都还没采到这两项，显示「未填」（<strong>不是 0</strong>）</div>\n      </div>\n\n      <div class=\"blk\" data-fold=\"10\">\n        <div class=\"bh\">\n          <div style=\"display:flex;align-items:baseline;gap:10px\"><div class=\"bt\">每日跟踪</div><span class=\"pill acc\"><i></i>12 条</span></div>\n          <div class=\"bhr\">\n            <span class=\"r\">7 个字段全平铺 · 每天 22:00 采一行 · 横版不再需要把列塞进悬浮窗</span>\n            <button class=\"btn\" style=\"padding:5px 12px\">去 duowei 编辑 ›</button>\n          </div>\n        </div>\n        <table class=\"tb\">\n          <!-- 列宽骨架：文字列窄、数值列铺满整行（数值一律右对齐 → 两张表\"同族\"）；\n               尾部文字列**两表同为 22%** → 起点完全对齐。\n               「商品销量」已删（老哥 09-27 21:39：与「对标总单量」同义，且库里 12 行全空） -->\n          <colgroup><col style=\"width:7%\"><col style=\"width:14%\"><col style=\"width:19%\"><col style=\"width:18%\"><col style=\"width:20%\"><col style=\"width:22%\"></colgroup>\n          <thead><tr><th>日期</th><th>品名</th><th class=\"r\">对标总单量</th><th class=\"r\">对标今日单量</th><th class=\"r\">对标24h购买数</th><th>备注</th></tr></thead>\n          <tbody>\n<tr><td class=\"mut num\">09-22</td><td class=\"t-title link\" title=\"打开该条记录\">舒眠精油</td><td class=\"r num\">12,000</td><td class=\"r num\">0</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-22</td><td class=\"t-title link\" title=\"打开该条记录\">星空小夜灯</td><td class=\"r num\">10,000</td><td class=\"r num\">0</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-22</td><td class=\"t-title link\" title=\"打开该条记录\">星星人转转摆件</td><td class=\"r num\">10,000</td><td class=\"r num\">0</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-21</td><td class=\"t-title link\" title=\"打开该条记录\">舒眠精油</td><td class=\"r num\">12,000</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-21</td><td class=\"t-title link\" title=\"打开该条记录\">星空小夜灯</td><td class=\"r num\">10,000</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-21</td><td class=\"t-title link\" title=\"打开该条记录\">星星人转转摆件</td><td class=\"r num\">10,000</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-16</td><td class=\"t-title link\" title=\"打开该条记录\">舒眠精油</td><td class=\"r num\">9,402</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">09-07 入库时 4,001</td></tr>\n<tr><td class=\"mut num\">09-08</td><td class=\"t-title link\" title=\"打开该条记录\">星星人转转摆件</td><td class=\"r num\">10,000</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-08</td><td class=\"t-title link\" title=\"打开该条记录\">星空小夜灯</td><td class=\"r num\">5,124</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-07</td><td class=\"t-title link\" title=\"打开该条记录\">舒眠精油</td><td class=\"r num\">4,001</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">入库当日记</td></tr>\n<tr><td class=\"mut num\">09-06</td><td class=\"t-title link\" title=\"打开该条记录\">润肺六物饮</td><td class=\"r num\">7,662</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n<tr><td class=\"mut num\">09-05</td><td class=\"t-title link\" title=\"打开该条记录\">藤条香薰</td><td class=\"r num\">8,441</td><td class=\"r num\">—</td><td class=\"r dash\">未填</td><td class=\"mut\">—</td></tr>\n          </tbody>\n        </table>\n        <div class=\"tail\">「—」= 该次采集未记这一项，<strong>不是 0</strong> · 库内「品」是关联字段，本表用「品名」表达<br>不显示「商品销量」列 —— 它与「对标总单量」同义（老哥 09-27 21:39 指出）</div>\n      </div>\n    </div>\n\n    <!-- ═══════ 4 · 数据库 ═══════ -->\n    <div class=\"page\" id=\"p-data\" hidden>\n\n      <div class=\"phead\">\n        <div>\n          <div class=\"pt\">数据库</div>\n          <div class=\"ps\">账号概览、内容分析与粉丝数据</div>\n        </div>\n        <span class=\"pill acc\"><i></i>已同步 1 个号</span>\n      </div>\n\n      <div class=\"srcbar\">\n        <div>\n          <div class=\"sb-t\">后台已连接</div>\n          <div class=\"sb-s\">自动同步：<strong>每天 22:00 一次</strong>（跟采集／回填同一个 22:00 节奏）· 其他时候点「立即同步」才去拉</div>\n          <div class=\"sb-s\">最近成功：2026/9/26 21:16:34 · 保持 Edge 与 Obsidian 运行，登录失效时需重新登录。</div>\n          <!-- 数据范围（老哥 09-28 10:53：三个子页签要显示\"所有账号\"的信息）\n               所以这里不是\"同步目标\"，而是\"看哪些号的数据\" —— 默认全部已同步号。\n               「号」的判定 = **装了 OpenCLI 扩展且已登录小红书** 的那个 Edge profile。 -->\n          <div class=\"sb-acc\">\n            <span>数据范围</span>\n            <select class=\"acc-sel\">\n              <option>全部已同步号（1 个）</option>\n              <option>小木鱼（Edge profile：川杏子）</option>\n            </select>\n            <span class=\"mut\">本机 8 个 Edge profile，其中 <strong>1 个装了扩展并已同步</strong> ·\n              <strong>加号 = 在 Edge 新建 profile → 登录小红书 → 再装一次 OpenCLI 扩展</strong></span>\n          </div>\n        </div>\n        <div class=\"grp\">\n          <label class=\"sw\"><input type=\"checkbox\" checked><i></i>每天 22:00 自动同步</label>\n          <button class=\"btn pri\" id=\"syncNow\">立即同步</button>\n        </div>\n      </div>\n\n      <div class=\"subtabs\" id=\"dataTabs\">\n        <button class=\"subtab on\" data-dt=\"dOv\">账号概览</button>\n        <button class=\"subtab\" data-dt=\"dAn\">内容分析</button>\n        <button class=\"subtab\" data-dt=\"dFans\">粉丝数据</button>\n        <span class=\"meta-r\">2026-08-28 至 2026-09-26 · 采集于 2026/9/26 21:16:02 · 已发布 1 条（未发布不计入本页）</span>\n      </div>\n\n      <!-- ═══ 子页签 1 · 账号概览（09-28 按线稿补回：原来把这块整段丢了）═══\n           数据源 = creator-stats 的 9 项直接产出（已实测，落盘在\n           xhs-creator-sync/_data/creator-latest.json）。这里收成线稿那 6 张卡。 -->\n      <section id=\"dOv\">\n        <div class=\"blk\">\n          <div class=\"bh\">\n            <div class=\"bt\">账号概览 · 按号分开</div>\n            <span class=\"r\">同步于 09-25 21:13 · 每项带近 7 天 · 多号时每号一组往下叠</span>\n          </div>\n          <!-- 每号一组（老哥 09-28 11:04：多号混在一起看不出哪号是哪号的数据）。\n               多号时复制整块 .acc-grp 往下叠，组间自带分隔线。 -->\n          <div class=\"acc-grp\">\n            <div class=\"acc-h\">\n              <span class=\"pill\"><i></i>小木鱼</span>\n              <span class=\"kt\">Edge profile：川杏子</span>\n            </div>\n          <div class=\"kpi6\">\n            <div class=\"kpi\"><div class=\"k\">观看数</div><div class=\"v num\">0</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n            <div class=\"kpi\"><div class=\"k\">平均观看时长</div><div class=\"v num\">0s</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n            <div class=\"kpi\"><div class=\"k\">主页访问</div><div class=\"v num\">0</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n            <div class=\"kpi\"><div class=\"k\">点赞 / 收藏</div><div class=\"v num\">0 / 0</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n            <div class=\"kpi\"><div class=\"k\">评论 / 分享</div><div class=\"v num\">0 / 0</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n            <div class=\"kpi\"><div class=\"k\">涨粉</div><div class=\"v num\">0</div>\n              <div class=\"sp7\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class=\"kt\">近 7 天 0 → 0</div></div>\n          </div>\n          </div>\n          <div class=\"tail\">数据源 = <strong>creator-stats 的 9 项直接产出</strong>（已实测；这里收成 6 张卡，另有「弹幕数」）·\n            每张卡的「近 7 天」是<strong>逐日 7 个值</strong>的真实字段 ——\n            本机测试号「小木鱼」全为 0，<strong>是 0 不是没采到</strong><br>\n            缺口 = 曝光／封面点击率／观众画像那批 —— <strong>要平台肯给</strong>，给不了就降级（不当 0）</div>\n        </div>\n      </section>\n\n      <!-- ═══ 子页签 2 · 内容分析 ═══\n           老哥 09-28 11:10：跟账号概览一样**按号分组成块往下叠**，不要所有号的笔记混一张表。\n           老哥 09-28 11:19：**本页只放已发布笔记** —— 未发布的在创作台看得到，放这里是重复\n           （所以「草稿」那一组已删除，不是没做）。\n           每组默认最多 5 条，超出折叠；每次展开 +10；「收起」一次性回到 5。\n           （折叠规则写在 data-fold / data-fold-step 上，JS 通用逻辑处理） -->\n      <section id=\"dAn\" hidden>\n\n      <div class=\"blk\">\n        <div class=\"bh\">\n          <div class=\"bt\">内容分析 · 按号分开</div>\n          <span class=\"r\">2026-08-28 至 2026-09-26 · 每号一组 · 每组默认 5 条 · 只含已发布</span>\n        </div>\n\n        <!-- 组 1｜小木鱼（真实已发布笔记，数据来自 creator-latest.json） -->\n        <div class=\"acc-grp\">\n          <div class=\"acc-h\">\n            <span class=\"pill\"><i></i>小木鱼</span>\n            <span class=\"kt\">Edge profile：川杏子</span>\n            <span class=\"r\">1 条</span>\n          </div>\n          <div data-fold=\"5\" data-fold-step=\"10\">\n            <table class=\"tb\">\n              <colgroup><col><col style=\"width:68px\"><col style=\"width:68px\"><col style=\"width:86px\"><col style=\"width:58px\"><col style=\"width:58px\"><col style=\"width:58px\"><col style=\"width:58px\"><col style=\"width:58px\"><col style=\"width:96px\"><col style=\"width:96px\"></colgroup>\n              <thead><tr><th>笔记基础信息</th><th class=\"r\">曝光</th><th class=\"r\">观看</th><th class=\"r\">封面点击率</th><th class=\"r\">点赞</th><th class=\"r\">评论</th><th class=\"r\">收藏</th><th class=\"r\">涨粉</th><th class=\"r\">分享</th><th class=\"r\">人均观看时长</th><th></th></tr></thead>\n              <tbody>\n            <tr>\n              <td class=\"tcell\"><div class=\"t-title\">47出网易云</div><div class=\"t-sub\">已发布 · 2024-06-07 23:27 · 观看 203</div></td>\n              <td class=\"r dash num\">&mdash;</td><td class=\"r num\">203</td><td class=\"r dash num\">&mdash;</td><td class=\"r num\">0</td><td class=\"r num\">1</td><td class=\"r num\">0</td><td class=\"r dash num\">&mdash;</td><td class=\"r num\">0</td><td class=\"r dash num\">&mdash;</td>\n              <td class=\"r\"><button class=\"btn\" data-an style=\"padding:5px 11px\">分析详情 &rsaquo;</button></td>\n            </tr>\n              </tbody>\n            </table>\n          </div>\n        </div>\n\n        <div class=\"tail\"><strong>只统计已发布笔记</strong> —— 未发布的笔记在<strong>创作台</strong>看（本页不重复放）· 发布后自动进对应号那一组<br>\n          <strong>折叠规则</strong>：每组默认最多 5 条，超出部分收起 · 每次点「展开」多显示 10 条 · 点「收起」<strong>一次性回到 5 条</strong><br>\n          「&mdash;」= 后台未提供，<strong>不能当作 0</strong> · 本页只读，明细只做一处<br>\n          「小木鱼」那行的 <strong>0 / 1 / 0 / 0</strong> 是后台返回的真实值（点 0 赞 0 收藏 0 分享 1 评论），与「&mdash;」是两回事<br>\n          <strong>「分析详情」</strong> = 单篇深度（观看来源／观众画像／趋势）—— 需<strong>发过笔记的号</strong>才能确认平台给不给；给不了就降级</div>\n      </div>\n\n      <div class=\"blk\">\n        <div class=\"bh\">\n          <!-- 号筛选（老哥 09-28 11:19：「这个就用筛选方式吧」）——\n               这页是跨号排行，所以不分组、给一个筛选：\n               「全部号」= 各号放一起比（排行的意义就在横向比）；选单号 = 只看那个号。\n               位置（09-28 11:21）：**紧跟「笔记表现」标题**，不与右侧指标切换混在一组。 -->\n          <div class=\"bh-l\">\n            <div class=\"bt\">笔记表现</div>\n            <select class=\"acc-sel\" id=\"rankAcc\" style=\"max-width:180px\">\n              <option>全部号（1）</option>\n              <option>小木鱼</option>\n            </select>\n          </div>\n          <div class=\"grp\">\n            <button class=\"subtab on\">观看</button><button class=\"subtab\">点赞</button><button class=\"subtab\">收藏</button><button class=\"subtab\">涨粉</button>\n          </div>\n        </div>\n        <div class=\"rank\">\n          <div class=\"rk\">\n            <div class=\"rk-t\">47出网易云 <span style=\"color:var(--ink-3);font-weight:500\">· 小木鱼</span></div>\n            <div class=\"rk-bar\"><i style=\"width:100%\"></i></div>\n            <div class=\"rk-v num\">203</div>\n          </div>\n        </div>\n        <div class=\"tail\">只统计<strong>已发布</strong>笔记（当前 1 篇，属于「小木鱼」）· 未发布的在<strong>创作台</strong>看，发布后自动进榜<br>\n          未选到号时显示「全部号」＝ <strong>各号放一起横向比</strong>（排行的意义就在比）；选单号只看那一个 · 数值来自创作者后台，未返回时显示「&mdash;」</div>\n      </div>\n\n      </section>\n\n      <!-- ═══ 子页签 3 · 粉丝数据（用 creator-profile 的真实资料，不摆空图）═══ -->\n      <section id=\"dFans\" hidden>\n        <div class=\"blk\">\n          <div class=\"bh\">\n            <div class=\"bt\">账号资料</div>\n            <span class=\"r\">同步于 09-25 21:13</span>\n          </div>\n          <!-- 多号时每号一行（可直接比），不是\"只看一个号\" -->\n          <table class=\"tb\">\n            <colgroup><col><col style=\"width:84px\"><col style=\"width:84px\"><col style=\"width:104px\"><col style=\"width:104px\"><col style=\"width:104px\"><col></colgroup>\n            <thead><tr><th>号</th><th class=\"r\">粉丝数</th><th class=\"r\">关注数</th><th class=\"r\">获赞与收藏</th><th class=\"r\">创作者等级</th><th class=\"r\">升级进度</th><th>简介</th></tr></thead>\n            <tbody>\n              <tr><td class=\"t-title\">小木鱼</td><td class=\"r num\">2</td><td class=\"r num\">3</td><td class=\"r num\">0</td><td class=\"r\">Lv 1</td><td class=\"r num\">0/500</td><td class=\"mut\">还没有简介</td></tr>\n            </tbody>\n          </table>\n          <div class=\"tail\">多号时<strong>每个号一行，能直接比</strong> · 取自 <strong>creator-profile</strong>（已实测）· 升级进度 = 满 500 粉升下一级 ·\n            粉丝画像（性别／年龄／地域／设备）<strong>平台是否提供待确认</strong> —— 拿到之前不摆空图，也不编</div>\n        </div>\n      </section>\n    </div>\n\n    <!-- ═══════ 5 · 知识库 ═══════ -->\n    <div class=\"page\" id=\"p-know\" hidden>\n\n      <div class=\"phead\">\n        <div>\n          <div class=\"pt\">知识库</div>\n          <div class=\"ps\">索引视图 —— 读文件聚合，不搬你的文件</div>\n        </div>\n        <span class=\"pill acc\"><i></i>知识 42 · 工具 12</span>\n      </div>\n\n      <div class=\"subtabs\">\n        <button class=\"subtab on\" data-k=\"k-know\">知识</button>\n        <button class=\"subtab\" data-k=\"k-tool\">资源</button>\n      </div>\n\n      <div class=\"subpage\" id=\"k-know\">\n        <div class=\"blk\">\n          <div class=\"bh\">\n            <div class=\"bt\">知识索引</div>\n            <div class=\"grp haspop\">\n              <span class=\"r\">读文件聚合，不建表</span>\n              <button class=\"btn\" id=\"incBtn\">收录目录</button>\n              <!-- 收录目录面板（老哥 09-28 11:39）——\n                   「我能否改成自己添加某个文件夹来展示？不然知识库怎么知道哪几个目录\n                    里的文件是要展示在知识库内的文件」。\n                   结构文档 §十八 只写了\"读文件聚合\"，**从没定义过收录范围** → 这个配置是必须的。\n                   默认值 = 五个领域目录；收件箱/Clippings 默认不收；附件与 Raw 层固定排除。 -->\n              <div class=\"inc-pop\" id=\"incPop\" hidden>\n                <div class=\"lp-t\">收录这些目录</div>\n                <label class=\"inc-row\"><input type=\"checkbox\" checked><span class=\"inc-path\">10-小红书带货</span><span class=\"inc-n\">98</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\" checked><span class=\"inc-path\">20-提示词资产</span><span class=\"inc-n\">2</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\" checked><span class=\"inc-path\">50-AI与方法论</span><span class=\"inc-n\">3</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\" checked><span class=\"inc-path\">40-学习资料</span><span class=\"inc-n\">2</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\" checked><span class=\"inc-path\">30-电脑与环境</span><span class=\"inc-n\">1</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\"><span class=\"inc-path\">00-收件箱</span><span class=\"inc-n\">1</span></label>\n                <label class=\"inc-row\"><input type=\"checkbox\"><span class=\"inc-path\">Clippings</span><span class=\"inc-n\">1</span></label>\n                <button class=\"inc-add\">＋ 添加目录…</button>\n\n                <div class=\"lp-t mt\">标记为只读（能看、不能改）</div>\n                <div class=\"inc-fixed\">\n                  <span>20-文案库/拆解原文/</span>\n                </div>\n                <div class=\"lp-hint\" style=\"margin-top:9px;padding-top:0;border-top:0\">\n                  只读<strong>按目录判</strong>，不是给单个文件打标 ——\n                  这样零字段、零维护，也永远和库规一致（<strong>人工打的\"只读\"标记一定会忘记更新</strong>）。</div>\n\n                <div class=\"lp-t mt\">固定排除（不收录）</div>\n                <div class=\"inc-fixed\">\n                  <span>附件/</span><span>多维表格/</span><span>05-日记/</span><span>Daily/</span><span>待拆解/</span>\n                </div>\n                <div class=\"lp-hint\">排除的是<strong>二进制、表和凭据</strong>。\n                  <strong>「待拆解/」按库规是「证据，不是知识」</strong>（同「未发布笔记不进数据库」）；\n                  「拆解原文/」<strong>照收但标只读</strong>（§18.6 已定）。</div>\n              </div>\n            </div>\n          </div>\n          <!-- 6 行 → 超过 5 条即触发通用折叠（默认 5 条 / 每次 +10 / 收起一次性回 5）\n               真实收录约 90+ 篇，不折叠会是一条长表 -->\n          <div data-fold=\"5\" data-fold-step=\"10\">\n          <table class=\"tb\">\n            <colgroup><col><col style=\"width:120px\"><col style=\"width:76px\"><col style=\"width:72px\"><col style=\"width:96px\"><col style=\"width:72px\"><col style=\"width:84px\"><col style=\"width:190px\"></colgroup>\n            <thead><tr><th>标题</th><th>主分类</th><th>类型</th><th class=\"cc\">输入/输出</th><th class=\"cc\">权限</th><th class=\"r\">被引用</th><th class=\"r\">更新时间</th><th></th></tr></thead>\n            <tbody>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">_模板-爆款拆解卡</div><div class=\"t-sub\">拆解爆款的唯一权威格式</div></td>\n                <td class=\"mut\">20-文案库</td><td class=\"mut\">reference</td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>输出</span></td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>可编辑</span></td>\n                <td class=\"r mut num\">0</td><td class=\"r mut num\">09-20</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">文字类-通用-清单合集-002</div><div class=\"t-sub\">模板卡 · 清单合集</div></td>\n                <td class=\"mut\">20-文案库/模板卡</td><td class=\"mut\">template</td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>输出</span></td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>可编辑</span></td>\n                <td class=\"r mut num\">0</td><td class=\"r mut num\">09-18</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">05-爆款笔记方法论</div><div class=\"t-sub\">概念 · 方法论（全库被引用最多）</div></td>\n                <td class=\"mut\">50-知识库/02-概念</td><td class=\"mut dash\">—</td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>输出</span></td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>可编辑</span></td>\n                <td class=\"r mut num\">14</td><td class=\"r mut num\">09-18</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">再也不用跟黑夜硬刚了！！！</div><div class=\"t-sub\">采来的原文 · Raw 层</div></td>\n                <td class=\"mut\">20-文案库/拆解原文</td><td class=\"mut\">raw</td>\n                <td class=\"cc\"><span class=\"pill wr\"><i></i>输入</span></td>\n                <td class=\"cc\"><span class=\"pill wr\"><i></i>只读</span></td>\n                <td class=\"r mut num\">0</td><td class=\"r mut num\">09-24</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">文案生成准则</div><div class=\"t-sub\">活文档 · 文案生成的准则</div></td>\n                <td class=\"mut\">40-进化准则</td><td class=\"mut\">rule</td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>输出</span></td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>可编辑</span></td>\n                <td class=\"r mut num\">8</td><td class=\"r mut num\">09-24</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n              <tr>\n                <td class=\"tcell\"><div class=\"t-title\">09-数据分析与复盘</div><div class=\"t-sub\">概念 · 数据分析</div></td>\n                <td class=\"mut\">50-知识库/02-概念</td><td class=\"mut dash\">—</td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>输出</span></td>\n                <td class=\"cc\"><span class=\"pill\"><i></i>可编辑</span></td>\n                <td class=\"r mut num\">12</td><td class=\"r mut num\">05-19</td>\n                <td class=\"r\"><button class=\"btn\" style=\"padding:4px 10px\">打开</button> <button class=\"btn\" data-perm=\"1\" style=\"padding:4px 10px\">改权限</button> <button class=\"btn\" style=\"padding:4px 10px\">看引用</button></td>\n              </tr>\n            </tbody>\n          </table>\n          </div>\n          <div class=\"tail\"><strong>类型</strong> = frontmatter <code>type</code>（值域以库内 <code>AGENTS.md</code> 为准）· <strong>权限</strong> = <strong>按目录判定</strong>（Raw 层如 <code>拆解原文/</code> = 只读；其余 = 可编辑）—— <strong>不是文件里的字段</strong><br>\n            <strong>被引用 N 次</strong> = 全库 backlink 实算（本页数字是脚本数出来的）· 权限默认<strong>按目录判</strong>，也可用「改权限」<strong>按文件覆盖</strong><br>\n            更新时间 = 本地文件时间（同步会重写 mtime，不假装它准）· 移动 / 删除<strong>不在本页</strong></div>\n        </div>\n      </div>\n\n      <div class=\"subpage\" id=\"k-tool\" hidden>\n        <div class=\"blk\">\n          <div class=\"bh\"><div class=\"bt\">资源 · 工具</div><span class=\"r\">只放工具（对标账号不算资源）</span></div>\n          <table class=\"tb\">\n            <colgroup><col><col style=\"width:150px\"><col style=\"width:100px\"></colgroup>\n            <thead><tr><th>工具</th><th>用途</th><th class=\"cc\">状态</th></tr></thead>\n            <tbody>\n              <tr><td class=\"t-title\">xhs-importer-pro</td><td class=\"mut\">小红书笔记 → 待拆解</td><td class=\"cc\"><span class=\"pill\"><i></i>已装</span></td></tr>\n              <tr><td class=\"t-title\">duowei-table</td><td class=\"mut\">读写三张 .duowei 表</td><td class=\"cc\"><span class=\"pill\"><i></i>已装</span></td></tr>\n              <tr><td class=\"t-title\">opencli</td><td class=\"mut\">创作者后台数据同步</td><td class=\"cc\"><span class=\"pill wr\"><i></i>登录号待确认</span></td></tr>\n            </tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  </main>\n</div>\n\n<!-- ═══ 「改权限」浮层（知识库页）═══\n     老哥 11:51 说「点了没反应，想看有哪些选项」→ 做了；\n     老哥 12:07 说「状态这栏改只读或可编辑就行」→ 列改了；\n     老哥 12:13 圈出浮层：「这个圈出来的地方还是没有改」→ 浮层选项也一起换成「只读 / 可编辑」。\n     🔴 写回位置 = frontmatter 的 `只读` 字段（只在显式改过时才写；没写 = 按目录判）。 -->\n<div class=\"st-pop\" id=\"stPop\" hidden>\n  <div class=\"st-h\" id=\"stFile\">—</div>\n  <span class=\"st-path\" id=\"stPath\">—</span>\n\n  <div class=\"lp-t\">当前权限</div>\n  <div class=\"st-cur\" id=\"stCur\">—</div>\n\n  <div class=\"lp-t mt\">改成</div>\n  <div class=\"st-opts\">\n    <button class=\"st-opt\">只读<i>工作台里不能改它</i></button>\n    <button class=\"st-opt\">可编辑<i>允许工作台改它</i></button>\n  </div>\n  <button class=\"inc-add\" style=\"margin-top:9px\">恢复默认（按目录判定）</button>\n\n  <div class=\"lp-hint\">写回文件 frontmatter 的 <code>只读</code> 字段 —— <strong>只在你显式改过时才写</strong>；\n    没有这个字段 = <strong>按目录判</strong>（<code>拆解原文/</code> 默认只读）。<br>\n    ⚠️ <strong>它只约束工作台自己</strong>：<strong>不是技术锁</strong> —— 你在 OB 里照样能编辑、AI 也照样能读写。\n    真正约束 AI 的是库规（Raw 层「人写、Agent 只读」）。</div>\n</div>\n<!-- ═══ 笔记卡弹窗（结构文档 §17.2）—— 点「打开」弹这里，不跳文件 ═══ -->\n<div class=\"modal\" id=\"noteModal\" hidden>\n  <div class=\"modal-box\">\n    <div class=\"m-head\">\n      <div>\n        <div class=\"m-t\" id=\"mT\">躺下脑子还在开会，我换了睡前这件事</div>\n        <div class=\"m-s\" id=\"mS\">舒眠精油 · 004 时间线助眠体验 · 生成于 09-24 01:41</div>\n      </div>\n      <button class=\"btn\">打开源文件</button>\n      <button class=\"m-x\" id=\"mX\" aria-label=\"关闭\">×</button>\n    </div>\n\n    <div class=\"m-body\">\n      <div class=\"m-sec\">\n        <div class=\"m-rw\">\n          <div class=\"m-lb\">状态<em>点了就改笔记卡里的状态 · 不挪文件位置</em></div>\n          <span class=\"m-side\">发布后自动改</span>\n        </div>\n        <div class=\"seg wide\">\n          <button class=\"seg-b\">草稿</button><button class=\"seg-b on\">已发布</button><button class=\"seg-b\">已归档</button>\n        </div>\n      </div>\n\n      <div class=\"m-sec\" style=\"margin-bottom:2px\">\n        <div class=\"m-lb\">复制<em>每块一组 · 每行一个按钮 —— 选哪个复制哪个</em></div>\n        <div id=\"mRows\"></div>\n      </div>\n    </div>\n  </div>\n</div>\n\n<div class=\"toast\" id=\"toast\" hidden></div>\n\n\n<!-- ═══ 「分析详情」弹窗（数据库 · 内容分析）═══\n     形态参照 `_UI参考/10-分析详情-流量转化.png` 与 `11-分析详情-核心数据.png`：\n     头部（标题＋笔记名＋发布/采集时间）→ 一排子页签 → 指标网格 → 口径小注。\n     🔴 内容严格按 creator-note-detail 的真实输出能力：4 段 13 项。\n        参考图里的「完播率 / 2 秒退出率 / 观看来源 / 观众画像 / 同类中位数 / 平台诊断」\n        **接口输出里都没有** —— 所以照参考图的做法：**字段保留、值写「—」**，\n        整块拿不到的（观看趋势/来源/画像）做成页签 + 明确空态。\n        **不摆空图、不编数、不把\"未返回\"写成 0**（老哥一贯的「空 ≠ 0」）。\n     值全部来自真实落盘：D:/Documents/work buddy/xhs-creator-sync/_data/creator-latest.json -->\n<div class=\"modal\" id=\"anModal\" hidden>\n  <!-- 宽度交给 CSS（#anModal .modal-box）控制 —— 内联 max-width 会盖掉样式表，之前就因此没生效 -->\n  <div class=\"modal-box\">\n    <div class=\"m-head\">\n      <div>\n        <div class=\"m-t\">分析详情</div>\n        <!-- 三层信息（照参考图 11）：标题 → 这条是什么 → 时间口径 -->\n        <div class=\"an-sub\">47出网易云 · 小木鱼</div>\n        <div class=\"m-s\">发布于 2024-06-07 23:27 · 采集于 2026/9/25 21:13</div>\n      </div>\n      <button class=\"m-x\" id=\"anX\" aria-label=\"关闭\">&times;</button>\n    </div>\n\n    <div class=\"m-body\">\n      <div class=\"subtabs\" id=\"anTabs\" style=\"margin-bottom:13px\">\n        <button class=\"subtab on\" data-an-t=\"anCore\">核心数据</button>\n        <button class=\"subtab\" data-an-t=\"anTrend\">观看趋势</button>\n        <button class=\"subtab\" data-an-t=\"anSrc\">观看来源</button>\n        <button class=\"subtab\" data-an-t=\"anAud\">观众画像</button>\n      </div>\n\n      <section id=\"anCore\">\n        <div class=\"kpi6\">\n          <div class=\"kpi\"><div class=\"k\">曝光数</div><div class=\"v dash num\">&mdash;</div></div>\n          <div class=\"kpi\"><div class=\"k\">观看数</div><div class=\"v num\">203</div></div>\n          <div class=\"kpi\"><div class=\"k\">封面点击率</div><div class=\"v dash num\">&mdash;</div></div>\n          <div class=\"kpi\"><div class=\"k\">平均观看时长</div><div class=\"v dash num\">&mdash;</div></div>\n          <div class=\"kpi\"><div class=\"k\">完播率</div><div class=\"v dash num\">&mdash;</div></div>\n          <div class=\"kpi\"><div class=\"k\">2 秒退出率</div><div class=\"v dash num\">&mdash;</div></div>\n        </div>\n        <div class=\"kpi5\">\n          <div class=\"kpi\"><div class=\"k\">涨粉数</div><div class=\"v dash num\">&mdash;</div></div>\n          <div class=\"kpi\"><div class=\"k\">点赞数</div><div class=\"v num\">0</div></div>\n          <div class=\"kpi\"><div class=\"k\">评论数</div><div class=\"v num\">1</div></div>\n          <div class=\"kpi\"><div class=\"k\">收藏数</div><div class=\"v num\">0</div></div>\n          <div class=\"kpi\"><div class=\"k\">分享数</div><div class=\"v num\">0</div></div>\n        </div>\n        <div class=\"tail\">以上为<strong>笔记详情页口径</strong> · 平台详情页与列表的更新时间、取整方式可能不同<br>\n          「&mdash;」= <strong>后台未返回</strong>（<strong>不是 0</strong>）· 本条发布于 2024-06-07（17 个月前），部分字段可能已超出后台保留窗口</div>\n      </section>\n\n      <section id=\"anTrend\" hidden>\n        <div class=\"na\">接口原话：<strong>「观众趋势：暂不可用」</strong><br>\n          后台<strong>没有返回</strong>这条笔记的趋势序列 —— <strong>不是没采，是平台不给</strong>。<br>\n          <strong>什么时候能确认</strong>：发一篇新笔记后跑一次同步，看新笔记的趋势能不能取到。老笔记可能已超出后台保留范围。</div>\n      </section>\n\n      <section id=\"anSrc\" hidden>\n        <div class=\"na\">这一项在 <code>creator-note-detail</code> 的<strong>输出里没有</strong> ——\n          不是被过滤掉，是接口本身没返回。<br>\n          <strong>什么时候能确认</strong>：参考图里这一屏来自平台详情页；接口给不给要<strong>发新笔记复核</strong>，可能平台根本不开放。<br>\n          <strong>拿不到就不摆</strong> —— 不画空图，也不拿别的东西凑。</div>\n        <div class=\"tail\" style=\"text-align:left;font-size:11.5px;margin-top:12px\">\n          参考图的这一屏还带「<strong>同类中位数</strong>」与「<strong>平台诊断评语</strong>」（如「超过 85% 同类作者」）——\n          那是<strong>平台侧算好的结论</strong>，接口同样不返回。工作台<strong>不代为推算</strong>，也不自己写一句结论充数。</div>\n      </section>\n\n      <section id=\"anAud\" hidden>\n        <div class=\"na\">同上：<strong>接口输出里没有观众画像</strong>（性别／年龄／地域分布）。<br>\n          若复核后平台确实不开放，这一页签在真插件里就<strong>不显示</strong>\n          （而不是留一个点开是空的按钮）—— 沿用「不做空按钮」这条（同 09-27 搜索面板：库里没有 .canvas/.pdf 就没做那两个图标）。</div>\n      </section>\n\n    </div>\n\n    <div class=\"m-foot\">\n      <button class=\"btn\">打开源文件</button>\n      <span class=\"m-note\">单篇只读 · 数据来自创作者后台</span>\n    </div>\n  </div>\n</div>\n</div>\n";
const INLINE_INTERACT_JS = "/* ⚠️ 由 _UI稿/工作台-A改进版-20260926.html 的 <script> 于 B1 迁移而来（2026-09-29）。\n   仅改写 2 处全局引用（documentElement.dataset.cw / body.classList → 视图根）。\n   由 main.js 用 new Function 执行，执行前后会劫持 document/window 的事件注册以便关视图时回收。\n   其中 NOTES 是原型的演示数据，B1 不使用（B3 会替换整块弹窗逻辑）。 */\n\n(function(){\n  var side = document.getElementById('side');\n  var tgl  = document.getElementById('sideToggle');\n  tgl.addEventListener('click', function(){\n    var mini = side.classList.toggle('mini');\n    tgl.textContent = mini ? '›' : '‹';\n    tgl.title = mini ? '展开导航' : '收起导航';\n  });\n\n  var btn = document.getElementById('layoutBtn');\n  var pop = document.getElementById('layoutPop');\n  btn.addEventListener('click', function(){ pop.hidden = !pop.hidden; });\n  document.addEventListener('click', function(e){\n    if(!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;\n  });\n\n  /* 设置面板：工作台名称可自行更改，实时同步到侧栏标题 */\n  var st = document.getElementById('settingsBtn');\n  var sPop = document.getElementById('settingsPop');\n  var wbName = document.getElementById('wbName');\n  var sideTitle = document.querySelector('.side-title');\n  st.addEventListener('click', function(e){\n    e.stopPropagation();\n    sPop.hidden = !sPop.hidden;\n  });\n  wbName.addEventListener('input', function(){\n    sideTitle.textContent = wbName.value.trim() || '工作台';\n  });\n  document.addEventListener('click', function(e){\n    if(!sPop.hidden && !sPop.contains(e.target) && !st.contains(e.target)) sPop.hidden = true;\n  });\n\n  /* 全库搜索：点搜索框展开结果面板；顶部图标按类型筛选 */\n  var sIn = document.getElementById('searchIn');\n  var sPan = document.getElementById('searchPanel');\n  var sItems = sPan.querySelectorAll('.sr-item');\n  sIn.addEventListener('focus', function(){ sPan.hidden = false; });\n  sIn.addEventListener('click', function(e){ e.stopPropagation(); sPan.hidden = false; });\n  document.querySelectorAll('.sr-f').forEach(function(b){\n    b.addEventListener('click', function(){\n      document.querySelectorAll('.sr-f').forEach(function(x){ x.classList.remove('on'); });\n      b.classList.add('on');\n      var t = b.dataset.t;\n      sItems.forEach(function(it){\n        it.style.display = (t === 'all' || it.dataset.t === t) ? '' : 'none';\n      });\n    });\n  });\n  document.addEventListener('click', function(e){\n    if(!sPan.hidden && !sPan.contains(e.target) && !sIn.contains(e.target)) sPan.hidden = true;\n  });\n\n  /* 壁纸显隐 —— 分模式（老哥 09-27 16:44：整页模式下别的页也要有壁纸）：\n     · 整页模式：壁纸是整张页面的背景，**所有页都显示**\n     · 横幅模式：它只是首页顶部的一条，切到别的页要收起 */\n  function syncWall(){\n    var cur = document.querySelector('.nav.on');\n    var onToday = !cur || cur.dataset.p === 'p-today';\n    wall.hidden = !onToday && !document.querySelector('.xhs-wb-root').classList.contains('wall-full');\n  }\n\n  /* 一级页签：切页面 */\n\n  document.querySelectorAll('.nav[data-p]').forEach(function(n){\n    n.addEventListener('click', function(){\n      document.querySelectorAll('.nav').forEach(function(x){ x.classList.remove('on'); });\n      n.classList.add('on');\n      document.querySelectorAll('.page').forEach(function(p){ p.hidden = (p.id !== n.dataset.p); });\n      syncWall();\n      window.scrollTo(0, 0);\n    });\n  });\n  /* 页内子页签：只切换同族 .subpage */\n  function bindTabs(sel, key, prefix){\n    var group = document.querySelectorAll(sel);\n    group.forEach(function(b){\n      b.addEventListener('click', function(){\n        group.forEach(function(x){ x.classList.remove('on'); });\n        b.classList.add('on');\n        document.querySelectorAll('.subpage').forEach(function(p){\n          if (p.id.indexOf(prefix) === 0) p.hidden = (p.id !== b.dataset[key]);\n        });\n      });\n    });\n  }\n  bindTabs('.subtab[data-s]', 's', 's-');\n  bindTabs('.subtab[data-k]', 'k', 'k-');\n  /* 纯视觉用的分段按钮（笔记卡筛选 / 账号切换）：只切选中态 */\n  document.querySelectorAll('.subtab:not([data-s]):not([data-k])').forEach(function(b){\n    b.addEventListener('click', function(){\n      b.parentElement.querySelectorAll('.subtab').forEach(function(x){ x.classList.remove('on'); });\n      b.classList.add('on');\n    });\n  });\n\n  /* 壁纸：原型里用 5 套渐变循环演示（真实插件里换成任意图片） */\n  var walls = [\n    'linear-gradient(125deg,#0f76c4 0%,#1e8ad0 48%,#5cb8e6 100%)',\n    'linear-gradient(125deg,#12395c 0%,#2f6b96 55%,#7fb4d4 100%)',\n    'linear-gradient(125deg,#42708f 0%,#7fa3bb 60%,#c6d9e6 100%)',\n    'linear-gradient(125deg,#0b3a63 0%,#1a6ea8 50%,#4fb0d8 100%)',\n    'linear-gradient(125deg,#2b4f6d 0%,#5d8aa8 55%,#a9c7da 100%)'\n  ];\n  var wi = 0, wall = document.getElementById('wall');\n  function changeWall(){\n    wi = (wi + 1) % walls.length;\n    wall.style.background = walls[wi];\n    try { localStorage.removeItem(WALL_IMG_KEY); } catch (e4) { /* ignore */ }\n  }\n  /* 壁纸入口：wall 悬浮按钮 + 布局弹层（横幅模式已砍，root 恒为 wall-full） */\n  var WALL_IMG_KEY = 'xhs-wb-wall-image';\n  var wb1 = document.getElementById('wallBtn');\n  if (wb1) wb1.addEventListener('click', function(e){ e.stopPropagation(); changeWall(); });\n  var wb2 = document.getElementById('wallBtn2');\n  if (wb2) wb2.addEventListener('click', function(e){ e.stopPropagation(); changeWall(); });\n\n  /* 自定义图片壁纸（老哥 09-30 二改：弹系统文件选择器，不让用户找路径）。\n     选中 → 写入插件目录 .obsidian/plugins/xhs-workbench/wall-image.<ext>（adapter 直写，\n     Obsidian 不索引该目录但 app:// 能服务）→ adapter.getResourcePath 拿 URL → 铺满整页。\n     记忆：localStorage 存扩展名；恢复时 Image 预加载校验（文件被删则自动回退渐变）。\n     点「换一张壁纸（官方渐变）」= 清除自定义回到渐变循环。 */\n  var WALL_DIR = '.obsidian/plugins/xhs-workbench/';\n  var wallFileIn = document.getElementById('wallImgFile'), wallImgBtn = document.getElementById('wallImgBtn');\n  function wallUrl(ext, bust){\n    var u = app.vault.adapter.getResourcePath(WALL_DIR + 'wall-image.' + ext);\n    return bust ? u + '?t=' + Date.now() : u;\n  }\n  function applyImageWall(url, ext){\n    wall.style.background = 'center / cover no-repeat url(' + url + ')';\n    try { localStorage.setItem(WALL_IMG_KEY, ext); } catch (e2) { /* ignore */ }\n  }\n  function restoreImageWall(){\n    var ext = null;\n    try { ext = localStorage.getItem(WALL_IMG_KEY); } catch (e3) { return; }\n    if (!ext) return;\n    var app = window.app;\n    if (!app || !app.vault || !app.vault.adapter) return;\n    var url = wallUrl(ext, true);\n    var probe = new Image();\n    probe.onload = function(){ applyImageWall(url, ext); };\n    probe.onerror = function(){ try { localStorage.removeItem(WALL_IMG_KEY); } catch (e4) { /* ignore */ } };\n    probe.src = url;\n  }\n  if (wallImgBtn) wallImgBtn.addEventListener('click', function(e){\n    e.stopPropagation();\n    var app = window.app;\n    if (!app || !app.vault || !app.vault.adapter || !app.vault.adapter.writeBinary) { toast('当前环境不支持自定义壁纸', 5000); return; }\n    wallFileIn.click();\n  });\n  if (wallFileIn) wallFileIn.addEventListener('change', function(){\n    var f = wallFileIn.files && wallFileIn.files[0];\n    wallFileIn.value = '';\n    if (!f) return;\n    if (!/^image\\//.test(f.type)) { toast('请选择图片文件', 5000); return; }\n    var ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';\n    if (ext.length > 5) ext = 'png';\n    f.arrayBuffer().then(function(buf){\n      var app = window.app;\n      var path = WALL_DIR + 'wall-image.' + ext;\n      var prevExt = null;\n      try { prevExt = localStorage.getItem(WALL_IMG_KEY); } catch (e5) { /* ignore */ }\n      return app.vault.adapter.writeBinary(path, buf).then(function(){\n        if (prevExt && prevExt !== ext) { try { app.vault.adapter.remove(WALL_DIR + 'wall-image.' + prevExt); } catch (e6) { /* ignore */ } }\n        applyImageWall(wallUrl(ext, true), ext);\n        toast('已用你的图片做壁纸 ✓（重新加载后依然生效）', 4000);\n      });\n    }).catch(function(err){ toast('写入壁纸失败：' + (err && err.message ? err.message : err), 6000); });\n  });\n  restoreImageWall();\n\n  /* 导航位置：左侧 / 顶部（顶部模式下壁纸要排到导航条之上，所以搬一次节点） */\n  var shell = document.querySelector('.shell');\n  var sideEl = document.getElementById('side');\n  var mainEl = document.querySelector('.main');\n  var segPos = document.querySelectorAll('.seg-b[data-pos]');\n  segPos.forEach(function(b){\n    b.addEventListener('click', function(){\n      segPos.forEach(function(x){ x.classList.remove('on'); });\n      b.classList.add('on');\n      var top = b.dataset.pos === 'top';\n      shell.classList.toggle('top', top);\n      if (top) shell.insertBefore(wall, sideEl);\n      else mainEl.insertBefore(wall, mainEl.firstChild);\n    });\n  });\n  /* 壁纸：横幅 / 整页 */\n  var segWall = document.querySelectorAll('.seg-b[data-wall]');\n  segWall.forEach(function(b){\n    b.addEventListener('click', function(){\n      segWall.forEach(function(x){ x.classList.remove('on'); });\n      b.classList.add('on');\n      document.querySelector('.xhs-wb-root').classList.toggle('wall-full', b.dataset.wall === 'full');\n      syncWall();\n    });\n  });\n  /* 数据库页子页签（真的能切）：账号概览 / 内容分析 / 粉丝数据\n     —— 原来三个子页签是\"死\"的，点了没反应，而且「账号概览」下面摆的其实是内容分析的表。 */\n  var dTabs = document.getElementById('dataTabs');\n  if (dTabs){\n    dTabs.querySelectorAll('.subtab[data-dt]').forEach(function(b){\n      b.addEventListener('click', function(){\n        dTabs.querySelectorAll('.subtab[data-dt]').forEach(function(x){ x.classList.remove('on'); });\n        b.classList.add('on');\n        ['dOv','dAn','dFans'].forEach(function(id){\n          var el = document.getElementById(id);\n          if (el) el.hidden = (id !== b.dataset.dt);\n        });\n      });\n    });\n  }\n\n  /* 轻提示（原型用）：点的东西在真插件里会发生什么，得让老哥看见反馈 */\n  var toastEl = document.getElementById('toast'), toastTid;\n  function toast(msg){\n    toastEl.textContent = msg;\n    toastEl.hidden = false;\n    clearTimeout(toastTid);\n    toastTid = setTimeout(function(){ toastEl.hidden = true; }, 2400);\n  }\n  /* 点品名 → 打开该条记录：真实接线在 main.js（openDuoweiRecord，09-30），原型提示已删 */\n\n  /* 长列表折叠（通用逻辑）：\n        data-fold        = 初始显示条数（也是「收起」后回到的条数）\n        data-fold-step   = 每次点「展开」新增的条数（不写则同初始值）\n     老哥口径：每日跟踪 10/10（09-27 21:47）；内容分析 初始 5 / 每次 +10（09-28 11:10）。\n     「收起」永远是一次性回到初始条数，不是逐批往回缩。 */\n  document.querySelectorAll('[data-fold]').forEach(function(blk){\n    var init = parseInt(blk.dataset.fold, 10) || 10;\n    var step = parseInt(blk.dataset.foldStep, 10) || init;\n    var tbl = blk.querySelector('table');\n    if (!tbl) return;\n    var rows = Array.prototype.slice.call(tbl.querySelectorAll('tbody tr'));\n    if (rows.length <= init) return;                 // 没超过就不显示按钮\n    var bar = document.createElement('div');\n    bar.className = 'foldbar';\n    var btn = document.createElement('button');\n    btn.className = 'btn';\n    bar.appendChild(btn);\n    tbl.parentNode.insertBefore(bar, tbl.nextSibling);\n    var shown = init;\n    function render(){\n      rows.forEach(function(r, i){ r.hidden = (i >= shown); });\n      var rest = rows.length - shown;\n      btn.textContent = rest > 0 ? ('展开剩余 ' + rest + ' 条 ⌄')\n                                 : ('收起（只看最近 ' + init + ' 条） ⌃');\n    }\n    btn.addEventListener('click', function(){\n      var rest = rows.length - shown;\n      shown = rest > 0 ? Math.min(shown + step, rows.length) : init;   // 展开下一批 / 一次性收回\n      render();\n    });\n    render();\n  });\n\n  /* 响应式断点：按「内容区实际宽度」写进 html[data-cw]（lg / sm / xs）\n     —— 不用 @media：窗口宽 ≠ 内容宽，Obsidian 侧栏一开一关，窗口没变内容区就窄了\n     lg ≥1040（4 指标卡 + 三栏）｜ sm 720–1040（2 列 + 单栏）｜ xs <720（单列） */\n  function applyCW(){\n    // B5 走查修断点：视图卸载后 ResizeObserver/resize 仍可能触发一次，\n    // 全局 querySelector 会拿到 null（或拿到别的实例）→ 空判断 + 只认自己的根\n    if (!mainEl || !mainEl.isConnected) return;\n    var rootEl = mainEl.classList && mainEl.classList.contains('xhs-wb-root') ? mainEl : mainEl.closest('.xhs-wb-root');\n    if (!rootEl) return;\n    var w = mainEl.clientWidth;\n    rootEl.dataset.cw = w < 720 ? 'xs' : (w < 1040 ? 'sm' : 'lg');\n  }\n  if (window.ResizeObserver) new ResizeObserver(applyCW).observe(mainEl);\n  window.addEventListener('resize', applyCW);\n  applyCW();\n\n  /* 笔记卡弹窗（§17.2）\n     ⚠️ 下面的 NOTES 是从 vault 真文件解析出来硬编码进稿子的（演示关联上以后长什么样）。\n     真实插件里这块由 vault.on('create'|'modify') 事件驱动，不是写死的。 */\n  var NOTES = [\n {\n  \"file\": \"前后状态对比-不信精油-041.md\",\n  \"t\": \"我本来是来打假的\",\n  \"meta\": \"舒眠精油 · 正文 292 字\",\n  \"tpl\": \"005 前后状态对比\",\n  \"titles\": [\n   {\n    \"d\": \"1. 我本来是来打假的（T2 反常识断言）\",\n    \"c\": \"我本来是来打假的\"\n   },\n   {\n    \"d\": \"2. 买它的时候，我就在等一个打脸的机会（T2）\",\n    \"c\": \"买它的时候，我就在等一个打脸的机会\"\n   },\n   {\n    \"d\": \"3. 用了一个月，我承认我错了（T6 时间成本）\",\n    \"c\": \"用了一个月，我承认我错了\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A：深色底 + 大字：我本来是来打假的\",\n    \"c\": \"A：深色底 + 大字：我本来是来打假的\"\n   },\n   {\n    \"d\": \"B：浅色底 + 大字：一瓶精油能有多大用\",\n    \"c\": \"B：浅色底 + 大字：一瓶精油能有多大用\"\n   }\n  ],\n  \"body\": \"我买这个的时候是抱着打假的心态的。\\n\\n一瓶闻起来香香的东西，凭什么能让人睡着。我买过太多号称神器的东西了，最后全堆在抽屉里。\\n\\n但那次是连续一周赶方案，脑子跟烧过一样，躺下就是睡不着。\\n死马当活马医，睡前在耳后和手腕各滚了两下。\\n\\n气味是那种木质调，不甜，凑近了才有。老实说没什么神奇的感觉，就是屋里多了一点味道。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n23:40 躺下，还是照常在刷手机\\n23:55 有点困了，把手机放下\\n00:15 再睁眼是天亮\\n\\n那天我一觉到天亮，中间一次都没醒。第二天早上爬起来还在想，是不是巧合。\\n\\n后来又用了两周，还是这样，我才承认它确实有点用。\\n\\n现在它在我的床头柜上有一格固定位置。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物\"\n },\n {\n  \"file\": \"前后状态对比-多梦-016.md\",\n  \"t\": \"睡够八小时还是累，问题可能不在时长\",\n  \"meta\": \"舒眠精油 · 正文 250 字\",\n  \"tpl\": \"005 前后状态对比\",\n  \"titles\": [\n   {\n    \"d\": \"1. 睡够八小时还是累，问题可能不在时长（T2 反常识断言）\",\n    \"c\": \"睡够八小时还是累，问题可能不在时长\"\n   },\n   {\n    \"d\": \"2. 一晚上做三场梦，比没睡还累（T5 痛点点名）\",\n    \"c\": \"一晚上做三场梦，比没睡还累\"\n   },\n   {\n    \"d\": \"3. 连续十天醒来不记得做过什么梦（T1 数字 + 情绪）\",\n    \"c\": \"连续十天醒来不记得做过什么梦\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A：深色底 + 大字：一整晚都在做梦\",\n    \"c\": \"A：深色底 + 大字：一整晚都在做梦\"\n   },\n   {\n    \"d\": \"B：浅色底 + 大字：睡够了，还是累\",\n    \"c\": \"B：浅色底 + 大字：睡够了，还是累\"\n   }\n  ],\n  \"body\": \"我属于一闭眼就开始演电影的那种。一个晚上做好几场，醒来全记得，还都是乱七八糟的。\\n睡够八个小时也不管用，早上起来跟跑了夜路一样，人是虚的。\\n\\n后来我才知道，睡的时间长和睡得整是两回事。\\n\\n朋友给了我一瓶这个，说她以前也这样。\\n\\n睡前在耳后和手腕各滚两下，淡淡的草本味，不冲。\\n它不管梦，梦该做还是做。就是醒来之后，没那么累了。\\n\\n【⚠️ 下面这组数字必须换成你自己的真实记录】\\n连续十天，我早上醒来都不太记得做过什么梦了。\\n以前是清清楚楚记一整晚，现在大部分时候是空的。\\n\\n上周末睡到自然醒，那天什么梦都没有。起床的时候人是清的。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物\"\n },\n {\n  \"file\": \"前后状态对比-浅眠党-014.md\",\n  \"t\": \"以前一晚醒三四次，现在能睡到天亮\",\n  \"meta\": \"舒眠精油 · 正文 312 字\",\n  \"tpl\": \"005 前后状态对比\",\n  \"titles\": [\n   {\n    \"d\": \"1. 以前一晚醒三四次，现在能睡到天亮（T1 人群+数字结果）\",\n    \"c\": \"以前一晚醒三四次，现在能睡到天亮\"\n   },\n   {\n    \"d\": \"2. 浅眠十年，这个月终于睡整了（T1）\",\n    \"c\": \"浅眠十年，这个月终于睡整了\"\n   },\n   {\n    \"d\": \"3. 连续一周醒来不超过一次，我知足了（T1 + 情绪词）\",\n    \"c\": \"连续一周醒来不超过一次，我知足了\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A：深色底 + 白色大字：一有动静就醒的人\",\n    \"c\": \"A：深色底 + 白色大字：一有动静就醒的人\"\n   },\n   {\n    \"d\": \"B：浅色底 + 大字：以前一晚醒四次，现在到天亮\",\n    \"c\": \"B：浅色底 + 大字：以前一晚醒四次，现在到天亮\"\n   }\n  ],\n  \"body\": \"我这人睡觉跟站岗一样。楼上拖鞋响一下、楼道有人上楼、外面车过去一下，我都能醒。\\n\\n醒了就完了，翻来覆去一两个小时才再睡着，有时候直接熬到闹钟响。\\n最烦的是白天。同事说我看着像没睡醒，我自己也知道，脑子糊糊的，反应慢半拍。\\n\\n这瓶是刷到一个博主推荐的。买的时候没抱什么希望，就想着反正也不贵。\\n\\n滚珠的，睡前在耳后和手腕各滚两下。味道说不上浓，凑近了才闻得到，有点像木头。\\n它不会让你一闻就困，但屋里安静下来之后，那股味道会一直在。\\n\\n【⚠️ 下面这组数字必须换成你自己的真实记录】\\n这一个月里，我大概有二十多天是整晚没醒的。\\n以前平均一晚醒三四次，现在大部分时候不超过一次。\\n\\n白天不用午休也能撑到下班。\\n\\n昨晚楼上又在拖地。我睁了一下眼，翻个身又睡回去了。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物\"\n },\n {\n  \"file\": \"前后状态对比-爱美女生-026.md\",\n  \"t\": \"睡不好那阵子，粉底都盖不住我这张脸\",\n  \"meta\": \"舒眠精油 · 正文 273 字\",\n  \"tpl\": \"005 前后状态对比\",\n  \"titles\": [\n   {\n    \"d\": \"1. 睡不好那阵子，粉底都盖不住我这张脸（T5 痛点点名）\",\n    \"c\": \"睡不好那阵子，粉底都盖不住我这张脸\"\n   },\n   {\n    \"d\": \"2. 同事问我最近是不是很累，那一刻挺想哭的（T4 身份共鸣）\",\n    \"c\": \"同事问我最近是不是很累，那一刻挺想哭的\"\n   },\n   {\n    \"d\": \"3. 以前化妆要磨半小时，现在十分钟出门（T1 数字对比）\",\n    \"c\": \"以前化妆要磨半小时，现在十分钟出门\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A：深色底 + 大字：粉底盖不住的那种累\",\n    \"c\": \"A：深色底 + 大字：粉底盖不住的那种累\"\n   },\n   {\n    \"d\": \"B：浅色底 + 大字：睡不好，妆都救不回来\",\n    \"c\": \"B：浅色底 + 大字：睡不好，妆都救不回来\"\n   }\n  ],\n  \"body\": \"上班要见客户，妆是必须化的。但那阵子我每天早上化妆都要磨很久。\\n\\n不是不会化，是整个人是垮的，粉底压不住，眼睛也没神。同事还问过我一句，你最近是不是很累。\\n\\n那种累是睡出来的。睡不好，第二天照镜子自己都躲不开。\\n\\n这个是我睡前刷手机刷到的，当时就一个念头，能让我睡踏实就行。\\n\\n滚珠的，睡前在耳后和手腕各滚两下，气味偏花香，很淡。\\n我一般躺下还要刷十分钟手机，刷着刷着手机就滑到枕头边上了。\\n\\n【⚠️ 下面这组数字必须换成你自己的真实记录】\\n这两周基本是躺下没多久就睡过去，中间没醒。\\n\\n睡得整了之后，早上起床没那么烦了。\\n前天赶早班机，五点半起床，居然没像以前那样一路黑着脸。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物\"\n },\n {\n  \"file\": \"时间线助眠体验-会后回放-002.md\",\n  \"t\": \"白天吵完的架，晚上终于不重播了\",\n  \"meta\": \"舒眠精油 · 正文 349 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 白天吵完的架，晚上终于不重播了（T5 痛点点名）\",\n    \"c\": \"白天吵完的架，晚上终于不重播了\"\n   },\n   {\n    \"d\": \"2. 做对接岗的，脑子关不掉的人懂（T4 身份共鸣）\",\n    \"c\": \"做对接岗的，脑子关不掉的人懂\"\n   },\n   {\n    \"d\": \"3. 上班一直在说话，睡前得让它停下（T4 身份共鸣）\",\n    \"c\": \"上班一直在说话，睡前得让它停下\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：深灰底 + 白色大字：脑子终于不重播了\",\n    \"c\": \"A（C1 大字报）：深灰底 + 白色大字：脑子终于不重播了\"\n   },\n   {\n    \"d\": \"B（C3 场景图 + 大字）：手在手腕滚珠的特写，大字：白天吵完，晚上别重播\",\n    \"c\": \"B（C3 场景图 + 大字）：手在手腕滚珠的特写，大字：白天吵完，晚上别重播\"\n   }\n  ],\n  \"body\": \"白天跟供应商来回磨，一来回三小时，最后还吵起来了。\\n\\n回家躺床上，那些话一句一句往外冒。刚才那句该那么说的，我本来应该直接怼回去的。\\n越想越气，越气越清醒。\\n\\n挺离谱的，明明是对方的问题，晚上睡不着的是我。\\n\\n同事在我工位上放了一瓶这个。我一直不太信这类东西，闻个味儿能怎么样。\\n结果加班到十点，随手在耳后滚了两下，那天回去躺下，脑子里居然没那么吵了。\\n\\n后来就成习惯了，睡前耳后、手腕各滚两下。\\n木质调，不甜不冲。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n23:10 洗完澡，耳后、手腕各滚两下\\n23:20 躺下，枕边一直有淡淡的味道\\n23:35 脑子像被人按了暂停。那些该说没说出口的话，停了\\n\\n那一晚一觉到天亮，中间没醒。\\n第二天开会轮到我说话，没像以前那样先紧张一下。\\n\\n白天在外面跟人不停地磨，回家总得有样东西能让脑子停一停。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #情绪稳定 #打工人日常 #下班生活 #独居日常\"\n },\n {\n  \"file\": \"时间线助眠体验-倒班夜班-009.md\",\n  \"t\": \"下夜班回家，天亮了我反而睡不着\",\n  \"meta\": \"舒眠精油 · 正文 336 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 下夜班回家，天亮了我反而睡不着（T5 痛点点名）\",\n    \"c\": \"下夜班回家，天亮了我反而睡不着\"\n   },\n   {\n    \"d\": \"2. 上完夜班躺下，天亮了脑子还是亮的（T5 痛点点名）\",\n    \"c\": \"上完夜班躺下，天亮了脑子还是亮的\"\n   },\n   {\n    \"d\": \"3. 倒班三年，我的睡眠是乱的（T4 身份共鸣）\",\n    \"c\": \"倒班三年，我的睡眠是乱的\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：遮光窗帘背景 + 大字：天亮了，我睡不着\",\n    \"c\": \"A（C1 大字报）：遮光窗帘背景 + 大字：天亮了，我睡不着\"\n   },\n   {\n    \"d\": \"B（C3 场景图 + 大字）：手举精油瓶 + 拉严的窗帘，大字：下夜班回家，脑子还在上班\",\n    \"c\": \"B（C3 场景图 + 大字）：手举精油瓶 + 拉严的窗帘，大字：下夜班回家，脑子还在上班\"\n   },\n   {\n    \"d\": \"> 形态取模板 004「手持整瓶展示」；本条的场景道具是遮光窗帘（倒班人群的符号）。\",\n    \"c\": \"> 形态取模板 004「手持整瓶展示」；本条的场景道具是遮光窗帘（倒班人群的符号）。\"\n   }\n  ],\n  \"body\": \"凌晨下夜班，天已经蒙蒙亮了。\\n\\n回到家洗完澡躺下，身体是散的，脑子还在转。白天该睡觉的点，偏偏清醒得要命。\\n窗帘拉到最严，还是听得见外面开始有声音了。车、鸟、楼下送孩子的。\\n\\n倒班最难受的不是累，是你跟这个世界的时间对不上。\\n\\n我原来一直靠硬扛，扛不住就白天补一觉，补完晚上又睡不着，来回倒。\\n同事给了我一瓶这个，说他上夜班也靠它。我当时想，闻个味儿还能压得住生物钟？\\n\\n结果那天洗完澡，在耳后和手腕各滚了两下，躺下没多久就睡过去了。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n06:10 到家洗完澡，耳后、手腕各滚两下\\n06:20 躺下，枕边有淡淡的木质味，窗帘拉严\\n06:45 睡过去了，中间没醒\\n\\n一直睡到下午两点多。醒来天都黑了，但难得没有那种睡了个假觉的感觉。\\n\\n倒班的兄弟姐妹，应该懂我在说什么。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #倒班日常 #夜班 #早睡 #生活仪式感\"\n },\n {\n  \"file\": \"时间线助眠体验-出差党-035.md\",\n  \"t\": \"换张床就睡不好的人，出差是酷刑\",\n  \"meta\": \"舒眠精油 · 正文 269 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 换张床就睡不好的人，出差是酷刑（T2 反常识断言）\",\n    \"c\": \"换张床就睡不好的人，出差是酷刑\"\n   },\n   {\n    \"d\": \"2. 酒店第一晚，我基本都是熬到天亮（T5 痛点点名）\",\n    \"c\": \"酒店第一晚，我基本都是熬到天亮\"\n   },\n   {\n    \"d\": \"3. 出差党最怕的不是开会，是认床（T2 反常识断言）\",\n    \"c\": \"出差党最怕的不是开会，是认床\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：酒店床头灯背景 + 大字：换张床就睡不好\",\n    \"c\": \"A（C1 大字报）：酒店床头灯背景 + 大字：换张床就睡不好\"\n   },\n   {\n    \"d\": \"B（C3 场景图 + 大字）：行李箱旁手举精油瓶，大字：出差的包里固定带一瓶\",\n    \"c\": \"B（C3 场景图 + 大字）：行李箱旁手举精油瓶，大字：出差的包里固定带一瓶\"\n   }\n  ],\n  \"body\": \"出差党有个共同的毛病，认床。\\n\\n在家躺下就着，到了酒店，同样的姿势、同样的关灯顺序，脑子就是不肯关机。\\n而且越想着明天还有会，越清醒。\\n\\n我一年有三分之一的时间在外面，基本每一趟的第一晚都是熬过去的。\\n后来学乖了，出差的包里固定带一瓶这个。滚珠的，小小一瓶，扔包里就走。\\n\\n洗完澡在耳后和手腕各滚两下，躺下闭眼。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n23:30 洗完澡，耳后、手腕各滚两下\\n23:40 躺下，枕边是熟悉的那股味\\n00:05 睡过去了，闹钟响之前没醒\\n\\n第二天开会的时候，没有那种倒了时差的恍惚。\\n\\n说实话，认床这事没法根治，但至少能让第一晚好过点。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #出差日常 #酒店好物 #随身好物 #生活仪式感\"\n },\n {\n  \"file\": \"时间线助眠体验-加班白领-001.md\",\n  \"t\": \"像断电一样沉，一觉到天亮\",\n  \"meta\": \"舒眠精油 · 正文 394 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 像断电一样沉，一觉到天亮（T2 反常识断言）\",\n    \"c\": \"像断电一样沉，一觉到天亮\"\n   },\n   {\n    \"d\": \"2. 十一点半到家的人，躺下就是断电（T5 痛点点名）\",\n    \"c\": \"十一点半到家的人，躺下就是断电\"\n   },\n   {\n    \"d\": \"3. 睡前滚两下，再睁眼就是早上（T10 场景型）\",\n    \"c\": \"睡前滚两下，再睁眼就是早上\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：深色底 + 白色大字：像断电一样沉\",\n    \"c\": \"A（C1 大字报）：深色底 + 白色大字：像断电一样沉\"\n   },\n   {\n    \"d\": \"B（C3 场景图 + 大字）：床头暖光 + 手举精油瓶，大字：一觉到天亮\",\n    \"c\": \"B（C3 场景图 + 大字）：床头暖光 + 手举精油瓶，大字：一觉到天亮\"\n   },\n   {\n    \"d\": \"> 形态取模板 004「手持整瓶展示」（11 篇对标里 5/11）。\",\n    \"c\": \"> 形态取模板 004「手持整瓶展示」（11 篇对标里 5/11）。\"\n   },\n   {\n    \"d\": \"> ⚠️ 对标的「昏迷式睡了 14 小时」是 🔴 药物比喻，不用。\",\n    \"c\": \"> ⚠️ 对标的「昏迷式睡了 14 小时」是 🔴 药物比喻，不用。\"\n   }\n  ],\n  \"body\": \"十一点半到家。\\n\\n洗完澡躺床上，眼睛闭上了，脑子还在上班。今天那句没说好的话、明天要交的东西，一件一件往外冒。\\n\\n就那种身体已经躺平、人还在工位上的感觉。\\n\\n我妹硬塞给我一瓶这个，原话是「你再这么熬下去要垮」。\\n我当时想，又来了，我妹的智商税一年得交好几轮。\\n所以它在床头躺了小半个月，我一次都没碰。\\n\\n后来是有天实在睡不着，抱着「反正也睡不着」的心态，睡前在耳后和手腕各滚了两下。\\n味道说不上来，有点像雨后的木头，不冲，凑近了才有。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录，编造体感 = 虚假营销】\\n22:40 洗完澡，耳后、手腕各滚两下\\n22:50 躺下刷手机，枕边一直是那个味\\n23:05 手机放下。再拿起来就是第二天早上了\\n\\n说真的，我自己都愣了一下。\\n我已经很多年没有「睡过去」这个过程了，以前都是躺到累晕的。\\n\\n第二天是自然醒的，没有那种被闹钟硬拽起来的懵。\\n那天开长会，居然没灌咖啡。\\n\\n反正睡前多滚两下的事，不占什么时间。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #打工人日常 #床头好物 #生活仪式感\"\n },\n {\n  \"file\": \"时间线助眠体验-喂夜奶妈妈-031.md\",\n  \"t\": \"喂完夜奶，宝宝睡回去了，我醒了\",\n  \"meta\": \"舒眠精油 · 正文 304 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 喂完夜奶，宝宝睡回去了，我醒了（T5 痛点点名）\",\n    \"c\": \"喂完夜奶，宝宝睡回去了，我醒了\"\n   },\n   {\n    \"d\": \"2. 凌晨三点喂完奶，我比宝宝还清醒（T5）\",\n    \"c\": \"凌晨三点喂完奶，我比宝宝还清醒\"\n   },\n   {\n    \"d\": \"3. 当妈以后，睡整觉成了奢侈品（T4 身份共鸣）\",\n    \"c\": \"当妈以后，睡整觉成了奢侈品\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：夜景暖光 + 大字：喂完奶，脑子还醒着\",\n    \"c\": \"A（C1 大字报）：夜景暖光 + 大字：喂完奶，脑子还醒着\"\n   },\n   {\n    \"d\": \"B（C3 场景图 + 大字）：床头小夜灯 + 手滚珠特写（不露脸、不拍孩子），大字：宝宝睡了，我醒了\",\n    \"c\": \"B（C3 场景图 + 大字）：床头小夜灯 + 手滚珠特写（不露脸、不拍孩子），大字：宝宝睡了，我醒了\"\n   },\n   {\n    \"d\": \"> ⚠️ 拍摄红线：不要把宝宝拍进画面（未成年人出镜的合规与风险），只拍环境与手部。\",\n    \"c\": \"> ⚠️ 拍摄红线：不要把宝宝拍进画面（未成年人出镜的合规与风险），只拍环境与手部。\"\n   }\n  ],\n  \"body\": \"凌晨三点，喂完夜奶，宝宝睡回去了。\\n\\n我把她放回小床，自己躺下。身体累得像散了架，脑子却亮得很。白天没做完的事、明天要买的东西、刚才抱她的姿势对不对，全冒出来了。\\n\\n当妈的应该都懂。宝宝睡了，你反而睡不着，然后躺着看天一点点亮。\\n\\n我原来不信香薰精油这类东西，闻个味儿还能怎么样。\\n是月子里闺蜜给我带了一瓶。有次喂完奶实在睡不着，随手在耳后滚了两下。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n03:20 喂完奶，在耳后滚两下\\n03:25 躺下，枕边有淡淡的草木味\\n03:40 睡过去了，宝宝下次醒之前没再睁眼\\n\\n第二天整个人没那么空。以前是睡了跟没睡一样，那天至少是真的歇过来了。\\n\\n外用滚珠，睡前几秒的事。\\n\\n喂夜奶的姐妹，真的可以试试。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #带娃日常 #新手妈妈 #生活仪式感 #早睡\"\n },\n {\n  \"file\": \"时间线助眠体验-舍不得睡-003.md\",\n  \"t\": \"睡过去那一刻，我是真的不记得\",\n  \"meta\": \"舒眠精油 · 正文 326 字\",\n  \"tpl\": \"004 时间线助眠体验\",\n  \"titles\": [\n   {\n    \"d\": \"1. 睡过去那一刻，我是真的不记得（T5 痛点点名 / 结果向）\",\n    \"c\": \"睡过去那一刻，我是真的不记得\"\n   },\n   {\n    \"d\": \"2. 不是睡不着，是舍不得睡（T2 反常识断言 / 心理向）\",\n    \"c\": \"不是睡不着，是舍不得睡\"\n   },\n   {\n    \"d\": \"3. 手机放下那一刻，我就断电了（T2 反常识断言 / 体感向）\",\n    \"c\": \"手机放下那一刻，我就断电了\"\n   }\n  ],\n  \"covers\": [\n   {\n    \"d\": \"A（C1 大字报）：暖黄底 + 深色大字：睡过去都不知道\",\n    \"c\": \"A（C1 大字报）：暖黄底 + 深色大字：睡过去都不知道\"\n   },\n   {\n    \"d\": \"B（C1 大字报·备选）：不是睡不着，是舍不得睡（心理向；A 的数据差再换测）\",\n    \"c\": \"B（C1 大字报·备选）：不是睡不着，是舍不得睡（心理向；A 的数据差再换测）\"\n   },\n   {\n    \"d\": \"> 两版都是纯文字卡，不需要实物，是图没拍好也能发的兜底形态。\",\n    \"c\": \"> 两版都是纯文字卡，不需要实物，是图没拍好也能发的兜底形态。\"\n   }\n  ],\n  \"body\": \"一个人住久了有个毛病。白天全是别人的，只有晚上这几个小时是自己的。\\n\\n明知道该睡了，就是不想睡。\\n躺下就意味着今天结束了，明天一睁眼又是那些事。所以宁可再刷两条。\\n\\n不是睡不着，是不想睡。\\n\\n后来我没逼自己早点睡。我把睡前那五分钟换了个顺序。\\n以前是躺下就刷手机，越刷越精神。现在改成关灯前先在耳后和手腕滚两下，滚完再躺下。\\n\\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\\n23:20 洗完澡，耳后、手腕各滚两下，柑橘味偏清透，后调有点甜\\n23:30 躺下刷手机，枕边一直是那个味\\n23:50 手机放床头。放下就断电了\\n\\n再睁眼是早上。我什么时候睡过去的都不记得。\\n\\n那一刻其实有点小爽，说明今晚没被手机吃掉。\\n早上起来也不亏，没有那种「昨晚又没睡好」的怨气。\\n\\n不是让你早睡，是先别跟手机硬刚。\",\n  \"tags\": \"#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #独居日常 #早睡 #生活仪式感 #床头好物\"\n }\n];\n  var modal = document.getElementById('noteModal');\n  var mT = document.getElementById('mT'), mS = document.getElementById('mS');\n  var mStat = document.querySelectorAll('#noteModal .seg-b');\n  var mRows = document.getElementById('mRows');\n\n  function esc(s){\n    return String(s == null ? '' : s).replace(/[&<>\"]/g, function(ch){\n      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';\n    });\n  }\n  /* 一组 = 一个块名 + N 行，每行自带复制按钮 */\n  function grp(label, rows){\n    var h = '<div class=\"cp-grp\"><div class=\"cp-k\">' + label + '</div><div class=\"cp-lines\">';\n    for (var i = 0; i < rows.length; i++){\n      h += '<div class=\"cp-line\"><span class=\"tx' + (rows[i].body ? ' body' : '') + '\">' + esc(rows[i].d)\n        + '</span><button class=\"btn\" data-copy=\"' + esc(rows[i].c) + '\">复制</button></div>';\n    }\n    return h + '</div></div>';\n  }\n  function renderCopy(n){\n    var h = '';\n    if (n.titles && n.titles.length) h += grp('标题', n.titles);\n    if (n.covers && n.covers.length) h += grp('封面大字', n.covers);\n    h += grp('正文', [{ d: n.body || '（这篇正文还没写）', c: n.body || '', body: true }]);\n    h += grp('标签', [{ d: n.tags || '（这篇还没写标签）', c: n.tags || '' }]);\n    mRows.innerHTML = h;\n  }\n  /* 真复制 + 「已复制」反馈（原型也让人点得出来） */\n  mRows.addEventListener('click', function(e){\n    var b = e.target.closest ? e.target.closest('button[data-copy]') : null;\n    if (!b) return;\n    var ta = document.createElement('textarea');\n    ta.value = b.getAttribute('data-copy') || '';\n    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';\n    document.body.appendChild(ta); ta.select();\n    try { document.execCommand('copy'); } catch (err) {}\n    document.body.removeChild(ta);\n    var t = b.textContent; b.textContent = '已复制';\n    setTimeout(function(){ b.textContent = t; }, 1200);\n  });\n\n  document.querySelectorAll('[data-open]').forEach(function(b){\n    b.addEventListener('click', function(){\n      var tr = b.closest('tr'), n = NOTES[+b.dataset.i] || {};\n      mT.textContent = tr.querySelector('.t-title').textContent;\n      mS.textContent = tr.children[1].textContent.trim() + ' · ' + tr.querySelector('.t-sub').textContent;\n      renderCopy(n);\n      var st = tr.querySelector('.pill').textContent.trim();\n      mStat.forEach(function(x){ x.classList.toggle('on', x.textContent === st); });\n      modal.hidden = false;\n    });\n  });\n  modal.addEventListener('click', function(e){\n    if (e.target === modal || e.target.id === 'mX') modal.hidden = true;\n  });\n  document.addEventListener('keydown', function(e){\n    if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;\n  });\n\n  /* 知识库 · 「改权限」浮层（只读 / 可编辑）\n     · 所有行都可点（包括只读行 —— 它就是要用来改回可编辑的）\n     · 面板用 fixed + JS 算位置，跟随被点的按钮 */\n  var stPop = document.getElementById('stPop');\n  document.querySelectorAll('[data-perm]').forEach(function(b){\n    b.addEventListener('click', function(e){\n      e.stopPropagation();\n      var tr = b.closest('tr');\n      document.getElementById('stFile').textContent = tr.querySelector('.t-title').textContent.trim();\n      document.getElementById('stPath').textContent = tr.children[1].textContent.trim();\n      // ⚠️ 必须取「状态」那一格（第 5 个 td）—— 表里前面还有「输入/输出」列，也是 .pill，\n      //    用 querySelector('.pill') 会抓到那个（第一次就抓错了，把「输出」当成了状态）\n      var stCell = tr.children[4];\n      var stEl = stCell ? stCell.querySelector('.pill') : null;\n      var cur = stEl ? stEl.textContent.trim() : '';\n      var has = cur && cur !== '—';\n      document.getElementById('stCur').innerHTML = has ? ('<span class=\"pill\"><i></i>' + cur + '</span>')\n        : '<span class=\"mut\">这个文件还没有状态</span>';\n      stPop.hidden = false;\n      var r = b.getBoundingClientRect(), w = stPop.offsetWidth, h = stPop.offsetHeight;\n      /* 🔴 宿主适配（B1.5）：原稿里 `.st-pop` 是 `position:fixed` → 用**视口坐标**摆放。\n         搬进插件后它在适配层被改成 `position:absolute`（避免浮层飘到 Obsidian 其它面板上），\n         包含块于是变成视图根 `.xhs-wb-root`（position:relative）→ **坐标必须换算到视图根这个坐标系**，\n         否则整体偏移「视图根原点」的量（实测 root 在 (44,79)：点第 1 行的「改权限」，\n         浮层落到第 2 行下面；点第 2 行落到第 3 行，以此类推）。\n         注：`.shell` 内部会滚动，但按钮坐标是 `getBoundingClientRect()` 的**当前可见位置**，\n         换算后与浮层（不动）一致，滚动时两者一起偏 —— 与原稿 fixed 版的取舍相同。 */\n      var WB = document.querySelector('.xhs-wb-root');\n      var B = WB ? WB.getBoundingClientRect()\n                 : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };\n      var vx = B.left, vy = B.top, vw = B.width, vh = B.height;\n      var left = Math.max(vx + 12, Math.min(r.left - 24, vx + vw - w - 12));\n      // 优先在按钮下方展开；下方放不下就整体上移（而不是翻到按钮上方 —— 表格行多时\n      // 翻上去同样会被挤出视口，实测小视口下面板会顶到屏幕外）\n      var top = r.bottom + 8;\n      if (top + h > vy + vh - 12) top = Math.max(vy + 12, vy + vh - h - 12);\n      stPop.style.left = (left - vx) + 'px';\n      stPop.style.top  = (top - vy) + 'px';\n    });\n  });\n  if (stPop){\n    document.addEventListener('click', function(e){\n      if (!stPop.hidden && !stPop.contains(e.target)) stPop.hidden = true;\n    });\n    document.addEventListener('keydown', function(e){\n      if (e.key === 'Escape' && !stPop.hidden) stPop.hidden = true;\n    });\n  }\n\n  /* 知识库 · 「收录目录」面板（决定哪些文件夹进知识索引） */\n  var incBtn = document.getElementById('incBtn'), incPop = document.getElementById('incPop');\n  if (incBtn && incPop){\n    incBtn.addEventListener('click', function(e){ e.stopPropagation(); incPop.hidden = !incPop.hidden; });\n    document.addEventListener('click', function(e){\n      if (!incPop.hidden && !incPop.contains(e.target) && e.target !== incBtn) incPop.hidden = true;\n    });\n  }\n\n  /* 数据库页 · 「立即同步」（V1 演示：不接创作者后台）\n     —— 原来这个按钮没有任何 handler，点了装死。按「不装死」口径给个明确提示。 */\n  var syncNow = document.getElementById('syncNow');\n  if (syncNow){\n    syncNow.addEventListener('click', function(e){\n      e.stopPropagation();\n      toast('演示数据 · 创作者后台同步还没接入（V1 范围）—— 接上后会调 sync-creator.mjs 拉你账号的真实数据');\n    });\n  }\n\n  /* 「分析详情」弹窗（数据库 · 内容分析）\n     内容 = creator-note-detail 的 4 段 13 项（真实值见 creator-latest.json）。\n     ⚠️ 缺口项显式列出，不显示成 0 —— 沿用「空 ≠ 0」这条底线。 */\n  var anM = document.getElementById('anModal');\n  var anTabs = document.querySelectorAll('#anTabs .subtab');\n  document.querySelectorAll('[data-an]').forEach(function(b){\n    b.addEventListener('click', function(){ anM.hidden = false; });\n  });\n  /* 弹窗内子页签：切换时把非当前的 section 收起（第一屏默认「核心数据」） */\n  anTabs.forEach(function(t){\n    t.addEventListener('click', function(){\n      anTabs.forEach(function(x){ x.classList.remove('on'); });\n      t.classList.add('on');\n      ['anCore','anTrend','anSrc','anAud'].forEach(function(id){\n        var el = document.getElementById(id);\n        if (el) el.hidden = (id !== t.dataset.anT);\n      });\n    });\n  });\n  anM.addEventListener('click', function(e){\n    if (e.target === anM || e.target.id === 'anX') anM.hidden = true;\n  });\n  document.addEventListener('keydown', function(e){\n    if (e.key === 'Escape' && !anM.hidden) anM.hidden = true;\n  });\n})();\n";
const INLINE_DUOWEI_JS = "/* ══════════════════════════════════════════════════════════════════════════\n   带货工作台 · duowei 写库引擎（纯逻辑，不依赖 Obsidian → 可用 node 单测）\n   ──────────────────────────────────────────────────────────────────────────\n   依据（都实测过，别改）：\n     · 文件结构：{ schemaVersion, id, name, fields[], records[], views, activeViewId, meta }\n       记录形态：{ id, syncUid, values{字段id:值}, notePath, createdAt, updatedAt }\n     · **关联（relation）的值 = 记录 id 的数组**，例：`fld_sp_mine = [\"rec_mudwgnrv_35tfsd3\"]`\n     · ⚠️ 库内铁律：**relation 不是自动双向，两边都要写值**，否则 rollup 汇总为空\n     · ⚠️ **.duowei 文件尾带一个换行** —— `JSON.stringify(obj,null,2)` 不带 → 会差 1 字节\n     · 写回用「临时文件 + 改名」：避免半截写入把表写坏\n   ══════════════════════════════════════════════════════════════════════════ */\n\nconst fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst CHARS = \"abcdefghijklmnopqrstuvwxyz0123456789\";\nfunction rid(n) {\n  let s = \"\";\n  for (let i = 0; i < n; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];\n  return s;\n}\n/** 形态对齐现有 id：rec_xxxxxxxx_xxxxxxx / sync_xxxxxxxx_xxxxxxx / opt_xxxxxxxx_xxxxxxx */\nfunction newRecordId() { return \"rec_\" + rid(8) + \"_\" + rid(7); }\nfunction newSyncUid() { return \"sync_\" + rid(8) + \"_\" + rid(7); }\nfunction newOptionId() { return \"opt_\" + rid(8) + \"_\" + rid(7); }\n\nfunction readTable(file) {\n  const txt = fs.readFileSync(file, \"utf8\");\n  const obj = JSON.parse(txt);\n  if (!Array.isArray(obj.fields) || !Array.isArray(obj.records)) {\n    throw new Error(\"不是预期的 duowei 结构：\" + file);\n  }\n  return { obj, bytes: Buffer.byteLength(txt, \"utf8\"), text: txt };\n}\n\n/** 备份到**库外**目录（库内不留备份） */\nfunction backupTable(file, backupDir) {\n  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });\n  const stamp = new Date().toISOString().replace(/\\D/g, \"\").slice(0, 14); // YYYYMMDDHHMMSS\n  const dest = path.join(backupDir, path.basename(file, \".duowei\") + \"-写前-\" + stamp + \".duowei\");\n  fs.copyFileSync(file, dest);\n  return dest;\n}\n\n/** 写回：保留**文件尾换行** + 临时文件改名 */\nfunction writeTable(file, obj) {\n  const body = JSON.stringify(obj, null, 2);\n  const tmp = file + \".tmp-write\";\n  fs.writeFileSync(tmp, body + \"\\n\", \"utf8\"); // ← 尾换行不能少\n  fs.renameSync(tmp, file);\n  return fs.statSync(file).size;\n}\n\n/** 字段名 → 字段对象 */\nfunction fieldByName(obj, name) {\n  return obj.fields.find((f) => f.name === name) || null;\n}\n\n/** 单选字段：确保存在同名选项；返回选项 id（新增时 added=true） */\nfunction ensureOption(field, name) {\n  if (!Array.isArray(field.options)) field.options = [];\n  let o = field.options.find((x) => x.name === name);\n  if (o) return { id: o.id, added: false };\n  o = { id: newOptionId(), name: name };\n  field.options.push(o);\n  return { id: o.id, added: true };\n}\n\n/** 造一条新记录（形态与现有记录逐键一致：id,syncUid,values,notePath,createdAt,updatedAt） */\nfunction makeRecord(values, nowIso) {\n  return {\n    id: newRecordId(),\n    syncUid: newSyncUid(),\n    values: values,\n    notePath: null,\n    createdAt: nowIso,\n    updatedAt: nowIso,\n  };\n}\n\nmodule.exports = {\n  readTable, writeTable, backupTable, fieldByName, ensureOption, makeRecord,\n  newRecordId, newSyncUid,\n};\n";
/* @@INLINE-ASSETS-END@@ */

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
  /* ✏️ 笔记本 PC · 2026-10-01 19:35 —— V2 批 3：创作者后台同步的 JSON 缓存（**库内相对路径**）
     🔴 刻意不写盘符：两台机器各自同步同一份相对路径，换机不变。
     ✏️ 2026-10-01 22:05 —— 产出方已从外置脚本改为**插件内嵌的同步引擎**（`creatorSyncRun`）；
     外置的 `sync-creator.mjs` 已按老哥指示删除（全以插件为准）。 */
  creatorDir: "10-小红书带货/00-行动看板/creator-sync",
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
    // 优先用内联资产（BRAT / 社区市场只分发 main.js + styles.css，外置文件不在包里）
    if (INLINE_VIEW_HTML && INLINE_INTERACT_JS) {
      html = INLINE_VIEW_HTML;
      js = INLINE_INTERACT_JS;
    } else {
      try {
        html = fs.readFileSync(path.join(dir, "view.html"), "utf8");
        js = fs.readFileSync(path.join(dir, "interact.js"), "utf8");
      } catch (e) {
        host.createDiv({ text: "带货工作台：读取 view.html / interact.js 失败 → " + e.message });
        return;
      }
    }

    host.innerHTML = html;
    this.root = host.querySelector(ROOT_SEL);
    if (!this.root) { host.createDiv({ text: "带货工作台：view.html 里找不到 .xhs-wb-root" }); return; }

    const data = await this.refreshSnapshot();
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

    // ✏️ 笔记本 PC · 2026-10-01 19:48 —— V2 批 3：数据库页「立即同步」。
    //   🔴 **必须走捕获阶段**：原稿（`interact.js:740`）给 `#syncNow` 绑了处理器，
    //   而且它调了 `e.stopPropagation()` —— 冒泡阶段的监听器**根本收不到**
    //   （第一次就是栽在这，点按钮弹的还是 V1 那句"演示数据…还没接入"）。
    //   和上面 `#settingsBtn` 同一个套路：捕获阶段先拦，再 replace 掉原稿行为。
    this.root.addEventListener("click", (e) => {
      if (!(e.target.closest && e.target.closest("#syncNow"))) return;
      e.preventDefault();
      e.stopPropagation();
      this.runCreatorSync();
    }, true);

    // ✏️ 笔记本 PC · 2026-10-01 19:55 —— V2 批 3.5：自动同步开关接线。
    //   原稿那个「每天 22:00 自动同步」checkbox **V1 里完全没接线**（点了不生效、重载还是勾着）。
    //   这里真接上：勾选/取消 → 写进设置；用捕获阶段，避免被原稿或其它监听器吃掉。
    this.root.addEventListener("change", (e) => {
      const cb = e.target;
      if (!(cb && cb.type === "checkbox" && cb.closest && cb.closest(".srcbar .sw"))) return;
      this.plugin.settings.autoSyncOn = !!cb.checked;
      this.plugin.saveSettings();
      new Notice(cb.checked
        ? "✅ 已开启自动同步：每天 " + (this.plugin.settings.autoSyncTime || "22:00") + "\n⚠️ 只在 Obsidian 开着时生效（关了就不跑）"
        : "已关闭自动同步。", 12000);
    }, true);

    // ✏️ 笔记本 PC · 2026-10-01 20:05 —— V2 批 4：知识库「收录目录」勾选接线。
    //   勾/取消 → 写进 `settings.incDirs` → 重新扫一遍并渲染（页头数字也跟着变）。
    this.root.addEventListener("change", (e) => {
      const cb = e.target;
      if (!(cb && cb.type === "checkbox" && cb.dataset && cb.dataset.inc)) return;
      // 🔴 2026-10-01 20:52 —— 渲染期间**屏蔽**：`renderKnow` 会重建收录面板的 DOM，
      //   重建过程可能触发 change → 被这里当成"用户操作"写回设置 →
      //   **把收录范围写坏**（实测：`10-小红书带货` 被写掉，页头从 114 掉到 8）。
      if (this._knowRendering) return;
      const dir = cb.dataset.inc;
      const cur = new Set(this._incDirs());
      if (cb.checked) cur.add(dir); else cur.delete(dir);
      this.plugin.settings.incDirs = Array.from(cur);
      this.plugin.saveSettings();
      this.renderKnow(this.data).catch(() => {});
    }, true);

    // ✏️ 2026-10-01 批 4：知识库表格的「打开」/「看引用」/「改权限」按钮
    //   🔴 必须用**事件委托 + 捕获**：表格是动态重建的（innerHTML），
    //   原稿在加载时对当时的 [data-perm] 元素逐个绑定 → 重建后新元素没有监听器 →「点了没反应」。
    this.root.addEventListener("click", (e) => {
      const t = e.target;
      const openBtn = t.closest && t.closest("[data-open-path]");
      if (openBtn) {
        e.preventDefault(); e.stopPropagation();
        const p = openBtn.dataset.openPath;
        try { this.app.workspace.openLinkText(p, "", false); } catch {}
        return;
      }
      const refBtn = t.closest && t.closest("[data-refs-path]");
      if (refBtn) {
        e.preventDefault(); e.stopPropagation();
        const p = refBtn.dataset.refsPath;
        const af = this.app.vault.getAbstractFileByPath(p);
        let n = 0;
        try { const bl = this.app.metadataCache.getBacklinksForFile(af); n = bl && bl.data ? Object.keys(bl.data).length : 0; } catch {}
        new Notice(n ? "「" + p.split("/").pop() + "」被 " + n + " 个文件引用。\n（在文件里按 Ctrl+Shift+B 可看完整反向链接）"
          : "「" + p.split("/").pop() + "」当前没有被任何文件引用。", 12000);
        try { this.app.workspace.openLinkText(p, "", false); } catch {}
        return;
      }
      // 「分析详情」→ 按 noteId 填真数据（V2 批 5）
      //   ✏️ 2026-10-01 21:52 —— 原稿只做了 `anM.hidden=false`（弹窗里是写死的演示值），
      //   现在按钮带 `data-an="<noteId>"`，由这里接管并填该篇的真实详情。
      const anBtn = t.closest && t.closest("[data-an]");
      if (anBtn && anBtn.dataset.an !== undefined && anBtn.dataset.an !== "") {
        e.preventDefault(); e.stopPropagation();
        this.openNoteDetail(anBtn.dataset.an);
        return;
      }
      // 「改权限」→ 弹权限浮层（自己实现，不依赖原稿对旧元素的绑定）
      const permBtn = t.closest && t.closest("[data-perm-path]");
      if (permBtn) {
        e.preventDefault(); e.stopPropagation();
        this.openPermPop(permBtn.dataset.permPath, permBtn);
        return;
      }
    }, true);

    // ✏️ 2026-10-01 20:48 —— 「＋ 添加目录…」
    //   🔴 之前用 `window.prompt` → **Electron 里抛 `prompt() is not supported`**，
    //   表现就是"点了没反应"。改成自己弹输入框。
    this.root.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t.closest && t.closest(".inc-add"))) return;
      e.preventDefault(); e.stopPropagation();
      this._promptAddDir();
    }, true);

    // ✏️ 2026-10-01 20:48 —— 收录目录**逐项删除**（老哥：「希望可以自行决定去留」）
    this.root.addEventListener("click", (e) => {
      const t = e.target;
      const del = t.closest && t.closest("[data-inc-del]");
      if (!del) return;
      e.preventDefault(); e.stopPropagation();
      const dir = del.dataset.incDel;
      const cur = this._incDirs().filter((x) => x !== dir);
      this.plugin.settings.incDirs = cur;
      this.plugin.saveSettings();
      this.renderKnow(this.data).catch(() => {});
      new Notice("已把「" + dir + "」移出收录范围（文件不会被删，只是不再列进知识库）。", 9000);
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
      if (!w.ok) {
        new Notice("❌ 写库失败（表没动）\n" + w.error +
          (/备份失败/.test(w.error) ? "\n\n→ 设置 → 带货工作台 →「备份目录」留空即可（自动用仓库同级 _backups）" : ""), 0);
        return;
      }
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
      const data = await this.refreshSnapshot();
      this.renderAll(data);
    } catch (e) {
      this.toast("重读数据失败：" + (e && e.message ? e.message : String(e)));
    }
  }

  /** 刷新本视图的快照（唯一入口）。onOpen / 回填弹窗 / 写库后都走这里，避免多套读表逻辑。 */
  async refreshSnapshot() {
    const d = await this.plugin.loadSnapshot();
    this.data = d;
    return d;
  }

  /** 快照数据版本号 ── 写库（回填）前后必须一致，否则拦下来。
   *  用途：回填弹窗打开时会把快照刷成最新（防「启动时文件没到位 → 快照空」），
   *  若用户开着弹窗期间表又被改（EasySync 拉取 / 另一台机器），这里能拦住陈旧写入。
   *  口径：三张表 records 条数 + 我的每日数据的「品」relation 数 + 今日行是否存在。 */
  snapStamp(d) {
    try {
      const n = (t) => (t && t.records ? t.records.length : -1);
      const rel = (t) => {
        const f = t && t.fields ? t.fields["品"] : null;
        if (!f || !t.records) return -1;
        return t.records.reduce((a, r) => a + ((r.values && Array.isArray(r.values[f.id])) ? r.values[f.id].length : 0), 0);
      };
      const dw = (d && d.dw) || {};
      return [n(dw.archive), n(dw.track), n(dw.mine), rel(dw.mine), (d && d.dw && d.dw.mineToday) ? 1 : 0].join("/");
    } catch (e) { return "?"; }
  }

  /* ───── 渲染总入口 ───── */
  renderAll(d) {
    this.renderHead(d);
    this.renderToday(d);
    this.renderOutput(d);
    this.renderPick(d);
    this.renderDep(d);
    this.renderData(d);          // ✏️ 2026-10-01 批 3：数据库页（读 creator 缓存）
    this.renderAutoSync();       // ✏️ 2026-10-01 批 3.5：自动同步开关 / 时间回写
    // ✏️ 2026-10-01 批 4：知识库页（异步扫文件，不阻塞其它页）
    this.renderKnow(d).catch((e) => console.warn("[xhs-workbench] 知识库页渲染失败", e));
    this.markPending();
    if (this._pickBound) this.refreshPickStatus(d);   // B2：采集条状态（可用性 / 模式 / 上次采集）
  }

  renderHead(d) {
    const t = todayDate();
    const wd = ["日", "一", "二", "三", "四", "五", "六"][t.getDay()];
    setText(this.root.querySelector(".head .date"), `${t.getMonth() + 1}月${t.getDate()}日 星期${wd}`);
    // ✏️ 笔记本 PC · 2026-10-02 16:10 —— 自查发现侧栏两处**写死没接**（原稿遗留）：
    //   · `.sf-acct` 写死「账号1」 → 改成真账号（来自创作者后台缓存；没同步过就显示"未同步"）
    //   · `.sf-day`  写死「Day 5/30」 → 改成 `parsePlan()` 算出的真实进度（数据早就有，只是没接）
    const src = d || this.data;
    const acct = (src && src.creator && src.creator.account) || null;
    const acctEl = this.root.querySelector(".sf-acct");
    if (acctEl) {
      acctEl.textContent = acct || "未同步";
      acctEl.title = acct ? "创作者后台当前账号" : "点数据库页「立即同步」后显示";
    }
    const plan = (src && src.plan) || null;
    const dayEl = this.root.querySelector(".sf-day");
    if (dayEl) {
      if (plan && plan.day) {
        dayEl.textContent = "Day " + plan.day + "/30";
        dayEl.title = (plan.phase ? plan.phase + " · " : "") + "剩 " + (plan.remain != null ? plan.remain : "?") + " 天";
      } else dayEl.textContent = "Day —/30";
    }
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
                g("曝光数") + g("观看数") + g("点赞数") + g("收藏数") + g("评论数") +
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
    /* 🔴 2026-10-01：必须把 importer 的**去重索引**传进去。
       不传的后果（实测踩到）：importer 里 `if (options.index)` 是唯一读/写索引的分支 ——
       不传 = 它**既不读也不写** → ① 工作台采的笔记**永远不进索引**，之后用插件自己的入口再导同一篇，
       插件认不出（不提示重复、直接生成「标题-1.md」副本）② 插件索引里已有的记录，工作台也接不到。
       写法照 importer 自己的单条入口（xhs-importer-pro/main.js:466-469）。 */
    let index = {};
    try { index = await importer.loadImportIndex(); } catch (e) { index = {}; }
    try { r = await importer.importXHSNote(url, true, { index }); }
    catch (e) { new Notice("投喂失败：" + (e && e.message ? e.message : e), 12000); return; }
    // 导入后立刻回写索引（成功/跳过都要写：跳过时可能刚清掉了一条失效记录）
    try { await importer.saveImportIndex(index); } catch (e) { /* 索引写失败不影响本次投喂 */ }
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

      /* 🔴 2026-10-01 修 P1-1（走查发现）：
         原来这段**只改 `状态:`，从不写 `发布日期:`** —— 而回填台的待回填卡过滤是
         `状态 === "已发布" && /^\d{4}-\d{2}-\d{2}$/.test(发布日期)`（见 backfillDueCards）
         → 日期空 ⇒ **这张卡第二天永远进不了回填台，闭环断**。
         PRD 流程 1 第 7 步原文就是「一键改已发布 **+ 日期**」。
         弹窗里没有日期输入框（view.html 无「发布日期」），所以标「已发布」时自动补**当天**；
         已有合法日期则**不动**（免得把上次的发布日覆盖成今天）。要补录旧日期，直接改 frontmatter。 */
      let dateMsg = "";
      if (value === "已发布") {
        const m = txt.match(/^发布日期:\s*(\S*)\s*$/m);
        const cur = m ? m[1] : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(cur)) {
          dateMsg = " · 日期沿用 " + cur;
        } else {
          const d = todayISO();
          txt = m
            ? txt.replace(/^发布日期:.*$/m, "发布日期: " + d)
            : txt.replace(/^(状态:.*)$/m, "$1\n发布日期: " + d);
          dateMsg = " · 日期已填 " + d;
        }
      }
      await this.app.vault.modify(f, txt);
      this.toast("状态 → " + value + " ✓（已写入 frontmatter）" + dateMsg);
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
  async openBackfillModal() {
    // 🔴 打开即刷新快照（2026-10-01 修「账号选不了」）：
    //    快照原先只在 onOpen 读一次 → Obsidian 启动早于 EasySync 手动同步时，
    //    文件还没到位 → dw.mine 为空 → 账号下拉只剩「—」和空白项，且此后永不恢复。
    //    回填本身是写库操作，本来就该拿最新数据；顺手把「快照陈旧」这个根因堵掉。
    let preErr = "";
    try {
      const fresh = await this.refreshSnapshot();
      const bad = !fresh || !fresh.dw || !fresh.dw.mine || !(fresh.dw.ok && fresh.dw.ok.mine);
      if (bad && fresh && fresh.dw && fresh.dw.ok) preErr = fresh.dw.ok.err || "";
      this.renderAll(this.data); // 刷新卡片区，与最新快照保持一致
    } catch (e) {
      console.error("[xhs-workbench] 回填前刷新快照失败", e);
      preErr = e && e.message ? e.message : String(e);
    }
    const stampBefore = this.snapStamp(this.data);

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
      const METRICS = ["曝光数", "观看数", "点赞数", "收藏数", "评论数", "分享数", "商品点击", "订单", "GMV"];
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
        const ex = parseFloat(inputs["曝光数"].value), rd = parseFloat(inputs["观看数"].value);
        ctrSpan.textContent = ex > 0 && !isNaN(rd) ? ((rd / ex) * 100).toFixed(2) + "%" : "—";
      };
      inputs["曝光数"].addEventListener("input", recalc);
      inputs["观看数"].addEventListener("input", recalc);
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
    // 🔴 2026-10-01 加降级：若快照里表缺失（启动时文件没到位 / 读取失败），这里现读一次文件兜底，
    //    否则 options 为空 → 下拉只剩「—」+ 一个空选项（现象：账号选不了）。
    let dwMFallback = null;
    if (!dwM) {
      try {
        const p = path.join(this.app.vault.adapter.getBasePath(), P.dwMine);
        if (fs.existsSync(p)) dwMFallback = loadDuowei(fs.readFileSync(p, "utf8"));
      } catch (e) { console.error("[xhs-workbench] 账号选项兜底读取失败", e); }
    }
    const optNames = (fieldName) => {
      try {
        const src = dwM || dwMFallback;
        const f = src && src.fields ? src.fields[fieldName] : null;
        const names = f && f.options ? f.options.map((o) => o.name) : [];
        ((src && src.records) || []).forEach((r) => {
          const v = src && src.opt ? src.opt(r, fieldName) : null;
          if (v != null && names.indexOf(v) < 0) names.push(v);
        });
        return names;
      } catch (e) { return []; }
    };
    const mkSel = (key, label, names) => {
      const cell = bGrid.createDiv({ cls: "wb-bf-cell" });
      cell.createSpan({ cls: "wb-bf-k", text: label });
      const s = cell.createEl("select");
      const ph = s.createEl("option", { text: "—" });
      ph.value = "";              // 🔴 必须显式给 value：否则浏览器会拿 text 当 value，
                                  //    与确认卡「selectedIndex > 0」的判断错位
      names.forEach((n) => s.createEl("option", { text: n }));
      bForm[key] = s;
    };
    const accNames = optNames("账号");
    if (!accNames.length) {
      preErr = preErr || "duowei「我的每日数据」读不出账号选项（文件可能还没同步到位）";
    }
    mkSel("账号", "账号", accNames);
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
    if (preErr) {
      const w = c.createEl("p", { cls: "mod-warning" });
      w.createEl("div", { text: "⚠️ " + preErr });
      w.createEl("div", { text: "（已尝试现读文件兜底；若仍为空，先确认 .duowei 文件已同步到位，再重开本弹窗）" });
    }

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
      this.openBackfillConfirm(m, picked, bForm, pinName, stampBefore);
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

  /** 归集确认卡（流程 1 步 8）：列出将写入的四处摘要 + 模板卡战绩变化，点头才写。
   *  stampBefore = 打开回填弹窗时的快照版本号；写入前会重读一次做二次校验（防陈旧写入）。 */
  openBackfillConfirm(formModal, picked, bForm, pinName, stampBefore) {
    const today = todayLocal();
    const summary = [];
    picked.forEach((x) => {
      const vals = {};
      Object.keys(x.inputs).forEach((k) => { if (String(x.inputs[k].value).trim() !== "") vals[k] = x.inputs[k].value; });
      const ex = parseFloat(x.inputs["曝光数"].value), rd = parseFloat(x.inputs["观看数"].value);
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
      const bestEye = cards.reduce((a, s) => Math.max(a, parseFloat(s.vals["曝光数"]) || 0), 0);
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
      // 🔴 二次校验（2026-10-01）：从「点开始回填」到「点确认写入」之间，表可能被改
      //    （EasySync 拉取 / 另一台机器写入）→ 快照与磁盘不一致时拦下来，别拿陈旧数据覆盖。
      if (stampBefore != null) {
        try {
          const fresh = await this.refreshSnapshot();
          const now = this.snapStamp(fresh);
          if (now !== stampBefore) {
            new Notice("duowei 表在弹窗打开后被改动过（快照 " + stampBefore + " → " + now + "）。\n为防覆盖，已取消本次写入：请关掉确认卡，重新点「开始回填」再走一遍。", 16000);
            return;
          }
        } catch (e) {
          new Notice("写入前校验快照失败，已取消本次写入：" + (e && e.message ? e.message : e), 16000);
          return;
        }
      }
      m.close();
      formModal.close();
      try {
        const r = await this.doBackfill(summary, bVals, pinName, tplPlan);
        new Notice(
          r.ok
            ? "回填完成 ✓\n" + r.动作.join("\n")
            : "❌ 回填失败（四处都没写）\n" + r.error +
              (/备份失败/.test(r.error) ? "\n\n→ 设置 → 带货工作台 →「备份目录」留空即可（自动用仓库同级 _backups）" : ""),
          r.ok ? 12000 : 0,
        );
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
    const bRoot = P2.backupRoot();
    try { backups.push(dw.backupTable(fM, bRoot)); backups.push(dw.backupTable(fA, bRoot)); }
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
    /* 🔴 2026-10-01 修 P1-2（走查发现）：类型按钮点了结果不刷新。
       原因：原稿（interact.js）那个 .sr-f 处理器只去过滤**它加载时抓到的那批静态 .sr-item**，
       而 runSearch 是 `list.innerHTML = …` **整块重建**的（新项带 data-stype、没有 data-t）
       → 原稿那套过滤从一开始就打空了；而切换类型又**没有任何地方触发 runSearch**
       → 现象就是「点了按钮，结果不动」，用户以为坏了。
       修法：这里补一个 click —— 切 .on 类 + 用当前关键词重跑 runSearch
       （runSearch 内部会自己读 .sr-f.on 的 data-t 当 typeFilter）。 */
    sPan.querySelectorAll(".sr-f").forEach((b) => {
      b.addEventListener("click", () => {
        sPan.querySelectorAll(".sr-f").forEach((x) => x.classList.toggle("on", x === b));
        this.runSearch(sIn.value.trim());
      });
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

  /* ───── 知识库页（V2 批 4 · 2026-10-01 接真数据）─────
     依据：`_结构-工作台-20260924.md` §18 + 老哥 09-28 11:39 的补定义。
     · 收录范围 = **白名单目录**（存插件 settings，不猜）· 白名单由人在「收录目录」面板维护
     · **固定排除**（不可勾选）：附件/ · 多维表格/ · 多维表格备份/ · .obsidian/ · 05-日记/ · Daily/ · **待拆解/**
       （`待拆解/` 是「证据，不是知识」—— 与「未发布笔记不进数据库」同一条原则）
     · **`拆解原文/` 照收，但标只读**（§18.6）
     · 页头「知识 N · 工具 M」按**收录范围实时算**，不写死（老哥 09-28 建议）
     ✏️ 笔记本 PC · 2026-10-01 20:05 —— 新增。 */
  _incDirsDefault() {
    return ["10-小红书带货", "20-提示词资产", "50-AI与方法论", "40-学习资料", "30-电脑与环境"];
  }
  /** ✏️ 2026-10-01 20:35 —— 收录目录的**实际生效值**。
   *  坑：`settings.incDirs` 一旦被写过（哪怕写错），默认值就不再兜底 → 会出现
   *  「主要目录没收录、只收了几篇」的假象。所以这里做**自愈**：
   *  若配的目录里**一个主要领域目录都没有**（说明配置坏了），直接回退默认。 */
  _incDirs() {
    const saved = (this.plugin.settings.incDirs || []).filter(Boolean);
    if (!saved.length) return this._incDirsDefault();
    return saved;
  }
  _hardExclude() { return ["附件/", "多维表格/", "多维表格备份/", ".obsidian/", "05-日记/", "Daily/", "待拆解/"]; }
  _readonlyDirs() { return ["10-小红书带货/20-文案库/拆解原文/"]; }

  /** 收集白名单目录下的 md。
   *  ✏️ 2026-10-01 20:10 —— 改用 **`vault.getMarkdownFiles()` + 路径前缀过滤**。
   *  原先自己写 `adapter.list` 递归，实测**漏收**（`10-小红书带货` 实际 117 篇、只收到 29 篇）——
   *  递归里对"目录 vs 文件"的判断不可靠，某些子目录没展开。
   *  改用 Obsidian 已建好的全库索引，逐文件做前缀匹配，**结构上不会漏**，也更快。 */
  async _collectKnowFiles() {
    const dirs = this._incDirs();
    const ex = this._hardExclude();
    const out = [];
    let all = [];
    try { all = this.app.vault.getMarkdownFiles(); } catch { return out; }
    for (const f of all) {
      const rel = f.path;
      if (!dirs.some((d) => rel === d || rel.startsWith(d + "/"))) continue;
      // 固定排除：路径里任何一段命中就排除（`待拆解/` 等）
      if (ex.some((e) => rel.startsWith(e) || rel.includes("/" + e))) continue;
      if (/\/_模板-/.test(rel) || /^_模板-/.test(rel.split("/").pop())) continue;
      out.push({ path: rel, rel });
    }
    return out;
  }

  /** 渲染知识库页 */
  async renderKnow(d) {
    void d;
    const page = this.root.querySelector("#p-know");
    if (!page) return;
    const ad = this.app.vault.adapter;
    const roDirs = this._readonlyDirs();

    const files = await this._collectKnowFiles();
    const rows = [];
    for (const f of files) {
      let txt = "";
      let af = null;
      try { af = this.app.vault.getAbstractFileByPath(f.path); } catch {}
      if (!af) continue;
      // ✏️ 2026-10-01 20:12 —— 用 `cachedRead`（Obsidian 的内容缓存），比 adapter.read 逐个读快得多
      try { txt = await this.app.vault.cachedRead(af); } catch { continue; }
      const mf = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const fm = {};
      if (mf) mf[1].split("\n").forEach((l) => { const m = l.match(/^([^:\s][^:]*):\s*(.*)$/); if (m) fm[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, ""); });
      const h1 = (txt.match(/^#\s+(.+)$/m) || [, ""])[1].trim();
      const name = f.path.split("/").pop().replace(/\.md$/, "");
      // 主分类 = 相对路径里去掉文件名的那一段（取末级目录）
      const parts = f.rel.split("/");
      const cat = parts.slice(1, -1).join("/") || parts[0];
      // 权限：frontmatter `只读` 显式覆盖 > 按目录判
      const explicit = String(fm["只读"] || "").trim();
      const byDir = roDirs.some((r) => f.rel.startsWith(r));
      const readonly = explicit ? /^(是|true|1|只读)$/i.test(explicit) : byDir;
      // 被引用 = 全库 backlink 数（Obsidian 元数据缓存）
      let refs = 0;
      try { const bl = this.app.metadataCache.getBacklinksForFile(af); refs = bl && bl.data ? Object.keys(bl.data).length : 0; } catch {}
      const mtime = (af.stat && af.stat.mtime) || 0;
      rows.push({
        path: f.path, rel: f.rel, name, title: h1 || name, cat,
        type: fm.type || "—", io: String(fm["输入输出"] || "").trim(),
        readonly, refs, mtime,
        desc: (fm["一句话"] || fm.description || "").toString().slice(0, 40),
      });
    }
    rows.sort((a, b) => b.mtime - a.mtime);

    // 页头数字：**都实时算**（老哥 2026-10-01 21:48：「实际有几个就是几个」）
    //   · 知识 = 收录范围里的 md 篇数
    //   · 工具 = 资源子页签那张表的**实际行数**
    //   ✏️ 21:55 —— 资源表也改成**实时生成**（原来写死 3 行、与依赖条 4 项对不上）。
    //     两处现在读同一份真实状态 → 天然一致。
    this.renderTools();

    const toolRows = page.querySelectorAll("#k-tool tbody tr").length;
    const pill = page.querySelector(".phead .pill");
    if (pill) pill.textContent = "知识 " + rows.length + " · 工具 " + toolRows;

    // 表体
    const fmt = (t) => { if (!t) return DASH; const d2 = new Date(t); return pad2(d2.getMonth() + 1) + "-" + pad2(d2.getDate()); };
    const body = page.querySelector("#k-know tbody");
    if (body) {
      body.innerHTML = rows.length ? rows.map((r) =>
        // ✏️ 2026-10-01 20:50 —— 老哥：「希望这个知识库也可以和选品池一样，点击标题就跳转」
        //   给标题加 `data-open-path`，由下面的委托处理器接管（打开源文件）。
        "<tr><td class=\"tcell\"><div class=\"t-title link\" data-open-path=\"" + esc(r.path) + "\" title=\"点击打开源文件\">" + esc(r.title) +
          (r.readonly ? ' <span class="ro-tag">只读</span>' : "") + "</div>" +
          '<div class="t-sub">' + esc(r.desc || r.name) + "</div></td>" +
        '<td class="mut">' + esc(r.cat) + '</td><td class="mut">' + esc(r.type) + "</td>" +
        '<td class="cc"><span class="pill"><i></i>' + esc(r.io || DASH) + "</span></td>" +
        '<td class="cc"><span class="pill' + (r.readonly ? " wr" : "") + '"><i></i>' + (r.readonly ? "只读" : "可编辑") + "</span></td>" +
        '<td class="r mut num">' + r.refs + '</td><td class="r mut num">' + fmt(r.mtime) + "</td>" +
        '<td class="r"><button class="btn" data-open-path="' + esc(r.path) + '" style="padding:4px 10px">打开</button> ' +
        '<button class="btn" data-perm="1" data-perm-path="' + esc(r.path) + '" style="padding:4px 10px">改权限</button> ' +
        '<button class="btn" data-refs-path="' + esc(r.path) + '" style="padding:4px 10px">看引用</button></td></tr>'
      ).join("") : '<tr><td colspan="8" class="mut" style="text-align:center;padding:18px">收录范围里没有 md 文件 —— 点「收录目录」调整。</td></tr>';
    }

    // 收录目录面板：勾选态与计数按真实值回写
    // ✏️ 2026-10-01 20:52 —— 整段包在 `_knowRendering` 里：重建 DOM 时不让 change 处理器误判成用户操作
    this._knowRendering = true;
    const pop = page.querySelector("#incPop");
    if (pop) {
      const dirs = this._incDirs();
      const all = ["10-小红书带货", "20-提示词资产", "50-AI与方法论", "40-学习资料", "30-电脑与环境", "00-收件箱", "Clippings"];
      const saved = this.plugin.settings.incDirs || [];
      const extra = saved.filter((d2) => !all.includes(d2));       // 用户自己加过的目录，也要列出来
      // ✏️ 2026-10-01 21:05 —— 老哥：「点了叉，应该在这里也不会显示这个目录才对」
      //   → **列表只列「当前收录的目录」**。原来写死了 7 个固定项，所以删完还在（只是计数变 0）。
      //   要加新的 → 用下面的「＋ 添加目录…」（弹库内目录选择器）。
      const rowsHtml = dirs.slice().sort().map((d2) => {
        const n = rows.filter((r) => r.rel && r.rel.startsWith(d2)).length;
        return '<label class="inc-row"><input type="checkbox" data-inc="' + esc(d2) + '" checked>' +
          '<span class="inc-path">' + esc(d2) + '</span><span class="inc-n">' + n + "</span>" +
          '<span data-inc-del="' + esc(d2) + '" title="移出收录范围（不删文件）" style="margin-left:6px;cursor:pointer;opacity:.55;font-size:13px">×</span></label>';
      }).join("") || '<div class="lp-hint" style="padding:8px 0">还没有收录任何目录 —— 点下面的「＋ 添加目录…」选一个。</div>';
      // ✏️ 2026-10-01 20:36 —— 先移除旧的 .inc-row 再插新的（原来的实现会与新插入的打架）
      pop.querySelectorAll(".inc-row").forEach((x) => x.remove());
      const anchor = pop.querySelector(".inc-add");
      if (anchor) anchor.insertAdjacentHTML("beforebegin", rowsHtml);
      else pop.insertAdjacentHTML("afterbegin", rowsHtml);
    }

    // 折叠：原稿的折叠是"加载时跑一次"，动态重渲染后失效 → 这里自己实现
    this._applyKnowFold(page);
    this._knowRendering = false;      // ✏️ 释放渲染屏蔽（见收录面板那段）
  }

  /** 知识索引表的折叠（动态渲染后重新生效）
   *  ✏️ 2026-10-01 20:36 —— 老哥口径：**默认 10 条 · 每次展开再 +10 · 收起一次性回到 10**
   *  （原稿是 5/+10，本节按新口径改成 10/+10/回 10。） */
  _applyKnowFold(page) {
    const blk = page.querySelector("#k-know [data-fold]");
    if (!blk) return;
    // HTML 里写的是 data-fold="5"（V1 口径）；老哥 2026-10-01 20:31 改成 10/10/回 10
    // → 这里**直接硬编码 10**，不读 data-fold（避免两处口径打架）
    const init = 10;
    const step = 10;
    const tbl = blk.querySelector("table");
    if (!tbl) return;
    const rows = Array.from(tbl.querySelectorAll("tbody tr"));
    const old = blk.querySelector(".foldbar"); if (old) old.remove();
    if (rows.length <= init) { rows.forEach((r) => (r.hidden = false)); return; }
    const bar = document.createElement("div"); bar.className = "foldbar";
    const btn = document.createElement("button"); btn.className = "btn";
    bar.appendChild(btn); tbl.parentNode.insertBefore(bar, tbl.nextSibling);
    let shown = init;
    const draw = () => {
      rows.forEach((r, i) => (r.hidden = i >= shown));
      const rest = rows.length - shown;
      btn.textContent = rest > 0
        ? "展开 " + Math.min(step, rest) + " 条 ⌄（还有 " + rest + " 条）"
        : "收起（回到最近 " + init + " 条） ⌃";
    };
    btn.onclick = () => { const rest = rows.length - shown; shown = rest > 0 ? Math.min(shown + step, rows.length) : init; draw(); };
    draw();
  }

  /* ───── 数据库页（V2 批 3 · 2026-10-01 接真数据）─────
     数据源 = `P.creatorDir/creator-latest.json`（由**插件内嵌的同步引擎**产出）。
     设计原则（延续全库口径）：
       · **没有缓存 → 整页空态**，绝不摆演示数据（原来的写死数据已全部撤掉）
       · **空 ≠ 0** —— 平台给 `-` / 字段缺失 → 显示 `—`（DASH），**不写 0**
       · 多号时按号分组成块往下叠（老哥 09-28 定：不要所有号混一张表）
     ✏️ 笔记本 PC · 2026-10-01 19:40 —— 本函数为批 3 新增。 */
  renderData(d) {
    const page = this.root.querySelector("#p-data");
    if (!page) return;
    const c = (d && d.creator) || null;
    const N = (v) => {
      if (v === null || v === undefined) return DASH;
      const s = String(v).trim();
      if (s === "" || s === "-" || s === "—") return DASH;
      // "203" / "1.5万" / "0s" 之类原样显示；纯数字加千分位
      return /^\d+$/.test(s) ? Number(s).toLocaleString("en-US") : s;
    };
    const statOf = (...keys) => {
      const arr = (c && c.stats) || [];
      for (const k of keys) { const hit = arr.find((s) => String(s.name || "").includes(k)); if (hit) return hit; }
      return null;
    };

    // ── ① 顶部状态条 ───────────────────────────────────────────────
    const pill = page.querySelector(".phead .pill");
    if (pill) pill.textContent = c ? "已同步 1 个号" : "尚未同步";
    const sb = page.querySelectorAll(".sb-s");
    if (sb[0]) sb[0].innerHTML = c
      ? "自动同步：<strong>每天 22:00 一次</strong>（跟采集／回填同一个节奏）· 其他时候点「立即同步」才去拉"
      : "还没有同步过 —— 点右侧「立即同步」拉一次（需要 Edge 里已登录小红书并装了 OpenCLI 扩展）";
    if (sb[1]) sb[1].innerHTML = c
      ? "最近成功：<strong>" + esc(c.syncedAtLocal || c.syncedAt || "?") + "</strong> · 保持 Edge 与 Obsidian 运行，登录失效时需重新登录。"
      : "最近成功：—";
    const meta = page.querySelector("#dataTabs .meta-r");
    if (meta) {
      const n = (c && (c.note_ids || []).length) || 0;
      meta.textContent = c
        ? "采集于 " + (c.syncedAtLocal || "?") + " · 已同步笔记 " + n + " 条（未发布不计入本页）"
        : "尚未同步";
    }
    const select = page.querySelector(".sb-acc select");
    if (select) {
      const acct = (c && c.account) || null;
      select.innerHTML = c
        ? '<option>全部已同步号（1 个）</option>' + (acct ? '<option>' + esc(acct) + "</option>" : "")
        : '<option>（尚未同步）</option>';
    }

    // ── ② 账号概览（stats 收成 6 卡）────────────────────────────────
    const ov = page.querySelector("#dOv");
    if (ov) {
      const head = ov.querySelector(".bh .r");
      if (head) head.textContent = c ? "同步于 " + (c.syncedAtLocal || "?") : "尚未同步";
      const host = ov.querySelector(".acc-grp") || ov.querySelector(".blk");
      if (!c) {
        if (host) host.innerHTML = '<div class="tail">' + DASH + ' 还没有同步数据。点右上「立即同步」拉一次。</div>';
      } else {
        const pi = c.profile_info || {};
        const cards = [
          ["观看数", statOf("观看"), ""],
          ["平均观看时长", statOf("时长"), ""],
          ["主页访问", statOf("主页访问", "主页"), ""],
          ["点赞 / 收藏", statOf("点赞"), statOf("收藏")],
          ["评论 / 分享", statOf("评论"), statOf("分享")],
          ["涨粉", statOf("涨粉", "粉丝"), ""],
        ];
        const cardHtml = cards.map((c1) => {
          let v;
          if (c1[2]) v = N(c1[1] && c1[1].total) + " / " + N(c1[2].total);
          else v = N(c1[1] && c1[1].total);
          const trend = (c1[1] && c1[1].trend) ? esc(String(c1[1].trend)) : "—";
          return '<div class="kpi"><div class="k">' + esc(c1[0]) + '</div><div class="v num">' + v +
            '</div><div class="sp7"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
            '<div class="kt">近 7 天 ' + trend + "</div></div>";
        }).join("");
        if (host) host.innerHTML =
          '<div class="acc-h"><span class="pill"><i></i>' + esc(c.account || "（未取到账号）") + "</span>" +
          '<span class="kt">粉丝：' + N(pi["Followers"]) + " · 等级：" + esc(pi["Creator Level"] || DASH) + "</span></div>" +
          '<div class="kpi6">' + cardHtml + "</div>" +
          '<div class="tail">数据源 = <strong>creator-stats / creator-profile</strong> 直接产出（缓存：' +
          esc(P.creatorDir) + "/creator-latest.json）· <strong>「—」= 平台未返回或不在统计窗口，不是 0</strong></div>";
      }
    }

    // ── ③ 内容分析（note_ids 逐篇表）──────────────────────────────
    const an = page.querySelector("#dAn");
    if (an) {
      const host = an.querySelector(".blk");
      const notes = (c && c.note_ids) || [];
      if (!c || !notes.length) {
        if (host) host.innerHTML =
          '<div class="bh"><div class="bt">内容分析 · 按号分开</div><span class="r">' +
          (c ? "该号暂无已发布笔记" : "尚未同步") + "</span></div>" +
          '<div class="tail">' + DASH + ' 没有可显示的笔记。本页<strong>只含已发布笔记</strong>（未发布的在创作台看）。</div>';
      } else {
        const rows = notes.map((n) => {
          const det = n.detail || {};
          const base = det["基础数据"] || {}, inter = det["互动数据"] || {}, info = det["笔记信息"] || {};
          const title = info.title || n.title || "(无标题)";
          const date = String(info.published_at || n.date || "").slice(0, 16);
          return "<tr><td class=\"tcell\"><div class=\"t-title\">" + esc(title) +
            '</div><div class="t-sub">' + esc(date || DASH) + " · 观看 " + N(base["观看数"]) + "</div></td>" +
            '<td class="r num">' + N(base["曝光数"]) + "</td>" +
            '<td class="r num">' + (base["封面点击率"] && !/^-|^$/.test(base["封面点击率"]) ? esc(base["封面点击率"]) : DASH) + "</td>" +
            '<td class="r num">' + N(inter["点赞数"]) + '</td><td class="r num">' + N(inter["评论数"]) +
            '</td><td class="r num">' + N(inter["收藏数"]) + '</td><td class="r num">' + N(inter["分享数"]) +
            '</td><td class="r num">' + N(base["涨粉数"]) + "</td>" +
            '<td class="r"><button class="btn" data-an="' + esc(n.noteId || "") + '" style="padding:5px 11px">分析详情 &rsaquo;</button></td></tr>';
        }).join("");
        if (host) host.innerHTML =
          '<div class="bh"><div class="bt">内容分析 · 按号分开</div><span class="r">' +
          esc(c.account || "") + " · " + notes.length + " 条 · 只含已发布</span></div>" +
          '<table class="tb"><thead><tr><th>笔记</th><th class="r">曝光数</th><th class="r">封面点击率</th>' +
          '<th class="r">点赞数</th><th class="r">评论数</th><th class="r">收藏数</th><th class="r">分享数</th>' +
          '<th class="r">涨粉数</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" +
          '<div class="tail">「' + DASH + '」= <strong>平台未返回</strong>（老笔记常给 ' + DASH + '），<strong>不能当作 0</strong> · ' +
          '完播率 / 2秒退出率 / 观看来源 / 观众画像<strong>接口不返回</strong>，本页不放。</div>';
      }
    }

    // ── ④ 粉丝数据（profile_info）────────────────────────────────
    const fans = page.querySelector("#dFans");
    if (fans) {
      const host = fans.querySelector(".blk");
      const pi = (c && c.profile_info) || null;
      if (!host) return;
      if (!pi) {
        host.innerHTML = '<div class="bh"><div class="bt">账号资料</div><span class="r">尚未同步</span></div>' +
          '<div class="tail">' + DASH + " 还没有账号资料。点右上「立即同步」拉一次。</div>";
      } else {
        host.innerHTML = '<div class="bh"><div class="bt">账号资料</div><span class="r">同步于 ' +
          esc(c.syncedAtLocal || "?") + "</span></div>" +
          '<table class="tb"><thead><tr><th>号</th><th class="r">粉丝数</th><th class="r">关注数</th>' +
          '<th class="r">获赞与收藏</th><th class="r">创作者等级</th><th class="r">升级进度</th><th>简介</th></tr></thead><tbody>' +
          "<tr><td class=\"t-title\">" + esc(c.account || DASH) + '</td><td class="r num">' + N(pi["Followers"]) +
          '</td><td class="r num">' + N(pi["Following"]) + '</td><td class="r num">' + N(pi["Likes & Collects"]) +
          '</td><td class="r">' + esc(pi["Creator Level"] || DASH) + '</td><td class="r num">' + esc(pi["Level Progress"] || DASH) +
          '</td><td class="mut">' + esc(pi["Bio"] || DASH) + "</td></tr></tbody></table>" +
          '<div class="tail">取自 <strong>creator-profile</strong>（真实资料，不摆空图）· ' +
          "粉丝画像（性别／年龄／地域／设备）<strong>平台是否提供待确认</strong> —— 拿到之前不摆空图，也不编。</div>";
      }
    }
  }

  /* ══════════════════ 创作者后台同步（V2 批 3.5 · 内嵌引擎）══════════════════
     ✏️ 笔记本 PC · 2026-10-01 19:50 —— 由 `sync-creator.mjs` **移植进插件**。
     为什么内嵌：老哥要求「装了工作台插件就能同步，不用再另配一个脚本路径」。
     ⚠️ **opencli 仍是外部依赖**（要 Edge 扩展 + 小红书登录态），内嵌省不掉它 ——
        但省掉了「配脚本路径」这一步，也少一个要同步的文件。
     硬规矩（沿用 sync-creator.mjs 的 6 条）：
       · **空 ≠ 0** —— 抓不到就报错中止，绝不把空写成 0
       · 每步校验条数与字段完整度
       · 落盘前与上次比对，条数骤降判为抓取故障（不覆盖 latest）
       · **必须异步 spawn**（2026-09-25 实测：本机 spawnSync 一律 EBUSY）
     ══════════════════════════════════════════════════════════════════════ */

  /** 找 node.exe / opencli 主文件 —— 见**插件类**上的同名方法（`_findNode` / `_findOpencli`）。
   *  ✏️ 2026-10-01 19:59：原来写在视图类，但设置页也要用 → 移到插件类，这里只留转发。 */
  _findNode() { return this.plugin ? this.plugin._findNode() : null; }
  _findOpencli() { return this.plugin ? this.plugin._findOpencli() : null; }

  /** 跑一次 opencli（异步 spawn，带超时）。返回 { code, out, err } */
  _oc(bin, mainJs, args, timeout) {
    return new Promise((resolve) => {
      const { spawn } = require("child_process");
      let out = "", err = "", done = false, timer = null, p;
      const fin = (code) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ code, out, err }); };
      try { p = spawn(bin, [mainJs, ...args], { windowsHide: true, env: process.env }); }
      catch (e) { return resolve({ code: 1, out: "", err: "spawn 失败：" + e.message }); }
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => { err += " spawn error: " + (e.code || "") + " " + e.message; fin(1); });
      p.on("close", (c) => fin(c === null ? 1 : c));
      timer = setTimeout(() => { err += " [超时 " + (timeout / 1000) + "s]"; try { p.kill(); } catch {} fin(124); }, timeout);
    });
  }

  /** 从混有提示文字的输出里抠 JSON */
  _parseJson(text) {
    if (!text) return null;
    const a = text.indexOf("["), o = text.indexOf("{");
    let start = -1;
    if (a >= 0 && (o < 0 || a < o)) start = a; else start = o;
    if (start < 0) return null;
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }

  /** 在笔记管理页挖 noteId（等价于 sync-creator.mjs 的 EXTRACT_JS） */
  _extractJs() {
    return "() => {\n" +
      "  const out = [];\n" +
      "  for (const el of document.querySelectorAll('[data-impression]')) {\n" +
      "    let noteId = '';\n" +
      "    try { const imp = JSON.parse(el.getAttribute('data-impression') || '{}');\n" +
      "      noteId = (imp.noteTarget && imp.noteTarget.value && imp.noteTarget.value.noteId) || ''; } catch (e) {}\n" +
      "    if (!/^[0-9a-f]{24}$/.test(noteId)) continue;\n" +
      "    out.push({ noteId, raw: (el.innerText || '').trim() });\n" +
      "  }\n" +
      "  const body = document.body.innerText || '';\n" +
      "  return { count: out.length, loading: /正在加载中/.test(body),\n" +
      "    empty: /没有找到相关笔记/.test(body),\n" +
      "    total: (body.match(/-\\s*共\\s*(\\d+)\\s*篇笔记\\s*-/) || [])[1] || '', items: out };\n" +
      "}";
  }

  /** 主流程：抓 → 组装 → 落盘（库内缓存）→ 落库（写笔记卡 YAML）
   *  silent=true 时不弹进度提示（自动同步用） */
  async creatorSyncRun(silent) {
    const node = this._findNode(), oc = this._findOpencli();
    if (!node || !oc) {
      const miss = !node ? "node.exe" : "opencli";
      new Notice("❌ 找不到 " + miss + "，无法同步。\n\n去 设置 → 带货工作台 手动指定路径（" +
        (!node ? "「Node 路径」" : "「opencli 主文件」") + "）。", 20000);
      return null;
    }
    const vaultAbs = (() => { try { return this.app.vault.adapter.getBasePath(); } catch { return ""; } })();
    if (!vaultAbs) { new Notice("❌ 拿不到仓库路径，无法写缓存。", 15000); return null; }

    const t0 = Date.now();
    const result = {
      schemaVersion: 1, syncedAt: new Date().toISOString(),
      syncedAtLocal: new Date().toLocaleString("zh-CN"),
      account: null, profile_info: null, stats: null,
      note_count: 0, note_ids: [], errors: [], warnings: [], steps: {},
    };
    const step = (name, ok, extra) => { result.steps[name] = Object.assign({ ok }, extra || {}); if (!ok) result.errors.push({ step: name, error: (extra && extra.error) || "" }); };

    try {
      // ① 账号信息
      const r1 = await this._oc(node, oc, ["xiaohongshu", "creator-profile", "-f", "json"], 180000);
      const a1 = this._parseJson(r1.out);
      if (Array.isArray(a1) && a1.length) {
        const map = {}; for (const it of a1) if (it && it.field) map[it.field] = it.value;
        result.profile_info = map; result.account = map["Name"] || null;
        step("creator-profile", true, { fields: a1.length });
      } else step("creator-profile", false, { error: "无数据 exit=" + r1.code });

      // ② 账号总览
      const r2 = await this._oc(node, oc, ["xiaohongshu", "creator-stats", "-f", "json"], 180000);
      const a2 = this._parseJson(r2.out);
      if (Array.isArray(a2) && a2.length) {
        result.stats = a2.map((it) => {
          const m = String(it.metric || "");
          const mm = m.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
          return { name: (mm ? mm[1] : m).trim(), key: mm ? mm[2].trim() : "", total: it.total, trend: it.trend };
        });
        step("creator-stats", true, { count: result.stats.length });
      } else step("creator-stats", false, { error: "无数据 exit=" + r2.code });

      // ③ 挖 noteId（**不依赖已坏的 creator-notes**）
      const r3 = await this._oc(node, oc, ["browser", "xsync", "open", "https://creator.xiaohongshu.com/new/note-manager", "--window", "foreground"], 180000);
      void r3;
      let ids = null;
      for (let att = 1; att <= 3; att++) {
        await new Promise((r) => setTimeout(r, att === 1 ? 8000 : 6000));
        const r4 = await this._oc(node, oc, ["browser", "xsync", "eval", this._extractJs()], 120000);
        const res = this._parseJson(r4.out);
        if (res && Array.isArray(res.items) && res.items.length) {
          ids = res.items.map((it) => {
            const lines = String(it.raw || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            const di = lines.findIndex((l) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(l));
            const date = di >= 0 ? lines[di] : "";
            const title = di >= 0 ? lines.slice(0, di).join(" ") : (lines[0] || "");
            const nums = lines.slice(di >= 0 ? di + 1 : 1)
              .map((l) => (l.match(/^[\d,]+$/) ? parseInt(l.replace(/,/g, ""), 10) : NaN))
              .filter((n) => Number.isFinite(n));
            return { noteId: it.noteId, title, date, card_numbers: nums };
          });
          step("note-ids", true, { attempts: att, page_total: res.total || "" });
          break;
        }
      }
      if (!ids) {
        step("note-ids", false, { error: "3 次都没提取到 noteId（页面结构可能变了 / 或该账号确实没有笔记）" });
        // 🔴 硬规矩：空 ≠ 0 → 中止，**不覆盖 latest**
        result.aborted = "note-ids 提取失败 → 按硬规矩中止，不写空结果";
        await this._creatorWriteCache(result, vaultAbs, true);
        new Notice("⚠️ 同步中止：没抓到任何笔记。\n\n（可能是该账号还没有已发布笔记，或页面结构变了）\n旧数据已保留。", 20000);
        return result;
      }
      result.note_ids = ids; result.note_count = ids.length;

      // ④ 逐篇详情
      for (let i = 0; i < ids.length; i++) {
        const it = ids[i];
        const r5 = await this._oc(node, oc, ["xiaohongshu", "creator-note-detail", it.noteId, "-f", "json"], 180000);
        const a5 = this._parseJson(r5.out);
        if (Array.isArray(a5) && a5.length) {
          const sec = {}; for (const x of a5) if (x && x.section) (sec[x.section] ||= {})[x.metric] = x.value;
          it.detail = sec;
        } else { it.detail = null; it.detail_error = "无数据 exit=" + r5.code; }
        await new Promise((r) => setTimeout(r, 800));   // 温和节流
      }

      // ⑤ 落盘 + ⑥ 落库
      await this._creatorWriteCache(result, vaultAbs, false);
      const bf = await this._creatorBackfill(result, vaultAbs);
      if (bf) result.backfill = bf;

      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!silent) {
        new Notice("✅ 同步完成（" + secs + " 秒）\n账号：" + (result.account || "?") +
          "\n笔记：" + result.note_count + " 篇" +
          (result.errors.length ? "\n⚠️ 错误 " + result.errors.length + " 条" : "") +
          (bf ? "\n落库：写 " + bf.planned + " 张卡" + (bf.unmatched ? "，未匹配 " + bf.unmatched + " 条" : "") : ""), 15000);
      }
      await this.refreshSnapshot(); this.renderAll(this.data);
      return result;
    } catch (e) {
      new Notice("❌ 同步异常：" + (e && e.message ? e.message : e), 25000);
      step("exception", false, { error: String(e && e.message ? e.message : e) });
      return result;
    }
  }

  /** 写库内缓存（creator-latest.json）；aborted=true 时**不覆盖 latest**（硬规矩 3） */
  async _creatorWriteCache(result, vaultAbs, aborted) {
    const ad = this.app.vault.adapter;
    const dir = P.creatorDir;
    try { if (!(await ad.exists(dir))) await ad.mkdir(dir); } catch {}
    // 与上次比对（条数骤降 = 疑似抓取故障）
    let prevN = 0;
    try {
      const prev = JSON.parse(await ad.read(dir + "/creator-latest.json"));
      prevN = (prev && prev.note_count) || 0;
      result.prev_note_count = prevN; result.prev_synced_at = (prev && prev.syncedAtLocal) || null;
      if (!aborted && prevN > 0 && result.note_count > 0 && result.note_count < prevN * 0.5) {
        result.warnings.push("⚠️ 条数骤降：上次 " + prevN + " → 本次 " + result.note_count + "，疑似抓取故障");
      }
    } catch {}
    try {
      await ad.write(dir + "/creator-latest.json", JSON.stringify(result, null, 2));
    } catch (e) { new Notice("缓存写入失败：" + (e && e.message ? e.message : e), 15000); }
    return result;
  }

  /** 落库：把 JSON 里的指标写进笔记卡 frontmatter（逻辑同 sync-creator.mjs 的 backfillToVault） */
  async _creatorBackfill(result, vaultAbs) {
    void vaultAbs;
    const FIELD_MAP = [
      ["基础数据", "曝光数"], ["基础数据", "观看数"],
      ["互动数据", "点赞数"], ["互动数据", "收藏数"], ["互动数据", "评论数"], ["互动数据", "分享数"],
    ];
    const usable = (v) => v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "-" && String(v).trim() !== "—";
    const norm = (s) => String(s || "").replace(/[\s\u3000]/g, "")
      .replace(/[，。！？、；：""''（）【】《》…—～·,\.!\?;:'"()\[\]<>~\-_/\\|]/g, "").toLowerCase();
    const ad = this.app.vault.adapter;
    const dir = P.wencang;
    let files = [];
    try { const r = await ad.list(dir); files = (r && r.files) || []; } catch { return null; }

    const cards = [];
    for (const f of files) {
      if (!/\.md$/.test(f) || /\/_模板-/.test(f)) continue;
      let txt; try { txt = await ad.read(f); } catch { continue; }
      const mf = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!mf) continue;
      const fm = {}; mf[1].split("\n").forEach((l) => { const m = l.match(/^([^:\s][^:]*):\s*(.*)$/); if (m) fm[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, ""); });
      if (fm.type !== "note") continue;
      const h1 = (txt.match(/^#\s+(.+)$/m) || [, ""])[1].trim();
      cards.push({ path: f, name: f.split("/").pop(), txt, fm, h1 });
    }
    const byId = new Map(); for (const c of cards) if (c.fm["笔记ID"]) byId.set(String(c.fm["笔记ID"]).trim(), c);

    const plan = [], unmatched = [];
    for (const n of (result.note_ids || [])) {
      const nid = String(n.noteId || "").trim(); if (!nid) continue;
      let card = byId.get(nid) || null, how = card ? "笔记ID" : "";
      if (!card) {
        const det = n.detail || {}, info = det["笔记信息"] || {};
        const pub = String(info.published_at || n.date || "").slice(0, 10);
        const nt = norm(info.title || n.title || "");
        const cand = cards.filter((c) => {
          if (String(c.fm["发布日期"] || "").slice(0, 10) !== pub) return false;
          const ch = norm(c.h1);
          return ch && (ch === nt || ch.includes(nt) || nt.includes(ch));
        });
        if (cand.length === 1) { card = cand[0]; how = "发布日期+标题"; }
        else if (cand.length > 1) { unmatched.push({ noteId: nid, why: "标题+日期命中 " + cand.length + " 张卡，不唯一" }); continue; }
      }
      if (!card) { unmatched.push({ noteId: nid, title: n.title || "", why: "没有匹配的笔记卡" }); continue; }
      const det = n.detail || {}, fields = {};
      for (const [sec, key] of FIELD_MAP) { const v = (det[sec] || {})[key]; if (usable(v)) fields[key] = String(v).trim(); }
      if (!card.fm["笔记ID"]) fields["笔记ID"] = nid;
      const pub = String(((det["笔记信息"] || {}).published_at) || "").slice(0, 10);
      if (pub && !String(card.fm["发布日期"] || "").trim()) fields["发布日期"] = pub;
      plan.push({ card, fields, how });
    }

    let written = 0;
    for (const it of plan) {
      if (!Object.keys(it.fields).length) continue;
      const lines = it.card.txt.split("\n");
      if (lines[0].trim() !== "---") continue;
      let end = -1; for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
      if (end < 0) continue;
      for (const [k, v] of Object.entries(it.fields)) {
        const idx = lines.slice(1, end).findIndex((l) => l.startsWith(k + ":"));
        if (idx >= 0) lines[1 + idx] = k + ": " + v;
        else lines.splice(end, 0, k + ": " + v);
      }
      try { await ad.write(it.card.path, lines.join("\n")); written++; } catch {}
    }
    return { scanned: cards.length, planned: plan.length, written, unmatched: unmatched.length, unmatchedDetail: unmatched.slice(0, 10) };
  }

  /* ───── 立即同步（V2 批 3.5 · 走内嵌引擎）─────
     ✏️ 笔记本 PC · 2026-10-01 19:52 —— 原来 spawn 外部 `sync-creator.mjs`，
     现改为**直接调内嵌的 `creatorSyncRun()`**（老哥要求：装了插件就能同步，不用配脚本路径）。
     ⚠️ opencli 仍是外部依赖（要 Edge 扩展 + 登录态）—— 探测不到会给可行动提示。 */
  async runCreatorSync() {
    const node = this._findNode(), oc = this._findOpencli();
    if (!node || !oc) {
      new Notice("❌ 同步前置缺失：" + (!node ? "找不到 node.exe" : "找不到 opencli") +
        "\n\n去 设置 → 带货工作台 手动指定路径。\n（opencli 是抓取工具，必须装 —— 内嵌省不掉它）", 22000);
      return;
    }
    new Notice("⏳ 正在同步创作者后台…（过程中请不要关闭 Edge）", 8000);
    await this.creatorSyncRun(false);
  }

  /** 「＋ 添加目录…」—— ✏️ 2026-10-01 21:05 改成**目录选择器**（老哥：「直接弹 Obsidian 仓库内的文件夹让我选」）。
   *  用 Obsidian 原生的 `SuggestModal`：**只列库内目录**、可模糊搜索、不用手输路径。
   *  （不用 Electron 的文件对话框：那样拿到的是磁盘路径，还得反推相对路径，更绕。） */
  _promptAddDir() {
    const cur = this._incDirs();
    const dirs = [];
    try {
      this.app.vault.getAllLoadedFiles().forEach((f) => {
        if (f instanceof TFolder && f.path && f.path !== "/") dirs.push(f.path);
      });
    } catch {}
    const cand = dirs.filter((d) => !cur.includes(d)).sort();
    if (!cand.length) { new Notice("库内的目录都已经被收录了。", 6000); return; }

    const self = this;
    class DirPicker extends SuggestModal {
      constructor(app) {
        super(app);
        this.setPlaceholder("输入关键词筛选目录…（回车选中）");
        this.emptyStateText = "没有匹配的目录";
      }
      getSuggestions(q) {
        const kw = String(q || "").trim().toLowerCase();
        const list = kw ? cand.filter((d) => d.toLowerCase().includes(kw)) : cand;
        return list.slice(0, 80);
      }
      renderSuggestion(d, el) { el.setText(d); }
      onChooseSuggestion(d) { self._addIncDir(d); }
    }
    new DirPicker(this.app).open();
  }

  /** 把一个目录加进收录范围 */
  _addIncDir(d) {
    const dir = String(d || "").trim().replace(/^\/+|\/+$/g, "");
    if (!dir) return;
    if (this._incDirs().includes(dir)) { new Notice("「" + dir + "」已经在收录列表里了。", 6000); return; }
    this.plugin.settings.incDirs = this._incDirs().concat([dir]);
    this.plugin.saveSettings();
    this.renderKnow(this.data).catch(() => {});
    new Notice("✅ 已把「" + dir + "」加入收录范围。", 8000);
  }

  /** 「改权限」浮层（V2 批 4）
   *  ✏️ 2026-10-01 20:38 —— 自己实现（原稿的绑定因表格动态重建而失效）。
   *  写回位置 = frontmatter 的 `只读` 键（**只在显式改过时才写**；没这个键 = 按目录判）。
   *  🔴 边界：**只改这一个键、不碰正文**（按行数组精确改，与批 2 落库同一套做法）。
   *  恢复默认 = 删掉该键。 */
  openPermPop(path, btn) {
    const pop = this.root.querySelector("#stPop");
    const af = this.app.vault.getAbstractFileByPath(path);
    if (!pop || !af) { new Notice("找不到文件：" + path, 12000); return; }
    const cur = this._permOf(path);
    setText(pop.querySelector("#stFile"), path.split("/").pop().replace(/\.md$/, ""));
    setText(pop.querySelector("#stPath"), path.replace(/\/[^/]+$/, ""));
    const curEl = pop.querySelector("#stCur");
    if (curEl) curEl.innerHTML = '<span class="pill' + (cur.readonly ? " wr" : "") + '"><i></i>' + (cur.readonly ? "只读" : "可编辑") + "</span>" +
      (cur.explicit ? '<span class="mut" style="margin-left:8px">（文件里显式标了 只读: ' + esc(cur.raw) + "）</span>"
        : '<span class="mut" style="margin-left:8px">（按目录判定）</span>');

    pop.querySelectorAll(".st-opt").forEach((b) => {
      b.onclick = async () => {
        const want = b.textContent.trim().indexOf("只读") === 0;
        // ✏️ 2026-10-01 21:35 —— 老哥试出来的设计问题：点「可编辑」原来会写 `只读: false`，
        //   等于给文件留了个**无意义的 frontmatter 块**（false 本来就等于"没标过"）。
        //   正解：**「可编辑」在普通目录下 = 删字段**（不留痕，回到"按目录判"）；
        //   只有**在只读目录里**才需要显式写 `false` —— 因为要用它覆盖"按目录判只读"。
        const byDir = this._readonlyDirs().some((r) => path.startsWith(r));
        if (!want && !byDir) await this._setPerm(path, null);
        else await this._setPerm(path, want);
        pop.hidden = true;
        new Notice("✅ 已把「" + path.split("/").pop() + "」改为" + (want ? "只读" : "可编辑") +
          (want ? "（写入 frontmatter 的 `只读` 键）" : (!byDir ? "（已移除该字段，回到按目录判定）" : "（显式覆盖目录的只读）")), 10000);
        /* ✏️ 2026-10-02 16:25 —— 自查查出的 bug：改完**立刻**重渲染时，Obsidian 的
           `metadataCache` 还没重扫完 → `_permOf` 读到的还是**旧权限**（看着像"点了没生效"）。
           → 延迟一下再重渲染，等索引落定。 */
        setTimeout(() => { this.renderKnow(this.data).catch(() => {}); }, 450);
      };
    });
    const reset = pop.querySelector(".inc-add");
    if (reset) reset.onclick = async () => {
      await this._setPerm(path, null);
      pop.hidden = true;
      new Notice("已恢复「按目录判定」。", 8000);
      this.renderKnow(this.data).catch(() => {});
    };

    pop.hidden = false;
    try {
      const r = btn.getBoundingClientRect();
      const B = this.root.getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const left = Math.max(12, Math.min(r.left - B.left - 24, B.width - w - 12));
      let top = r.bottom - B.top + 8;
      if (top + h > B.height - 12) top = Math.max(12, B.height - h - 12);
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    } catch {}
  }

  /** 读某文件的权限：{ readonly, explicit, raw } —— 显式 `只读` 键 > 按目录判 */
  _permOf(path) {
    let explicitRaw = "";
    try {
      const af = this.app.vault.getAbstractFileByPath(path);
      const cache = af ? this.app.metadataCache.getFileCache(af) : null;
      if (cache && cache.frontmatter) explicitRaw = String(cache.frontmatter["只读"] == null ? "" : cache.frontmatter["只读"]).trim();
    } catch {}
    const byDir = this._readonlyDirs().some((r) => path.startsWith(r));
    if (explicitRaw) return { readonly: /^(是|true|1|只读)$/i.test(explicitRaw), explicit: true, raw: explicitRaw };
    return { readonly: byDir, explicit: false, raw: "" };
  }

  /** 写权限：want=true/false 写 frontmatter `只读` 键；want=null 删掉该键（恢复按目录判）
   *  ✏️ 2026-10-01 20:50 —— **没有 frontmatter 的文件也能改**：
   *  库里很多文件（`log.md`、`AGENTS.md` 等）根本没 frontmatter 块，原来直接报
   *  「这个文件没有 frontmatter，改不了权限」→ 老哥反馈"所有文件都改不了"。
   *  现在：**没有就补一个只含 `只读` 键的最小 frontmatter**（加在文件最前面，**正文一字不动**）。
   *  ⚠️ 恢复默认（want=null）对"本来就是补出来的"情况不做删除（避免把 frontmatter 拆空）——
   *     改为写入 `只读: false`，语义等价（显式可编辑）。 */
  async _setPerm(path, want) {
    const af = this.app.vault.getAbstractFileByPath(path);
    if (!af) return;
    let txt = ""; try { txt = await this.app.vault.read(af); } catch { return; }
    const lines = txt.split("\n");
    const hasFM = lines[0].trim() === "---";
    if (!hasFM) {
      if (want === null) { new Notice("这个文件没有 frontmatter，无需恢复默认（它本来就没被显式标过）。", 9000); return; }
      // 补一个最小 frontmatter，插在文件最前面；正文原样跟在后面
      const v = want ? "true" : "false";
      const out = "---\n只读: " + v + "\n---\n" + txt;
      await this.app.vault.modify(af, out);
      return;
    }
    let end = -1; for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
    if (end < 0) { new Notice("frontmatter 不完整，改不了权限。", 10000); return; }
    const idx = lines.slice(1, end).findIndex((l) => l.startsWith("只读:"));
    if (want === null) { if (idx >= 0) lines.splice(1 + idx, 1); }
    else {
      const v = want ? "true" : "false";
      if (idx >= 0) lines[1 + idx] = "只读: " + v;
      else lines.splice(end, 0, "只读: " + v);
    }
    /* ✏️ 2026-10-02 16:28 —— 自查查出的 bug：删掉 `只读` 后若 frontmatter **空了**，
       原来会留下一个空壳 `---\n---`（看着像文件被弄坏了）。
       → 空块就**整块移除**。
       ⚠️ 写法说明：不用正则 —— 空块的实际形态是 `---` / `---` **紧挨两行**（中间没有内容行），
       用 `/^---\n([\s\S]*?)\n---/` 这种写法**匹配不到**（我第一版就栽在这，`([\s\S]*?)` 拿不到空串）。
       → 直接按行判断，最直白也最不容易错。 */
    let out2 = lines.join("\n");
    if (lines[0].trim() === "---" && lines[1] !== undefined && lines[1].trim() === "---") {
      lines.splice(0, 2);                                 // 连两行 --- 一起删
      if (lines[0] === "") lines.shift();                 // 顺带吃掉紧跟的空行
      out2 = lines.join("\n");
    }
    await this.app.vault.modify(af, out2);   // 只改 frontmatter 行，正文原样
  }

  /** 资源子页签 · 工具表 —— **实时生成**（V2 批 5 · 2026-10-01 21:55）
   *  老哥：「工具显示有 3 个，但右上角显示了 4 个，要实际有几个就是几个」。
   *  → 这张表**不改 HTML**（原来写死 3 行），改为按**真实安装状态**渲染，
   *     数据源与侧栏依赖条（`renderDep`）**同一套判断**，两处天然一致。
   *  ⚠️ 口径：这里列的是**工作台依赖的工具**（不是一个插件一个坑位）。 */
  renderTools() {
    const tbody = this.root.querySelector("#k-tool tbody");
    if (!tbody) return;
    const pm = this.app.plugins;
    const col = pm.getPlugin("xhs-product-search");
    const sc = String((this.plugin.settings && this.plugin.settings.creatorScript) || "").trim();
    void sc;
    const ocOk = !!(this.plugin._findNode && this.plugin._findNode() && this.plugin._findOpencli && this.plugin._findOpencli());
    const items = [
      { name: "xhs-importer-pro", use: "小红书笔记 → 待拆解", ok: !!pm.getPlugin("xhs-importer-pro") },
      { name: "duowei-table", use: "读写三张 .duowei 表", ok: !!(this.data && this.data.dw && this.data.dw.ok && this.data.dw.ok.archive) },
      { name: "xhs-product-search", use: "商品采集（选品池内置引擎）", ok: !!col },
      { name: "opencli", use: "创作者后台数据同步", ok: ocOk },
    ];
    const esc2 = esc;
    tbody.innerHTML = items.map((it) => {
      const pill = it.ok
        ? '<span class="pill"><i></i>已装</span>'
        : '<span class="pill wr"><i></i>未就绪</span>';
      return '<tr><td class="t-title">' + esc2(it.name) + '</td><td class="mut">' + esc2(it.use) + '</td><td class="cc">' + pill + "</td></tr>";
    }).join("");
  }

  /** 「分析详情」弹窗 —— 按 noteId 填真数据（V2 批 5 · 2026-10-01 21:52）
   *  数据源 = `creator-latest.json` 里该篇的 `detail`（4 段 13 项）。
   *  🔴 **空 ≠ 0**：接口没返回的（完播率 / 2秒退出率 / 观看来源 / 观众画像）显示 `—` 并说明"平台不返回"，
   *     绝不当 0 摆出来。 */
  openNoteDetail(noteId) {
    const modal = this.root.querySelector("#anModal");
    if (!modal) return;
    const c = (this.data && this.data.creator) || null;
    const n = c ? (c.note_ids || []).find((x) => String(x.noteId) === String(noteId)) : null;
    const det = (n && n.detail) || null;

    const info = (det && det["笔记信息"]) || {};
    setText(modal.querySelector(".an-sub"), (info.title || (n && n.title) || "(无标题)") + " · " + (c ? (c.account || "") : ""));
    setText(modal.querySelector(".m-s"), "发布于 " + String(info.published_at || (n && n.date) || DASH) + " · 采集于 " + (c ? (c.syncedAtLocal || "?") : "?"));

    if (!det) {
      const core = modal.querySelector("#anCore");
      if (core) core.innerHTML = '<div class="na">这一篇<strong>没有详情数据</strong>（' +
        (n && n.detail_error ? esc(n.detail_error) : "采集时未取到") + "）。<br>点「立即同步」重跑一次试试。</div>";
      modal.hidden = false;
      return;
    }
    const base = det["基础数据"] || {}, inter = det["互动数据"] || {};
    const V = (v) => {
      const s = String(v == null ? "" : v).trim();
      if (!s || s === "-" || s === "—") return { cls: "v dash num", txt: DASH };
      return { cls: "v num", txt: /^\d+$/.test(s) ? Number(s).toLocaleString("en-US") : s };
    };
    const KPI = (label, v) => { const o = V(v); return '<div class="kpi"><div class="k">' + esc(label) + '</div><div class="' + o.cls + '">' + esc(o.txt) + "</div></div>"; };

    const core = modal.querySelector("#anCore");
    if (core) core.innerHTML =
      '<div class="kpi6">' +
        KPI("曝光数", base["曝光数"]) + KPI("观看数", base["观看数"]) + KPI("封面点击率", base["封面点击率"]) +
        KPI("平均观看时长", base["平均观看时长"]) + KPI("完播率", null) + KPI("2 秒退出率", null) +
      "</div>" +
      '<div class="kpi5">' +
        KPI("涨粉数", base["涨粉数"]) + KPI("点赞数", inter["点赞数"]) + KPI("评论数", inter["评论数"]) +
        KPI("收藏数", inter["收藏数"]) + KPI("分享数", inter["分享数"]) +
      "</div>" +
      '<div class="tail">以上为<strong>笔记详情页口径</strong>（来源：creator-note-detail）<br>' +
        "「" + DASH + "」= <strong>平台未返回</strong>（<strong>不是 0</strong>）· " +
        "<strong>完播率 / 2 秒退出率</strong>在这个接口的返回里<strong>没有</strong>，不是没采到</div>";

    const setNa = (sel, txt) => { const el = modal.querySelector(sel); if (el) el.innerHTML = '<div class="na">' + txt + "</div>"; };
    setNa("#anTrend", "接口原话：<strong>「观众趋势：暂不可用」</strong><br>后台<strong>没有返回</strong>这条笔记的趋势序列 —— <strong>不是没采，是平台不给</strong>。<br>发一篇新笔记后跑一次同步，看新笔记能不能取到。");
    setNa("#anSrc", "这一项在 <code>creator-note-detail</code> 的<strong>输出里没有</strong> —— 不是被过滤掉，是接口本身没返回。<br><strong>拿不到就不摆</strong>：不画空图，也不拿别的东西凑。");
    setNa("#anAud", "同上：<strong>接口输出里没有观众画像</strong>（性别／年龄／地域分布）。<br>若复核后平台确实不开放，这一页签在真插件里就<strong>不显示</strong>（而不是留一个点开是空的按钮）。");

    modal.querySelectorAll("#anTabs .subtab").forEach((t, i) => t.classList.toggle("on", i === 0));
    ["anCore", "anTrend", "anSrc", "anAud"].forEach((id) => { const el = modal.querySelector("#" + id); if (el) el.hidden = id !== "anCore"; });
    modal.hidden = false;
  }

  /* ───── 自动同步（V2 批 3.5）─────
     定时器与 tick 都实现在**插件类**（见 `XhsWorkbenchPlugin.setupAutoSync`），
     因为定时器不该依赖"工作台视图已打开"。这里只留一个"把界面状态回写"的渲染函数。 */

  /** 把「自动同步」开关 / 时间 回写到界面（渲染时调） */
  renderAutoSync() {
    const page = this.root.querySelector("#p-data");
    if (!page) return;
    const s = this.plugin.settings || {};
    const cb = page.querySelector(".srcbar .sw input[type=checkbox]");
    if (cb) cb.checked = !!s.autoSyncOn;
    const lab = page.querySelector(".srcbar .sw");
    if (lab) {
      // 把「每天 22:00 自动同步」这行文案换成真实时间（原稿写死 22:00）
      const nodes = Array.from(lab.childNodes).filter((n) => n.nodeType === 3);
      if (nodes.length) nodes[nodes.length - 1].nodeValue = "每天 " + (s.autoSyncTime || "22:00") + " 自动同步";
      else lab.appendChild(document.createTextNode("每天 " + (s.autoSyncTime || "22:00") + " 自动同步"));
    }
  }

  /* ───── 依赖状态（§18.7）：只探测能真探测的；开放外部命令（opencli/Edge）V1 简化 ───── */
  renderDep(d) {
    const list = this.root.querySelector(".dep-list");
    if (!list) return;
    const pm = this.app.plugins;
    const col = pm.getPlugin("xhs-product-search");
    // ✏️ 笔记本 PC · 2026-10-01 19:52 —— V2 批 3.5：opencli 项改**真探测**（探 node + opencli 两个文件在不在）。
    //   不真去跑 opencli（要 20 秒且会碰浏览器）；"文件就位"是足够好的代理指标，零副作用。
    const ocOk = !!(this._findNode() && this._findOpencli());
    const ocTip = ocOk
      ? "同步引擎就位：node + opencli 都已找到 → 「立即同步」可用"
      : "缺 " + (!this._findNode() ? "node.exe" : "opencli") + " → 去 设置 → 带货工作台 手动指定路径";
    const items = [
      { label: "duowei", ok: !!(d.dw.ok.archive && d.dw.ok.track && d.dw.ok.mine), tip: d.dw.ok.err || "三张表可读" },
      { label: "importer", ok: !!pm.getPlugin("xhs-importer-pro"), tip: pm.getPlugin("xhs-importer-pro") ? "xhs-importer-pro 已启用" : "xhs-importer-pro 未启用 → 爆款投喂不可用" },
      { label: "collector", ok: !!col, tip: col ? "xhs-product-search 已启用（内置采集引擎，采集条可自检）" : "xhs-product-search 未启用 → 商品采集置灰" },
      { label: "opencli", ok: ocOk, tip: ocTip || "外部命令（Edge/扩展/登录号）—— V1 简化不探测（PRD §6.2 允许）" },
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
    void 0;
    // ✏️ 笔记本 PC · 2026-10-01 20:05 —— 数据库页（批 3）与知识库页（批 4）都已接真数据，
    //   **两处「演示数据」角标全部撤掉**。将来若某页又变回演示，在这里加回来。
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
    new Setting(containerEl)
      .setName("打开 Obsidian 时自动打开工作台")
      .setDesc("相当于把工作台设成「首页」。开启后每次启动 Obsidian 会自动打开工作台。" +
        "（Obsidian 原生没有「首页」这个概念，这是用「启动时自动打开」实现的。）" +
        "⚠️ 如果上次退出时工作台本来就开着，不会重复开。")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.openOnStartup).onChange(async (v) => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
        })
      );

    const bkSet = new Setting(containerEl)
      .setName("备份目录")
      .setDesc(
        "写多表前先备份到这里（**库外**，库内不留备份）。留空 = 自动用仓库同级的 _backups/ —— 换电脑不用改。",
      )
      .addText((t) =>
        t
          .setPlaceholder("留空 = 仓库同级 _backups")
          .setValue(this.plugin.settings.backupRoot || "")
          .onChange(async (v) => {
            this.plugin.settings.backupRoot = v.trim();
            await this.plugin.saveSettings();
            bkNow.setText("当前生效：" + this.plugin.backupRoot());
          })
      );
    const bkNow = bkSet.descEl.createEl("div", { cls: "xhs-wb-bk-now" });
    bkNow.setText("当前生效：" + this.plugin.backupRoot());

    /* ✏️ 笔记本 PC · 2026-10-01 19:52 —— V2 批 3.5：同步引擎已内嵌进插件，
       **不再需要「同步脚本路径」**（该设置项删除）。保留的是「没探到时可手动指定」两个兜底项。 */
    new Setting(containerEl)
      .setName("自动同步")
      .setDesc("打开后，每天到下面这个时刻自动拉一次创作者后台数据。⚠️ 只在 Obsidian 开着时生效。")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.autoSyncOn).onChange(async (v) => {
          this.plugin.settings.autoSyncOn = v;
          await this.plugin.saveSettings();
        })
      )
      .addText((t) =>
        t.setPlaceholder("22:00").setValue(this.plugin.settings.autoSyncTime || "22:00")
          .onChange(async (v) => {
            const s = String(v).trim();
            if (!/^\d{1,2}:\d{2}$/.test(s)) return;      // 只认 HH:MM
            const [h, m] = s.split(":");
            this.plugin.settings.autoSyncTime = pad2(Math.min(23, parseInt(h, 10))) + ":" + pad2(Math.min(59, parseInt(m, 10)));
            await this.plugin.saveSettings();
          })
      );

    const nodeSet = new Setting(containerEl)
      .setName("Node 路径（兜底）")
      .setDesc("同步引擎用它跑 opencli。留空 = 自动探测（`C:\\Program Files\\nodejs\\node.exe`）。探不到才需要填。")
      .addText((t) =>
        t.setPlaceholder("留空 = 自动探测").setValue(this.plugin.settings.creatorNode || "")
          .onChange(async (v) => { this.plugin.settings.creatorNode = v.trim(); await this.plugin.saveSettings(); nodeNow.setText("当前生效：" + (this.plugin._findNode() || "（未找到）")); })
      );
    const nodeNow = nodeSet.descEl.createEl("div", { cls: "xhs-wb-bk-now" });
    nodeNow.setText("当前生效：" + (this.plugin._findNode() || "（未找到）"));

    const ocSet = new Setting(containerEl)
      .setName("opencli 主文件（兜底）")
      .setDesc("`opencli` 的 `dist/src/main.js` 完整路径。留空 = 自动探测 `~/.local/bin/node_modules/@jackwener/opencli/dist/src/main.js`。" +
        "⚠️ **opencli 是外部抓取工具，内嵌省不掉它**（要 Edge 扩展 + 小红书登录态）。")
      .addText((t) =>
        t.setPlaceholder("留空 = 自动探测").setValue(this.plugin.settings.creatorOpencli || "")
          .onChange(async (v) => { this.plugin.settings.creatorOpencli = v.trim(); await this.plugin.saveSettings(); ocNow.setText("当前生效：" + (this.plugin._findOpencli() || "（未找到）")); })
      );
    const ocNow = ocSet.descEl.createEl("div", { cls: "xhs-wb-bk-now" });
    ocNow.setText("当前生效：" + (this.plugin._findOpencli() || "（未找到）"));

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
/* 备份目录（**库外**，库内不留）：
   · 设置里留空（默认）→ 自动用 **vault 同级** 的 `_backups/`，换电脑不变
   · 也可以填绝对路径，例如 `D:/backups`
   🔴 2026-10-01 走查根因：这里原来写死 `D:/Documents/work buddy/_backups`，
      本机没有 D 盘 → 备份步骤直接 ENOENT → 回填 / 采集**两条写链路全部中止**。
      别再写死路径；要改就改插件设置页的「备份目录」。 */
const BACKUP_DIRNAME = "_backups";

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
  /* ───── 自动同步（V2 批 3.5）─────
     ✏️ 笔记本 PC · 2026-10-01 19:55 —— 新增。原稿那个「每天 22:00 自动同步」开关
     **V1 里完全没接线**（全库无任何定时器），这次真接上，且时间可自定义。
     做法：每 30 秒检查一次「是否到了设定时刻且今天还没跑过」；到点 → 确保视图在 → 调同步引擎。
     ⚠️ 只在 Obsidian 开着时生效（插件没法在应用关闭时运行）—— 这点在 UI 与提示里都写明，不假装它是后台服务。 */
  setupAutoSync() {
    if (this._autoTimer) { try { clearInterval(this._autoTimer); } catch {} }
    this._autoTimer = setInterval(() => { this._autoSyncTick(); }, 30000);
    this.registerInterval(this._autoTimer);
  }

  async _autoSyncTick() {
    const s = this.settings || {};
    if (!s.autoSyncOn) return;
    const hm = String(s.autoSyncTime || "22:00");
    const d = new Date();
    const now = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (now !== hm) return;
    const today = (() => { const t = new Date(); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); })();
    if (this._autoLastRun === today) return;      // 今天已经跑过
    this._autoLastRun = today;

    let v = (this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] || {}).view;
    if (!v || typeof v.creatorSyncRun !== "function") {
      try { await this.activateView(); await new Promise((r) => setTimeout(r, 1500)); } catch {}
      v = (this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] || {}).view;
    }
    if (!v || typeof v.creatorSyncRun !== "function") {
      new Notice("⚠️ 自动同步没跑成：工作台视图没起来。请手动打开工作台再点「立即同步」。", 20000);
      return;
    }
    try {
      const r = await v.creatorSyncRun(true);
      new Notice(r && r.aborted ? "⚠️ 自动同步中止（没抓到笔记，旧数据已保留）" : "✅ 自动同步完成（" + hm + "）", 15000);
    } catch (e) {
      new Notice("❌ 自动同步失败：" + (e && e.message ? e.message : e), 20000);
    }
  }

  /** 找 node.exe（内嵌引擎用它跑 opencli；不依赖 PATH）
   *  ✏️ 2026-10-01 19:59 —— 从视图类**移到插件类**：设置页（SettingTab）也要用它，
   *  而 SettingTab 没有视图的方法 → 之前报 `this._findNode is not a function`。 */
  _findNode() {
    const cands = [
      (this.settings || {}).creatorNode,
      "C:/Program Files/nodejs/node.exe",
      "C:/Program Files (x86)/nodejs/node.exe",
    ].filter(Boolean);
    let fs = null; try { fs = require("fs"); } catch { return null; }
    for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch {} }
    return null;
  }

  /** 找 opencli 的 main.js（内嵌引擎直接 node 跑它，绕开 shell/PATH） */
  _findOpencli() {
    const home = (() => { try { return require("os").homedir(); } catch { return ""; } })();
    const cands = [
      (this.settings || {}).creatorOpencli,
      home && home + "/.local/bin/node_modules/@jackwener/opencli/dist/src/main.js",
    ].filter(Boolean);
    let fs = null; try { fs = require("fs"); } catch { return null; }
    for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch {} }
    return null;
  }

  /** 把用户设的「工作台名称」同步到 Obsidian 的插件清单（设置页插件列表里显示的就是它）
   *  ✏️ 2026-10-02 18:10 —— 老哥要求「设置里改成什么，插件名就同步成什么」。
   *  ⚠️ 只改**运行时对象**（`app.plugins.manifests[id].name`），**不动 `manifest.json`**：
   *     那是插件元数据，BRAT 更新会覆盖；改运行时对象才能"持久"（每次启动由 onload 再同步一次）。 */
  syncManifestName() {
    try {
      const name = (this.settings && this.settings.wbName) || "带货工作台";
      const m = this.app.plugins.manifests[this.manifest.id];
      if (m && m.name !== name) {
        m.name = name;
        // 让已打开的设置页/插件列表也跟着刷新（Obsidian 没提供细粒度 API，兜底触发一次）
        try { this.app.plugins.loadManifests && this.app.plugins.loadManifests(); } catch {}
      }
    } catch (e) { /* 拿不到就算了，不影响主功能 */ }
  }

  async onload() {
    await this.loadSettings();
    this.dw = this.loadDwLib();   // duowei 写库引擎（纯逻辑模块，可独立用 node 单测）
    this.registerView(VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this));
    this.addSettingTab(new WorkbenchSettingTab(this.app, this));
    // ✏️ 2026-10-02 18:10 —— 图标改为**可配置**（原来写死 layout-dashboard，跟 duowei-table 的方块感容易混）
    this._ribbonEl = this.addRibbonIcon(this.settings.ribbonIcon || "rocket", "打开" + (this.settings.wbName || "工作台"), () => this.activateView());
    // ✏️ 2026-10-02 18:10 —— 启动时同步插件名（把用户设的「工作台名称」写到 Obsidian 的插件清单里）
    this.syncManifestName();
    // ✏️ 2026-10-02 18:10 —— 「设为首页」：布局就绪后自动打开工作台（可关）
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.openOnStartup) return;
      // 已经有工作台视图（Obsidian 恢复了上次布局）→ 不重复开
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) return;
      this.activateView();
    });
    this.addCommand({ id: "open-xhs-workbench", name: "打开带货工作台", callback: () => this.activateView() });
    // ✏️ 2026-10-01 批 3.5：启动自动同步定时器（每 30 秒检查是否到点）
    this.setupAutoSync();
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
    // 优先用内联的 duowei.js（BRAT / 社区市场包里没有外置文件）—— 写成一个可 require 的临时模块
    if (INLINE_DUOWEI_JS) {
      try { return this._evalModule(INLINE_DUOWEI_JS); } catch (e) { console.error("[xhs-workbench] 内联 duowei.js 载入失败", e); }
    }
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
  /** 把一段 CommonJS 源码当模块执行，返回其 module.exports（供内联 duowei.js 用） */
  _evalModule(src) {
    const module = { exports: {} };
    const fn = new Function("module", "exports", "require", src + "\n;return module.exports;");
    return fn(module, module.exports, require);
  }
  dwRoot() {
    const a = this.app.vault.adapter;
    const base = a.getBasePath ? a.getBasePath() : "";
    return path.join(base, DW_DIRNAME);
  }
  dwFile(name) { return path.join(this.dwRoot(), name + ".duowei"); }

  /** 备份根目录（库外）：设置页留空 → vault 同级的 `_backups/`（换电脑不变） */
  backupRoot() {
    const set = String((this.settings && this.settings.backupRoot) || "").trim();
    if (set) return set;
    const a = this.app.vault.adapter;
    const base = a.getBasePath ? a.getBasePath() : "";
    if (!base) return path.join(process.cwd(), BACKUP_DIRNAME); // 兜底：极端情况下拿不到库路径
    return path.join(base, "..", BACKUP_DIRNAME);
  }

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
      const bRoot = this.backupRoot();
      backups.push(dw.backupTable(fA, bRoot));
      backups.push(dw.backupTable(fT, bRoot));
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
    // ✏️ 2026-10-02 18:10 —— 老哥要求「设置里改成什么，插件名就同步成什么」：
    //   改名的同时，把名字也写进 Obsidian 的插件清单对象（列表里显示的就是它）。
    //   ⚠️ 不动 manifest.json —— 那是插件元数据，BRAT 更新会覆盖；改运行时对象即可，
    //     重启后由 onload 里的 syncManifestName() 再同步一次，所以是持久的。
    this.syncManifestName();
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

    // ✏️ 2026-10-01 批 3：创作者后台 JSON 缓存（没有就是 null —— 页面走空态，不编数）
    snap.creator = await this.loadCreator();

    return snap;
  }

  /** 读 `creator-latest.json`。文件不在 → null（调用方负责显示空态）。
   *  ✏️ 笔记本 PC · 2026-10-01 19:35 —— V2 批 3 新增。路径走 P.creatorDir（库内相对路径）。 */
  async loadCreator() {
    try {
      const p = P.creatorDir + "/creator-latest.json";
      const raw = await this.app.vault.adapter.read(p);
      const j = JSON.parse(raw);
      return j && typeof j === "object" ? j : null;
    } catch (e) {
      return null;
    }
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
