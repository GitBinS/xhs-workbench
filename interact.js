/* ⚠️ 由 _UI稿/工作台-A改进版-20260926.html 的 <script> 于 B1 迁移而来（2026-09-29）。
   仅改写 2 处全局引用（documentElement.dataset.cw / body.classList → 视图根）。
   由 main.js 用 new Function 执行，执行前后会劫持 document/window 的事件注册以便关视图时回收。
   其中 NOTES 是原型的演示数据，B1 不使用（B3 会替换整块弹窗逻辑）。 */

(function(){
  var side = document.getElementById('side');
  var tgl  = document.getElementById('sideToggle');
  tgl.addEventListener('click', function(){
    var mini = side.classList.toggle('mini');
    tgl.textContent = mini ? '›' : '‹';
    tgl.title = mini ? '展开导航' : '收起导航';
  });

  var btn = document.getElementById('layoutBtn');
  var pop = document.getElementById('layoutPop');
  btn.addEventListener('click', function(){ pop.hidden = !pop.hidden; });
  document.addEventListener('click', function(e){
    if(!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });

  /* 设置面板：工作台名称可自行更改，实时同步到侧栏标题 */
  var st = document.getElementById('settingsBtn');
  var sPop = document.getElementById('settingsPop');
  var wbName = document.getElementById('wbName');
  var sideTitle = document.querySelector('.side-title');
  st.addEventListener('click', function(e){
    e.stopPropagation();
    sPop.hidden = !sPop.hidden;
  });
  wbName.addEventListener('input', function(){
    sideTitle.textContent = wbName.value.trim() || '工作台';
  });
  document.addEventListener('click', function(e){
    if(!sPop.hidden && !sPop.contains(e.target) && !st.contains(e.target)) sPop.hidden = true;
  });

  /* 全库搜索：点搜索框展开结果面板；顶部图标按类型筛选 */
  var sIn = document.getElementById('searchIn');
  var sPan = document.getElementById('searchPanel');
  var sItems = sPan.querySelectorAll('.sr-item');
  sIn.addEventListener('focus', function(){ sPan.hidden = false; });
  sIn.addEventListener('click', function(e){ e.stopPropagation(); sPan.hidden = false; });
  document.querySelectorAll('.sr-f').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.sr-f').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      var t = b.dataset.t;
      sItems.forEach(function(it){
        it.style.display = (t === 'all' || it.dataset.t === t) ? '' : 'none';
      });
    });
  });
  document.addEventListener('click', function(e){
    if(!sPan.hidden && !sPan.contains(e.target) && !sIn.contains(e.target)) sPan.hidden = true;
  });

  /* 壁纸显隐 —— 分模式（老哥 09-27 16:44：整页模式下别的页也要有壁纸）：
     · 整页模式：壁纸是整张页面的背景，**所有页都显示**
     · 横幅模式：它只是首页顶部的一条，切到别的页要收起 */
  function syncWall(){
    var cur = document.querySelector('.nav.on');
    var onToday = !cur || cur.dataset.p === 'p-today';
    wall.hidden = !onToday && !document.querySelector('.xhs-wb-root').classList.contains('wall-full');
  }

  /* 一级页签：切页面 */

  document.querySelectorAll('.nav[data-p]').forEach(function(n){
    n.addEventListener('click', function(){
      document.querySelectorAll('.nav').forEach(function(x){ x.classList.remove('on'); });
      n.classList.add('on');
      document.querySelectorAll('.page').forEach(function(p){ p.hidden = (p.id !== n.dataset.p); });
      syncWall();
      window.scrollTo(0, 0);
    });
  });
  /* 页内子页签：只切换同族 .subpage */
  function bindTabs(sel, key, prefix){
    var group = document.querySelectorAll(sel);
    group.forEach(function(b){
      b.addEventListener('click', function(){
        group.forEach(function(x){ x.classList.remove('on'); });
        b.classList.add('on');
        document.querySelectorAll('.subpage').forEach(function(p){
          if (p.id.indexOf(prefix) === 0) p.hidden = (p.id !== b.dataset[key]);
        });
      });
    });
  }
  bindTabs('.subtab[data-s]', 's', 's-');
  bindTabs('.subtab[data-k]', 'k', 'k-');
  /* 纯视觉用的分段按钮（笔记卡筛选 / 账号切换）：只切选中态 */
  document.querySelectorAll('.subtab:not([data-s]):not([data-k])').forEach(function(b){
    b.addEventListener('click', function(){
      b.parentElement.querySelectorAll('.subtab').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
    });
  });

  /* 壁纸：原型里用 5 套渐变循环演示（真实插件里换成任意图片） */
  var walls = [
    'linear-gradient(125deg,#0f76c4 0%,#1e8ad0 48%,#5cb8e6 100%)',
    'linear-gradient(125deg,#12395c 0%,#2f6b96 55%,#7fb4d4 100%)',
    'linear-gradient(125deg,#42708f 0%,#7fa3bb 60%,#c6d9e6 100%)',
    'linear-gradient(125deg,#0b3a63 0%,#1a6ea8 50%,#4fb0d8 100%)',
    'linear-gradient(125deg,#2b4f6d 0%,#5d8aa8 55%,#a9c7da 100%)'
  ];
  var wi = 0, wall = document.getElementById('wall');
  function changeWall(){
    wi = (wi + 1) % walls.length;
    wall.style.background = walls[wi];
    try { localStorage.removeItem(WALL_IMG_KEY); } catch (e4) { /* ignore */ }
  }
  /* 壁纸入口：wall 悬浮按钮 + 布局弹层（横幅模式已砍，root 恒为 wall-full） */
  var WALL_IMG_KEY = 'xhs-wb-wall-image';
  var wb1 = document.getElementById('wallBtn');
  if (wb1) wb1.addEventListener('click', function(e){ e.stopPropagation(); changeWall(); });
  var wb2 = document.getElementById('wallBtn2');
  if (wb2) wb2.addEventListener('click', function(e){ e.stopPropagation(); changeWall(); });

  /* 自定义图片壁纸（老哥 09-30 二改：弹系统文件选择器，不让用户找路径）。
     选中 → 写入插件目录 .obsidian/plugins/xhs-workbench/wall-image.<ext>（adapter 直写，
     Obsidian 不索引该目录但 app:// 能服务）→ adapter.getResourcePath 拿 URL → 铺满整页。
     记忆：localStorage 存扩展名；恢复时 Image 预加载校验（文件被删则自动回退渐变）。
     点「换一张壁纸（官方渐变）」= 清除自定义回到渐变循环。 */
  var WALL_DIR = '.obsidian/plugins/xhs-workbench/';
  var wallFileIn = document.getElementById('wallImgFile'), wallImgBtn = document.getElementById('wallImgBtn');
  function wallUrl(ext, bust){
    var u = app.vault.adapter.getResourcePath(WALL_DIR + 'wall-image.' + ext);
    return bust ? u + '?t=' + Date.now() : u;
  }
  function applyImageWall(url, ext){
    wall.style.background = 'center / cover no-repeat url(' + url + ')';
    try { localStorage.setItem(WALL_IMG_KEY, ext); } catch (e2) { /* ignore */ }
  }
  function restoreImageWall(){
    var ext = null;
    try { ext = localStorage.getItem(WALL_IMG_KEY); } catch (e3) { return; }
    if (!ext) return;
    var app = window.app;
    if (!app || !app.vault || !app.vault.adapter) return;
    var url = wallUrl(ext, true);
    var probe = new Image();
    probe.onload = function(){ applyImageWall(url, ext); };
    probe.onerror = function(){ try { localStorage.removeItem(WALL_IMG_KEY); } catch (e4) { /* ignore */ } };
    probe.src = url;
  }
  if (wallImgBtn) wallImgBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var app = window.app;
    if (!app || !app.vault || !app.vault.adapter || !app.vault.adapter.writeBinary) { toast('当前环境不支持自定义壁纸', 5000); return; }
    wallFileIn.click();
  });
  if (wallFileIn) wallFileIn.addEventListener('change', function(){
    var f = wallFileIn.files && wallFileIn.files[0];
    wallFileIn.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('请选择图片文件', 5000); return; }
    var ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    if (ext.length > 5) ext = 'png';
    f.arrayBuffer().then(function(buf){
      var app = window.app;
      var path = WALL_DIR + 'wall-image.' + ext;
      var prevExt = null;
      try { prevExt = localStorage.getItem(WALL_IMG_KEY); } catch (e5) { /* ignore */ }
      return app.vault.adapter.writeBinary(path, buf).then(function(){
        if (prevExt && prevExt !== ext) { try { app.vault.adapter.remove(WALL_DIR + 'wall-image.' + prevExt); } catch (e6) { /* ignore */ } }
        applyImageWall(wallUrl(ext, true), ext);
        toast('已用你的图片做壁纸 ✓（重新加载后依然生效）', 4000);
      });
    }).catch(function(err){ toast('写入壁纸失败：' + (err && err.message ? err.message : err), 6000); });
  });
  restoreImageWall();

  /* 导航位置：左侧 / 顶部（顶部模式下壁纸要排到导航条之上，所以搬一次节点） */
  var shell = document.querySelector('.shell');
  var sideEl = document.getElementById('side');
  var mainEl = document.querySelector('.main');
  var segPos = document.querySelectorAll('.seg-b[data-pos]');
  segPos.forEach(function(b){
    b.addEventListener('click', function(){
      segPos.forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      var top = b.dataset.pos === 'top';
      shell.classList.toggle('top', top);
      if (top) shell.insertBefore(wall, sideEl);
      else mainEl.insertBefore(wall, mainEl.firstChild);
    });
  });
  /* 壁纸：横幅 / 整页 */
  var segWall = document.querySelectorAll('.seg-b[data-wall]');
  segWall.forEach(function(b){
    b.addEventListener('click', function(){
      segWall.forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      document.querySelector('.xhs-wb-root').classList.toggle('wall-full', b.dataset.wall === 'full');
      syncWall();
    });
  });
  /* 数据库页子页签（真的能切）：账号概览 / 内容分析 / 粉丝数据
     —— 原来三个子页签是"死"的，点了没反应，而且「账号概览」下面摆的其实是内容分析的表。 */
  var dTabs = document.getElementById('dataTabs');
  if (dTabs){
    dTabs.querySelectorAll('.subtab[data-dt]').forEach(function(b){
      b.addEventListener('click', function(){
        dTabs.querySelectorAll('.subtab[data-dt]').forEach(function(x){ x.classList.remove('on'); });
        b.classList.add('on');
        ['dOv','dAn','dFans'].forEach(function(id){
          var el = document.getElementById(id);
          if (el) el.hidden = (id !== b.dataset.dt);
        });
      });
    });
  }

  /* 轻提示（原型用）：点的东西在真插件里会发生什么，得让老哥看见反馈 */
  var toastEl = document.getElementById('toast'), toastTid;
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTid);
    toastTid = setTimeout(function(){ toastEl.hidden = true; }, 2400);
  }
  /* 点品名 → 打开该条记录：真实接线在 main.js（openDuoweiRecord，09-30），原型提示已删 */

  /* 长列表折叠（通用逻辑）：
        data-fold        = 初始显示条数（也是「收起」后回到的条数）
        data-fold-step   = 每次点「展开」新增的条数（不写则同初始值）
     老哥口径：每日跟踪 10/10（09-27 21:47）；内容分析 初始 5 / 每次 +10（09-28 11:10）。
     「收起」永远是一次性回到初始条数，不是逐批往回缩。 */
  document.querySelectorAll('[data-fold]').forEach(function(blk){
    var init = parseInt(blk.dataset.fold, 10) || 10;
    var step = parseInt(blk.dataset.foldStep, 10) || init;
    var tbl = blk.querySelector('table');
    if (!tbl) return;
    var rows = Array.prototype.slice.call(tbl.querySelectorAll('tbody tr'));
    if (rows.length <= init) return;                 // 没超过就不显示按钮
    var bar = document.createElement('div');
    bar.className = 'foldbar';
    var btn = document.createElement('button');
    btn.className = 'btn';
    bar.appendChild(btn);
    tbl.parentNode.insertBefore(bar, tbl.nextSibling);
    var shown = init;
    function render(){
      rows.forEach(function(r, i){ r.hidden = (i >= shown); });
      var rest = rows.length - shown;
      btn.textContent = rest > 0 ? ('展开剩余 ' + rest + ' 条 ⌄')
                                 : ('收起（只看最近 ' + init + ' 条） ⌃');
    }
    btn.addEventListener('click', function(){
      var rest = rows.length - shown;
      shown = rest > 0 ? Math.min(shown + step, rows.length) : init;   // 展开下一批 / 一次性收回
      render();
    });
    render();
  });

  /* 响应式断点：按「内容区实际宽度」写进 html[data-cw]（lg / sm / xs）
     —— 不用 @media：窗口宽 ≠ 内容宽，Obsidian 侧栏一开一关，窗口没变内容区就窄了
     lg ≥1040（4 指标卡 + 三栏）｜ sm 720–1040（2 列 + 单栏）｜ xs <720（单列） */
  function applyCW(){
    // B5 走查修断点：视图卸载后 ResizeObserver/resize 仍可能触发一次，
    // 全局 querySelector 会拿到 null（或拿到别的实例）→ 空判断 + 只认自己的根
    if (!mainEl || !mainEl.isConnected) return;
    var rootEl = mainEl.classList && mainEl.classList.contains('xhs-wb-root') ? mainEl : mainEl.closest('.xhs-wb-root');
    if (!rootEl) return;
    var w = mainEl.clientWidth;
    rootEl.dataset.cw = w < 720 ? 'xs' : (w < 1040 ? 'sm' : 'lg');
  }
  if (window.ResizeObserver) new ResizeObserver(applyCW).observe(mainEl);
  window.addEventListener('resize', applyCW);
  applyCW();

  /* 笔记卡弹窗（§17.2）
     ⚠️ 下面的 NOTES 是从 vault 真文件解析出来硬编码进稿子的（演示关联上以后长什么样）。
     真实插件里这块由 vault.on('create'|'modify') 事件驱动，不是写死的。 */
  var NOTES = [
 {
  "file": "前后状态对比-不信精油-041.md",
  "t": "我本来是来打假的",
  "meta": "舒眠精油 · 正文 292 字",
  "tpl": "005 前后状态对比",
  "titles": [
   {
    "d": "1. 我本来是来打假的（T2 反常识断言）",
    "c": "我本来是来打假的"
   },
   {
    "d": "2. 买它的时候，我就在等一个打脸的机会（T2）",
    "c": "买它的时候，我就在等一个打脸的机会"
   },
   {
    "d": "3. 用了一个月，我承认我错了（T6 时间成本）",
    "c": "用了一个月，我承认我错了"
   }
  ],
  "covers": [
   {
    "d": "A：深色底 + 大字：我本来是来打假的",
    "c": "A：深色底 + 大字：我本来是来打假的"
   },
   {
    "d": "B：浅色底 + 大字：一瓶精油能有多大用",
    "c": "B：浅色底 + 大字：一瓶精油能有多大用"
   }
  ],
  "body": "我买这个的时候是抱着打假的心态的。\n\n一瓶闻起来香香的东西，凭什么能让人睡着。我买过太多号称神器的东西了，最后全堆在抽屉里。\n\n但那次是连续一周赶方案，脑子跟烧过一样，躺下就是睡不着。\n死马当活马医，睡前在耳后和手腕各滚了两下。\n\n气味是那种木质调，不甜，凑近了才有。老实说没什么神奇的感觉，就是屋里多了一点味道。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n23:40 躺下，还是照常在刷手机\n23:55 有点困了，把手机放下\n00:15 再睁眼是天亮\n\n那天我一觉到天亮，中间一次都没醒。第二天早上爬起来还在想，是不是巧合。\n\n后来又用了两周，还是这样，我才承认它确实有点用。\n\n现在它在我的床头柜上有一格固定位置。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物"
 },
 {
  "file": "前后状态对比-多梦-016.md",
  "t": "睡够八小时还是累，问题可能不在时长",
  "meta": "舒眠精油 · 正文 250 字",
  "tpl": "005 前后状态对比",
  "titles": [
   {
    "d": "1. 睡够八小时还是累，问题可能不在时长（T2 反常识断言）",
    "c": "睡够八小时还是累，问题可能不在时长"
   },
   {
    "d": "2. 一晚上做三场梦，比没睡还累（T5 痛点点名）",
    "c": "一晚上做三场梦，比没睡还累"
   },
   {
    "d": "3. 连续十天醒来不记得做过什么梦（T1 数字 + 情绪）",
    "c": "连续十天醒来不记得做过什么梦"
   }
  ],
  "covers": [
   {
    "d": "A：深色底 + 大字：一整晚都在做梦",
    "c": "A：深色底 + 大字：一整晚都在做梦"
   },
   {
    "d": "B：浅色底 + 大字：睡够了，还是累",
    "c": "B：浅色底 + 大字：睡够了，还是累"
   }
  ],
  "body": "我属于一闭眼就开始演电影的那种。一个晚上做好几场，醒来全记得，还都是乱七八糟的。\n睡够八个小时也不管用，早上起来跟跑了夜路一样，人是虚的。\n\n后来我才知道，睡的时间长和睡得整是两回事。\n\n朋友给了我一瓶这个，说她以前也这样。\n\n睡前在耳后和手腕各滚两下，淡淡的草本味，不冲。\n它不管梦，梦该做还是做。就是醒来之后，没那么累了。\n\n【⚠️ 下面这组数字必须换成你自己的真实记录】\n连续十天，我早上醒来都不太记得做过什么梦了。\n以前是清清楚楚记一整晚，现在大部分时候是空的。\n\n上周末睡到自然醒，那天什么梦都没有。起床的时候人是清的。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物"
 },
 {
  "file": "前后状态对比-浅眠党-014.md",
  "t": "以前一晚醒三四次，现在能睡到天亮",
  "meta": "舒眠精油 · 正文 312 字",
  "tpl": "005 前后状态对比",
  "titles": [
   {
    "d": "1. 以前一晚醒三四次，现在能睡到天亮（T1 人群+数字结果）",
    "c": "以前一晚醒三四次，现在能睡到天亮"
   },
   {
    "d": "2. 浅眠十年，这个月终于睡整了（T1）",
    "c": "浅眠十年，这个月终于睡整了"
   },
   {
    "d": "3. 连续一周醒来不超过一次，我知足了（T1 + 情绪词）",
    "c": "连续一周醒来不超过一次，我知足了"
   }
  ],
  "covers": [
   {
    "d": "A：深色底 + 白色大字：一有动静就醒的人",
    "c": "A：深色底 + 白色大字：一有动静就醒的人"
   },
   {
    "d": "B：浅色底 + 大字：以前一晚醒四次，现在到天亮",
    "c": "B：浅色底 + 大字：以前一晚醒四次，现在到天亮"
   }
  ],
  "body": "我这人睡觉跟站岗一样。楼上拖鞋响一下、楼道有人上楼、外面车过去一下，我都能醒。\n\n醒了就完了，翻来覆去一两个小时才再睡着，有时候直接熬到闹钟响。\n最烦的是白天。同事说我看着像没睡醒，我自己也知道，脑子糊糊的，反应慢半拍。\n\n这瓶是刷到一个博主推荐的。买的时候没抱什么希望，就想着反正也不贵。\n\n滚珠的，睡前在耳后和手腕各滚两下。味道说不上浓，凑近了才闻得到，有点像木头。\n它不会让你一闻就困，但屋里安静下来之后，那股味道会一直在。\n\n【⚠️ 下面这组数字必须换成你自己的真实记录】\n这一个月里，我大概有二十多天是整晚没醒的。\n以前平均一晚醒三四次，现在大部分时候不超过一次。\n\n白天不用午休也能撑到下班。\n\n昨晚楼上又在拖地。我睁了一下眼，翻个身又睡回去了。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物"
 },
 {
  "file": "前后状态对比-爱美女生-026.md",
  "t": "睡不好那阵子，粉底都盖不住我这张脸",
  "meta": "舒眠精油 · 正文 273 字",
  "tpl": "005 前后状态对比",
  "titles": [
   {
    "d": "1. 睡不好那阵子，粉底都盖不住我这张脸（T5 痛点点名）",
    "c": "睡不好那阵子，粉底都盖不住我这张脸"
   },
   {
    "d": "2. 同事问我最近是不是很累，那一刻挺想哭的（T4 身份共鸣）",
    "c": "同事问我最近是不是很累，那一刻挺想哭的"
   },
   {
    "d": "3. 以前化妆要磨半小时，现在十分钟出门（T1 数字对比）",
    "c": "以前化妆要磨半小时，现在十分钟出门"
   }
  ],
  "covers": [
   {
    "d": "A：深色底 + 大字：粉底盖不住的那种累",
    "c": "A：深色底 + 大字：粉底盖不住的那种累"
   },
   {
    "d": "B：浅色底 + 大字：睡不好，妆都救不回来",
    "c": "B：浅色底 + 大字：睡不好，妆都救不回来"
   }
  ],
  "body": "上班要见客户，妆是必须化的。但那阵子我每天早上化妆都要磨很久。\n\n不是不会化，是整个人是垮的，粉底压不住，眼睛也没神。同事还问过我一句，你最近是不是很累。\n\n那种累是睡出来的。睡不好，第二天照镜子自己都躲不开。\n\n这个是我睡前刷手机刷到的，当时就一个念头，能让我睡踏实就行。\n\n滚珠的，睡前在耳后和手腕各滚两下，气味偏花香，很淡。\n我一般躺下还要刷十分钟手机，刷着刷着手机就滑到枕头边上了。\n\n【⚠️ 下面这组数字必须换成你自己的真实记录】\n这两周基本是躺下没多久就睡过去，中间没醒。\n\n睡得整了之后，早上起床没那么烦了。\n前天赶早班机，五点半起床，居然没像以前那样一路黑着脸。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #生活仪式感 #居家的日子 #床头好物"
 },
 {
  "file": "时间线助眠体验-会后回放-002.md",
  "t": "白天吵完的架，晚上终于不重播了",
  "meta": "舒眠精油 · 正文 349 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 白天吵完的架，晚上终于不重播了（T5 痛点点名）",
    "c": "白天吵完的架，晚上终于不重播了"
   },
   {
    "d": "2. 做对接岗的，脑子关不掉的人懂（T4 身份共鸣）",
    "c": "做对接岗的，脑子关不掉的人懂"
   },
   {
    "d": "3. 上班一直在说话，睡前得让它停下（T4 身份共鸣）",
    "c": "上班一直在说话，睡前得让它停下"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：深灰底 + 白色大字：脑子终于不重播了",
    "c": "A（C1 大字报）：深灰底 + 白色大字：脑子终于不重播了"
   },
   {
    "d": "B（C3 场景图 + 大字）：手在手腕滚珠的特写，大字：白天吵完，晚上别重播",
    "c": "B（C3 场景图 + 大字）：手在手腕滚珠的特写，大字：白天吵完，晚上别重播"
   }
  ],
  "body": "白天跟供应商来回磨，一来回三小时，最后还吵起来了。\n\n回家躺床上，那些话一句一句往外冒。刚才那句该那么说的，我本来应该直接怼回去的。\n越想越气，越气越清醒。\n\n挺离谱的，明明是对方的问题，晚上睡不着的是我。\n\n同事在我工位上放了一瓶这个。我一直不太信这类东西，闻个味儿能怎么样。\n结果加班到十点，随手在耳后滚了两下，那天回去躺下，脑子里居然没那么吵了。\n\n后来就成习惯了，睡前耳后、手腕各滚两下。\n木质调，不甜不冲。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n23:10 洗完澡，耳后、手腕各滚两下\n23:20 躺下，枕边一直有淡淡的味道\n23:35 脑子像被人按了暂停。那些该说没说出口的话，停了\n\n那一晚一觉到天亮，中间没醒。\n第二天开会轮到我说话，没像以前那样先紧张一下。\n\n白天在外面跟人不停地磨，回家总得有样东西能让脑子停一停。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #情绪稳定 #打工人日常 #下班生活 #独居日常"
 },
 {
  "file": "时间线助眠体验-倒班夜班-009.md",
  "t": "下夜班回家，天亮了我反而睡不着",
  "meta": "舒眠精油 · 正文 336 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 下夜班回家，天亮了我反而睡不着（T5 痛点点名）",
    "c": "下夜班回家，天亮了我反而睡不着"
   },
   {
    "d": "2. 上完夜班躺下，天亮了脑子还是亮的（T5 痛点点名）",
    "c": "上完夜班躺下，天亮了脑子还是亮的"
   },
   {
    "d": "3. 倒班三年，我的睡眠是乱的（T4 身份共鸣）",
    "c": "倒班三年，我的睡眠是乱的"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：遮光窗帘背景 + 大字：天亮了，我睡不着",
    "c": "A（C1 大字报）：遮光窗帘背景 + 大字：天亮了，我睡不着"
   },
   {
    "d": "B（C3 场景图 + 大字）：手举精油瓶 + 拉严的窗帘，大字：下夜班回家，脑子还在上班",
    "c": "B（C3 场景图 + 大字）：手举精油瓶 + 拉严的窗帘，大字：下夜班回家，脑子还在上班"
   },
   {
    "d": "> 形态取模板 004「手持整瓶展示」；本条的场景道具是遮光窗帘（倒班人群的符号）。",
    "c": "> 形态取模板 004「手持整瓶展示」；本条的场景道具是遮光窗帘（倒班人群的符号）。"
   }
  ],
  "body": "凌晨下夜班，天已经蒙蒙亮了。\n\n回到家洗完澡躺下，身体是散的，脑子还在转。白天该睡觉的点，偏偏清醒得要命。\n窗帘拉到最严，还是听得见外面开始有声音了。车、鸟、楼下送孩子的。\n\n倒班最难受的不是累，是你跟这个世界的时间对不上。\n\n我原来一直靠硬扛，扛不住就白天补一觉，补完晚上又睡不着，来回倒。\n同事给了我一瓶这个，说他上夜班也靠它。我当时想，闻个味儿还能压得住生物钟？\n\n结果那天洗完澡，在耳后和手腕各滚了两下，躺下没多久就睡过去了。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n06:10 到家洗完澡，耳后、手腕各滚两下\n06:20 躺下，枕边有淡淡的木质味，窗帘拉严\n06:45 睡过去了，中间没醒\n\n一直睡到下午两点多。醒来天都黑了，但难得没有那种睡了个假觉的感觉。\n\n倒班的兄弟姐妹，应该懂我在说什么。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #倒班日常 #夜班 #早睡 #生活仪式感"
 },
 {
  "file": "时间线助眠体验-出差党-035.md",
  "t": "换张床就睡不好的人，出差是酷刑",
  "meta": "舒眠精油 · 正文 269 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 换张床就睡不好的人，出差是酷刑（T2 反常识断言）",
    "c": "换张床就睡不好的人，出差是酷刑"
   },
   {
    "d": "2. 酒店第一晚，我基本都是熬到天亮（T5 痛点点名）",
    "c": "酒店第一晚，我基本都是熬到天亮"
   },
   {
    "d": "3. 出差党最怕的不是开会，是认床（T2 反常识断言）",
    "c": "出差党最怕的不是开会，是认床"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：酒店床头灯背景 + 大字：换张床就睡不好",
    "c": "A（C1 大字报）：酒店床头灯背景 + 大字：换张床就睡不好"
   },
   {
    "d": "B（C3 场景图 + 大字）：行李箱旁手举精油瓶，大字：出差的包里固定带一瓶",
    "c": "B（C3 场景图 + 大字）：行李箱旁手举精油瓶，大字：出差的包里固定带一瓶"
   }
  ],
  "body": "出差党有个共同的毛病，认床。\n\n在家躺下就着，到了酒店，同样的姿势、同样的关灯顺序，脑子就是不肯关机。\n而且越想着明天还有会，越清醒。\n\n我一年有三分之一的时间在外面，基本每一趟的第一晚都是熬过去的。\n后来学乖了，出差的包里固定带一瓶这个。滚珠的，小小一瓶，扔包里就走。\n\n洗完澡在耳后和手腕各滚两下，躺下闭眼。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n23:30 洗完澡，耳后、手腕各滚两下\n23:40 躺下，枕边是熟悉的那股味\n00:05 睡过去了，闹钟响之前没醒\n\n第二天开会的时候，没有那种倒了时差的恍惚。\n\n说实话，认床这事没法根治，但至少能让第一晚好过点。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #出差日常 #酒店好物 #随身好物 #生活仪式感"
 },
 {
  "file": "时间线助眠体验-加班白领-001.md",
  "t": "像断电一样沉，一觉到天亮",
  "meta": "舒眠精油 · 正文 394 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 像断电一样沉，一觉到天亮（T2 反常识断言）",
    "c": "像断电一样沉，一觉到天亮"
   },
   {
    "d": "2. 十一点半到家的人，躺下就是断电（T5 痛点点名）",
    "c": "十一点半到家的人，躺下就是断电"
   },
   {
    "d": "3. 睡前滚两下，再睁眼就是早上（T10 场景型）",
    "c": "睡前滚两下，再睁眼就是早上"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：深色底 + 白色大字：像断电一样沉",
    "c": "A（C1 大字报）：深色底 + 白色大字：像断电一样沉"
   },
   {
    "d": "B（C3 场景图 + 大字）：床头暖光 + 手举精油瓶，大字：一觉到天亮",
    "c": "B（C3 场景图 + 大字）：床头暖光 + 手举精油瓶，大字：一觉到天亮"
   },
   {
    "d": "> 形态取模板 004「手持整瓶展示」（11 篇对标里 5/11）。",
    "c": "> 形态取模板 004「手持整瓶展示」（11 篇对标里 5/11）。"
   },
   {
    "d": "> ⚠️ 对标的「昏迷式睡了 14 小时」是 🔴 药物比喻，不用。",
    "c": "> ⚠️ 对标的「昏迷式睡了 14 小时」是 🔴 药物比喻，不用。"
   }
  ],
  "body": "十一点半到家。\n\n洗完澡躺床上，眼睛闭上了，脑子还在上班。今天那句没说好的话、明天要交的东西，一件一件往外冒。\n\n就那种身体已经躺平、人还在工位上的感觉。\n\n我妹硬塞给我一瓶这个，原话是「你再这么熬下去要垮」。\n我当时想，又来了，我妹的智商税一年得交好几轮。\n所以它在床头躺了小半个月，我一次都没碰。\n\n后来是有天实在睡不着，抱着「反正也睡不着」的心态，睡前在耳后和手腕各滚了两下。\n味道说不上来，有点像雨后的木头，不冲，凑近了才有。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录，编造体感 = 虚假营销】\n22:40 洗完澡，耳后、手腕各滚两下\n22:50 躺下刷手机，枕边一直是那个味\n23:05 手机放下。再拿起来就是第二天早上了\n\n说真的，我自己都愣了一下。\n我已经很多年没有「睡过去」这个过程了，以前都是躺到累晕的。\n\n第二天是自然醒的，没有那种被闹钟硬拽起来的懵。\n那天开长会，居然没灌咖啡。\n\n反正睡前多滚两下的事，不占什么时间。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #早睡 #打工人日常 #床头好物 #生活仪式感"
 },
 {
  "file": "时间线助眠体验-喂夜奶妈妈-031.md",
  "t": "喂完夜奶，宝宝睡回去了，我醒了",
  "meta": "舒眠精油 · 正文 304 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 喂完夜奶，宝宝睡回去了，我醒了（T5 痛点点名）",
    "c": "喂完夜奶，宝宝睡回去了，我醒了"
   },
   {
    "d": "2. 凌晨三点喂完奶，我比宝宝还清醒（T5）",
    "c": "凌晨三点喂完奶，我比宝宝还清醒"
   },
   {
    "d": "3. 当妈以后，睡整觉成了奢侈品（T4 身份共鸣）",
    "c": "当妈以后，睡整觉成了奢侈品"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：夜景暖光 + 大字：喂完奶，脑子还醒着",
    "c": "A（C1 大字报）：夜景暖光 + 大字：喂完奶，脑子还醒着"
   },
   {
    "d": "B（C3 场景图 + 大字）：床头小夜灯 + 手滚珠特写（不露脸、不拍孩子），大字：宝宝睡了，我醒了",
    "c": "B（C3 场景图 + 大字）：床头小夜灯 + 手滚珠特写（不露脸、不拍孩子），大字：宝宝睡了，我醒了"
   },
   {
    "d": "> ⚠️ 拍摄红线：不要把宝宝拍进画面（未成年人出镜的合规与风险），只拍环境与手部。",
    "c": "> ⚠️ 拍摄红线：不要把宝宝拍进画面（未成年人出镜的合规与风险），只拍环境与手部。"
   }
  ],
  "body": "凌晨三点，喂完夜奶，宝宝睡回去了。\n\n我把她放回小床，自己躺下。身体累得像散了架，脑子却亮得很。白天没做完的事、明天要买的东西、刚才抱她的姿势对不对，全冒出来了。\n\n当妈的应该都懂。宝宝睡了，你反而睡不着，然后躺着看天一点点亮。\n\n我原来不信香薰精油这类东西，闻个味儿还能怎么样。\n是月子里闺蜜给我带了一瓶。有次喂完奶实在睡不着，随手在耳后滚了两下。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n03:20 喂完奶，在耳后滚两下\n03:25 躺下，枕边有淡淡的草木味\n03:40 睡过去了，宝宝下次醒之前没再睁眼\n\n第二天整个人没那么空。以前是睡了跟没睡一样，那天至少是真的歇过来了。\n\n外用滚珠，睡前几秒的事。\n\n喂夜奶的姐妹，真的可以试试。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #带娃日常 #新手妈妈 #生活仪式感 #早睡"
 },
 {
  "file": "时间线助眠体验-舍不得睡-003.md",
  "t": "睡过去那一刻，我是真的不记得",
  "meta": "舒眠精油 · 正文 326 字",
  "tpl": "004 时间线助眠体验",
  "titles": [
   {
    "d": "1. 睡过去那一刻，我是真的不记得（T5 痛点点名 / 结果向）",
    "c": "睡过去那一刻，我是真的不记得"
   },
   {
    "d": "2. 不是睡不着，是舍不得睡（T2 反常识断言 / 心理向）",
    "c": "不是睡不着，是舍不得睡"
   },
   {
    "d": "3. 手机放下那一刻，我就断电了（T2 反常识断言 / 体感向）",
    "c": "手机放下那一刻，我就断电了"
   }
  ],
  "covers": [
   {
    "d": "A（C1 大字报）：暖黄底 + 深色大字：睡过去都不知道",
    "c": "A（C1 大字报）：暖黄底 + 深色大字：睡过去都不知道"
   },
   {
    "d": "B（C1 大字报·备选）：不是睡不着，是舍不得睡（心理向；A 的数据差再换测）",
    "c": "B（C1 大字报·备选）：不是睡不着，是舍不得睡（心理向；A 的数据差再换测）"
   },
   {
    "d": "> 两版都是纯文字卡，不需要实物，是图没拍好也能发的兜底形态。",
    "c": "> 两版都是纯文字卡，不需要实物，是图没拍好也能发的兜底形态。"
   }
  ],
  "body": "一个人住久了有个毛病。白天全是别人的，只有晚上这几个小时是自己的。\n\n明知道该睡了，就是不想睡。\n躺下就意味着今天结束了，明天一睁眼又是那些事。所以宁可再刷两条。\n\n不是睡不着，是不想睡。\n\n后来我没逼自己早点睡。我把睡前那五分钟换了个顺序。\n以前是躺下就刷手机，越刷越精神。现在改成关灯前先在耳后和手腕滚两下，滚完再躺下。\n\n【⚠️ 下面这组时间线必须换成你自己的真实记录】\n23:20 洗完澡，耳后、手腕各滚两下，柑橘味偏清透，后调有点甜\n23:30 躺下刷手机，枕边一直是那个味\n23:50 手机放床头。放下就断电了\n\n再睁眼是早上。我什么时候睡过去的都不记得。\n\n那一刻其实有点小爽，说明今晚没被手机吃掉。\n早上起来也不亏，没有那种「昨晚又没睡好」的怨气。\n\n不是让你早睡，是先别跟手机硬刚。",
  "tags": "#睡前放松 #晚安好物 #睡前仪式感 #高质量睡眠 #独居日常 #早睡 #生活仪式感 #床头好物"
 }
];
  var modal = document.getElementById('noteModal');
  var mT = document.getElementById('mT'), mS = document.getElementById('mS');
  var mStat = document.querySelectorAll('#noteModal .seg-b');
  var mRows = document.getElementById('mRows');

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(ch){
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
    });
  }
  /* 一组 = 一个块名 + N 行，每行自带复制按钮 */
  function grp(label, rows){
    var h = '<div class="cp-grp"><div class="cp-k">' + label + '</div><div class="cp-lines">';
    for (var i = 0; i < rows.length; i++){
      h += '<div class="cp-line"><span class="tx' + (rows[i].body ? ' body' : '') + '">' + esc(rows[i].d)
        + '</span><button class="btn" data-copy="' + esc(rows[i].c) + '">复制</button></div>';
    }
    return h + '</div></div>';
  }
  function renderCopy(n){
    var h = '';
    if (n.titles && n.titles.length) h += grp('标题', n.titles);
    if (n.covers && n.covers.length) h += grp('封面大字', n.covers);
    h += grp('正文', [{ d: n.body || '（这篇正文还没写）', c: n.body || '', body: true }]);
    h += grp('标签', [{ d: n.tags || '（这篇还没写标签）', c: n.tags || '' }]);
    mRows.innerHTML = h;
  }
  /* 真复制 + 「已复制」反馈（原型也让人点得出来） */
  mRows.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('button[data-copy]') : null;
    if (!b) return;
    var ta = document.createElement('textarea');
    ta.value = b.getAttribute('data-copy') || '';
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
    var t = b.textContent; b.textContent = '已复制';
    setTimeout(function(){ b.textContent = t; }, 1200);
  });

  document.querySelectorAll('[data-open]').forEach(function(b){
    b.addEventListener('click', function(){
      var tr = b.closest('tr'), n = NOTES[+b.dataset.i] || {};
      mT.textContent = tr.querySelector('.t-title').textContent;
      mS.textContent = tr.children[1].textContent.trim() + ' · ' + tr.querySelector('.t-sub').textContent;
      renderCopy(n);
      var st = tr.querySelector('.pill').textContent.trim();
      mStat.forEach(function(x){ x.classList.toggle('on', x.textContent === st); });
      modal.hidden = false;
    });
  });
  modal.addEventListener('click', function(e){
    if (e.target === modal || e.target.id === 'mX') modal.hidden = true;
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });

  /* 知识库 · 「改权限」浮层（只读 / 可编辑）
     · 所有行都可点（包括只读行 —— 它就是要用来改回可编辑的）
     · 面板用 fixed + JS 算位置，跟随被点的按钮 */
  var stPop = document.getElementById('stPop');
  document.querySelectorAll('[data-perm]').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var tr = b.closest('tr');
      document.getElementById('stFile').textContent = tr.querySelector('.t-title').textContent.trim();
      document.getElementById('stPath').textContent = tr.children[1].textContent.trim();
      // ⚠️ 必须取「状态」那一格（第 5 个 td）—— 表里前面还有「输入/输出」列，也是 .pill，
      //    用 querySelector('.pill') 会抓到那个（第一次就抓错了，把「输出」当成了状态）
      var stCell = tr.children[4];
      var stEl = stCell ? stCell.querySelector('.pill') : null;
      var cur = stEl ? stEl.textContent.trim() : '';
      var has = cur && cur !== '—';
      document.getElementById('stCur').innerHTML = has ? ('<span class="pill"><i></i>' + cur + '</span>')
        : '<span class="mut">这个文件还没有状态</span>';
      stPop.hidden = false;
      var r = b.getBoundingClientRect(), w = stPop.offsetWidth, h = stPop.offsetHeight;
      /* 🔴 宿主适配（B1.5）：原稿里 `.st-pop` 是 `position:fixed` → 用**视口坐标**摆放。
         搬进插件后它在适配层被改成 `position:absolute`（避免浮层飘到 Obsidian 其它面板上），
         包含块于是变成视图根 `.xhs-wb-root`（position:relative）→ **坐标必须换算到视图根这个坐标系**，
         否则整体偏移「视图根原点」的量（实测 root 在 (44,79)：点第 1 行的「改权限」，
         浮层落到第 2 行下面；点第 2 行落到第 3 行，以此类推）。
         注：`.shell` 内部会滚动，但按钮坐标是 `getBoundingClientRect()` 的**当前可见位置**，
         换算后与浮层（不动）一致，滚动时两者一起偏 —— 与原稿 fixed 版的取舍相同。 */
      var WB = document.querySelector('.xhs-wb-root');
      var B = WB ? WB.getBoundingClientRect()
                 : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      var vx = B.left, vy = B.top, vw = B.width, vh = B.height;
      var left = Math.max(vx + 12, Math.min(r.left - 24, vx + vw - w - 12));
      // 优先在按钮下方展开；下方放不下就整体上移（而不是翻到按钮上方 —— 表格行多时
      // 翻上去同样会被挤出视口，实测小视口下面板会顶到屏幕外）
      var top = r.bottom + 8;
      if (top + h > vy + vh - 12) top = Math.max(vy + 12, vy + vh - h - 12);
      stPop.style.left = (left - vx) + 'px';
      stPop.style.top  = (top - vy) + 'px';
    });
  });
  if (stPop){
    document.addEventListener('click', function(e){
      if (!stPop.hidden && !stPop.contains(e.target)) stPop.hidden = true;
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && !stPop.hidden) stPop.hidden = true;
    });
  }

  /* 知识库 · 「收录目录」面板（决定哪些文件夹进知识索引） */
  var incBtn = document.getElementById('incBtn'), incPop = document.getElementById('incPop');
  if (incBtn && incPop){
    incBtn.addEventListener('click', function(e){ e.stopPropagation(); incPop.hidden = !incPop.hidden; });
    document.addEventListener('click', function(e){
      if (!incPop.hidden && !incPop.contains(e.target) && e.target !== incBtn) incPop.hidden = true;
    });
  }

  /* 数据库页 · 「立即同步」（V1 演示：不接创作者后台）
     —— 原来这个按钮没有任何 handler，点了装死。按「不装死」口径给个明确提示。 */
  var syncNow = document.getElementById('syncNow');
  if (syncNow){
    syncNow.addEventListener('click', function(e){
      e.stopPropagation();
      toast('演示数据 · 创作者后台同步还没接入（V1 范围）—— 接上后会调 sync-creator.mjs 拉你账号的真实数据');
    });
  }

  /* 「分析详情」弹窗（数据库 · 内容分析）
     内容 = creator-note-detail 的 4 段 13 项（真实值见 creator-latest.json）。
     ⚠️ 缺口项显式列出，不显示成 0 —— 沿用「空 ≠ 0」这条底线。 */
  var anM = document.getElementById('anModal');
  var anTabs = document.querySelectorAll('#anTabs .subtab');
  document.querySelectorAll('[data-an]').forEach(function(b){
    b.addEventListener('click', function(){ anM.hidden = false; });
  });
  /* 弹窗内子页签：切换时把非当前的 section 收起（第一屏默认「核心数据」） */
  anTabs.forEach(function(t){
    t.addEventListener('click', function(){
      anTabs.forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on');
      ['anCore','anTrend','anSrc','anAud'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.hidden = (id !== t.dataset.anT);
      });
    });
  });
  anM.addEventListener('click', function(e){
    if (e.target === anM || e.target.id === 'anX') anM.hidden = true;
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !anM.hidden) anM.hidden = true;
  });
})();
