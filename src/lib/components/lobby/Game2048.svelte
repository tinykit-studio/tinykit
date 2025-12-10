<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  type Grid = number[][];

  const GRID_SIZE = 4;
  let grid: Grid = [];
  let score = 0;
  let bestScore = 0;
  let gameOver = false;
  let hasWon = false;
  let showWinMessage = false;

  // Initialize empty grid
  function createEmptyGrid(): Grid {
    return Array(GRID_SIZE)
      .fill(null)
      .map(() => Array(GRID_SIZE).fill(0));
  }

  // Get empty cells
  function getEmptyCells(g: Grid): [number, number][] {
    const empty: [number, number][] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (g[i][j] === 0) empty.push([i, j]);
      }
    }
    return empty;
  }

  // Add random tile (2 or 4)
  function addRandomTile(g: Grid): Grid {
    const empty = getEmptyCells(g);
    if (empty.length > 0) {
      const [i, j] = empty[Math.floor(Math.random() * empty.length)];
      const newGrid = g.map((row) => [...row]);
      newGrid[i][j] = Math.random() < 0.9 ? 2 : 4;
      return newGrid;
    }
    return g;
  }

  // Initialize game
  function initGame() {
    let g = createEmptyGrid();
    g = addRandomTile(g);
    g = addRandomTile(g);
    grid = g;
    score = 0;
    gameOver = false;
    showWinMessage = false;
    saveState();
  }

  // Load state from localStorage
  onMount(() => {
    const saved = localStorage.getItem("lobby-2048-state");
    const savedBest = localStorage.getItem("lobby-2048-best");

    if (savedBest) {
      bestScore = parseInt(savedBest, 10);
    }

    if (saved) {
      try {
        const state = JSON.parse(saved);
        grid = state.grid || createEmptyGrid();
        score = state.score || 0;
        gameOver = state.gameOver || false;
        hasWon = state.hasWon || false;
        showWinMessage = state.showWinMessage || false;

        // If grid is empty, start new game
        if (getEmptyCells(grid).length === GRID_SIZE * GRID_SIZE) {
          initGame();
        }
      } catch (e) {
        console.error("Failed to load 2048 state:", e);
        initGame();
      }
    } else {
      initGame();
    }
  });

  // Save state
  function saveState() {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "lobby-2048-state",
        JSON.stringify({
          grid,
          score,
          gameOver,
          hasWon,
          showWinMessage,
        })
      );

      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem("lobby-2048-best", bestScore.toString());
      }
    }
  }

  // Rotate grid 90 degrees clockwise
  function rotateGrid(g: Grid): Grid {
    const n = GRID_SIZE;
    const rotated: Grid = createEmptyGrid();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        rotated[i][j] = g[n - 1 - j][i];
      }
    }
    return rotated;
  }

  // Slide row left (core game logic)
  function slideRow(row: number[]): { row: number[]; scoreGained: number } {
    // Remove zeros
    let newRow = row.filter((x) => x !== 0);
    let scoreGained = 0;

    // Merge tiles
    for (let i = 0; i < newRow.length - 1; i++) {
      if (newRow[i] === newRow[i + 1]) {
        newRow[i] *= 2;
        scoreGained += newRow[i];
        newRow[i + 1] = 0;

        // Check for 2048
        if (newRow[i] === 2048 && !hasWon) {
          hasWon = true;
          showWinMessage = true;
        }
      }
    }

    // Remove zeros again after merging
    newRow = newRow.filter((x) => x !== 0);

    // Pad with zeros
    while (newRow.length < GRID_SIZE) {
      newRow.push(0);
    }

    return { row: newRow, scoreGained };
  }

  // Move left
  function moveLeft(g: Grid): {
    grid: Grid;
    scoreGained: number;
    changed: boolean;
  } {
    let newGrid: Grid = createEmptyGrid();
    let totalScore = 0;
    let changed = false;

    for (let i = 0; i < GRID_SIZE; i++) {
      const { row, scoreGained } = slideRow(g[i]);
      newGrid[i] = row;
      totalScore += scoreGained;

      if (JSON.stringify(row) !== JSON.stringify(g[i])) {
        changed = true;
      }
    }

    return { grid: newGrid, scoreGained: totalScore, changed };
  }

  // Move in any direction
  function move(direction: "left" | "right" | "up" | "down"): boolean {
    if (gameOver) return false;

    let g = grid;
    let rotations = 0;

    // Rotate to make all moves equivalent to "left"
    switch (direction) {
      case "up":
        rotations = 3;
        break;
      case "right":
        rotations = 2;
        break;
      case "down":
        rotations = 1;
        break;
    }

    // Rotate
    for (let i = 0; i < rotations; i++) {
      g = rotateGrid(g);
    }

    // Move left
    const { grid: movedGrid, scoreGained, changed } = moveLeft(g);

    // Rotate back
    g = movedGrid;
    for (let i = 0; i < (4 - rotations) % 4; i++) {
      g = rotateGrid(g);
    }

    if (changed) {
      score += scoreGained;
      grid = addRandomTile(g);

      // Check if game over
      if (isGameOver(grid)) {
        gameOver = true;
      }

      saveState();
      return true;
    }

    return false;
  }

  // Check if any moves are possible
  function isGameOver(g: Grid): boolean {
    // Check for empty cells
    if (getEmptyCells(g).length > 0) return false;

    // Check for possible merges horizontally
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE - 1; j++) {
        if (g[i][j] === g[i][j + 1]) return false;
      }
    }

    // Check for possible merges vertically
    for (let i = 0; i < GRID_SIZE - 1; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (g[i][j] === g[i + 1][j]) return false;
      }
    }

    return true;
  }

  // Handle keyboard input
  function handleKeydown(e: KeyboardEvent) {
    if (showWinMessage && e.key !== "Escape") {
      showWinMessage = false;
      saveState();
      return;
    }

    switch (e.key) {
      case "ArrowUp":
        move("up");
        e.preventDefault();
        break;
      case "ArrowDown":
        move("down");
        e.preventDefault();
        break;
      case "ArrowLeft":
        move("left");
        e.preventDefault();
        break;
      case "ArrowRight":
        move("right");
        e.preventDefault();
        break;
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  // Get tile color
  function getTileColor(value: number): string {
    const colors: Record<number, string> = {
      2: "bg-gray-200 text-gray-800",
      4: "bg-gray-300 text-gray-800",
      8: "bg-orange-400 text-white",
      16: "bg-orange-500 text-white",
      32: "bg-orange-600 text-white",
      64: "bg-red-500 text-white",
      128: "bg-yellow-400 text-white",
      256: "bg-yellow-500 text-white",
      512: "bg-yellow-600 text-white",
      1024: "bg-yellow-700 text-white",
      2048: "bg-yellow-800 text-white",
    };
    return colors[value] || "bg-purple-600 text-white";
  }

  function continueGame() {
    showWinMessage = false;
    saveState();
  }
</script>

<div class="flex flex-col items-center justify-center space-y-4">
  <!-- Score display -->
  <div class="flex items-center space-x-6 font-sans">
    <div class="text-center">
      <div class="text-gray-500 text-xs uppercase">Score</div>
      <div class="text-white text-2xl">{score}</div>
    </div>
    <div class="text-center">
      <div class="text-gray-500 text-xs uppercase">Best</div>
      <div class="text-orange-500 text-2xl">{bestScore}</div>
    </div>
  </div>

  <!-- Game grid -->
  <div class="bg-[#2a2a2a] p-3 rounded-lg" style="width: 340px; height: 340px;">
    <div class="grid grid-cols-4 gap-3 w-full h-full">
      {#each grid as row}
        {#each row as cell}
          <div class="relative">
            <div class="absolute inset-0 bg-[#1a1a1a] rounded"></div>
            {#if cell !== 0}
              <div
                class="absolute inset-0 rounded flex items-center justify-center font-bold text-xl transition-all duration-150 {getTileColor(
                  cell
                )}"
                style="animation: pop 0.2s ease-in-out;"
              >
                {cell}
              </div>
            {/if}
          </div>
        {/each}
      {/each}
    </div>
  </div>

  <!-- Controls -->
  <div class="flex items-center space-x-4">
    <button
      onclick={initGame}
      class="px-4 py-2 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
    >
      New Game
    </button>
  </div>

  <!-- Instructions -->
  <div class="text-gray-500 text-sm font-sans text-center space-y-1">
    <p>Use arrow keys to move tiles</p>
    <p>Merge tiles to reach <span class="text-yellow-500">2048</span>!</p>
    <p class="text-gray-600 text-xs mt-2">Progress is saved automatically</p>
  </div>

  <!-- Win message -->
  {#if showWinMessage}
    <div
      class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
    >
      <div class="text-center space-y-4">
        <div class="text-yellow-500 text-5xl font-sans mb-4">
          🎉 YOU WIN! 🎉
        </div>
        <div class="text-white text-2xl">You reached 2048!</div>
        <div class="flex items-center space-x-4 justify-center">
          <button
            onclick={continueGame}
            class="px-6 py-3 bg-green-500 text-black font-sans hover:bg-green-600 transition-colors"
          >
            Keep Playing
          </button>
          <button
            onclick={initGame}
            class="px-6 py-3 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Game over overlay -->
  {#if gameOver}
    <div
      class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
    >
      <div class="text-center space-y-4">
        <div class="text-red-500 text-5xl font-sans mb-4">GAME OVER</div>
        <div class="text-white text-2xl">Score: {score}</div>
        {#if score === bestScore && score > 0}
          <div class="text-yellow-500 text-lg">🏆 New Best Score!</div>
        {/if}
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

<style>
  @keyframes pop {
    0% {
      transform: scale(0);
    }
    50% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
    }
  }
</style>
