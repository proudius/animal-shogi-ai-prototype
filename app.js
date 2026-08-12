import {
  PIECE_INFO,
  applyMove,
  cloneState,
  initialState,
  legalMoves,
  moveNotation,
  sameMove,
  stateKey,
  withDraw,
} from "./engine.js";
import { AI_LEVELS, chooseMove, tablebaseSize } from "./ai.js";

const $ = (id) => document.getElementById(id);
const levelOrder = ["v1", "v2", "v3", "v4", "v5"];

let state;
let repetition;
let snapshots;
let log;
let selected = null;
let lastMove = null;
let busy = false;
let autoMode = false;
let session = 0;

function initializeControls() {
  for (const level of levelOrder) {
    const info = AI_LEVELS[level];
    for (const select of [$("p1Select"), $("p2Select")]) {
      const option = document.createElement("option");
      option.value = level;
      option.textContent = info.name;
      select.appendChild(option);
    }
  }
  $("p1Select").value = "human";
  $("p2Select").value = "v5";

  const power = [18, 35, 55, 76, 100];
  $("levelCards").innerHTML = levelOrder.map((level, index) => {
    const info = AI_LEVELS[level];
    const technique = ["무작위 표본", "정적 평가", "미니맥스", "알파베타 + TT", "정확해 + 반복 심화"][index];
    return `<article class="level-card ${level === "v5" ? "active" : ""}" data-version="${level.toUpperCase()}" style="--power:${power[index]}%">
      <span class="bar"></span><b>${info.name}</b><small>${technique}</small><p>${info.description}</p>
    </article>`;
  }).join("");
  updatePlayerLabels();
}

function newGame({ auto = false } = {}) {
  session += 1;
  state = initialState();
  repetition = new Map([[stateKey(state), 1]]);
  snapshots = [];
  log = [];
  selected = null;
  lastMove = null;
  busy = false;
  autoMode = auto;
  closeModal();
  resetTelemetry();
  saveSnapshot();
  render();
  setStatus(auto ? "AI 자동 대국을 시작합니다." : "말을 선택한 뒤 표시된 칸으로 이동하세요.");
  if (playerType(state.turn) !== "human") scheduleAI();
}

function playerType(player) {
  return $(player === "P1" ? "p1Select" : "p2Select").value;
}

function render() {
  renderBoard();
  renderHands();
  renderLog();
  updatePlayerLabels();
  const label = state.winner ? "대국 종료" : `${state.turn === "P1" ? "P1" : "P2"} 차례`;
  $("turnPill").textContent = label;
  $("tablebaseCount").textContent = tablebaseSize().toLocaleString();
  $("undo").disabled = busy || snapshots.length <= 1;
}

function renderBoard() {
  const moves = legalMoves(state);
  const destinations = selected ? moves.filter((move) => {
    if (selected.type === "drop") return move.type === "drop" && move.piece === selected.piece;
    return move.type === "move" && move.from === selected.from;
  }) : [];

  $("board").innerHTML = "";
  state.board.forEach((item, index) => {
    const cell = document.createElement("button");
    cell.className = "cell";
    cell.type = "button";
    cell.setAttribute("aria-label", item ? `${PIECE_INFO[item.type].name} ${item.owner}` : `빈칸 ${index + 1}`);
    if (lastMove?.to === index) cell.classList.add("last");
    if (item?.owner === state.turn && moves.some((move) => move.type === "move" && move.from === index)) cell.classList.add("selectable");
    if (selected?.from === index) cell.classList.add("selected");
    if (destinations.some((move) => move.to === index)) {
      cell.classList.add("destination");
      if (item) cell.classList.add("capture");
    }
    if (item) {
      cell.innerHTML = `<span class="piece ${item.owner.toLowerCase()}">${PIECE_INFO[item.type].symbol}<small>${item.owner}</small></span>`;
    }
    cell.onclick = () => boardClick(index);
    $("board").appendChild(cell);
  });
}

function renderHands() {
  for (const player of ["P1", "P2"]) {
    const hand = $(player === "P1" ? "p1Hand" : "p2Hand");
    hand.innerHTML = "";
    for (const type of ["chick", "elephant", "giraffe"]) {
      const count = state.hands[player][type];
      for (let number = 0; number < count; number += 1) {
        const button = document.createElement("button");
        button.className = `hand-piece ${selected?.type === "drop" && selected.piece === type ? "selected" : ""}`;
        button.textContent = PIECE_INFO[type].symbol;
        button.title = `${PIECE_INFO[type].name} 놓기`;
        button.disabled = busy || state.turn !== player || playerType(player) !== "human";
        button.onclick = () => {
          selected = { type: "drop", piece: type };
          setStatus(`${PIECE_INFO[type].name}을 놓을 빈칸을 선택하세요.`);
          renderBoard();
          renderHands();
        };
        hand.appendChild(button);
      }
    }
  }
}

function renderLog() {
  if (!log.length) {
    $("moveLog").innerHTML = '<li class="empty">아직 둔 수가 없습니다.</li>';
    return;
  }
  $("moveLog").innerHTML = log.map((entry) => `<li>${entry.player} ${escapeHtml(entry.notation)}</li>`).join("");
  $("moveLog").scrollTop = $("moveLog").scrollHeight;
}

function boardClick(index) {
  if (busy || state.winner || playerType(state.turn) !== "human") return;
  const item = state.board[index];
  const moves = legalMoves(state);

  if (item?.owner === state.turn) {
    selected = { type: "move", from: index };
    setStatus(`${PIECE_INFO[item.type].name}의 목적지를 선택하세요.`);
    renderBoard();
    return;
  }

  if (!selected) return;
  const requested = moves.find((move) => {
    if (move.to !== index) return false;
    return selected.type === "drop"
      ? move.type === "drop" && move.piece === selected.piece
      : move.type === "move" && move.from === selected.from;
  });
  if (!requested) {
    setStatus("그 칸으로는 이동할 수 없습니다.");
    return;
  }
  playMove(requested);
}

function playMove(move, aiResult = null) {
  const before = state;
  const notation = moveNotation(before, move);
  const player = before.turn;
  state = applyMove(before, move);
  lastMove = move;
  selected = null;
  log.push({ player, notation });

  if (!state.winner) {
    const key = stateKey(state);
    const count = (repetition.get(key) ?? 0) + 1;
    repetition.set(key, count);
    if (count >= 3) state = withDraw(state);
  }

  if (aiResult) updateTelemetry(aiResult, notation);
  saveSnapshot();
  render();

  if (state.winner) {
    finishGame();
    return;
  }
  setStatus(`${state.turn}의 차례입니다.`);
  if (playerType(state.turn) !== "human") scheduleAI();
}

function scheduleAI() {
  if (busy || state.winner) return;
  const activeSession = session;
  busy = true;
  selected = null;
  render();
  setStatus(`${AI_LEVELS[playerType(state.turn)].name}이 수를 읽고 있습니다…`);
  window.setTimeout(() => {
    if (activeSession !== session || state.winner) return;
    try {
      const level = playerType(state.turn);
      const answer = chooseMove(state, level, { timeMs: autoMode ? 90 : undefined });
      busy = false;
      if (!answer.move) throw new Error("둘 수 있는 수가 없습니다.");
      playMove(answer.move, answer);
    } catch (error) {
      busy = false;
      setStatus(`AI 오류: ${error.message}`);
      render();
    }
  }, autoMode ? 45 : 110);
}

function saveSnapshot() {
  snapshots.push({
    state: cloneState(state),
    repetition: new Map(repetition),
    log: log.map((entry) => ({ ...entry })),
    lastMove: lastMove ? { ...lastMove } : null,
  });
}

function undo() {
  if (busy || snapshots.length <= 1) return;
  session += 1;
  snapshots.pop();
  // 사람 대 AI에서는 AI의 응수까지 함께 되돌려 사람 차례로 맞춘다.
  while (snapshots.length > 1 && playerType(snapshots.at(-1).state.turn) !== "human") snapshots.pop();
  const previous = snapshots.at(-1);
  state = cloneState(previous.state);
  repetition = new Map(previous.repetition);
  log = previous.log.map((entry) => ({ ...entry }));
  lastMove = previous.lastMove ? { ...previous.lastMove } : null;
  selected = null;
  autoMode = false;
  closeModal();
  render();
  setStatus("이전 국면으로 되돌렸습니다.");
}

function hint() {
  if (busy || state.winner || playerType(state.turn) !== "human") {
    setStatus("사람 차례에만 추천 수를 분석할 수 있습니다.");
    return;
  }
  busy = true;
  setStatus("v5가 추천 수를 분석하고 있습니다…");
  window.setTimeout(() => {
    const answer = chooseMove(state, "v5", { timeMs: 260 });
    busy = false;
    if (answer.move.type === "drop") selected = { type: "drop", piece: answer.move.piece };
    else selected = { type: "move", from: answer.move.from };
    updateTelemetry(answer, moveNotation(state, answer.move));
    render();
    setStatus(`추천: ${moveNotation(state, answer.move)} · 초록 점을 선택하면 실행됩니다.`);
  }, 30);
}

function startAutoPlay() {
  if (busy) return;
  if ($("p1Select").value === "human") $("p1Select").value = "v4";
  if ($("p2Select").value === "human") $("p2Select").value = "v5";
  updatePlayerLabels();
  newGame({ auto: true });
}

function finishGame() {
  busy = false;
  autoMode = false;
  const isDraw = state.winner === "DRAW";
  $("resultKicker").textContent = isDraw ? "THREEFOLD REPETITION" : "GAME OVER";
  $("resultTitle").textContent = isDraw ? "무승부" : `${state.winner} 승리`;
  $("resultReason").textContent = state.reason;
  $("resultModal").hidden = false;
  setStatus(`${$("resultTitle").textContent} · ${state.reason}`);
}

function closeModal() {
  $("resultModal").hidden = true;
}

function updatePlayerLabels() {
  for (const player of ["P1", "P2"]) {
    const value = playerType(player);
    $(player === "P1" ? "p1Name" : "p2Name").textContent = value === "human" ? "사람" : AI_LEVELS[value].name;
  }
  const selectedLevel = $("p2Select").value === "human" ? $("p1Select").value : $("p2Select").value;
  $("levelDetail").textContent = selectedLevel === "human"
    ? "두 선수를 설정한 뒤 새 대국 또는 AI끼리 1판을 선택하세요."
    : `${AI_LEVELS[selectedLevel].name} · ${AI_LEVELS[selectedLevel].description}`;
  document.querySelectorAll(".level-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.version.toLowerCase() === selectedLevel);
  });
}

function updateTelemetry(answer, notation) {
  const stats = answer.stats;
  $("nodes").textContent = (stats.nodes ?? 0).toLocaleString();
  $("depth").textContent = String(stats.depth ?? 0);
  $("elapsed").textContent = `${stats.elapsedMs ?? 0} ms`;
  $("tableHits").textContent = (stats.tableHits ?? 0).toLocaleString();
  $("chosenMove").textContent = notation;
  $("sourceChip").textContent = stats.exact ? "정확해" : sourceLabel(stats.source);
}

function resetTelemetry() {
  $("nodes").textContent = "0";
  $("depth").textContent = "0";
  $("elapsed").textContent = "0 ms";
  $("tableHits").textContent = "0";
  $("chosenMove").textContent = "—";
  $("sourceChip").textContent = "대기";
}

function sourceLabel(source) {
  return { random: "무작위", heuristic: "정적 평가", search: "고정 탐색", "iterative-search": "반복 심화", tablebase: "정확해" }[source] ?? "탐색";
}

function setStatus(message) {
  $("status").textContent = message;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

$("newGame").onclick = () => newGame();
$("modalNewGame").onclick = () => newGame();
$("closeModal").onclick = closeModal;
$("undo").onclick = undo;
$("hint").onclick = hint;
$("autoPlay").onclick = startAutoPlay;
$("clearLog").onclick = () => { log = []; renderLog(); };
$("p1Select").onchange = updatePlayerLabels;
$("p2Select").onchange = updatePlayerLabels;
$("resultModal").onclick = (event) => { if (event.target === $("resultModal")) closeModal(); };

initializeControls();
newGame();
