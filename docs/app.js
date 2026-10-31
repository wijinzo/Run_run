
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
let currentPage = 'login';

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

const npcStyle = document.createElement('style');

npcStyle.textContent = `
  .npc-overlay {
    position: fixed;
    inset: 0;
    z-index: 9990;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    background: rgba(9, 30, 26, .55);
    backdrop-filter: blur(3px);
    padding: 20px;
  }

  .npc-dialog {
    width: 100%;
    max-width: 440px;
    background: #fff8df;
    color: #30483b;
    border: 3px solid #c4a66e;
    border-radius: 22px;
    padding: 24px 21px;
    box-shadow: 0 12px 35px #102c2980;
    cursor: pointer;
    animation: npcAppear .25s ease-out;
    position: relative;
  }

  .npc-dialog:focus-visible {
    outline: 3px solid #2a785d;
    outline-offset: 4px;
  }

  .npc-dialog-head {
    display: flex;
    align-items: center;
    gap: 13px;
    margin-bottom: 16px;
  }

  .npc-dialog-avatar {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: #dceacb;
    display: grid;
    place-items: center;
    font-size: 30px;
    flex-shrink: 0;
  }

  .npc-dialog-name {
    font-size: 16px;
    font-weight: 900;
    color: #28533d;
  }

  .npc-dialog-tag {
    font-size: 11px;
    color: #879783;
    margin-top: 3px;
  }

  .npc-dialog-text {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.9;
    margin: 0 0 18px;
    color: #334a3d;
  }

  .npc-dialog-status {
    font-size: 12px;
    color: #6a7e6b;
    text-align: right;
    min-height: 20px;
  }

  .npc-dialog-status.error {
    color: #b24f38;
  }

  .npc-dialog-arrow {
    color: #9e814e;
    display: inline-block;
    animation: npcBounce .7s infinite alternate;
  }

  @keyframes npcAppear {
    from {
      opacity: 0;
      transform: translateY(25px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes npcBounce {
    to {
      transform: translateY(5px);
    }
  }
`;

document.head.appendChild(npcStyle);

let npcDialog = null;

/*
  saveTask 是一個函式：
    () => Promise

  對話立即出現。
  背景同時執行 saveTask。
  點擊對話框才返回地圖。

  如果儲存未完成：
    記住點擊動作，完成後返回。

  如果失敗：
    保留對話框，點擊可重試。
*/

function showNpcDialog({
  name,
  icon,
  message,
  saveTask = null
}) {
  if (npcDialog) {
    npcDialog.overlay.remove();
    npcDialog = null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'npc-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'npc-dialog';
  dialog.setAttribute('role', 'button');
  dialog.setAttribute('tabindex', '0');

  dialog.innerHTML = `
    <div class="npc-dialog-head">
      <div class="npc-dialog-avatar"></div>
      <div>
        <div class="npc-dialog-name"></div>
        <div class="npc-dialog-tag">
          星光碎片已取得
        </div>
      </div>
    </div>

    <p class="npc-dialog-text"></p>

    <div class="npc-dialog-status">
      正在記錄星光碎片…
    </div>
  `;

  dialog.querySelector(
    '.npc-dialog-avatar'
  ).textContent = icon;

  dialog.querySelector(
    '.npc-dialog-name'
  ).textContent = name;

  dialog.querySelector(
    '.npc-dialog-text'
  ).textContent = `「${message}」`;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const status = dialog.querySelector(
    '.npc-dialog-status'
  );

  const record = {
    overlay,
    saved: !saveTask,
    saving: false,
    error: null,
    wantsReturn: false
  };

  npcDialog = record;

  function updateStatus() {
    status.classList.remove('error');

    if (record.saving) {
      status.textContent =
        record.wantsReturn
          ? '星光碎片記錄中，完成後自動返回…'
          : '點擊對話繼續 · 正在記錄…';

    } else if (record.error) {
      status.classList.add('error');
      status.textContent =
        '儲存失敗，點擊此處重試';

    } else {
      status.innerHTML =
        '點擊對話，繼續冒險 ' +
        '<span class="npc-dialog-arrow">▼</span>';
    }
  }

  function returnMap() {
    if (npcDialog !== record) return;

    overlay.remove();
    npcDialog = null;

    page('map');
  }

  async function startSave() {
    if (!saveTask || record.saving) return;

    record.saving = true;
    record.error = null;

    updateStatus();

    try {
      await saveTask();

      record.saved = true;
      record.error = null;

      updateStatus();

      if (record.wantsReturn) {
        returnMap();
      }

    } catch (error) {
      record.error = error;
      record.wantsReturn = false;

      updateStatus();

    } finally {
      record.saving = false;
      updateStatus();
    }
  }

  function advance() {
    if (record.saved) {
      returnMap();
      return;
    }

    if (record.error) {
      startSave();
      return;
    }

    record.wantsReturn = true;
    updateStatus();
  }

  dialog.addEventListener('click', advance);

  dialog.addEventListener('keydown', event => {
    if (
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      advance();
    }
  });

  updateStatus();

  if (saveTask) {
    startSave();
  }

  return record;
}

// =====================================================
// 畫面切換
// =====================================================

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
  page('login');
};

document.querySelectorAll('[data-go]').forEach(
  button => {
    button.onclick = () => {
      page(button.dataset.go);
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
// 完全保留原本後端模型與 Prompt
// =====================================================

$('generate').onclick = async () => {
  const button = $('generate');

  button.disabled = true;

  $('imageStatus').textContent =
    '星光正在凝聚，請不要重複點擊…';

  try {
    const data = await req(
      '/api/images/generate',
      {},
      170000
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

const WIDTH = 360;
const HEIGHT = 540;

const origin = {
  x: 180,
  y: 470
};

let active = false;
let drag = false;

let aim = {
  x: 0,
  y: 0
};

let orb = {
  x: origin.x,
  y: origin.y,
  vx: 0,
  vy: 0,
  r: 13
};

let enemies = [];
let particles = [];
let floating = [];

let shots = 0;
let damage = 0;
let score = 0;
let combo = 0;

let attempt = '';
let lastTime = 0;
let anim = 0;
let finish = false;
let shotElapsed = 0;

// 遊戲物理設定
const LAUNCH_SPEED = 22;
const FRICTION = 0.9988;
const WALL_BOUNCE = 0.98;
const ENEMY_BOUNCE = 1.12;
const MAX_SHOT_TIME = 4300;

function resetEnemies() {
  enemies = [
    {
      x: 78,
      y: 124,
      r: 25,
      hp: 2,
      max: 2
    },
    {
      x: 278,
      y: 160,
      r: 25,
      hp: 2,
      max: 2
    },
    {
      x: 180,
      y: 270,
      r: 27,
      hp: 3,
      max: 3
    }
  ];

  particles = [];
  floating = [];

  score = 0;
  shots = 0;
  combo = 0;
  damage = 0;

  finish = false;
  shotElapsed = 0;

  orb = {
    x: origin.x,
    y: origin.y,
    vx: 0,
    vy: 0,
    r: 13
  };

  $('score').textContent = '0';
  $('enemyCount').textContent = '3';
}

function drawGame() {
  cx.clearRect(0, 0, WIDTH, HEIGHT);

  const gradient = cx.createLinearGradient(
    0, 0, 0, HEIGHT
  );

  gradient.addColorStop(0, '#346857');
  gradient.addColorStop(1, '#163c35');

  cx.fillStyle = gradient;
  cx.fillRect(0, 0, WIDTH, HEIGHT);

  // 背景星點
  for (let i = 0; i < 30; i++) {
    const x = i * 79 % WIDTH;
    const y = i * 131 % HEIGHT;

    cx.fillStyle = '#abcf9c88';

    cx.beginPath();
    cx.arc(x, y, 1.6, 0, Math.PI * 2);
    cx.fill();
  }

  // 邊界
  cx.strokeStyle = '#a1bb80';
  cx.lineWidth = 6;
  cx.strokeRect(8, 8, 344, 524);

  // 發射器
  cx.fillStyle = '#7dae84';

  cx.beginPath();
  cx.arc(
    origin.x,
    origin.y,
    28,
    0,
    Math.PI * 2
  );
  cx.fill();

  // 怪物
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;

    cx.fillStyle = '#f1b36e';

    cx.beginPath();
    cx.arc(
      enemy.x,
      enemy.y,
      enemy.r,
      0,
      Math.PI * 2
    );
    cx.fill();

    // 眼睛
    cx.fillStyle = '#35453a';

    cx.beginPath();
    cx.arc(
      enemy.x - 9,
      enemy.y - 4,
      4,
      0,
      Math.PI * 2
    );
    cx.arc(
      enemy.x + 9,
      enemy.y - 4,
      4,
      0,
      Math.PI * 2
    );
    cx.fill();

    // 血條底色
    cx.fillStyle = '#243e32';

    cx.fillRect(
      enemy.x - enemy.r,
      enemy.y - enemy.r - 13,
      enemy.r * 2,
      7
    );

    // 血量
    cx.fillStyle = '#9cde83';

    cx.fillRect(
      enemy.x - enemy.r,
      enemy.y - enemy.r - 13,
      enemy.r * 2 * enemy.hp / enemy.max,
      7
    );
  }

  // 瞄準線
  if (drag) {
    cx.setLineDash([7, 8]);
    cx.strokeStyle = '#ffe7a4';
    cx.lineWidth = 3;

    cx.beginPath();
    cx.moveTo(orb.x, orb.y);

    cx.lineTo(
      orb.x + aim.x * 2.5,
      orb.y + aim.y * 2.5
    );

    cx.stroke();
    cx.setLineDash([]);
  }

  // 彈珠
  cx.fillStyle = '#f9d878';
  cx.shadowColor = '#ffdd82';
  cx.shadowBlur = 18;

  cx.beginPath();
  cx.arc(
    orb.x,
    orb.y,
    orb.r,
    0,
    Math.PI * 2
  );
  cx.fill();

  cx.shadowBlur = 0;

  // 粒子
  for (const particle of particles) {
    cx.globalAlpha = Math.max(
      0,
      particle.life / 22
    );

    cx.fillStyle = particle.color;

    cx.beginPath();
    cx.arc(
      particle.x,
      particle.y,
      particle.r,
      0,
      Math.PI * 2
    );
    cx.fill();
  }

  cx.globalAlpha = 1;

  // 傷害數字
  cx.font = 'bold 17px sans-serif';

  for (const item of floating) {
    cx.fillStyle = '#ffe7ab';

    cx.fillText(
      item.text,
      item.x,
      item.y
    );
  }

  // Combo
  if (combo >= 2) {
    cx.fillStyle = '#ffeab1';
    cx.font = 'bold 21px sans-serif';

    cx.fillText(
      `COMBO ×${combo}`,
      117,
      48
    );
  }
}

function effects(x, y, text) {
  for (let i = 0; i < 16; i++) {
    const angle =
      Math.random() * Math.PI * 2;

    const speed =
      Math.random() * 4 + 1;

    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: Math.random() * 3 + 2,
      life: 22,

      color: i % 2
        ? '#ffcd75'
        : '#eaf8bc'
    });
  }

  floating.push({
    x,
    y: y - 15,
    text,
    life: 38
  });

  if (navigator.vibrate) {
    navigator.vibrate(16);
  }
}

function launch() {
  if (!drag || !active || finish) return;

  drag = false;

  const magnitude = Math.hypot(
    aim.x,
    aim.y
  );

  if (magnitude < 10) return;

  const power = Math.min(
    LAUNCH_SPEED,
    magnitude * 0.23
  );

  orb.vx = aim.x / magnitude * power;
  orb.vy = aim.y / magnitude * power;

  shots++;
  combo = 0;
  shotElapsed = 0;

  $('recallOrb').disabled = false;
}

function update(dt) {
  if (!active || finish) return;

  const moving = Math.hypot(
    orb.vx,
    orb.vy
  ) > 0.2;

  if (moving) {
    shotElapsed += Math.min(dt, 33);

    if (shotElapsed > MAX_SHOT_TIME) {
      recallOrb();
      return;
    }
  }

  const step = Math.min(
    dt / 16.67,
    2
  );

  for (
    let k = 0;
    k < Math.ceil(step);
    k++
  ) {
    if (
      Math.abs(orb.vx) +
      Math.abs(orb.vy) > 0.12
    ) {

      // 純物理移動，不追蹤怪物
      orb.x += orb.vx;
      orb.y += orb.vy;

      // 左右牆
      if (
        orb.x < orb.r + 14 ||
        orb.x > WIDTH - orb.r - 14
      ) {
        orb.vx *= -WALL_BOUNCE;

        orb.x = Math.max(
          orb.r + 14,
          Math.min(
            WIDTH - orb.r - 14,
            orb.x
          )
        );
      }

      // 上下牆
      if (
        orb.y < orb.r + 14 ||
        orb.y > HEIGHT - orb.r - 14
      ) {
        orb.vy *= -WALL_BOUNCE;

        orb.y = Math.max(
          orb.r + 14,
          Math.min(
            HEIGHT - orb.r - 14,
            orb.y
          )
        );
      }

      // 速度衰減
      orb.vx *= FRICTION;
      orb.vy *= FRICTION;

      // 怪物碰撞
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;

        const dx = orb.x - enemy.x;
        const dy = orb.y - enemy.y;

        const distance = Math.hypot(
          dx,
          dy
        );

        if (
          distance < orb.r + enemy.r &&
          distance > 0
        ) {
          const nx = dx / distance;
          const ny = dy / distance;

          const dot =
            orb.vx * nx +
            orb.vy * ny;

          // 防止陷入怪物
          orb.x =
            enemy.x +
            nx * (orb.r + enemy.r + 1);

          orb.y =
            enemy.y +
            ny * (orb.r + enemy.r + 1);

          if (dot < 0) {
            // 正常物理反射
            orb.vx = (
              orb.vx - 2 * dot * nx
            ) * ENEMY_BOUNCE;

            orb.vy = (
              orb.vy - 2 * dot * ny
            ) * ENEMY_BOUNCE;

            enemy.hp--;
            combo++;
            damage++;

            score += combo > 1
              ? 85
              : 60;

            $('score').textContent =
              Math.min(score, 999);

            effects(
              enemy.x,
              enemy.y,
              '-1 HP'
            );

            $('enemyCount').textContent =
              enemies.filter(
                enemy => enemy.hp > 0
              ).length;

            // 所有怪物死亡
            if (
              enemies.every(
                enemy => enemy.hp <= 0
              )
            ) {
              winGame();
              return;
            }
          }
        }
      }

      // 速度太低時召回
      if (
        Math.hypot(
          orb.vx,
          orb.vy
        ) < 0.16
      ) {
        recallOrb();
      }
    }
  }

  // 更新粒子
  particles = particles.filter(
    particle => particle.life-- > 0
  );

  for (const particle of particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;

    particle.vx *= 0.95;
    particle.vy *= 0.95;
  }

  // 更新傷害文字
  floating = floating.filter(
    item => item.life-- > 0
  );

  for (const item of floating) {
    item.y -= 0.7;
  }
}

function recallOrb() {
  if (!active || finish) return;

  orb.x = origin.x;
  orb.y = origin.y;
  orb.vx = 0;
  orb.vy = 0;

  shotElapsed = 0;
  drag = false;

  $('recallOrb').disabled = true;
}

$('recallOrb').onclick = recallOrb;

function loop(time) {
  if (!active) return;

  update(time - lastTime || 16);
  lastTime = time;

  drawGame();

  if (active) {
    anim = requestAnimationFrame(loop);
  }
}

function startGame() {
  cancelAnimationFrame(anim);

  resetEnemies();

  active = true;

  $('gameModal').style.display = 'none';

  attempt = crypto.randomUUID();
  lastTime = 0;

  $('recallOrb').disabled = true;
  $('retryPinball').hidden = true;
  $('gameStatus').textContent = '';

  anim = requestAnimationFrame(loop);
}

async function winGame() {
  if (finish) return;

  finish = true;
  active = false;

  cancelAnimationFrame(anim);

  $('recallOrb').disabled = true;

  // 分數快速增加到 1000
  const initial = Math.min(
    score,
    999
  );

  const begin = performance.now();

  await new Promise(resolve => {
    function tick(time) {
      const progress = Math.min(
        (time - begin) / 450,
        1
      );

      const ease =
        1 - (1 - progress) ** 3;

      $('score').textContent = Math.round(
        initial +
        (1000 - initial) * ease
      );

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });

  $('score').textContent = '1000';

  // 保留本次過關 ID
  const completedAttempt = attempt;

  // 立即顯示 NPC 通關對話
  // 同時在背景儲存成績
  showNpcDialog({
    name: '彈珠精靈',
    icon: '✦',

    message:
      '漂亮的一擊！' +
      '星隕之谷的怪物都被你打敗了！' +
      '這塊星光碎片就交給你啦！',

    saveTask: () => req(
      '/api/pinball/submit',
      {
        score: 1000,
        attempt_id: completedAttempt
      }
    )
  });
}

$('retryPinball').onclick = async () => {
  const button = $('retryPinball');

  button.disabled = true;

  try {
    await req(
      '/api/pinball/submit',
      {
        score: 1000,
        attempt_id: attempt
      }
    );

    button.hidden = true;

    page('map');

  } catch (error) {
    notify(error.message);

  } finally {
    button.disabled = false;
  }
};

// =====================================================
// 手機拖曳彈射
// =====================================================

canvas.addEventListener('pointerdown', event => {
  if (
    !active ||
    finish ||
    Math.hypot(orb.vx, orb.vy) > 0.2
  ) {
    return;
  }

  const rect =
    canvas.getBoundingClientRect();

  const x =
    (event.clientX - rect.left) *
    WIDTH / rect.width;

  const y =
    (event.clientY - rect.top) *
    HEIGHT / rect.height;

  if (
    Math.hypot(
      x - orb.x,
      y - orb.y
    ) < 70
  ) {
    drag = true;

    aim = { x: 0, y: 0 };

    canvas.setPointerCapture(
      event.pointerId
    );
  }
});

canvas.addEventListener('pointermove', event => {
  if (!drag) return;

  const rect =
    canvas.getBoundingClientRect();

  const x =
    (event.clientX - rect.left) *
    WIDTH / rect.width;

  const y =
    (event.clientY - rect.top) *
    HEIGHT / rect.height;

  aim = {
    x: Math.max(
      -105,
      Math.min(105, orb.x - x)
    ),

    y: Math.max(
      -105,
      Math.min(105, orb.y - y)
    )
  };
});

canvas.addEventListener('pointerup', launch);

canvas.addEventListener('pointercancel', () => {
  drag = false;
});

$('startGame').onclick = startGame;

resetEnemies();
drawGame();

// =====================================================
// 自動恢復登入
// =====================================================

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
