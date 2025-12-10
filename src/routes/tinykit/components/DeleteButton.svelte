<script lang="ts">
	import { Button } from "$lib/components/ui/button"
	import Trash2 from "lucide-svelte/icons/trash-2"

	type DeleteButtonProps = {
		onclick: () => void
		disabled?: boolean
	}

	let { onclick, disabled = false }: DeleteButtonProps = $props()
</script>

<Button
	variant="outline"
	size="icon"
	{onclick}
	{disabled}
	class="shrink-0 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/50"
>
	<Trash2 class="h-4 w-4" />
</Button>
