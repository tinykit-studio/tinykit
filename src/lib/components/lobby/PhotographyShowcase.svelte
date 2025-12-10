<script lang="ts">
  import { onMount } from "svelte";

  interface Photo {
    url: string;
    photographer: string;
    location: string;
    description: string;
  }

  // Curated collection of stunning public domain / CC0 photos from Unsplash
  // Using direct URLs to avoid API key requirements
  const photos: Photo[] = [
    {
      url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80",
      photographer: "Luca Bravo",
      location: "Mountain landscape",
      description: "Misty mountain peaks at sunrise",
    },
    {
      url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=80",
      photographer: "David Marcu",
      location: "Forest trail",
      description: "Winding path through autumn forest",
    },
    {
      url: "https://images.unsplash.com/photo-1511884642898-4c92249e20b6?w=1200&q=80",
      photographer: "Roberto Nickson",
      location: "Ocean waves",
      description: "Turquoise waves crashing on shore",
    },
    {
      url: "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&q=80",
      photographer: "Qingbao Meng",
      location: "Lakeside sunset",
      description: "Golden hour reflection on calm water",
    },
    {
      url: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&q=80",
      photographer: "Luke Stackpoole",
      location: "Desert dunes",
      description: "Sweeping sand dunes under blue sky",
    },
    {
      url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80",
      photographer: "v2osk",
      location: "Northern lights",
      description: "Aurora borealis over snowy landscape",
    },
    {
      url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80",
      photographer: "Casey Horner",
      location: "Forest canopy",
      description: "Sunlight filtering through trees",
    },
    {
      url: "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1200&q=80",
      photographer: "Ales Krivec",
      location: "Starry night",
      description: "Milky way over mountain ridge",
    },
    {
      url: "https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1200&q=80",
      photographer: "Todd Diemer",
      location: "Alpine meadow",
      description: "Wildflowers in mountain valley",
    },
    {
      url: "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80",
      photographer: "Tim Swaan",
      location: "Tropical beach",
      description: "Palm trees swaying over turquoise water",
    },
  ];

  let currentIndex = $state(0);

  onMount(() => {
    currentIndex = Math.floor(Math.random() * photos.length);
  });

  function nextPhoto() {
    currentIndex = (currentIndex + 1) % photos.length;
  }

  let currentPhoto = $derived(photos[currentIndex]);
</script>

<div class="flex flex-col items-center justify-center space-y-6 px-4">
  <!-- Photo Display -->
  <div
    class="border-2 border-[#2a2a2a] rounded-lg overflow-hidden max-w-3xl w-full"
  >
    <img
      src={currentPhoto.url}
      alt={currentPhoto.description}
      class="w-full h-auto max-h-[500px] object-cover"
    />
  </div>

  <!-- Photo Info -->
  <div class="text-center space-y-1">
    <p class="text-white font-sans text-lg">{currentPhoto.description}</p>
    <p class="text-gray-400 font-sans text-sm">
      📸 {currentPhoto.photographer}
    </p>
  </div>

  <!-- Single Button -->
  <button
    onclick={nextPhoto}
    class="px-6 py-3 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
  >
    Next Image
  </button>
</div>
