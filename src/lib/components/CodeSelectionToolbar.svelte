<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	let {
		show = false,
		selectedText = '',
		language = ''
	}: {
		show?: boolean
		selectedText?: string
		language?: string
	} = $props()

	const dispatch = createEventDispatcher<{
		sendToChat: void;
	}>();

	function handleSendToChat() {
		dispatch('sendToChat');
	}
</script>

{#if show && selectedText}
	<div
		class="code-selection-toolbar"
		transition:scale={{ duration: 150, start: 0.9 }}
	>
		<button
			class="toolbar-button"
			onclick={handleSendToChat}
			title="Send to chat (⌘K / Ctrl+K)"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
			<span>Ask AI</span>
			<span class="shortcut">⌘K</span>
		</button>
	</div>
{/if}

<style>
	.code-selection-toolbar {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1000;
		background: rgba(30, 30, 30, 0.95);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.3),
			0 0 0 1px rgba(255, 255, 255, 0.05);
		padding: 4px;
	}

	.toolbar-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: transparent;
		border: none;
		color: #e0e0e0;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.15s ease;
		white-space: nowrap;
	}

	.toolbar-button:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.toolbar-button:active {
		transform: scale(0.98);
	}

	.toolbar-button svg {
		flex-shrink: 0;
	}

	.shortcut {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.5);
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
	}
</style>
