
const $ = id => document.getElementById(id);

const API = (
  window.APP_CONFIG?.API_BASE_URL || ''
).replace(/\/$/, '');

let token = localStorage.getItem('sf_token');

let state = { completed: [] };
let quizAt = 0;
let quizSelected = null;
let quizAnswers = [null, null, null, null];
let quizConfirmed = [false, false, false, false];

let session = null;
let chatLocked = false;
let pendingRequests = 0;
let currentPage = 'story';

// =====================================================
// 共用工具
// =====================================================

function notify(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';

  clearTimeout(window._toast);

  window._toast = setTimeout(() => {
    $('toast').style.display = 'none';
  }, 3500);
}

function loadingState(show, message = '森林正在處理請求…') {
  const layer = $('globalLoading');
  if (!layer) return;

  pendingRequests = Math.max(
    0,
    pendingRequests + (show ? 1 : -1)
  );

  if (show) {
    $('globalLoadingText').textContent = message;
    layer.hidden = false;
  } else if (pendingRequests === 0) {
    layer.hidden = true;
  }
}

/*
  等待策略：

  一般 API：
    不顯示全畫面等待。

  聊天：
    使用原本的三點打字動畫。

  背景儲存：
    由 NPC 對話框顯示狀態。

  AI 生圖：
    立即顯示全畫面等待動畫。
*/

async function req(path, body, timeout = 60000) {
  if (!API || API.includes('YOUR-SERVICE')) {
    throw Error('請先在 config.js 設定 Render 網址');
  }

  const isImage = path === '/api/images/generate';

  if (isImage) {
    loadingState(
      true,
      '正在繪製你的專屬冒險紀念卡…'
    );
  }

  const ctrl = new AbortController();

  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeout);

  try {
    const response = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',

      headers: {
        'Content-Type': 'application/json',
        ...(token
          ? { Authorization: 'Bearer ' + token }
          : {})
      },

      body: body === undefined
        ? undefined
        : JSON.stringify(body),

      signal: ctrl.signal
    });

    const data = await response.json().catch(
      () => ({})
    );

    if (!response.ok) {
      throw Error(
        typeof data.detail === 'string'
          ? data.detail
          : `HTTP ${response.status}`
      );
    }

    return data;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw Error(
        '請求逾時，請確認結果後再重試'
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);

    if (isImage) {
      loadingState(false);
    }
  }
}

// =====================================================
// NPC 通關對話框
// 不需修改 HTML、CSS
// =====================================================

const NPCS = {
  pinball: { name: '彈珠精靈', image: 'assets/npc-spirit.webp', message: '星屑把谷中的小怪物都喚醒了！你只有三顆星光彈珠，善用反彈與連擊，幫我把散落的星光重新凝聚吧。' },
  guessing: { name: '貓頭鷹賢者', image: 'assets/npc-owl.webp', message: '哦？想帶走星光碎片？先猜出我心裡的秘密吧。你有十次提問的機會……至於我說的話，呵呵，你可得自己判斷。' },
  quiz: { name: '古樹長老', image: 'assets/npc-tree.webp', message: '我在這裡等了幾千年。要取得碎片，就讓我看看你的靈魂吧……先說好，我對你的選擇可能有一點意見。' }
};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let npcDialog = null;

function showNpcDialog({ name, message, saveTask = null, onContinue = () => page('map'), intro = false }) {
  if (npcDialog) return;
  const previousFocus = document.activeElement;
  const overlay = document.createElement('dialog');
  overlay.className = 'npc-overlay';
  overlay.setAttribute('aria-labelledby', 'npcName');
  overlay.setAttribute('aria-describedby', 'npcText');
  overlay.innerHTML = '<div class="npc-dialog"><div class="npc-dialog-head"><img class="npc-dialog-avatar" alt="" width="1254" height="1254"><div><h2 id="npcName"></h2><p class="npc-dialog-tag"></p></div></div><p id="npcText" class="npc-dialog-text"></p><p class="npc-dialog-status" role="status"></p><button class="primary npc-advance">顯示完整對話</button></div>';
  overlay.querySelector('h2').textContent = name;
  overlay.querySelector('img').src = Object.values(NPCS).find(n => n.name === name)?.image || NPCS.pinball.image;
  overlay.querySelector('.npc-dialog-tag').textContent = intro ? '森林守護者' : '星光碎片已取得';
  const text = overlay.querySelector('.npc-dialog-text');
  const status = overlay.querySelector('.npc-dialog-status');
  const button = overlay.querySelector('button');
  const chars = Array.from('「' + message + '」');
  const record = { overlay, saved: !saveTask, saving: false, error: null, wantsReturn: false };
  npcDialog = record;
  let at = 0, timer;
  function update() {
    status.classList.toggle('error', !!record.error);
    status.textContent = record.error ? '儲存失敗：' + record.error.message : record.saving ? '正在記錄星光碎片…' : '';
    button.textContent = at < chars.length ? '顯示完整對話' : record.error ? '重試儲存' : record.wantsReturn ? '記錄完成後繼續…' : intro ? '開始試煉 →' : '返回冒險地圖 →';
  }
  function reveal() { clearInterval(timer); at = chars.length; text.textContent = chars.join(''); update(); }
  function close(next) {
    clearInterval(timer);
    overlay.close(); overlay.remove(); npcDialog = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    next();
  }
  async function save() {
    if (!saveTask || record.saving) return;
    record.saving = true; record.error = null; update();
    try {
      await saveTask(); record.saved = true;
    } catch (error) { record.error = error; record.wantsReturn = false; }
    finally { record.saving = false; update(); }
    if (record.saved && record.wantsReturn) close(onContinue);
  }
  function advance() {
    if (at < chars.length) { reveal(); return; }
    if (record.saved) { close(onContinue); return; }
    if (record.error) { save(); return; }
    record.wantsReturn = true; update();
  }
  button.onclick = advance;
  overlay.querySelector('.npc-dialog-text').onclick = advance;
  overlay.addEventListener('cancel', event => {
    event.preventDefault();
    if (intro) close(() => {});
    else advance();
  });
  document.body.appendChild(overlay);
  overlay.showModal(); button.focus();
  if (reducedMotion.matches) reveal();
  else timer = setInterval(() => { text.textContent = chars.slice(0, ++at).join(''); if (at === chars.length) { clearInterval(timer); update(); } }, 28);
  update(); if (saveTask) save();
  return record;
}


function page(id) {
  if (currentPage === 'pinball' && id !== 'pinball') {
    active = false;
    cancelAnimationFrame(anim);
  }

  currentPage = id;

  document.querySelectorAll('.page').forEach(
    element => {
      element.classList.toggle(
        'active',
        element.id === id
      );
    }
  );

  window.scrollTo(0, 0);
  $(id).querySelector('h1, h2')?.setAttribute('tabindex', '-1');
  $(id).querySelector('h1, h2')?.focus({ preventScroll: true });

  if (id === 'map') {
    refresh();
  }

  if (id === 'quiz') {
    renderQuiz();
  }

  if (id === 'guessing') {
    startGuess();
  }

  if (id === 'pinball') {
    $('gameModal').style.display = 'flex';

    $('gameTitle').textContent =
      '準備好彈射了嗎？';

    $('gameText').textContent =
      '向後拖曳星光彈珠，放開發射！';

    $('startGame').textContent =
      '開始挑戰';

    resetEnemies();
    drawGame();
  }
}

async function refresh() {
  try {
    const data = await req('/api/progress');

    state = data;

    $('who').textContent = data.player_code;

    $('progress').textContent =
      `${data.completed.length} / 3 星光碎片`;

    $('progressFill').style.width =
      `${data.completed.length / 3 * 100}%`;

    const games = [
      ['pinball', 'donePinball'],
      ['guessing', 'doneGuessing'],
      ['quiz', 'doneQuiz']
    ];

    for (const [game, element] of games) {
      document.querySelector('[data-go="' + game + '"]').classList.toggle('completed', data.completed.includes(game));
      $(element).textContent =
        data.completed.includes(game)
          ? '✓ 已完成'
          : '';
    }

    $('finalBtn').disabled =
      data.completed.length !== 3;

    $('finalBtn').textContent =
      data.completed.length === 3
        ? '✦ 修復星之核心'
        : '集齊三塊碎片解鎖紀念卡';

    if (data.image?.url) {
      $('reward').src = data.image.url;
      $('reward').hidden = false;
    }

  } catch (error) {
    notify(error.message);
  }
}

// =====================================================
// 登入
// =====================================================

$('loginBtn').onclick = async () => {
  const player_code =
    $('playerCode').value.trim();

  const invite_code =
    $('inviteCode').value.trim();

  if (!player_code || !invite_code) {
    notify('請填寫冒險者名字與邀請碼');
    return;
  }

  const button = $('loginBtn');
  button.disabled = true;
  button.textContent = '正在進入森林…';

  try {
    const data = await req(
      '/api/players/login',
      { player_code, invite_code }
    );

    token = data.token;
    localStorage.setItem('sf_token', token);

    page('map');

  } catch (error) {
    notify(error.message);

  } finally {
    button.disabled = false;
    button.textContent = '踏入森林 ↗';
  }
};

$('logoutBtn').onclick = () => {
  token = null;
  localStorage.removeItem('sf_token');
  state = { completed: [] }; session = null; chatLocked = false;
  $('who').textContent = ''; $('reward').hidden = true; $('reward').removeAttribute('src');
  $('userNote').value = ''; $('inviteCode').value = '';
  page('login');
};

document.querySelectorAll('[data-go]').forEach(
  button => {
    button.onclick = () => {
      const target = button.dataset.go;
      showNpcDialog({ ...NPCS[target], intro: true, onContinue: () => page(target) });
    };
  }
);

document.querySelectorAll('.back').forEach(
  button => {
    button.onclick = () => page('map');
  }
);

$('finalBtn').onclick = () => page('final');

// =====================================================
// 第三關：古樹的靈魂拷問
// =====================================================

const quiz = [
  {
    q: '咖哩飯，你拌不拌？',
    options: [
      ['拌', '作者不贊同你的選擇。'],
      ['不拌', '作者不贊同你的選擇。']
    ]
  },
  {
    q: '你是什麼學院的？',
    options: [
      ['商學院', '真是高高在上呢。'],
      ['社科院', '有趣。'],
      ['傳院', '有潛力的明日之星。'],
      ['文學院', 'd(･∀･b) 讚讚的。'],
      ['都不是', '抱歉啦，放不下。'],
      ['魔法學院', '別想騙我，麻瓜。']
    ]
  },
  {
    q: '吃布丁會舔蓋子嗎？',
    options: [
      ['舔', '一滴都不浪費，布丁界的守財奴。'],
      ['不舔', '發現有錢人！']
    ]
  },
  {
    q: '哪一句話最讓你有感覺？',
    options: [
      [
        '不戰鬥就無法生存',
        '看來你已經做好戰鬥的覺悟了。'
      ],
      [
        '沒有什麼必須堅持下去的理由，同樣也沒有放棄的理由。',
        '你適合打排球。'
      ],
      [
        '接下來會好轉，然後再變糟，又變好，這就是人生，我不會謊稱日日皆有陽光，不過陽光總會再次照耀，我向你保證，你將再次溫暖',
        '生先於死，力先於弱，旅程先於終點。'
      ],
      [
        '我無法成為主角，也拯救不了任何人，但至少我深深知曉這則故事，也能將這則故事傳遞出去。',
        '救贖的魔王讚賞你的選擇。'
      ]
    ]
  }
];

function renderQuiz() {
  const question = quiz[quizAt];

  $('quizCount').textContent =
    `0${quizAt + 1} / 04`;

  $('question').textContent = question.q;

  $('options').replaceChildren();

  question.options.forEach(([label], index) => {
    const button = document.createElement('button');

    button.textContent = label;

    if (quizSelected === index) {
      button.classList.add('selected');
    }

    button.onclick = () => {
      quizSelected = index;
      quizAnswers[quizAt] = index;
      quizConfirmed[quizAt] = false;

      renderQuiz();
    };

    $('options').appendChild(button);
  });

  $('reply').hidden = !quizConfirmed[quizAt];

  if (quizConfirmed[quizAt]) {
    $('reply').textContent =
      `古樹：「${question.options[quizAnswers[quizAt]][1]}」`;
  }

  $('confirmQuiz').hidden =
    quizConfirmed[quizAt];

  $('confirmQuiz').disabled =
    quizSelected === null;

  $('nextQuiz').hidden =
    !quizConfirmed[quizAt];

  $('nextQuiz').textContent =
    quizAt === 3
      ? '完成試煉'
      : '下一題 →';

  $('prevQuiz').hidden =
    quizAt === 0;
}

$('confirmQuiz').onclick = () => {
  if (quizSelected === null) return;

  quizConfirmed[quizAt] = true;
  renderQuiz();
};

$('prevQuiz').onclick = () => {
  quizAt = Math.max(0, quizAt - 1);

  quizSelected = quizAnswers[quizAt];

  renderQuiz();
};

$('nextQuiz').onclick = () => {
  if (quizAt !== 3) {
    quizAt++;
    quizSelected = quizAnswers[quizAt];
    renderQuiz();
    return;
  }

  if (quizAnswers.some(answer => answer === null)) {
    notify('請完成所有選擇');
    return;
  }

  // 先保存答案快照，避免後續操作改變資料
  const submittedAnswers = [...quizAnswers];

  // 完成測驗立即顯示 NPC
  showNpcDialog({
    name: '古樹長老',
    icon: '🌳',

    message:
      '嗯……真是個有趣的靈魂。' +
      '雖然你的某些選擇讓我難以理解，' +
      '但這最後一塊碎片，是你的了。',

    saveTask: () => req(
      '/api/quiz/submit',
      { answers: submittedAnswers }
    )
  });

  // 下次進來可重新挑戰
  quizAt = 0;
  quizSelected = null;
  quizAnswers = [null, null, null, null];
  quizConfirmed = [false, false, false, false];
};

// =====================================================
// 第二關：謎語小屋
// =====================================================

function bubble(text, side = 'ai') {
  const element = document.createElement('div');

  element.className = 'bubble ' + side;
  element.textContent = text;

  $('messages').appendChild(element);

  $('messages').scrollTop =
    $('messages').scrollHeight;

  return element;
}

function typingBubble() {
  const element = document.createElement('div');

  element.className = 'bubble ai typing';
  element.setAttribute(
    'aria-label',
    '貓頭鷹正在打字'
  );

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    element.appendChild(dot);
  }

  $('messages').appendChild(element);

  $('messages').scrollTop =
    $('messages').scrollHeight;

  return element;
}

async function startGuess(restart = false) {
  if (session && !restart) return;

  session = null;

  $('messages').replaceChildren();

  bubble(
    '我是貓頭鷹賢者。' +
    '你可以向我提問，' +
    '但我不會直接告訴你答案。'
  );

  $('chatStatus').textContent = '';

  $('chatInput').disabled = false;
  $('chatSend').disabled = true;
  $('guessSend').disabled = true;

  $('chatStatus').textContent =
    '貓頭鷹正在準備謎題…';

  try {
    const data = await req(
      '/api/guessing/start',
      { restart }
    );

    session = data.session_id;

    $('remaining').textContent =
      `剩餘 ${data.remaining} 次提問`;

    $('chatStatus').textContent =
      data.completed
        ? '✓ 已完成本關'
        : '';

  } catch (error) {
    $('chatStatus').textContent =
      '謎題載入失敗，可重新開始';

    notify(error.message);

  } finally {
    $('chatSend').disabled = !session;
    $('guessSend').disabled = !session;
  }
}

$('chatSend').onclick = async () => {
  if (chatLocked || !session) return;

  const message = $('chatInput').value.trim();
  if (!message) return;

  chatLocked = true;

  $('chatSend').disabled = true;
  $('chatInput').value = '';

  bubble(message, 'user');

  const loading = typingBubble();

  try {
    const data = await req(
      '/api/guessing/chat',
      { session_id: session, message },
      65000
    );

    loading.remove();

    bubble(data.reply);

    $('remaining').textContent =
      `剩餘 ${data.remaining} 次提問`;

  } catch (error) {
    loading.remove();

    notify(error.message);

    bubble(
      '抱歉，我剛才走神了。請再試一次。'
    );

  } finally {
    chatLocked = false;
    $('chatSend').disabled = false;
  }
};

$('chatInput').addEventListener(
  'keydown',
  event => {
    if (event.key === 'Enter') {
      $('chatSend').click();
    }
  }
);

$('guessSend').onclick = async () => {
  const answer = $('guessInput').value.trim();

  if (!answer || !session) return;

  const button = $('guessSend');
  button.disabled = true;
  button.textContent = '確認中…';

  try {
    const data = await req(
      '/api/guessing/answer',
      {
        session_id: session,
        answer
      }
    );

    bubble('我猜：' + answer, 'user');

    if (data.correct) {
      session = null;

      // 後端已驗證通關，顯示 NPC 對話
      showNpcDialog({
        name: '貓頭鷹賢者',
        icon: '🦉',

        message:
          '居然被你猜中了……' +
          '咳咳，看來你的智慧已經足以' +
          '帶走這塊碎片了。'
      });

    } else {
      bubble('還不對，再試試吧。');
    }

  } catch (error) {
    notify(error.message);

  } finally {
    button.disabled = false;
    button.textContent = '提交答案';
  }
};

$('restartGuess').onclick = () => {
  startGuess(true);
};

// =====================================================
// AI 生圖
// 玩家註解與測驗結果共同決定紀念卡
// =====================================================

$('generate').onclick = async () => {
  const button = $('generate');

  button.disabled = true;

  $('imageStatus').textContent =
    '星光正在凝聚，請不要重複點擊…';

  try {
    const data = await req(
      '/api/images/generate',
      { user_note: $('userNote').value.trim() },
      190000
    );

    $('reward').src = data.url;
    $('reward').hidden = false;

    $('imageStatus').textContent =
      '✦ 你的冒險紀念卡完成了！';

  } catch (error) {
    $('imageStatus').textContent =
      error.message;

  } finally {
    button.disabled = false;
  }
};

// =====================================================
// 第一關：星隕彈珠台
// 無自動追蹤
// =====================================================


const canvas = $('game');
const cx = canvas.getContext('2d');
const WIDTH = 360, HEIGHT = 540;
const origin = { x: 180, y: 470 };
const MAX_SHOT_TIME = 5000;
let active = false, drag = false, finish = false, shotActive = false;
let aim = { x: 0, y: 0 }, orb, enemies = [], particles = [], floating = [];
let score = 0, combo = 0, ballsLeft = 3, attempt = '', anim = 0, lastTime = 0, shotElapsed = 0;
let hitPause = 0, shake = 0;
const bumpers = [{x:35,y:75,r:13},{x:325,y:75,r:13},{x:35,y:265,r:13},{x:325,y:265,r:13}];
const rand = (min,max) => min + Math.random() * (max-min);

function spawnEnemy(enemy) {
  // Avoid overlaps so the orb cannot get trapped inside stacked monsters.
  for (let tries = 0; tries < 60; tries++) {
    const x = rand(68,292), y = rand(100,330);
    if (!enemies.some(e => e !== enemy && e.hp > 0 && Math.hypot(x-e.x,y-e.y) < enemy.r+e.r+15)) {
      enemy.x=x; enemy.y=y; enemy.hp=enemy.max; enemy.flash=0; return;
    }
  }
  enemy.respawn=performance.now()+200;
}
function resetOrb() {
  orb = { ...origin, vx:0, vy:0, r:13, trail:[] };
  shotActive=false; shotElapsed=0; drag=false; combo=0;
  $('recallOrb').disabled=true;
  $('launchOrb').disabled=!active || finish || ballsLeft <= 0;
}
function resetEnemies() {
  active=false; finish=false; score=0; ballsLeft=3; combo=0; hitPause=0; shake=0;
  enemies = [
    {x:78,y:120,r:23,hp:2,max:2,rare:false},
    {x:280,y:155,r:23,hp:2,max:2,rare:false},
    {x:180,y:275,r:25,hp:2,max:2,rare:false},
    {x:290,y:295,r:18,hp:1,max:1,rare:true}
  ];
  particles=[]; floating=[];
  $('score').textContent='—'; $('ballsLeft').textContent='3';
  $('gameStatus').textContent='盡情彈射！完成三次彈射，凝聚星光碎片。';
  resetOrb();
}
function burst(x,y,color) {
  if (reducedMotion.matches) return;
  for (let i=0;i<12;i++) {
    const a=rand(0,Math.PI*2), speed=rand(40,170);
    particles.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:.35,color});
  }
}
function hitFeedback(text,x,y) {
  floating.push({x,y,text,life:.8});
}
function finishShot() {
  resetOrb();
  if (ballsLeft <= 0 && !finish) {
    winGame();
  }
}
function recallOrb() { if (active && shotActive && !finish) finishShot(); }
$('recallOrb').onclick=recallOrb;
function launchVector(dx,dy) {
  if (!active || finish || shotActive || ballsLeft <= 0) return;
  const length=Math.hypot(dx,dy); if (length < 8) return;
  const speed=1400;
  orb.vx=dx/length*speed; orb.vy=dy/length*speed;
  drag=false; shotActive=true; combo=0; shotElapsed=0; ballsLeft--;
  $('ballsLeft').textContent=String(ballsLeft);
  $('recallOrb').disabled=false; $('launchOrb').disabled=true;
}
function launch() { if (drag) { launchVector(aim.x,aim.y); drag=false; } }
function launchAngle() {
  const angle=Number($('launchAngle').value)*Math.PI/180;
  launchVector(Math.sin(angle)*100,-Math.cos(angle)*100);
}
$('launchOrb').onclick=launchAngle;
$('launchAngle').oninput=() => {
  const angle=Number($('launchAngle').value);
  $('angleLabel').textContent=angle===0?'正前方':(angle<0?'左':'右')+Math.abs(angle)+'°';
  if (!shotActive) drawGame();
};
canvas.addEventListener('keydown', event => {
  if (['ArrowLeft','ArrowRight',' '].includes(event.key)) {
    event.preventDefault();
    if (event.key===' ') launchAngle();
    else { $('launchAngle').value=String(Math.max(-70,Math.min(70,Number($('launchAngle').value)+(event.key==='ArrowLeft'?-5:5)))); $('launchAngle').oninput(); }
  }
});
function collide(target, multiplier, monster) {
  const dx=orb.x-target.x, dy=orb.y-target.y, distance=Math.hypot(dx,dy);
  const radius=orb.r+target.r;
  if (distance >= radius) return;
  const nx=distance ? dx/distance : 0, ny=distance ? dy/distance : -1;
  orb.x=target.x+nx*(radius+.1); orb.y=target.y+ny*(radius+.1);
  const dot=orb.vx*nx+orb.vy*ny;
  if (dot>=0) return;
  orb.vx=(orb.vx-2*dot*nx)*multiplier; orb.vy=(orb.vy-2*dot*ny)*multiplier;
  const speed=Math.hypot(orb.vx,orb.vy), capped=Math.min(1900,Math.max(1100,speed));
  orb.vx*=capped/speed; orb.vy*=capped/speed;
  burst(target.x,target.y,monster && target.rare?'#ffe599':'#bddecc');
  if (!monster) return;
  target.hp--; target.flash=.09; combo++;
  hitPause=32; shake=reducedMotion.matches?0:4;
  hitFeedback('命中',target.x,target.y-20);
  if (target.hp<=0) {
    target.respawn=performance.now()+(target.rare?1400:800);
    hitFeedback(target.rare?'稀有擊倒！':'擊倒！',target.x,target.y-35);
  }
}
function update(dt,now) {
  for (const e of enemies) {
    if (e.hp<=0 && now>=e.respawn) spawnEnemy(e);
    e.flash=Math.max(0,(e.flash||0)-dt/1000);
  }
  particles=particles.filter(p=>(p.life-=dt/1000)>0);
  for(const p of particles){p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;}
  floating=floating.filter(f=>(f.life-=dt/1000)>0);
  for(const f of floating) f.y-=dt*.025;
  shake=Math.max(0,shake-dt*.04);
  if(!shotActive) return;
  shotElapsed+=dt;
  if(shotElapsed>=MAX_SHOT_TIME){finishShot();return;}
  if(hitPause>0){hitPause=Math.max(0,hitPause-dt);return;}
  // Small integration steps prevent tunneling through a monster at high speed.
  const steps=Math.ceil(dt/3), step=dt/steps/1000;
  for(let i=0;i<steps;i++){
    orb.x+=orb.vx*step; orb.y+=orb.vy*step;
    if(orb.x<27){orb.x=27;orb.vx=Math.abs(orb.vx);}
    if(orb.x>WIDTH-27){orb.x=WIDTH-27;orb.vx=-Math.abs(orb.vx);}
    if(orb.y<27){orb.y=27;orb.vy=Math.abs(orb.vy);}
    if(orb.y>HEIGHT-27){orb.y=HEIGHT-27;orb.vy=-Math.abs(orb.vy);}
    for(const b of bumpers) collide(b,1.04,false);
    for(const e of enemies) if(e.hp>0) collide(e,1.06,true);
  }
  orb.trail.push({x:orb.x,y:orb.y}); if(orb.trail.length>14)orb.trail.shift();
}
function circle(x,y,r,color) { cx.fillStyle=color;cx.beginPath();cx.arc(x,y,r,0,Math.PI*2);cx.fill(); }
function drawGame() {
  cx.save();
  if(shake)cx.translate(rand(-shake,shake),rand(-shake,shake));
  const gradient=cx.createLinearGradient(0,0,0,HEIGHT);
  gradient.addColorStop(0,'#344f4c');gradient.addColorStop(1,'#182f30');
  cx.fillStyle=gradient;cx.fillRect(0,0,WIDTH,HEIGHT);
  for(let i=0;i<30;i++)circle(i*79%WIDTH,i*131%HEIGHT,1.3,'#b4c9b588');
  cx.strokeStyle='#acbd9e';cx.lineWidth=4;cx.strokeRect(12,12,336,516);
  for(const b of bumpers){circle(b.x,b.y,b.r,'#94b6b2');circle(b.x,b.y,5,'#e7efdc');}
  circle(origin.x,origin.y,27,'#66836c');
  for(const e of enemies){
    if(e.hp<=0)continue;
    circle(e.x,e.y,e.r,e.flash>0?'#fffbe2':e.rare?'#e6c47d':'#b5c4a2');
    circle(e.x-7,e.y-3,3,'#30493f');circle(e.x+7,e.y-3,3,'#30493f');
    cx.fillStyle='#142d29';cx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2,4);
    cx.fillStyle='#ebdca7';cx.fillRect(e.x-e.r,e.y-e.r-10,e.r*2*e.hp/e.max,4);
    if(e.rare){cx.fillStyle='#fff3c6';cx.font='12px sans-serif';cx.textAlign='center';cx.fillText('稀有',e.x,e.y+e.r+15);}
  }
  if(!reducedMotion.matches)orb.trail.forEach((p,i)=>{cx.globalAlpha=i/orb.trail.length*.35;circle(p.x,p.y,7,'#f1d999');});
  cx.globalAlpha=1;
  if(drag || (!shotActive && active)){
    const angle=Number($('launchAngle').value)*Math.PI/180;
    const dx=drag?aim.x:Math.sin(angle)*80, dy=drag?aim.y:-Math.cos(angle)*80;
    cx.setLineDash([6,7]);cx.strokeStyle='#e6d9ad';cx.lineWidth=2;cx.beginPath();cx.moveTo(orb.x,orb.y);cx.lineTo(orb.x+dx*2,orb.y+dy*2);cx.stroke();cx.setLineDash([]);
  }
  circle(orb.x,orb.y,orb.r,'#f6d995');circle(orb.x-3,orb.y-4,4,'#fff4cd');
  for(const p of particles){cx.globalAlpha=p.life/.35;circle(p.x,p.y,2,p.color);}
  cx.globalAlpha=1;cx.textAlign='center';cx.font='bold 17px sans-serif';cx.fillStyle='#ffebae';
  for(const f of floating)cx.fillText(f.text,f.x,f.y);
  if(combo>=2){cx.font='bold 23px sans-serif';cx.fillText('COMBO ×'+combo,WIDTH/2,50);}
  cx.restore();
}
function loop(time){
  if(!active)return;
  const dt=Math.min(32,lastTime?time-lastTime:16);lastTime=time;
  update(dt,time);drawGame();
  if(active)anim=requestAnimationFrame(loop);
}
function startGame(){
  cancelAnimationFrame(anim);resetEnemies();active=true;lastTime=0;attempt=crypto.randomUUID();
  $('gameModal').style.display='none';$('launchOrb').disabled=false;
  anim=requestAnimationFrame(loop);
}
function winGame(){
  if(finish || ballsLeft > 0 || shotActive)return;
  finish=true;active=false;shotActive=false;cancelAnimationFrame(anim);
  $('recallOrb').disabled=true;$('launchOrb').disabled=true;
  score=1000+Math.floor(Math.random()*51)*10;
  $('score').textContent=String(score);
  $('gameStatus').textContent='三次彈射完成！獲得 '+score+' 分。';
  const finalScore=score, completedAttempt=attempt;
  showNpcDialog({
    name:'彈珠精靈',
    message:'三次彈射完成！散落的星屑終於凝聚成碎片了。這一塊，歸你了！你獲得了 '+finalScore+' 分作為冒險紀念。',
    saveTask:()=>req('/api/pinball/submit',{score:finalScore,attempt_id:completedAttempt})
  });
}
canvas.addEventListener('pointerdown',event=>{
  if(!active||finish||shotActive||ballsLeft<=0)return;
  const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*WIDTH/rect.width,y=(event.clientY-rect.top)*HEIGHT/rect.height;
  if(Math.hypot(x-orb.x,y-orb.y)<70){drag=true;aim={x:0,y:0};canvas.setPointerCapture(event.pointerId);}
});
canvas.addEventListener('pointermove',event=>{
  if(!drag)return;
  const rect=canvas.getBoundingClientRect();
  aim={x:Math.max(-110,Math.min(110,orb.x-(event.clientX-rect.left)*WIDTH/rect.width)),y:Math.max(-110,Math.min(110,orb.y-(event.clientY-rect.top)*HEIGHT/rect.height))};
});
canvas.addEventListener('pointerup',launch);
canvas.addEventListener('pointercancel',()=>{drag=false;});
canvas.addEventListener('lostpointercapture',()=>{drag=false;});
$('startGame').onclick=startGame;
resetEnemies();drawGame();


const storyFrames = [
  ['曾經的星光森林', '很久以前，星光森林的夜空中，懸掛著一顆永不熄滅的星星。人們稱它為「星之核心」，它的光芒守護著森林裡的一切。', '星之核心照亮寧靜的森林與溪流'],
  ['星之核心碎裂', '然而某個夜晚，一聲巨響劃破天際。星之核心突然碎裂，化作三道流星，墜落在森林深處。失去星光的森林，漸漸暗了下來。', '三塊星光碎片劃過夜空'],
  ['三道試煉', '碎片散落在星隕之谷、謎語小屋，以及古樹的根系深處。想找回星光，就得通過森林守護者們的考驗。', '星隕之谷、謎語小屋與智慧古樹'],
  ['冒險開始', '如今，森林正等待一位新的冒險者。找回三塊星光碎片，讓夜空重新閃耀。那麼，你準備好了嗎？', '精靈在發光的森林小徑等待冒險者']
];
let storyAt = 0;
function renderStory() {
  const [title, text, alt] = storyFrames[storyAt];
  $('storyTitle').textContent = title; $('storyText').textContent = text;
  $('storyArt').src = 'assets/story-0' + (storyAt + 1) + '.webp';
  $('storyArt').alt = alt;
  $('storyCount').textContent = '序章 · 0' + (storyAt + 1) + ' / 04';
  $('prevStory').disabled = storyAt === 0;
  $('nextStory').textContent = storyAt === 3 ? '準備出發 →' : '繼續故事 →';
  // Only preload the next frame, keeping the initial download small.
  if (storyAt < 3) { const image = new Image(); image.src = 'assets/story-0' + (storyAt + 2) + '.webp'; }
}
function nextStory() {
  if (storyAt === 3) { page('login'); return; }
  storyAt++; renderStory();
}
$('nextStory').onclick = nextStory;
$('storyArtButton').onclick = nextStory;
$('prevStory').onclick = () => { if (storyAt > 0) { storyAt--; renderStory(); } };
$('skipStory').onclick = () => page('login');
$('replayStory').onclick = () => { storyAt = 0; renderStory(); page('story'); };
renderStory();

(async () => {
  if (!token) return;

  try {
    await req('/api/players/me');
    page('map');

  } catch (error) {
    token = null;

    localStorage.removeItem('sf_token');

    page('login');
  }
})();
