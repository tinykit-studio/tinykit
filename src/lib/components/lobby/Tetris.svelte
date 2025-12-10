<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  type Grid = number[][];
  type Tetromino = number[][];
  type Position = { x: number; y: number };

  const ROWS = 20;
  const COLS = 10;
  const CELL_SIZE = 25;

  // Tetromino shapes
  const SHAPES: Record<string, Tetromino> = {
    I: [[1, 1, 1, 1]],
    O: [
      [1, 1],
      [1, 1],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
    ],
  };

  const COLORS: Record<string, string> = {
    I: "bg-cyan-500",
    O: "bg-yellow-500",
    T: "bg-purple-500",
    S: "bg-green-500",
    Z: "bg-red-500",
    J: "bg-blue-500",
    L: "bg-orange-500",
  };

  let grid: Grid = $state(
    Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0)),
  );
  let currentPiece: { shape: Tetromino; type: string; pos: Position } | null =
    $state(null);
  let score = $state(0);
  let highScore = $state(0);
  let level = $state(1);
  let lines = $state(0);
  let gameOver = $state(false);
  let isPaused = $state(false);
  let gameLoop: number | null = null;
  let dropSpeed = $state(800);

  function createPiece(): typeof currentPiece {
    const types = Object.keys(SHAPES);
    const type = types[Math.floor(Math.random() * types.length)];
    return {
      shape: SHAPES[type],
      type,
      pos: { x: Math.floor(COLS / 2) - 1, y: 0 },
    };
  }

  function canMove(piece: typeof currentPiece, newPos: Position): boolean {
    if (!piece) return false;

    for (let y = 0; y < piece.shape.length; y++) {
      for (let x = 0; x < piece.shape[y].length; x++) {
        if (piece.shape[y][x]) {
          const newX = newPos.x + x;
          const newY = newPos.y + y;

          if (newX < 0 || newX >= COLS || newY >= ROWS) return false;
          if (newY >= 0 && grid[newY][newX]) return false;
        }
      }
    }
    return true;
  }

  function mergePiece() {
    if (!currentPiece) return;

    const newGrid = grid.map((row) => [...row]);
    for (let y = 0; y < currentPiece.shape.length; y++) {
      for (let x = 0; x < currentPiece.shape[y].length; x++) {
        if (currentPiece.shape[y][x]) {
          const gridY = currentPiece.pos.y + y;
          const gridX = currentPiece.pos.x + x;
          if (gridY >= 0) {
            newGrid[gridY][gridX] = 1;
          }
        }
      }
    }
    grid = newGrid;
  }

  function clearLines(): number {
    let linesCleared = 0;
    const newGrid: Grid = [];

    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every((cell) => cell === 1)) {
        linesCleared++;
      } else {
        newGrid.unshift(grid[y]);
      }
    }

    while (newGrid.length < ROWS) {
      newGrid.unshift(Array(COLS).fill(0));
    }

    grid = newGrid;
    return linesCleared;
  }

  function rotatePiece() {
    if (!currentPiece || gameOver || isPaused) return;

    const rotated = currentPiece.shape[0].map((_, i) =>
      currentPiece!.shape.map((row) => row[i]).reverse(),
    );

    const rotatedPiece = { ...currentPiece, shape: rotated };

    if (canMove(rotatedPiece, currentPiece.pos)) {
      currentPiece = rotatedPiece;
      saveState();
    }
  }

  function movePiece(dx: number) {
    if (!currentPiece || gameOver || isPaused) return;

    const newPos = { x: currentPiece.pos.x + dx, y: currentPiece.pos.y };
    if (canMove(currentPiece, newPos)) {
      currentPiece.pos = newPos;
      saveState();
    }
  }

  function dropPiece() {
    if (!currentPiece || gameOver || isPaused) return;

    const newPos = { x: currentPiece.pos.x, y: currentPiece.pos.y + 1 };

    if (canMove(currentPiece, newPos)) {
      currentPiece.pos = newPos;
    } else {
      mergePiece();
      const linesCleared = clearLines();

      if (linesCleared > 0) {
        lines += linesCleared;
        score += [0, 100, 300, 500, 800][linesCleared] * level;
        level = Math.floor(lines / 10) + 1;
        dropSpeed = Math.max(100, 800 - (level - 1) * 50);
        restartGameLoop();
      }

      currentPiece = createPiece();

      if (currentPiece && !canMove(currentPiece, currentPiece.pos)) {
        gameOver = true;
      }
    }
    saveState();
  }

  function hardDrop() {
    if (!currentPiece || gameOver || isPaused) return;

    while (currentPiece) {
      const newPos = { x: currentPiece.pos.x, y: currentPiece.pos.y + 1 };
      if (canMove(currentPiece, newPos)) {
        currentPiece.pos = newPos;
      } else {
        break;
      }
    }
    dropPiece();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (gameOver) return;

    switch (e.key) {
      case "ArrowLeft":
        movePiece(-1);
        e.preventDefault();
        break;
      case "ArrowRight":
        movePiece(1);
        e.preventDefault();
        break;
      case "ArrowDown":
        dropPiece();
        e.preventDefault();
        break;
      case "ArrowUp":
        hardDrop();
        e.preventDefault();
        break;
      case " ":
        rotatePiece();
        e.preventDefault();
        break;
      case "p":
      case "P":
        if (!gameOver) {
          isPaused = !isPaused;
        }
        e.preventDefault();
        break;
    }
  }

  function startGameLoop() {
    if (gameLoop !== null) clearInterval(gameLoop);
    gameLoop = setInterval(() => {
      if (!isPaused && !gameOver) {
        dropPiece();
      }
    }, dropSpeed) as unknown as number;
  }

  function restartGameLoop() {
    startGameLoop();
  }

  function initGame() {
    grid = Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0));
    currentPiece = createPiece();
    score = 0;
    level = 1;
    lines = 0;
    gameOver = false;
    isPaused = false;
    dropSpeed = 800;
    saveState();
    startGameLoop();
  }

  function saveState() {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "lobby-tetris-state",
        JSON.stringify({
          grid,
          currentPiece,
          score,
          level,
          lines,
          gameOver,
          isPaused,
        }),
      );

      if (score > highScore) {
        highScore = score;
        localStorage.setItem("lobby-tetris-high-score", highScore.toString());
      }
    }
  }

  onMount(() => {
    // Load high score
    const savedHighScore = localStorage.getItem("lobby-tetris-high-score");
    if (savedHighScore) {
      highScore = parseInt(savedHighScore, 10);
    }

    // Try to restore saved game state
    const savedState = localStorage.getItem("lobby-tetris-state");
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        // Only restore if game wasn't over
        if (state && !state.gameOver && state.grid && state.currentPiece) {
          grid = state.grid;
          currentPiece = state.currentPiece;
          score = state.score || 0;
          level = state.level || 1;
          lines = state.lines || 0;
          gameOver = false;
          isPaused = false;
          dropSpeed = Math.max(100, 800 - (level - 1) * 50);
          startGameLoop();
        } else {
          initGame();
        }
      } catch {
        initGame();
      }
    } else {
      initGame();
    }

    window.addEventListener("keydown", handleKeydown);

    return () => {
      if (gameLoop !== null) clearInterval(gameLoop);
      window.removeEventListener("keydown", handleKeydown);
    };
  });

  onDestroy(() => {
    if (gameLoop !== null) clearInterval(gameLoop);
  });

  function getGhostPosition(): Position | null {
    if (!currentPiece) return null;

    let ghostY = currentPiece.pos.y;
    while (canMove(currentPiece, { x: currentPiece.pos.x, y: ghostY + 1 })) {
      ghostY++;
    }

    return { x: currentPiece.pos.x, y: ghostY };
  }

  function getCellColor(x: number, y: number): string {
    const ghostPos = getGhostPosition();

    // Check if current piece occupies this cell
    if (currentPiece) {
      const pieceY = y - currentPiece.pos.y;
      const pieceX = x - currentPiece.pos.x;
      if (
        pieceY >= 0 &&
        pieceY < currentPiece.shape.length &&
        pieceX >= 0 &&
        pieceX < currentPiece.shape[pieceY].length &&
        currentPiece.shape[pieceY][pieceX]
      ) {
        return COLORS[currentPiece.type];
      }
    }

    // Check if ghost piece occupies this cell (only if not same as current piece)
    if (ghostPos && currentPiece && ghostPos.y !== currentPiece.pos.y) {
      const ghostY = y - ghostPos.y;
      const ghostX = x - ghostPos.x;
      if (
        ghostY >= 0 &&
        ghostY < currentPiece.shape.length &&
        ghostX >= 0 &&
        ghostX < currentPiece.shape[ghostY].length &&
        currentPiece.shape[ghostY][ghostX]
      ) {
        return "bg-gray-700 border border-gray-500";
      }
    }

    // Check if grid has a piece
    if (grid[y][x]) {
      return "bg-gray-400";
    }

    return "bg-[#1a1a1a]";
  }
</script>

<div class="flex flex-col items-center justify-center space-y-4 relative">
  <!-- Stats -->
  <div class="flex items-center space-x-6 font-sans text-sm">
    <div class="text-center">
      <div class="text-gray-500 text-xs">Score</div>
      <div class="text-white">{score}</div>
    </div>
    <div class="text-center">
      <div class="text-gray-500 text-xs">Best</div>
      <div class="text-yellow-500">{highScore}</div>
    </div>
    <div class="text-center">
      <div class="text-gray-500 text-xs">Level</div>
      <div class="text-orange-500">{level}</div>
    </div>
    <div class="text-center">
      <div class="text-gray-500 text-xs">Lines</div>
      <div class="text-green-500">{lines}</div>
    </div>
    {#if isPaused}
      <div class="text-yellow-500 text-xs">PAUSED</div>
    {/if}
  </div>

  <!-- Game Grid -->
  <div class="border-2 border-[#2a2a2a] bg-black p-1">
    <div
      class="grid"
      style="grid-template-columns: repeat({COLS}, {CELL_SIZE}px); gap: 1px;"
    >
      {#each Array(ROWS) as _, y}
        {#each Array(COLS) as _, x}
          <div
            class="{getCellColor(x, y)} transition-colors"
            style="width: {CELL_SIZE}px; height: {CELL_SIZE}px;"
          />
        {/each}
      {/each}
    </div>
  </div>

  <!-- Controls -->
  <div class="flex items-center space-x-4">
    <button
      onclick={initGame}
      class="px-4 py-2 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors text-sm"
    >
      New Game
    </button>
  </div>

  <!-- Instructions -->
  <div class="text-gray-500 text-xs font-sans text-center space-y-1">
    <p>← → Move | ↑ Hard Drop | ↓ Soft Drop</p>
    <p>SPACE Rotate | P Pause</p>
  </div>

  <!-- Game Over -->
  {#if gameOver}
    <div
      class="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
    >
      <div class="text-center space-y-4">
        <div class="text-red-500 text-5xl font-sans">GAME OVER</div>
        <div class="text-white text-2xl">Score: {score}</div>
        {#if score === highScore && score > 0}
          <div class="text-yellow-500 text-lg">🏆 New High Score!</div>
        {/if}
        <div class="text-gray-400">Level: {level} | Lines: {lines}</div>
        <button
          onclick={initGame}
          class="px-6 py-3 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
        >
          Play Again
        </button>
      </div>
    </div>
  {/if}
</div>
