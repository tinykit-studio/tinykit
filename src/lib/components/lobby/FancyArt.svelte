<script lang="ts">
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";

	interface Artwork {
		title: string;
		artist: string;
		artistBio: string;
		date: string;
		medium: string;
		dimensions: string;
		department: string;
		culture: string;
		classification: string;
		creditLine: string;
		imageUrl: string;
		metUrl: string;
		description?: string;
	}

	let artwork = $state<Artwork | null>(null);
	let loading = $state(true);
	let loadingDescription = $state(false);
	let error = $state(false);
	let availableArtworks = $state<number[]>([]);

	// Department IDs for paintings and fine art (to avoid artifacts)
	const ART_DEPARTMENTS = [
		11, // European Paintings
		21, // Modern and Contemporary Art
		6,  // Asian Art
		1,  // American Decorative Arts
		13, // Greek and Roman Art
	];

	// Search queries for different art categories
	const SEARCH_QUERIES = [
		"Van Gogh",
		"Monet",
		"Rembrandt",
		"Picasso",
		"painting",
		"sculpture",
		"landscape",
		"portrait"
	];

	async function fetchDescription(metUrl: string) {
		loadingDescription = true;
		try {
			// Use proxy to fetch the Met Museum page
			const response = await fetch(`/api/proxy?url=${encodeURIComponent(metUrl)}`);

			if (response.ok) {
				const html = await response.text();

				// Parse HTML and use querySelector
				const parser = new DOMParser();
				const doc = parser.parseFromString(html, 'text/html');
				const wrapper = doc.querySelector('[data-sentry-component="ReadMoreWrapper"]');
				const markdown = wrapper?.querySelector('[data-sentry-element="Markdown"]');

				let description = markdown?.textContent
					?.replace(/\[(\d+)\]/g, '') // Remove footnote markers like [1]
					.trim();

				if (artwork && description) {
					artwork = { ...artwork, description };
				}
			}
		} catch (err) {
			console.error("Failed to fetch description:", err);
		} finally {
			loadingDescription = false;
		}
	}

	async function fetchArtworkById(objectId: number) {
		try {
			const response = await fetch(
				`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`,
			);

			if (!response.ok) throw new Error("Failed to fetch artwork");

			const data = await response.json();

			// Validate that it has an image
			if (!data.primaryImage) {
				throw new Error("No image available");
			}

			const metUrl = data.objectURL || "";

			artwork = {
				title: data.title || "Untitled",
				artist: data.artistDisplayName || "Unknown Artist",
				artistBio: data.artistDisplayBio || "",
				date: data.objectDate || "Date unknown",
				medium: data.medium || "",
				dimensions: data.dimensions || "",
				department: data.department || "",
				culture: data.culture || "",
				classification: data.classification || "",
				creditLine: data.creditLine || "",
				imageUrl: data.primaryImage || "",
				metUrl,
			};

			loading = false;

			// Fetch description from Met Museum page
			if (metUrl) {
				fetchDescription(metUrl);
			}
		} catch (err) {
			throw err;
		}
	}

	async function loadAvailableArtworks() {
		try {
			// Pick a random search query and department
			const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
			const deptId = ART_DEPARTMENTS[Math.floor(Math.random() * ART_DEPARTMENTS.length)];

			const response = await fetch(
				`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&departmentId=${deptId}&q=${encodeURIComponent(query)}`
			);

			if (!response.ok) throw new Error("Search failed");

			const data = await response.json();

			if (data.objectIDs && data.objectIDs.length > 0) {
				// Store up to 100 random artworks from the results
				const shuffled = data.objectIDs.sort(() => 0.5 - Math.random());
				availableArtworks = shuffled.slice(0, 100);
			}
		} catch (err) {
			console.error("Failed to load artwork IDs:", err);
		}
	}

	async function fetchRandomArtwork() {
		loading = true;
		error = false;

		// Load artworks if we don't have any cached
		if (availableArtworks.length === 0) {
			await loadAvailableArtworks();
		}

		// If still no artworks, reload and try again
		if (availableArtworks.length === 0) {
			console.log("No artworks found, retrying...");
			setTimeout(fetchRandomArtwork, 1000);
			return;
		}

		// Try up to 3 times to find a valid artwork
		for (let i = 0; i < 3; i++) {
			try {
				const randomIndex = Math.floor(Math.random() * availableArtworks.length);
				const objectId = availableArtworks[randomIndex];
				await fetchArtworkById(objectId);
				return; // Success!
			} catch (err) {
				console.error(`Attempt ${i + 1} failed:`, err);
			}
		}

		// If all attempts failed, reload artworks and try again
		console.log("All attempts failed, clearing cache and retrying...");
		availableArtworks = [];
		setTimeout(fetchRandomArtwork, 1000);
	}

	onMount(() => {
		fetchRandomArtwork();
	});
</script>

<div
	class="w-full h-full flex flex-col bg-[#1a1a1a] text-white overflow-hidden"
>
	{#if loading}
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center">
				<div
					class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"
				></div>
				<p class="text-gray-400">Loading fancy art...</p>
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
			<div
				class="flex-1 flex items-center justify-center p-8 bg-[#0d0d0d]"
			>
				<img
					src={artwork.imageUrl}
					alt={artwork.title}
					class="max-h-full max-w-full object-contain"
				/>
			</div>

			<!-- Info -->
			<div class="w-full md:w-96 p-8 overflow-y-auto">
				<h2 class="text-2xl font-bold mb-2">{artwork.title}</h2>
				<p class="text-xl text-gray-300 mb-1">{artwork.artist}</p>
				{#if artwork.artistBio}
					<p class="text-sm text-gray-500 mb-4">{artwork.artistBio}</p>
				{/if}
				<p class="text-gray-400 mb-6">{artwork.date}</p>

				<!-- Description -->
				{#if artwork.description}
					<div class="mb-6 p-4 bg-gray-800/50 rounded border border-gray-700" transition:fade={{ duration: 300 }}>
						<p class="text-sm text-gray-300 leading-relaxed">{artwork.description}</p>
					</div>
				{/if}

				<div class="space-y-3 text-sm">
					{#if artwork.classification}
						<div>
							<span class="text-gray-500 font-medium">Type:</span>
							<p class="text-gray-300">{artwork.classification}</p>
						</div>
					{/if}

					{#if artwork.medium}
						<div>
							<span class="text-gray-500 font-medium">Medium:</span>
							<p class="text-gray-300">{artwork.medium}</p>
						</div>
					{/if}

					{#if artwork.dimensions}
						<div>
							<span class="text-gray-500 font-medium">Dimensions:</span>
							<p class="text-gray-300">{artwork.dimensions}</p>
						</div>
					{/if}

					{#if artwork.culture}
						<div>
							<span class="text-gray-500 font-medium">Culture:</span>
							<p class="text-gray-300">{artwork.culture}</p>
						</div>
					{/if}

					{#if artwork.department}
						<div>
							<span class="text-gray-500 font-medium">Department:</span>
							<p class="text-gray-300">{artwork.department}</p>
						</div>
					{/if}

					{#if artwork.creditLine}
						<div class="pt-2 border-t border-gray-700">
							<span class="text-gray-500 font-medium text-xs">Acquired:</span>
							<p class="text-gray-400 text-xs mt-1">{artwork.creditLine}</p>
						</div>
					{/if}
				</div>

				<div class="mt-8 space-y-2">
					<button
						onclick={fetchRandomArtwork}
						class="w-full px-4 py-2 bg-white text-black rounded hover:bg-gray-200 transition font-medium"
					>
						More Fancy Art →
					</button>
					{#if artwork.metUrl}
						<a
							href={artwork.metUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="block w-full px-4 py-2 border border-white text-white rounded hover:bg-white hover:text-black transition font-medium text-center"
						>
							Read Full Description
						</a>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
