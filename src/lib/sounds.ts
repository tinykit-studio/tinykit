// Subtle UI sounds using Web Audio API
// No external files needed - generates tones programmatically

const STORAGE_KEY = "tinykit:sounds_enabled"

// Lazy-init AudioContext (browsers require user gesture before creating)
let ctx: AudioContext | null = null

function get_context(): AudioContext | null {
	if (typeof window === "undefined") return null
	if (!ctx) {
		try {
			ctx = new AudioContext()
		} catch {
			return null
		}
	}
	return ctx
}

export function is_sounds_enabled(): boolean {
	if (typeof window === "undefined") return false
	return localStorage.getItem(STORAGE_KEY) !== "false"
}

export function set_sounds_enabled(enabled: boolean): void {
	if (typeof window === "undefined") return
	localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false")
}

// Soft tap sound - short, subtle click
export function play_tap(): void {
	if (!is_sounds_enabled()) return
	const audio = get_context()
	if (!audio) return

	const osc = audio.createOscillator()
	const gain = audio.createGain()

	osc.connect(gain)
	gain.connect(audio.destination)

	osc.frequency.value = 800
	osc.type = "sine"

	gain.gain.setValueAtTime(0.08, audio.currentTime)
	gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.05)

	osc.start(audio.currentTime)
	osc.stop(audio.currentTime + 0.05)
}

// Completion chime - pleasant ascending tone
export function play_complete(): void {
	if (!is_sounds_enabled()) return
	const audio = get_context()
	if (!audio) return

	const now = audio.currentTime

	// Two-note ascending chime
	const notes = [523.25, 659.25] // C5, E5
	const duration = 0.12

	notes.forEach((freq, i) => {
		const osc = audio.createOscillator()
		const gain = audio.createGain()

		osc.connect(gain)
		gain.connect(audio.destination)

		osc.frequency.value = freq
		osc.type = "sine"

		const start = now + i * duration * 0.8
		gain.gain.setValueAtTime(0, start)
		gain.gain.linearRampToValueAtTime(0.1, start + 0.02)
		gain.gain.exponentialRampToValueAtTime(0.001, start + duration)

		osc.start(start)
		osc.stop(start + duration)
	})
}

// Error sound - descending tone
export function play_error(): void {
	if (!is_sounds_enabled()) return
	const audio = get_context()
	if (!audio) return

	const osc = audio.createOscillator()
	const gain = audio.createGain()

	osc.connect(gain)
	gain.connect(audio.destination)

	osc.frequency.setValueAtTime(400, audio.currentTime)
	osc.frequency.exponentialRampToValueAtTime(200, audio.currentTime + 0.15)
	osc.type = "sine"

	gain.gain.setValueAtTime(0.08, audio.currentTime)
	gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15)

	osc.start(audio.currentTime)
	osc.stop(audio.currentTime + 0.15)
}
