
const $ = x => document.getElementById(x);
const API = (window.APP_CONFIG?.API_BASE_URL || '').replace(/\/$/, '');

let token = localStorage.getItem('sf_token');
let state = { completed: [] };
let quizAt = 0;
let quizSelected = null;
let quizAnswers = [null, null, null, null];
let quizConfirmed = [false, false, false, false];
let session = null;
let chatLocked = false;
let pendingRequests = 0;

function loadingState(visible, message = '森林正在傳遞星光，請稍候…') {
  const layer = $('globalLoading');
  if (!layer) return;

  pendingRequests = Math.max(0, pendingRequests + (visible ? 1 : -1));

  if (visible) {
    $('globalLoadingText').textContent = message;
    layer.hidden = false;
    layer.setAttribute('aria-busy', 'true');
  } else if (pendingRequests === 0) {
    layer.hidden = true;
    layer.setAttribute('aria-busy', 'false');
  }
}

function notify(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';

  clearTimeout(window._toast);
  window._toast = setTimeout(() => {
    $('toast').style.display = 'none';
  }, 4000);
}

async function req(path, body, timeout = 60000) {
  if (!API || API.includes('YOUR-SERVICE')) {
    throw Error('請先在 docs/config.js 設定 Render 網址');
  }

  const isChat = path === '/api/guessing/chat';

  if (!isChat) {
    let message = '正在與森林建立連線…';

    if (path.includes('/images/')) {
      message = '正在繪製你的冒險紀念卡，請不要離開…';
    } else if (path.includes('/guessing/')) {
      message = '貓頭鷹賢者正在思考…';
    }

    loadingState(true, message);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  try {
    const response = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });

    const data = await response.json().catch(() => ({}));

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
      throw Error('請求逾時，請稍後確認結果再重試');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (!isChat) loadingState(false);
  }
}

function page(id) {
  if (id !== 'pinball' && active) {
    active = false;
    cancelAnimationFrame(anim);
  }

  document.querySelectorAll('.page').forEach(element => {
    element.classList.toggle('active', element.id === id);
  });

  window.scrollTo(0, 0);

  if (id === 'map') refresh();
  if (id === 'quiz') renderQuiz();
  if (id === 'guessing') startGuess();

  if (id === 'pinball') {
    if (!active) {
      $('gameModal').style.display = 'flex';
      $('gameTitle').textContent = '準備好彈射了嗎？';
      $('gameText').textContent = '拉住下方的星光彈珠，放開發射！';
      $('startGame').textContent = '開始挑戰';
      resetEnemies();
    }

    drawGame();
  }
}

async function refresh() {
  try {
    const data = await req('/api/progress');
    state = data;

    $('who').textContent = data.player_code;
    $('progress').textContent = `${data.completed.length} / 3 星光碎片`;
    $('progressFill').style.width =
      (data.completed.length / 3 * 100) + '%';

    for (const [game, element] of [
      ['pinball', 'donePinball'],
      ['guessing', 'doneGuessing'],
      ['quiz', 'doneQuiz']
    ]) {
      $(element).textContent = data.completed.includes(game)
        ? '✓ 已完成'
        : '';
    }

    $('finalBtn').disabled = data.completed.length !== 3;
    $('finalBtn').textContent = data.completed.length === 3
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

// ===== 登入 =====

$('loginBtn').onclick = async () => {
  const player_code = $('playerCode').value.trim();
  const invite_code = $('inviteCode').value.trim();

  if (!player_code || !invite_code) {
    return notify('請填寫冒險者名字與邀請碼');
  }

  try {
    const data = await req('/api/players/login', {
      player_code,
      invite_code
    });

    token = data.token;
    localStorage.setItem('sf_token', token);
    page('map');
  } catch (error) {
    notify(error.message);
  }
};

$('logoutBtn').onclick = () => {
  token = null;
  localStorage.removeItem('sf_token');
  page('login');
};

document.querySelectorAll('[data-go]').forEach(button => {
  button.onclick = () => page(button.dataset.go);
});

document.querySelectorAll('.back').forEach(button => {
  button.onclick = () => page('map');
});

$('finalBtn').onclick = () => page('final');

// ===== 古樹測驗 =====

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

  $('quizCount').textContent = `0${quizAt + 1} / 04`;
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

  $('confirmQuiz').hidden = quizConfirmed[quizAt];
  $('confirmQuiz').disabled = quizSelected === null;

  $('nextQuiz').hidden = !quizConfirmed[quizAt];
  $('nextQuiz').textContent =
    quizAt === 3 ? '完成試煉' : '下一題 →';

  $('prevQuiz').hidden = quizAt === 0;
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

$('nextQuiz').onclick = async () => {
  if (quizAt === 3) {
    if (quizAnswers.some(answer => answer === null)) {
      return notify('請完成所有選擇');
    }

    try {
      await req('/api/quiz/submit', {
        answers: quizAnswers
      });

      $('quizStatus').textContent =
        '✓ 第三塊星光碎片已收集！';

      quizAt = 0;
      quizSelected = null;
      quizConfirmed = [false, false, false, false];

      page('map');
      notify('古樹試煉完成！已取得星光碎片');
    } catch (error) {
      notify(error.message);
    }
  } else {
    quizAt++;
    quizSelected = quizAnswers[quizAt];
    renderQuiz();
  }
};

// ===== 謎語小屋 =====

function bubble(text, side = 'ai') {
  const element = document.createElement('div');
  element.className = 'bubble ' + side;
  element.textContent = text;

  $('messages').appendChild(element);
  $('messages').scrollTop = $('messages').scrollHeight;

  return element;
}

function typingBubble() {
  const element = document.createElement('div');
  element.className = 'bubble ai typing';
  element.setAttribute('aria-label', '賢者正在打字');

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    element.appendChild(dot);
  }

  $('messages').appendChild(element);
  $('messages').scrollTop = $('messages').scrollHeight;

  return element;
}

async function startGuess(restart = false) {
  if (session && !restart) return;

  session = null;
  $('messages').replaceChildren();

  bubble(
    '我是貓頭鷹賢者。你可以向我提問，但我不會直接告訴你答案。'
  );

  $('chatStatus').textContent = '';
  $('chatInput').disabled = false;
  $('chatSend').disabled = false;

  try {
    const data = await req('/api/guessing/start', { restart });

    session = data.session_id;
    $('remaining').textContent =
      `剩餘 ${data.remaining} 次提問`;

    if (data.completed) {
      $('chatStatus').textContent = '✓ 已完成本關';
    }
  } catch (error) {
    notify(error.message);
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
    const data = await req('/api/guessing/chat', {
      session_id: session,
      message
    }, 65000);

    loading.remove();
    bubble(data.reply);

    $('remaining').textContent =
      `剩餘 ${data.remaining} 次提問`;
  } catch (error) {
    loading.remove();
    notify(error.message);

    bubble('抱歉，我剛才走神了。請再試一次。');
  } finally {
    chatLocked = false;
    $('chatSend').disabled = false;
  }
};

$('chatInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    $('chatSend').click();
  }
});

$('guessSend').onclick = async () => {
  const answer = $('guessInput').value.trim();
  if (!answer || !session) return;

  const button = $('guessSend');
  button.disabled = true;

  try {
    const data = await req('/api/guessing/answer', {
      session_id: session,
      answer
    });

    bubble('我猜：' + answer, 'user');

    bubble(
      data.correct
        ? '猜對了！你得到第二塊碎片。'
        : '還不對，再試試吧。'
    );

    if (data.correct) {
      $('chatStatus').textContent = '✓ 通關成功';
      session = null;

      setTimeout(() => {
        page('map');
        notify('謎語小屋通關成功！');
      }, 550);
    }
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};

$('restartGuess').onclick = () => startGuess(true);

// ===== AI 生圖 =====
// 保留原本後端 API，不修改模型或 Prompt。

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
    $('imageStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

// =====================================================
// 第一關：星隕彈珠台
// 本版完全取消自動追蹤，彈珠方向只受玩家發射與碰撞影響
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

// 物理參數
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

  // 遊戲邊界
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

  // 怪物與血條
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

    // 血條背景
    cx.fillStyle = '#243e32';
    cx.fillRect(
      enemy.x - enemy.r,
      enemy.y - enemy.r - 13,
      enemy.r * 2,
      7
    );

    // 剩餘血量
    cx.fillStyle = '#9cde83';
    cx.fillRect(
      enemy.x - enemy.r,
      enemy.y - enemy.r - 13,
      enemy.r * 2 * enemy.hp / enemy.max,
      7
    );
  }

  // 瞄準線：完全由玩家的拖曳決定
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

  // 撞擊粒子
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

  // 傷害文字
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
  // 撞擊粒子
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 1;

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

  // 傷害數字
  floating.push({
    x,
    y: y - 15,
    text,
    life: 38
  });

  // 手機震動
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

  // 只根據拖曳方向決定發射方向
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

  // 發射超過指定時間就返回發射器
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

  for (let k = 0; k < Math.ceil(step); k++) {
    if (
      Math.abs(orb.vx) +
      Math.abs(orb.vy) > 0.12
    ) {

      // =======================================
      // 純物理移動：沒有任何自動追蹤
      // =======================================

      orb.x += orb.vx;
      orb.y += orb.vy;

      // 左右牆壁反彈
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

      // 上下牆壁反彈
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

      // 速度緩慢衰減
      orb.vx *= FRICTION;
      orb.vy *= FRICTION;

      // 撞擊怪物
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

          // 避免彈珠卡在怪物內
          orb.x = enemy.x +
            nx * (orb.r + enemy.r + 1);

          orb.y = enemy.y +
            ny * (orb.r + enemy.r + 1);

          if (dot < 0) {
            // 根據碰撞法線反射
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

            // 擊敗所有怪物才算過關
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

      // 速度過低時自動返回發射器
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

  // 更新撞擊粒子
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

  // 通關時分數遞增至 1000
  const initial = Math.min(
    score,
    999
  );

  const begin = performance.now();

  await new Promise(resolve => {
    function tick(time) {
      const progress = Math.min(
        (time - begin) / 550,
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

  $('gameStatus').textContent =
    '怪物全部擊敗！正在儲存通關紀錄…';

  try {
    await req('/api/pinball/submit', {
      score: 1000,
      attempt_id: attempt
    });

    page('map');
    notify('星隕彈珠台通關！獲得 1000 分');
  } catch (error) {
    $('gameStatus').textContent =
      '通關紀錄儲存失敗：' +
      error.message +
      '。請按「重試儲存」。';

    $('retryPinball').hidden = false;
  }
}

$('retryPinball').onclick = async () => {
  const button = $('retryPinball');
  button.disabled = true;

  try {
    await req('/api/pinball/submit', {
      score: 1000,
      attempt_id: attempt
    });

    button.hidden = true;

    page('map');
    notify('通關紀錄已成功儲存');
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};

// ===== 手機拖曳彈射 =====

canvas.addEventListener('pointerdown', event => {
  if (
    !active ||
    finish ||
    Math.hypot(orb.vx, orb.vy) > 0.2
  ) return;

  const rect = canvas.getBoundingClientRect();

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
    canvas.setPointerCapture(
      event.pointerId
    );
  }
});

canvas.addEventListener('pointermove', event => {
  if (!drag) return;

  const rect = canvas.getBoundingClientRect();

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

// ===== 自動恢復登入 =====

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
