<script lang="ts">
  import { onMount } from "svelte";

  type GuessResult = "correct" | "present" | "absent" | "empty";
  type LetterState = { letter: string; state: GuessResult };

  const WORD_LIST = [
    "REACT",
    "ASYNC",
    "DEBUG",
    "CACHE",
    "CLONE",
    "BUILD",
    "STACK",
    "QUERY",
    "FETCH",
    "HOOKS",
    "STATE",
    "PROPS",
    "NODES",
    "ARRAY",
    "CLASS",
    "SUPER",
    "MERGE",
    "PATCH",
    "ROUTE",
    "FRAME",
    "SCALE",
    "SCOPE",
    "SHELL",
    "TOKEN",
    "PARSE",
    "INDEX",
    "YIELD",
    "THROW",
    "BYTES",
    "MUTEX",
    "QUEUE",
    "REDIS",
    "NGINX",
    "PROXY",
    "ADMIN",
    "AXIOS",
    "BABEL",
    "CHART",
    "MONGO",
    "KAFKA",
    "LINUX",
    "SWIFT",
    "FLASK",
    "RAILS",
    "MYSQL",
    "HTTPS",
    "PORTS",
    "HOSTS",
  ];

  const MAX_GUESSES = 6;
  const WORD_LENGTH = 5;

  let targetWord = "";
  let guesses: LetterState[][] = [];
  let currentGuess = "";
  let gameOver = false;
  let won = false;
  let message = "";
  let totalWins = 0;
  let currentStreak = 0;
  let colorblindMode = false;

  onMount(() => {
    loadGameState();
    loadColorblindMode();
  });

  function loadColorblindMode() {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("lobby-wordle-colorblind");
    colorblindMode = saved === "true";
  }

  function toggleColorblindMode() {
    colorblindMode = !colorblindMode;
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "lobby-wordle-colorblind",
        colorblindMode.toString()
      );
    }
  }

  function loadGameState() {
    if (typeof window === "undefined") return;

    const savedState = localStorage.getItem("lobby-wordle-state");
    const stats = localStorage.getItem("lobby-wordle-stats");

    if (stats) {
      try {
        const parsed = JSON.parse(stats);
        totalWins = parsed.totalWins || 0;
        currentStreak = parsed.currentStreak || 0;
      } catch (e) {
        console.error("Failed to load wordle stats:", e);
      }
    }

    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        const savedDate = state.date;
        const today = new Date().toDateString();

        if (savedDate === today && state.targetWord) {
          targetWord = state.targetWord;
          guesses = state.guesses || [];
          gameOver = state.gameOver || false;
          won = state.won || false;
          message = state.message || "";
          return;
        }
      } catch (e) {
        console.error("Failed to load wordle state:", e);
      }
    }

    startNewGame();
  }

  function startNewGame() {
    targetWord = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    guesses = [];
    currentGuess = "";
    gameOver = false;
    won = false;
    message = "";
    saveGameState();
  }

  function saveGameState() {
    if (typeof window === "undefined") return;

    localStorage.setItem(
      "lobby-wordle-state",
      JSON.stringify({
        date: new Date().toDateString(),
        targetWord,
        guesses,
        gameOver,
        won,
        message,
      })
    );

    localStorage.setItem(
      "lobby-wordle-stats",
      JSON.stringify({
        totalWins,
        currentStreak,
      })
    );
  }

  function checkGuess(guess: string): LetterState[] {
    const result: LetterState[] = [];
    const targetLetters = targetWord.split("");
    const guessLetters = guess.split("");

    // First pass: mark correct positions
    const remaining: string[] = [];
    guessLetters.forEach((letter, i) => {
      if (letter === targetLetters[i]) {
        result[i] = { letter, state: "correct" };
      } else {
        remaining.push(targetLetters[i]);
        result[i] = { letter, state: "absent" };
      }
    });

    // Second pass: mark present letters
    guessLetters.forEach((letter, i) => {
      if (result[i].state === "absent") {
        const index = remaining.indexOf(letter);
        if (index !== -1) {
          result[i] = { letter, state: "present" };
          remaining.splice(index, 1);
        }
      }
    });

    return result;
  }

  function submitGuess() {
    if (currentGuess.length !== WORD_LENGTH) {
      message = "Word must be 5 letters";
      setTimeout(() => (message = ""), 2000);
      return;
    }

    const guess = currentGuess.toUpperCase();
    const result = checkGuess(guess);
    guesses = [...guesses, result];
    currentGuess = "";

    if (guess === targetWord) {
      gameOver = true;
      won = true;
      totalWins++;
      currentStreak++;
      message = "🎉 You got it!";
    } else if (guesses.length >= MAX_GUESSES) {
      gameOver = true;
      won = false;
      currentStreak = 0;
      message = `The word was ${targetWord}`;
    }

    saveGameState();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (gameOver) return;

    if (e.key === "Enter") {
      submitGuess();
    } else if (e.key === "Backspace") {
      currentGuess = currentGuess.slice(0, -1);
    } else if (
      e.key.length === 1 &&
      /[a-zA-Z]/.test(e.key) &&
      currentGuess.length < WORD_LENGTH
    ) {
      currentGuess += e.key.toUpperCase();
    }
  }

  function getCellColor(state: GuessResult): string {
    if (colorblindMode) {
      switch (state) {
        case "correct":
          return "bg-blue-600";
        case "present":
          return "bg-orange-600";
        case "absent":
          return "bg-gray-700";
        case "empty":
          return "bg-[#2a2a2a] border border-[#3a3a3a]";
      }
    } else {
      switch (state) {
        case "correct":
          return "bg-green-600";
        case "present":
          return "bg-yellow-600";
        case "absent":
          return "bg-gray-700";
        case "empty":
          return "bg-[#2a2a2a] border border-[#3a3a3a]";
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<div
  class="flex flex-col items-center justify-center space-y-6 max-w-md mx-auto"
>
  <div class="flex items-center justify-between w-full font-sans text-sm">
    <div class="flex items-center space-x-6">
      <div class="text-white">
        Wins: <span class="text-green-500">{totalWins}</span>
      </div>
      <div class="text-white">
        Streak: <span class="text-orange-500">{currentStreak}</span>
      </div>
    </div>
    <button
      onclick={toggleColorblindMode}
      class="px-3 py-1 text-xs border border-[#2a2a2a] hover:border-orange-500 text-gray-400 hover:text-orange-500 transition-colors rounded"
      title="Toggle colorblind mode"
    >
      {colorblindMode ? "👁️ Colorblind" : "👁️ Normal"}
    </button>
  </div>

  <!-- Grid -->
  <div class="space-y-2">
    {#each Array(MAX_GUESSES) as _, rowIndex}
      <div class="flex space-x-2">
        {#each Array(WORD_LENGTH) as _, colIndex}
          {@const guess = guesses[rowIndex]}
          {@const isCurrentRow = rowIndex === guesses.length && !gameOver}
          {@const letter = guess
            ? guess[colIndex].letter
            : (isCurrentRow && currentGuess[colIndex]) || ""}
          {@const state = guess ? guess[colIndex].state : "empty"}
          <div
            class="w-14 h-14 flex items-center justify-center font-sans text-2xl font-bold text-white {getCellColor(
              state
            )} transition-colors"
          >
            {letter}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <!-- Message -->
  {#if message}
    <div
      class="text-center font-sans text-lg {won
        ? 'text-green-500'
        : 'text-orange-500'}"
    >
      {message}
    </div>
  {/if}

  <!-- Instructions or New Game -->
  {#if gameOver}
    <button
      onclick={startNewGame}
      class="px-6 py-3 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
    >
      New Game
    </button>
  {:else}
    <div class="text-gray-500 text-sm font-sans text-center space-y-1">
      <p>Guess the 5-letter tech word</p>
      <p class="text-xs text-gray-600">Type and press ENTER</p>
      <p class="text-xs text-gray-600">One puzzle per day • Progress saved</p>
    </div>
  {/if}

  <!-- Legend -->
  <div class="flex space-x-4 text-xs font-sans">
    <div class="flex items-center space-x-1">
      <div
        class="w-6 h-6 {colorblindMode ? 'bg-blue-600' : 'bg-green-600'}"
      ></div>
      <span class="text-gray-400">Correct</span>
    </div>
    <div class="flex items-center space-x-1">
      <div
        class="w-6 h-6 {colorblindMode ? 'bg-orange-600' : 'bg-yellow-600'}"
      ></div>
      <span class="text-gray-400">Wrong spot</span>
    </div>
    <div class="flex items-center space-x-1">
      <div class="w-6 h-6 bg-gray-700"></div>
      <span class="text-gray-400">Not in word</span>
    </div>
  </div>
</div>
