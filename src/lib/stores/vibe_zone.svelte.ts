type VibeId =
	| "snake"
	| "2048"
	| "tetris"
	| "wordle"
	| "video"
	| "lofi"
	| "museum"
	| "music";

const allVibes: VibeId[] = [
	"snake",
	"2048",
	"tetris",
	"wordle",
	"video",
	"lofi",
	"museum",
	"music"
];

function shuffleArray<T>(array: T[]): T[] {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

// Load from localStorage on init
function loadHiddenVibes(): string[] {
	if (typeof window === "undefined") return [];
	const saved = localStorage.getItem("vibezone-hidden");
	return saved ? JSON.parse(saved) : [];
}

function loadCurrentVibeIndex(shuffled: VibeId[]): number {
	if (typeof window === "undefined") return 0;
	const savedVibe = localStorage.getItem("vibezone-current-vibe") as VibeId | null;
	if (savedVibe && shuffled.includes(savedVibe)) {
		const index = shuffled.indexOf(savedVibe);
		if (index !== -1) return index;
	}
	return 0;
}

// Shared state
let hidden_vibes = $state<string[]>(loadHiddenVibes());
let shuffled_vibes = $state<VibeId[]>([]);
let current_vibe_index = $state(0);
let is_loading = $state(true);

// Initialize shuffled vibes
function updateShuffledVibes() {
	const visibleVibes = allVibes.filter((vibe) => !hidden_vibes.includes(vibe));
	shuffled_vibes = shuffleArray(visibleVibes);
	// Re-validate current index
	if (current_vibe_index >= shuffled_vibes.length) {
		current_vibe_index = 0;
	}
}

// Initial setup
if (typeof window !== "undefined") {
	updateShuffledVibes();
	current_vibe_index = loadCurrentVibeIndex(shuffled_vibes);
	setTimeout(() => {
		is_loading = false;
	}, 100);
}

function saveHiddenVibes() {
	if (typeof window !== "undefined") {
		localStorage.setItem("vibezone-hidden", JSON.stringify(hidden_vibes));
	}
}

function saveCurrentVibe() {
	if (typeof window !== "undefined" && shuffled_vibes.length > 0) {
		const vibe = shuffled_vibes[current_vibe_index];
		if (vibe) {
			localStorage.setItem("vibezone-current-vibe", vibe);
		}
	}
}

export const vibe_zone_state = {
	get hidden_vibes() {
		return hidden_vibes;
	},
	set hidden_vibes(value: string[]) {
		hidden_vibes = value;
		updateShuffledVibes();
		saveHiddenVibes();
	},
	get shuffled_vibes() {
		return shuffled_vibes;
	},
	get current_vibe_index() {
		return current_vibe_index;
	},
	set current_vibe_index(value: number) {
		current_vibe_index = value;
		saveCurrentVibe();
	},
	get is_loading() {
		return is_loading;
	},
	get current_vibe() {
		return shuffled_vibes[current_vibe_index];
	},
	next_vibe() {
		if (shuffled_vibes.length === 0) return;
		current_vibe_index = (current_vibe_index + 1) % shuffled_vibes.length;
		saveCurrentVibe();
	},
	hide_current_vibe() {
		if (shuffled_vibes.length === 0) return;
		const vibeToHide = shuffled_vibes[current_vibe_index];
		hidden_vibes = [...hidden_vibes, vibeToHide];
		updateShuffledVibes();
		if (current_vibe_index >= shuffled_vibes.length) {
			current_vibe_index = 0;
		}
		saveHiddenVibes();
		saveCurrentVibe();
	},
	restore_all_vibes() {
		hidden_vibes = [];
		updateShuffledVibes();
		saveHiddenVibes();
	}
};
