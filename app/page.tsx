"use client";

import { useEffect, useMemo, useState } from "react";

type PlayerColor = "red" | "blue" | "green" | "yellow";

type Token = {
  id: string;
  steps: number | null; // null = home, 0-51 track, 52-56 final, 57 done
};

type Player = {
  color: PlayerColor;
  label: string;
  startIndex: number;
  tokens: Token[];
};

type GameState = {
  players: Player[];
  currentPlayer: PlayerColor;
  dice: number | null;
  message: string;
  winner: PlayerColor | null;
};

type MoveOption = {
  tokenId: string;
  nextSteps: number;
  willCapture: string[];
};

const COLORS: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#facc15",
};

const START_INDICES: Record<PlayerColor, number> = {
  red: 0,
  blue: 13,
  yellow: 26,
  green: 39,
};

const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const STORAGE_KEY = "ludo-state-v1";
const TOKENS_PER_PLAYER = 4;
const FINAL_STEPS_START = 52;
const FINAL_STEPS_END = 57; // inclusive, 57 means finished

function createPlayers(): Player[] {
  const order: PlayerColor[] = ["red", "blue", "yellow", "green"];
  return order.map((color) => ({
    color,
    label: color[0].toUpperCase() + color.slice(1),
    startIndex: START_INDICES[color],
    tokens: Array.from({ length: TOKENS_PER_PLAYER }).map((_, idx) => ({
      id: `${color}-${idx + 1}`,
      steps: null,
    })),
  }));
}

function initialState(): GameState {
  const players = createPlayers();
  return {
    players,
    currentPlayer: players[0].color,
    dice: null,
    message: "Roll to start",
    winner: null,
  };
}

function clampSteps(steps: number | null) {
  if (steps === null) return null;
  if (steps < 0) return 0;
  if (steps > FINAL_STEPS_END) return FINAL_STEPS_END;
  return steps;
}

function tokenPhase(steps: number | null, startIndex: number) {
  if (steps === null) return { phase: "home" as const };
  if (steps >= FINAL_STEPS_END) return { phase: "done" as const };
  if (steps >= FINAL_STEPS_START) {
    return { phase: "final" as const, finalIndex: steps - FINAL_STEPS_START };
  }
  const trackIndex = (startIndex + steps) % 52;
  return { phase: "track" as const, trackIndex };
}

function randomDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

function findPlayer(players: Player[], color: PlayerColor) {
  return players.find((p) => p.color === color)!;
}

function buildTrackOccupancy(players: Player[]) {
  const map = new Map<number, (Token & { color: PlayerColor })[]>();
  players.forEach((player) => {
    player.tokens.forEach((token) => {
      const info = tokenPhase(token.steps, player.startIndex);
      if (info.phase === "track") {
        const current = map.get(info.trackIndex) ?? [];
        current.push({ ...token, color: player.color });
        map.set(info.trackIndex, current);
      }
    });
  });
  return map;
}

function computeValidMoves(
  game: GameState,
  dice: number
): { moves: MoveOption[]; reason?: string } {
  if (game.winner) return { moves: [], reason: "Game finished" };
  const player = findPlayer(game.players, game.currentPlayer);
  const occupancy = buildTrackOccupancy(game.players);
  const moves: MoveOption[] = [];

  player.tokens.forEach((token) => {
    const info = tokenPhase(token.steps, player.startIndex);
    if (info.phase === "home") {
      if (dice === 6) {
        moves.push({ tokenId: token.id, nextSteps: 0, willCapture: [] });
      }
      return;
    }

    const candidate = token.steps === null ? 0 : token.steps + dice;
    if (candidate > FINAL_STEPS_END) return;

    const nextInfo = tokenPhase(candidate, player.startIndex);
    if (nextInfo.phase === "track") {
      const occupants = occupancy.get(nextInfo.trackIndex) ?? [];
      const opponents = occupants.filter((o) => o.color !== player.color);
      const willCapture =
        opponents.length > 0 && !SAFE_CELLS.has(nextInfo.trackIndex)
          ? opponents.map((o) => o.id)
          : [];
      moves.push({ tokenId: token.id, nextSteps: candidate, willCapture });
      return;
    }

    moves.push({ tokenId: token.id, nextSteps: candidate, willCapture: [] });
  });

  return moves.length
    ? { moves }
    : {
        moves: [],
        reason:
          dice === 6
            ? "No piece can enter or move; roll again."
            : "No valid moves this turn.",
      };
}

function nextPlayerColor(current: PlayerColor, players: Player[]) {
  const order = players.map((p) => p.color);
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

function hasWinner(players: Player[]) {
  return players.find((p) =>
    p.tokens.every((t) => clampSteps(t.steps) === FINAL_STEPS_END)
  );
}

function persistableState(state: GameState) {
  return JSON.stringify(state);
}

export default function Home() {
  const [state, setState] = useState<GameState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [availableMoves, setAvailableMoves] = useState<MoveOption[]>([]);
  const [diceRolling, setDiceRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GameState;
        setState(parsed);
        setHydrated(true);
        return;
      } catch {
        // ignore parse errors
      }
    }
    setState(initialState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !state) return;
    window.localStorage.setItem(STORAGE_KEY, persistableState(state));
  }, [state, hydrated]);

  const ringPoints = useMemo(() => {
    const center = 50;
    const radius = 42;
    return Array.from({ length: 52 }).map((_, idx) => {
      const angle = idx / 52 * Math.PI * 2 - Math.PI / 2;
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      return { x, y };
    });
  }, []);

  const finalLanes = useMemo(() => {
    const center = 50;
    const lanes: Record<PlayerColor, { x: number; y: number }[]> = {
      red: [],
      blue: [],
      yellow: [],
      green: [],
    };
    (Object.keys(START_INDICES) as PlayerColor[]).forEach((color) => {
      const start = START_INDICES[color];
      const startPoint = ringPoints[start];
      const dx = center - startPoint.x;
      const dy = center - startPoint.y;
      for (let step = 0; step < 6; step += 1) {
        const factor = (step + 1) / 7;
        lanes[color].push({
          x: startPoint.x + dx * factor,
          y: startPoint.y + dy * factor,
        });
      }
    });
    return lanes;
  }, [ringPoints]);

  const homePositions = useMemo(() => {
    const positions: Record<PlayerColor, { x: number; y: number }[]> = {
      red: [
        { x: 16, y: 16 },
        { x: 25, y: 16 },
        { x: 16, y: 25 },
        { x: 25, y: 25 },
      ],
      blue: [
        { x: 84, y: 16 },
        { x: 75, y: 16 },
        { x: 84, y: 25 },
        { x: 75, y: 25 },
      ],
      yellow: [
        { x: 84, y: 84 },
        { x: 75, y: 84 },
        { x: 84, y: 75 },
        { x: 75, y: 75 },
      ],
      green: [
        { x: 16, y: 84 },
        { x: 25, y: 84 },
        { x: 16, y: 75 },
        { x: 25, y: 75 },
      ],
    };
    return positions;
  }, []);

  if (!state) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium">Loading your board...</p>
        </div>
      </main>
    );
  }

  const currentPlayer = findPlayer(state.players, state.currentPlayer);

  const handleRoll = () => {
    if (state.winner || diceRolling) return;
    const roll = randomDice();
    setDiceRolling(true);
    setLastRoll(roll);
    const { moves, reason } = computeValidMoves(state, roll);
    setState((prev) =>
      prev
        ? {
            ...prev,
            dice: roll,
            message: reason ?? `${currentPlayer.label} rolled a ${roll}`,
          }
        : prev
    );
    setAvailableMoves(moves);

    if (!moves.length) {
      setTimeout(() => {
        setState((prev) => {
          if (!prev) return prev;
          const next =
            roll === 6 ? prev.currentPlayer : nextPlayerColor(prev.currentPlayer, prev.players);
          return { ...prev, currentPlayer: next, dice: null };
        });
      }, 350);
    }

    setTimeout(() => setDiceRolling(false), 650);
  };

  const applyMove = (move: MoveOption) => {
    if (state.winner) return;
    const dice = state.dice;
    if (!dice) return;
    setState((prev) => {
      if (!prev) return prev;
      const players = prev.players.map((p) => {
        if (p.color !== prev.currentPlayer) return p;
        return {
          ...p,
          tokens: p.tokens.map((t) =>
            t.id === move.tokenId ? { ...t, steps: move.nextSteps } : t
          ),
        };
      });

      const mover = findPlayer(players, prev.currentPlayer);
      const movedToken = mover.tokens.find((t) => t.id === move.tokenId)!;
      const posInfo = tokenPhase(movedToken.steps, mover.startIndex);
      let updatedPlayers = players;
      if (posInfo.phase === "track" && move.willCapture.length) {
        updatedPlayers = players.map((p) => ({
          ...p,
          tokens: p.tokens.map((t) =>
            move.willCapture.includes(t.id) ? { ...t, steps: null } : t
          ),
        }));
      }

      const winnerPlayer = hasWinner(updatedPlayers);
      const stayedOnTurn = dice === 6 && !winnerPlayer;
      const nextColor = stayedOnTurn
        ? prev.currentPlayer
        : nextPlayerColor(prev.currentPlayer, prev.players);
      const nextLabel = findPlayer(updatedPlayers, nextColor).label;

      return {
        ...prev,
        players: updatedPlayers,
        currentPlayer: winnerPlayer ? prev.currentPlayer : nextColor,
        dice: null,
        winner: winnerPlayer?.color ?? null,
        message: winnerPlayer
          ? `${winnerPlayer.label} wins!`
          : stayedOnTurn
          ? `${currentPlayer.label} rolled a 6 - go again`
          : `${nextLabel} to roll`,
      };
    });
    setAvailableMoves([]);
  };

  const resetGame = () => {
    const fresh = initialState();
    setState(fresh);
    setAvailableMoves([]);
    setLastRoll(null);
  };

  const summary = (player: Player) => {
    const home = player.tokens.filter((t) => t.steps === null).length;
    const finished = player.tokens.filter(
      (t) => clampSteps(t.steps) === FINAL_STEPS_END
    ).length;
    return { home, finished };
  };

  const applyMoveFor = (tokenId: string) => {
    const move = availableMoves.find((m) => m.tokenId === tokenId);
    if (!move) return;
    applyMove(move);
  };

  const tileForToken = (
    token: Token,
    player: Player,
    idx: number,
    clickable: boolean,
    offset = { x: 0, y: 0 },
    stackSize = 1,
    stackOrder = 0,
    isCurrentTurn = false
  ) => {
    const info = tokenPhase(token.steps, player.startIndex);
    const label = token.id.split("-")[1];
    const isReady =
      clickable &&
      availableMoves.some((m) => m.tokenId === token.id && m.nextSteps === clampSteps(m.nextSteps));
    const pulse = isReady ? "animate-token-wobble" : "";
    const glow = isCurrentTurn ? "shadow-[0_0_0_6px_rgba(255,255,255,0.18)] ring-2 ring-white/60" : "";
    const base =
      "h-9 w-9 rounded-full border-2 border-white/80 shadow-md flex items-center justify-center text-xs font-bold";
    const style = { backgroundColor: COLORS[player.color], color: "#0b1224" };
    const content = (
      <div className={`${base} ${pulse} ${glow}`} style={style} key={token.id}>
        {label}
      </div>
    );
    const hitboxPadding = stackSize > 1 ? 14 : 10;
    const wrapperClass =
      "absolute select-none focus:outline-none active:scale-[0.97] transition-transform touch-manipulation";
    const buildStyle = (pos: { x: number; y: number }) => {
      const turnBonus = isCurrentTurn ? 100 : 0;
      return {
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
        padding: `${hitboxPadding}px`,
        zIndex: 50 + stackSize - stackOrder + turnBonus,
        transition: "left 0.45s ease, top 0.45s ease, transform 0.45s ease",
      };
    };

    if (info.phase === "home") {
      const pos = homePositions[player.color][idx % 4];
      return (
        <button
          key={token.id}
          onClick={() => applyMoveFor(token.id)}
          disabled={!isReady}
          className={wrapperClass}
          style={buildStyle(pos)}
        >
          {content}
        </button>
      );
    }

    if (info.phase === "track") {
      const pt = ringPoints[info.trackIndex];
      return (
        <button
          key={token.id}
          onClick={() => applyMoveFor(token.id)}
          disabled={!isReady}
          className={wrapperClass}
          style={buildStyle(pt)}
        >
          {content}
        </button>
      );
    }

    if (info.phase === "final") {
      const lane = finalLanes[player.color][info.finalIndex];
      return (
        <button
          key={token.id}
          onClick={() => applyMoveFor(token.id)}
          disabled={!isReady}
          className={wrapperClass}
          style={buildStyle(lane)}
        >
          {content}
        </button>
      );
    }

    return (
      <div
        key={token.id}
        className={wrapperClass}
        style={buildStyle({ x: 50, y: 50 })}
      >
        {content}
      </div>
    );
  };

  const renderTokens = (() => {
    const stackOffsets = (count: number) => {
      if (count === 2) return [{ x: -12, y: -10 }, { x: 12, y: 10 }];
      if (count === 3)
        return [
          { x: -14, y: -8 },
          { x: 14, y: -8 },
          { x: 0, y: 14 },
        ];
      if (count >= 4)
        return [
          { x: -14, y: -10 },
          { x: 14, y: -10 },
          { x: -14, y: 10 },
          { x: 14, y: 10 },
        ].concat(Array.from({ length: count - 4 }, () => ({ x: 0, y: 0 })));
      return [{ x: 0, y: 0 }];
    };

    const placements = state.players.flatMap((player) =>
      player.tokens.map((token, idx) => {
        const info = tokenPhase(token.steps, player.startIndex);
        const clickable =
          !!state.dice &&
          availableMoves.some((m) => m.tokenId === token.id) &&
          !diceRolling;

        if (info.phase === "home") {
          const pos = homePositions[player.color][idx % 4];
          return { token, player, idx, clickable, pos, key: `home-${player.color}-${idx % 4}` };
        }
        if (info.phase === "track") {
          const pt = ringPoints[info.trackIndex];
          return { token, player, idx, clickable, pos: pt, key: `track-${info.trackIndex}` };
        }
        if (info.phase === "final") {
          const lane = finalLanes[player.color][info.finalIndex];
          return { token, player, idx, clickable, pos: lane, key: `final-${player.color}-${info.finalIndex}` };
        }
        return { token, player, idx, clickable, pos: { x: 50, y: 50 }, key: `done-${player.color}` };
      })
    );

    const grouped = placements.reduce((map, item) => {
      const list = map.get(item.key) ?? [];
      list.push(item);
      map.set(item.key, list);
      return map;
    }, new Map<string, typeof placements>());

    return Array.from(grouped.values()).flatMap((group) => {
      const offsets = stackOffsets(group.length);
      const sortedGroup = [...group].sort((a, b) => {
        const aTurn = a.player.color === state.currentPlayer ? 1 : 0;
        const bTurn = b.player.color === state.currentPlayer ? 1 : 0;
        if (aTurn !== bTurn) return bTurn - aTurn; // current turn tokens render on top
        return 0;
      });
      return sortedGroup.map((item, order) =>
        tileForToken(
          item.token,
          item.player,
          item.idx,
          item.clickable,
          offsets[order] ?? { x: 0, y: 0 },
          group.length,
          order,
          item.player.color === state.currentPlayer
        )
      );
    });
  })();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
              Ludo, reimagined
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              Ludo Lounge
            </h1>
            <p className="text-slate-400">
              Mobile-first board, smooth turns, and on-device saves.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 backdrop-blur">
            <div
              className="h-10 w-10 rounded-xl border border-white/15 text-lg font-black flex items-center justify-center shadow-lg"
              style={{ backgroundColor: COLORS[state.currentPlayer], color: "#0b1224" }}
            >
              {state.currentPlayer[0].toUpperCase()}
            </div>
            <div>
              <p className="text-xs text-slate-400">Current player</p>
              <p className="text-sm font-semibold">{currentPlayer.label}</p>
            </div>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr),minmax(280px,0.8fr)]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
            <div className="relative mx-auto aspect-square max-w-[720px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.04)_0%,_transparent_45%)]" />
              <div className="absolute inset-6 rounded-2xl border border-white/5" />
              <div className="absolute inset-0" aria-label="Board">
                {renderTokens}
              </div>
              {ringPoints.map((pt, idx) => (
                <div
                  key={idx}
                  className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 ${
                    SAFE_CELLS.has(idx) ? "bg-white/30" : "bg-white/10"
                  }`}
                  style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                />
              ))}
              {(Object.keys(finalLanes) as PlayerColor[]).map((color) =>
                finalLanes[color].map((pt, idx) => (
                  <div
                    key={`${color}-lane-${idx}`}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30"
                    style={{
                      left: `${pt.x}%`,
                      top: `${pt.y}%`,
                      backgroundColor: `${COLORS[color]}30`,
                    }}
                  />
                ))
              )}
              <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-white/40 bg-white/10" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="rounded-full bg-white/5 px-3 py-1">Tap a glowing piece after you roll</span>
              <span className="rounded-full bg-white/5 px-3 py-1">6 keeps your turn</span>
              <span className="rounded-full bg-white/5 px-3 py-1">Landing on rivals bumps them home (not on safe spots)</span>
            </div>
          </section>

          <aside className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
              <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Dice</p>
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-2xl font-black tracking-tight ${
                    diceRolling ? "dice-rolling" : ""
                  }`}
                >
                  {diceRolling ? "" : state.dice ?? lastRoll ?? "-"}
                </div>
              </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRoll}
                    disabled={!!state.dice || !!state.winner || diceRolling}
                    className="rounded-xl bg-white text-slate-900 px-4 py-2 text-sm font-semibold shadow-lg shadow-blue-500/30 transition hover:scale-[1.02] disabled:opacity-50"
                  >
                    Roll
                  </button>
                  <button
                    onClick={resetGame}
                    className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/5"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-300">{state.message}</p>
              {availableMoves.length > 0 && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
                  <p className="mb-2 font-semibold">Choose a piece to move:</p>
                  <div className="space-y-2">
                    {availableMoves.map((move) => (
                      <button
                        key={move.tokenId}
                        onClick={() => applyMove(move)}
                        className="flex w-full items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                      >
                        <span>
                          {move.tokenId} {"->"} step {move.nextSteps}
                        </span>
                        {move.willCapture.length > 0 && (
                          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-white/90">
                            Capture
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {state.players.map((player) => {
                const stats = summary(player);
                return (
                  <div
                    key={player.color}
                    className={`rounded-2xl border border-white/10 p-3 ${
                      player.color === state.currentPlayer
                        ? "bg-white/10"
                        : "bg-slate-900/70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: COLORS[player.color] }}
                      />
                      <p className="text-sm font-semibold">{player.label}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                      <span>Home: {stats.home}</span>
                      <span>Finished: {stats.finished}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white">Quick tips</p>
              <ul className="mt-2 space-y-1 text-slate-400">
                <li>- Roll a 6 to launch from home.</li>
                <li>- Tap glowing pieces to move after rolling.</li>
                <li>- 6 gives another roll; capture bumps rivals home.</li>
                <li>- Your game auto-saves to this device.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
