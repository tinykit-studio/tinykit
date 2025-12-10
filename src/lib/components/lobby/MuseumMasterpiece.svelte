<script lang="ts">
	import { onMount } from 'svelte';

	interface Artwork {
		title: string;
		artist: string;
		date: string;
		medium: string;
		department: string;
		culture: string;
		imageUrl: string;
		metUrl: string;
	}

	let artwork = $state<Artwork | null>(null);
	let loading = $state(true);
	let error = $state(false);

	// Met Museum API - public domain artworks with images
	const HIGHLIGHTED_OBJECTS = [
		436535, // Wheat Field with Cypresses - Van Gogh
		438817, // Madame X - Sargent
		436121, // Bridge over a Pond of Water Lilies - Monet
		438754, // Young Mother Sewing - Cassatt
		436532, // Cypresses - Van Gogh
		437853, // The Gulf Stream - Homer
		11060,  // Gertrude Stein - Picasso
		436105, // Garden at Sainte-Adresse - Monet
		459080, // Washington Crossing the Delaware - Leutze
		10699   // Bodhisattva - Chinese sculpture
	];

	async function fetchRandomArtwork() {
		loading = true;
		error = false;

		try {
			// Pick a random object from highlighted collection
			const objectId = HIGHLIGHTED_OBJECTS[Math.floor(Math.random() * HIGHLIGHTED_OBJECTS.length)];

			const response = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);

			if (!response.ok) throw new Error('Failed to fetch artwork');

			const data = await response.json();

			artwork = {
				title: data.title || 'Untitled',
				artist: data.artistDisplayName || 'Unknown Artist',
				date: data.objectDate || 'Date unknown',
				medium: data.medium || 'Medium unknown',
				department: data.department || '',
				culture: data.culture || '',
				imageUrl: data.primaryImage || '',
				metUrl: data.objectURL || ''
			};

			loading = false;
		} catch (err) {
			console.error('Failed to fetch artwork:', err);
			error = true;
			loading = false;
		}
	}

	onMount(() => {
		fetchRandomArtwork();
	});
</script>

<div class="h-full flex flex-col bg-[#1a1a1a] text-white overflow-hidden">
	{#if loading}
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center">
				<div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
				<p class="text-gray-400">Loading masterpiece...</p>
			</div>
		</div>
	{:else if error}
		<div class="flex-1 flex items-center justify-center p-8">
			<div class="text-center">
				<p class="text-red-400 mb-4">Failed to load artwork</p>
				<button
					onclick={fetchRandomArtwork}
					class="px-4 py-2 bg-white text-black rounded hover:bg-gray-200 transition"
				>
					Try Again
				</button>
			</div>
		</div>
	{:else if artwork}
		<div class="flex-1 flex flex-col md:flex-row overflow-hidden">
			<!-- Image -->
			<div class="flex-1 flex items-center justify-center p-8 bg-[#0d0d0d]">
				<img
					src={artwork.imageUrl}
					alt={artwork.title}
					class="max-h-full max-w-full object-contain"
				/>
			</div>

			<!-- Info -->
			<div class="w-full md:w-96 p-8 overflow-y-auto">
				<h2 class="text-2xl font-bold mb-2">{artwork.title}</h2>
				<p class="text-xl text-gray-300 mb-4">{artwork.artist}</p>
				<p class="text-gray-400 mb-6">{artwork.date}</p>

				<div class="space-y-4 text-sm">
					{#if artwork.medium}
						<div>
							<span class="text-gray-500">Medium:</span>
							<p class="text-gray-300">{artwork.medium}</p>
						</div>
					{/if}

					{#if artwork.department}
						<div>
							<span class="text-gray-500">Department:</span>
							<p class="text-gray-300">{artwork.department}</p>
						</div>
					{/if}

					{#if artwork.culture}
						<div>
							<span class="text-gray-500">Culture:</span>
							<p class="text-gray-300">{artwork.culture}</p>
						</div>
					{/if}
				</div>

				<div class="mt-8 space-y-2">
					<button
						onclick={fetchRandomArtwork}
						class="w-full px-4 py-2 bg-white text-black rounded hover:bg-gray-200 transition font-medium"
					>
						Next Masterpiece
					</button>
					{#if artwork.metUrl}
						<a
							href={artwork.metUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="block w-full px-4 py-2 border border-white text-white rounded hover:bg-white hover:text-black transition font-medium text-center"
						>
							View on Met Museum
						</a>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
