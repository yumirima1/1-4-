const games = [
  {
    id: 'number-guess',
    name: '数字当て',
    description: '1〜30の数字を5回以内に当てよう。',
    play(stage, schedule, onPoint) {
      const answer = Math.floor(Math.random() * 30) + 1;
      let attempts = 5;
      const prompt = document.createElement('p');
      prompt.className = 'mini-game-prompt';
      prompt.textContent = '数字を入力して「予想する」を押してください。';
      const input = document.createElement('input');
      input.className = 'mini-game-input';
      input.type = 'number';
      input.min = '1';
      input.max = '30';
      input.inputMode = 'numeric';
      input.placeholder = '1〜30';
      input.setAttribute('aria-label', '予想する数字');
      const submit = makeButton('予想する', 'mini-game-button');
      const feedback = makeStatus(`残り ${attempts} 回`);
      const replay = makeButton('同じゲームに再挑戦', 'mini-game-button mini-game-button-secondary', () => {
        play(stage, schedule, onPoint);
      });
      replay.hidden = true;

      submit.addEventListener('click', () => {
        const guess = Number(input.value);
        if (!Number.isInteger(guess) || guess < 1 || guess > 30) {
          feedback.textContent = '1〜30の整数を入力してください。';
          input.focus();
          return;
        }
        attempts -= 1;
        input.disabled = true;
        submit.disabled = true;
        if (guess === answer) {
          feedback.textContent = `正解！${5 - attempts} 回で当たりました。`;
          onPoint();
          replay.hidden = false;
          return;
        }
        if (attempts === 0) {
          feedback.textContent = `残念！正解は ${answer} でした。`;
          replay.hidden = false;
          return;
        }
        feedback.textContent = `${guess < answer ? 'もっと大きい数字です' : 'もっと小さい数字です'}。残り ${attempts} 回`;
        input.disabled = false;
        input.value = '';
        submit.disabled = false;
        input.focus();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') submit.click();
      });
      stage.replaceChildren(prompt, input, submit, feedback, replay);
      input.focus();
    }
  },
  {
    id: 'reaction',
    name: '反射神経',
    description: '合図が出たら、できるだけ早くタップ！',
    play(stage, schedule, onPoint) {
      let startTime = 0;
      let isReady = false;
      let finished = false;
      const feedback = makeStatus('緑色に変わるまで押さないでください。');
      const tap = makeButton('待って…', 'mini-game-button mini-game-reaction');
      const replay = makeButton('もう一度挑戦', 'mini-game-button mini-game-button-secondary', () => {
        play(stage, schedule, onPoint);
      });
      replay.hidden = true;
      tap.addEventListener('click', () => {
        if (!isReady) {
          finished = true;
          feedback.textContent = '早すぎます！もう一度挑戦してみましょう。';
          tap.disabled = true;
          replay.hidden = false;
          return;
        }
        const elapsed = Math.round(performance.now() - startTime);
        feedback.textContent = `${elapsed} ミリ秒！${elapsed < 250 ? 'すばやい！' : 'ナイスチャレンジ！'}`;
        onPoint();
        finished = true;
        tap.disabled = true;
        replay.hidden = false;
      });
      stage.replaceChildren(feedback, tap, replay);
      schedule(() => {
        if (finished) return;
        isReady = true;
        startTime = performance.now();
        tap.textContent = '今すぐタップ！';
        tap.classList.add('is-ready');
        tap.disabled = false;
        feedback.textContent = 'タップ！';
      }, 1200 + Math.random() * 2200);
    }
  },
  {
    id: 'memory',
    name: '記憶チャレンジ',
    description: '表示された絵文字の順番を覚えて再現しよう。',
    play(stage, schedule, onPoint) {
      const symbols = ['🍎', '⭐', '🐟', '🌙'];
      const sequence = Array.from(
        { length: 4 + Math.floor(Math.random() * 3) },
        () => Math.floor(Math.random() * symbols.length)
      );
      const prompt = document.createElement('p');
      prompt.className = 'mini-game-prompt';
      const display = document.createElement('div');
      display.className = 'mini-game-memory-display';
      const controls = document.createElement('div');
      controls.className = 'mini-game-memory-controls';
      const feedback = makeStatus('');
      const chosen = [];
      const inputButtons = [];
      let sequenceIndex = 0;

      const chooseSymbol = index => {
        chosen.push(index);
        display.textContent = chosen.map(symbolIndex => symbols[symbolIndex]).join(' ');
        if (chosen.length !== sequence.length) return;
        const correct = chosen.every((symbolIndex, chosenIndex) => symbolIndex === sequence[chosenIndex]);
        feedback.textContent = correct ? '正解！順番を覚えました。' : `残念。正解は ${sequence.map(symbolIndex => symbols[symbolIndex]).join(' ')} でした。`;
        if (correct) onPoint();
        controls.replaceChildren(makeButton('もう一度挑戦', 'mini-game-button mini-game-button-secondary', () => {
          play(stage, schedule, onPoint);
        }));
      };

      symbols.forEach((symbol, index) => {
        const button = makeButton(symbol, 'mini-game-memory-button', () => chooseSymbol(index));
        button.disabled = true;
        inputButtons.push(button);
        controls.append(button);
      });
      stage.replaceChildren(prompt, display, controls, feedback);
      const showNext = () => {
        if (sequenceIndex >= sequence.length) {
          prompt.textContent = '順番どおりに選んでください。';
          display.textContent = '？ '.repeat(sequence.length).trim();
          inputButtons.forEach(button => { button.disabled = false; });
          return;
        }
        display.textContent = symbols[sequence[sequenceIndex]];
        sequenceIndex += 1;
        schedule(showNext, 650);
      };
      prompt.textContent = '順番を覚えてください…';
      schedule(showNext, 650);
    }
  }
];

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function makeStatus(text) {
  const status = document.createElement('p');
  status.className = 'mini-game-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = text;
  return status;
}

export function mountMiniGames(container, onExit, onClear) {
  const timers = new Set();
  let currentGameId = null;
  let score = 0;
  const scoreTarget = 10;
  const page = document.createElement('section');
  page.className = 'mini-games-page';

  const header = document.createElement('header');
  header.className = 'mini-games-header';
  const headingGroup = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'mini-games-eyebrow';
  eyebrow.textContent = 'SECRET ARCADE';
  const heading = document.createElement('h1');
  heading.className = 'mini-games-title';
  heading.textContent = '裏ゲームルーム';
  headingGroup.append(eyebrow, heading);
  const exit = makeButton('ホームへ戻る', 'mini-game-button mini-game-button-secondary', onExit);
  header.append(headingGroup, exit);

  const intro = document.createElement('p');
  intro.className = 'mini-games-intro';
  intro.textContent = '遊びたいゲームを選ぶか、ランダムで挑戦しよう。';
  const toolbar = document.createElement('div');
  toolbar.className = 'mini-games-toolbar';
  const randomButton = makeButton('🎲 ランダムに遊ぶ', 'mini-game-button', () => startRandomGame());
  toolbar.append(randomButton);

  const scorePanel = document.createElement('section');
  scorePanel.className = 'mini-games-score';
  const scoreLabel = document.createElement('p');
  scoreLabel.className = 'mini-games-score-label';
  scoreLabel.setAttribute('role', 'status');
  scoreLabel.setAttribute('aria-live', 'polite');
  const scoreProgress = document.createElement('progress');
  scoreProgress.className = 'mini-games-score-progress';
  scoreProgress.max = scoreTarget;
  scoreProgress.value = score;
  scoreProgress.setAttribute('aria-label', `クリアまで ${scoreTarget} 点`);
  const clearMessage = document.createElement('p');
  clearMessage.className = 'mini-games-clear-message';
  clearMessage.textContent = 'クリア！設定画面へ進めます。';
  clearMessage.hidden = true;
  const settingsButton = makeButton('設定画面へ進む', 'mini-game-button mini-games-settings-button', onClear);
  settingsButton.hidden = true;
  scorePanel.append(scoreLabel, scoreProgress, clearMessage, settingsButton);

  function updateScore() {
    scoreLabel.textContent = `スコア ${score} / ${scoreTarget}`;
    scoreProgress.value = score;
    scoreProgress.setAttribute('aria-label', `スコア ${score} 点、クリアまで ${Math.max(scoreTarget - score, 0)} 点`);
    if (score >= scoreTarget) {
      clearMessage.hidden = false;
      settingsButton.hidden = false;
    }
  }

  function awardPoint() {
    if (score >= scoreTarget) return;
    score += 1;
    updateScore();
  }

  const gameList = document.createElement('nav');
  gameList.className = 'mini-games-list';
  gameList.setAttribute('aria-label', 'ミニゲームを選択');
  const stage = document.createElement('section');
  stage.className = 'mini-game-stage';
  stage.setAttribute('aria-label', 'ゲーム');

  function schedule(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function startGame(game) {
    timers.forEach(timer => window.clearTimeout(timer));
    timers.clear();
    currentGameId = game.id;
    gameList.querySelectorAll('button').forEach(button => {
      const selected = button.dataset.gameId === game.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    stage.replaceChildren();
    const title = document.createElement('h2');
    title.className = 'mini-game-title';
    title.textContent = game.name;
    const description = document.createElement('p');
    description.className = 'mini-game-description';
    description.textContent = game.description;
    const gameContent = document.createElement('div');
    gameContent.className = 'mini-game-content';
    stage.append(title, description, gameContent);
    game.play(gameContent, schedule, awardPoint);
  }

  function startRandomGame() {
    const candidates = games.filter(game => game.id !== currentGameId);
    const choices = candidates.length > 0 ? candidates : games;
    startGame(choices[Math.floor(Math.random() * choices.length)]);
  }

  for (const game of games) {
    const choice = makeButton(game.name, 'mini-game-choice', () => startGame(game));
    choice.dataset.gameId = game.id;
    choice.setAttribute('aria-pressed', 'false');
    gameList.append(choice);
  }

  page.append(header, intro, toolbar, scorePanel, gameList, stage);
  container.replaceChildren(page);
  updateScore();
  startRandomGame();

  return () => {
    timers.forEach(timer => window.clearTimeout(timer));
    timers.clear();
    container.replaceChildren();
  };
}
