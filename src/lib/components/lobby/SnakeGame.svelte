<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  type Position = { x: number; y: number };
  type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

  const GRID_SIZE = 20;
  const CELL_SIZE = 20;
  const INITIAL_SPEED = 150;

  let snake: Position[] = [{ x: 10, y: 10 }];
  let direction: Direction = "RIGHT";
  let nextDirection: Direction = "RIGHT";
  let food: Position = { x: 15, y: 10 };
  let score = 0;
  let highScore = 0;
  let gameOver = false;
  let isPaused = false;
  let gameLoop: number | null = null;

  // Load game state from localStorage
  onMount(() => {
    const savedState = localStorage.getItem("lobby-snake-state");
    const savedHighScore = localStorage.getItem("lobby-snake-high-score");

    if (savedHighScore) {
      highScore = parseInt(savedHighScore, 10);
    }

    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        snake = state.snake || [{ x: 10, y: 10 }];
        direction = state.direction || "RIGHT";
        nextDirection = state.direction || "RIGHT";
        food = state.food || { x: 15, y: 10 };
        score = state.score || 0;
        gameOver = state.gameOver || false;
      } catch (e) {
        console.error("Failed to load snake state:", e);
        resetGame();
      }
    }
    startGame();
  });

  onDestroy(() => {
    if (gameLoop !== null) {
      clearInterval(gameLoop);
    }
  });

  // Save game state
  function saveState() {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "lobby-snake-state",
        JSON.stringify({
          snake,
          direction,
          food,
          score,
          gameOver,
        })
      );

      if (score > highScore) {
        highScore = score;
        localStorage.setItem("lobby-snake-high-score", highScore.toString());
      }
    }
  }

  function startGame() {
    if (gameLoop !== null) {
      clearInterval(gameLoop);
    }
    gameLoop = setInterval(tick, INITIAL_SPEED) as unknown as number;
  }

  function resetGame() {
    snake = [{ x: 10, y: 10 }];
    direction = "RIGHT";
    nextDirection = "RIGHT";
    food = generateFood();
    score = 0;
    gameOver = false;
    isPaused = false;
    saveState();
    startGame();
  }

  function generateFood(): Position {
    let newFood: Position;
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
    } while (
      snake.some(
        (segment) => segment.x === newFood.x && segment.y === newFood.y
      )
    );
    return newFood;
  }

  function tick() {
    if (gameOver || isPaused) return;

    direction = nextDirection;
    const head = snake[0];
    let newHead: Position;

    switch (direction) {
      case "UP":
        newHead = { x: head.x, y: head.y - 1 };
        break;
      case "DOWN":
        newHead = { x: head.x, y: head.y + 1 };
        break;
      case "LEFT":
        newHead = { x: head.x - 1, y: head.y };
        break;
      case "RIGHT":
        newHead = { x: head.x + 1, y: head.y };
        break;
    }

    // Check wall collision
    if (
      newHead.x < 0 ||
      newHead.x >= GRID_SIZE ||
      newHead.y < 0 ||
      newHead.y >= GRID_SIZE
    ) {
      gameOver = true;
      saveState();
      return;
    }

    // Check self collision
    if (
      snake.some(
        (segment) => segment.x === newHead.x && segment.y === newHead.y
      )
    ) {
      gameOver = true;
      saveState();
      return;
    }

    snake = [newHead, ...snake];

    // Check food collision
    if (newHead.x === food.x && newHead.y === food.y) {
      score += 10;
      food = generateFood();
    } else {
      snake.pop();
    }

    saveState();
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowUp":
        if (direction !== "DOWN") nextDirection = "UP";
        e.preventDefault();
        break;
      case "ArrowDown":
        if (direction !== "UP") nextDirection = "DOWN";
        e.preventDefault();
        break;
      case "ArrowLeft":
        if (direction !== "RIGHT") nextDirection = "LEFT";
        e.preventDefault();
        break;
      case "ArrowRight":
        if (direction !== "LEFT") nextDirection = "RIGHT";
        e.preventDefault();
        break;
      case " ":
        isPaused = !isPaused;
        e.preventDefault();
        break;
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<div class="flex flex-col items-center justify-center space-y-4">
  <div class="flex items-center space-x-8 font-sans text-lg">
    <div class="text-white">
      Score: <span class="text-orange-500">{score}</span>
    </div>
    <div class="text-white">
      Best: <span class="text-yellow-500">{highScore}</span>
    </div>
    {#if isPaused}
      <div class="text-yellow-500">PAUSED</div>
    {/if}
  </div>

  <div
    class="border-2 border-[#2a2a2a] bg-black"
    style="width: {GRID_SIZE * CELL_SIZE}px; height: {GRID_SIZE *
      CELL_SIZE}px; position: relative;"
  >
    <!-- Snake -->
    {#each snake as segment, i}
      <div
        class="absolute {i === 0 ? 'bg-orange-500' : 'bg-orange-600'}"
        style="
					width: {CELL_SIZE - 2}px;
					height: {CELL_SIZE - 2}px;
					left: {segment.x * CELL_SIZE}px;
					top: {segment.y * CELL_SIZE}px;
				"
      />
    {/each}

    <!-- Food -->
    <div
      class="absolute bg-green-500 rounded-full"
      style="
				width: {CELL_SIZE - 4}px;
				height: {CELL_SIZE - 4}px;
				left: {food.x * CELL_SIZE + 2}px;
				top: {food.y * CELL_SIZE + 2}px;
			"
    />

    <!-- Game Over overlay -->
    {#if gameOver}
      <div
        class="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center"
      >
        <div class="text-center">
          <div class="text-red-500 text-3xl font-sans mb-4">GAME OVER</div>
          <div class="text-white text-xl mb-2">Score: {score}</div>
          {#if score === highScore && score > 0}
            <div class="text-yellow-500 text-lg mb-4">🏆 New High Score!</div>
          {/if}
          <button
            onclick={resetGame}
            class="px-4 py-2 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors mt-2"
          >
            Play Again
          </button>
        </div>
      </div>
    {/if}
  </div>

  <div class="text-gray-500 text-sm font-sans space-y-1 text-center">
    <p>Use arrow keys to move</p>
    <p>Press SPACE to pause</p>
    <p class="text-gray-600 text-xs mt-2">
      Your progress is saved automatically
    </p>
  </div>
</div>
