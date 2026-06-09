<template>
  <div class="preview-content">
    <div class="audio-preview" ref="playerRef"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useTauri } from "@/composables/useTauri";
import APlayer from "aplayer";
import "aplayer/dist/APlayer.min.css";

const props = defineProps({ entry: Object });
const store = useAppStore();
const tauri = useTauri();
const playerRef = ref(null);
let player = null;

onMounted(async () => {
  try {
    const entries = store.entries.filter(
      (e) =>
        e.entryType === "file" && (e.kind === "audio" || e.kind === "music"),
    );
    const results = await Promise.allSettled(
      entries.map((e) => tauri.fileUrl(e.absolutePath)),
    );
    const audio = [];
    let currentIndex = 0;
    for (let i = 0; i < entries.length; i++) {
      if (results[i].status === "rejected") continue;
      audio.push({
        name: entries[i].name || "unknown",
        artist: entries[i].artist || "unknown",
        url: results[i].value,
      });
      if (entries[i].path === props.entry?.path) {
        currentIndex = audio.length - 1;
      }
    }
    if (!audio.length) return;

    console.log(audio);
    player = new APlayer({
      container: playerRef.value,
      theme: "#1264a3",
      audio: audio,
      index: currentIndex,
      mini: false,
      autoplay: false,
      loop: "all",
      order: "random",
      preload: "auto",
      volume: 0.7,
      mutex: true,
      listFolded: false,
      listMaxHeight: 290,
      lrcType: 3,
    });

    // show song list
    // const aplayerEl = playerRef.value.querySelector(".aplayer");
    // if (aplayerEl) {
    //   aplayerEl.classList.add("aplayer-withlist");
    // }
  } catch (e) {
    console.error("audio error:", e);
  }
});

onUnmounted(() => {
  if (player) {
    player.destroy();
    player = null;
  }
});
</script>
