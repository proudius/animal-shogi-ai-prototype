import test from "node:test";
import assert from "node:assert/strict";
import { battleLogFilename, formatBattleLog } from "../battle-log.js";

const sample = {
  sequence: 1,
  opponent: "v1",
  opponentName: "v1 탐험가",
  customSide: "P1",
  codeFileName: "my-ai.js",
  result: "win",
  reason: "라이온을 잡았습니다.",
  plies: 2,
  playedAt: "2026. 8. 12. 16:00:00",
  error: null,
  moves: [
    { ply: 1, side: "P1", actor: "내 AI", notation: "병아리 B3xB2", elapsedMs: 8.2 },
    { ply: 2, side: "P2", actor: "v1 탐험가", notation: "기린 A1-A2", elapsedMs: 0 },
  ],
};

test("대전 로그는 경기 정보와 모든 수순을 텍스트로 만든다", () => {
  const text = formatBattleLog(sample);
  assert.match(text, /상대: v1 탐험가 \(v1\)/);
  assert.match(text, /결과: 승리/);
  assert.match(text, /1\. P1 내 AI · 병아리 B3xB2 · 8\.2ms/);
  assert.match(text, /2\. P2 v1 탐험가 · 기린 A1-A2 · 0ms/);
});

test("대전 로그 다운로드 파일명은 경기별로 구분된다", () => {
  assert.equal(battleLogFilename(sample), "animal-shogi-v1-game-01-win.txt");
});
