// Brain Companion — Mobile Client
import { openUrl } from "@tauri-apps/plugin-opener";
import { 
  enqueueOfflineTask, 
  getOfflineTasks, 
  removeOfflineTask, 
  countOfflineTasks 
} from "./offlineQueue";

// Adres serwera ustawiany przy budowaniu obrazu (`VITE_BRAIN_SERVER`) — dla
// instalacji klienta wskazuje jego host w tailnecie, np. http://twoj-host.
const BUILD_DEFAULT_SERVER = String(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_BRAIN_SERVER ?? ""
).trim();

const CANDIDATE_SERVERS: string[] = (() => {
  const custom = localStorage.getItem("brain_servers");
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [
    ...(BUILD_DEFAULT_SERVER ? [BUILD_DEFAULT_SERVER] : []),
    "http://127.0.0.1:8777",
    "http://brain.local:8777"
  ];
})();

const BRAIN_API_TOKEN = localStorage.getItem("brain_api_token") || "";

// Nazwa urządzenia widoczna w stopce — konfigurowana w ⚙️ (albo z builda),
// nigdy zaszyta: każda stacja ma inną (laptop, Mac, telefon).
const BUILD_DEFAULT_DEVICE = String(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_BRAIN_DEVICE ?? ""
).trim();
const DEVICE_LABEL = localStorage.getItem("brain_device_label") || BUILD_DEFAULT_DEVICE || "Twoje urządzenie";
const FEED_CACHE_KEY = "brain_companion_feed_cache";
let activeServerUrl = CANDIDATE_SERVERS[0];

// Odczyt (notatki, feed) działa tylko w tailnecie: publiczna brama (np. api.*)
// wyłącznie przyjmuje dane i na ścieżki odczytu odpowiada 404. Adres tailnetu
// przychodzi w kodzie połączenia (`read=`); gdy aktywny serwer sam jest
// prywatny (http://…), czytamy z niego. Token nigdy nie jedzie w URL-u.
let pendingReadServer = "";

// Brama publiczna (`https://api.…`, `https://geo.…`) nie serwuje odczytu, więc
// budowanie z niej linków do notatek dawało 404 — dokładnie tak wyglądał błąd
// „link do notatki nie działa, bo prowadzi na api.gustawdaniel.com”. Prywatne
// są tylko adresy http:// (tailnet, LAN, lokalny dev) oraz HTTPS w tailnecie:
// `*.ts.net` i surowe adresy CGNAT tailnetu (RFC 6598).
function isPrivateReadBase(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:") return true;
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".ts.net")) return true;
    const octets = host.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  } catch {
    return false;
  }
}

function readServerUrl(): string {
  const active = (activeServerUrl || "").trim();
  if (isPrivateReadBase(active)) return active;
  const stored = (localStorage.getItem("brain_read_server") || "").trim();
  return isPrivateReadBase(stored) ? stored : "";
}

const TAILNET_ONLY_MSG = "Notatki i historia są dostępne tylko w tailnecie. Włącz Tailscale albo wklej ponownie kod połączenia z /setup.";
const PUBLIC_READ_MSG = "Kod połączenia podał publiczną bramę (https://…) jako adres odczytu. Notatki czyta się w tailnecie — wklej kod z /setup jeszcze raz (niesie read=http://<host>).";
let isFlushingQueue = false;

// DOM Elements
const recordBtn = document.getElementById("record-btn") as HTMLButtonElement;
const micIcon = document.getElementById("mic-icon") as unknown as SVGElement;
const stopIcon = document.getElementById("stop-icon") as HTMLElement;
const recordTimer = document.getElementById("record-timer") as HTMLElement;
const recordStatus = document.getElementById("record-status") as HTMLElement;
const cancelRecordBtn = document.getElementById("cancel-record-btn") as HTMLButtonElement;
const canvas = document.getElementById("waveform-canvas") as HTMLCanvasElement;
const canvasCtx = canvas.getContext("2d");

const quickTextInput = document.getElementById("quick-text-input") as HTMLInputElement;
const quickTextSendBtn = document.getElementById("quick-text-send-btn") as HTMLButtonElement;

const processingBanner = document.getElementById("processing-banner") as HTMLElement;
const bannerStage = document.getElementById("banner-stage") as HTMLElement;
const bannerDetail = document.getElementById("banner-detail") as HTMLElement;
const resultCard = document.getElementById("result-card") as HTMLElement;
const cardTypeBadge = document.getElementById("card-type-badge") as HTMLElement;
const cardTargetBadge = document.getElementById("card-target-badge") as HTMLElement;
const cardTitle = document.getElementById("card-title") as HTMLElement;
const cardSummary = document.getElementById("card-summary") as HTMLElement;
const cardActions = document.getElementById("card-actions") as HTMLElement;

const feedList = document.getElementById("feed-list") as HTMLElement;
const refreshFeedBtn = document.getElementById("refresh-feed-btn") as HTMLButtonElement;
const serverStatusBadge = document.getElementById("server-status-badge") as HTMLElement;
const serverStatusDot = document.getElementById("server-status-dot") as HTMLElement;
const serverLabel = document.getElementById("server-label") as HTMLElement;
const offlineQueueBadge = document.getElementById("offline-queue-badge") as HTMLButtonElement;
const queueCountEl = document.getElementById("queue-count") as HTMLElement;

// Note Viewer Modal Elements
const noteModal = document.getElementById("note-modal") as HTMLElement;
const noteModalBackdrop = document.getElementById("note-modal-backdrop") as HTMLElement;
const noteModalBadge = document.getElementById("note-modal-badge") as HTMLElement;
const noteModalTitle = document.getElementById("note-modal-title") as HTMLElement;
const noteModalBody = document.getElementById("note-modal-body") as HTMLElement;
const noteCloseBtn = document.getElementById("note-close-btn") as HTMLButtonElement;
const noteOpenBrowserBtn = document.getElementById("note-open-browser-btn") as HTMLButtonElement;

// Ustawienia połączenia: bez tego okna nie da się wskazać serwera w tailnecie
// właściciela instalacji (domyślne adresy to localhost/brain.local).
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const settingsModal = document.getElementById("settings-modal") as HTMLElement;
const settingsBackdrop = document.getElementById("settings-backdrop") as HTMLElement;
const settingsCloseBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;
const settingsSaveBtn = document.getElementById("settings-save-btn") as HTMLButtonElement;
const settingsServerInput = document.getElementById("settings-server") as HTMLInputElement;
const settingsTokenInput = document.getElementById("settings-token") as HTMLInputElement;
const settingsDeviceInput = document.getElementById("settings-device") as HTMLInputElement;
const settingsConnectInput = document.getElementById("settings-connect") as HTMLInputElement | null;
const settingsConnectHint = document.getElementById("settings-connect-hint") as HTMLElement | null;
const deviceLabelEl = document.getElementById("device-label") as HTMLElement | null;

function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

// Kod połączenia z /setup: brain://connect?server=…&token=…&device=…
// Wklejenie go wypełnia pola, żeby nie przepisywać ręcznie adresu i tokenu.
function applyConnectCode(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  const match = /^(?:brain:\/\/connect|https?:\/\/[^\s]*[?&]connect=1)\??(.*)$/i.exec(text);
  const query = match ? match[1] : text.replace(/^[^?]*\?/, "");
  const params = new URLSearchParams(query);
  const server = params.get("server") ?? params.get("s") ?? "";
  const token = params.get("token") ?? params.get("t") ?? "";
  const device = params.get("device") ?? params.get("d") ?? "";
  const readParam = normalizeServerUrl(params.get("read") ?? "");
  pendingReadServer = isPrivateReadBase(readParam) ? readParam : "";
  if (settingsConnectHint && readParam && !pendingReadServer) {
    settingsConnectHint.textContent = PUBLIC_READ_MSG;
  }
  if (!server && !token && !device) return false;
  if (server) settingsServerInput.value = normalizeServerUrl(server);
  if (token) settingsTokenInput.value = token;
  if (device) settingsDeviceInput.value = device;
  return true;
}

function openSettings() {
  settingsServerInput.value = activeServerUrl || CANDIDATE_SERVERS[0] || "";
  settingsTokenInput.value = localStorage.getItem("brain_api_token") || "";
  settingsDeviceInput.value = localStorage.getItem("brain_device_label") || BUILD_DEFAULT_DEVICE;
  if (settingsConnectInput) settingsConnectInput.value = "";
  settingsModal.classList.remove("hidden");
  settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
  settingsModal.setAttribute("aria-hidden", "true");
}

function saveSettings() {
  const url = normalizeServerUrl(settingsServerInput.value);
  if (!url) {
    settingsServerInput.focus();
    return;
  }
  localStorage.setItem("brain_servers", JSON.stringify([url]));
  localStorage.setItem("brain_api_token", settingsTokenInput.value.trim());
  localStorage.setItem("brain_device_label", settingsDeviceInput.value.trim());
  if (pendingReadServer) localStorage.setItem("brain_read_server", pendingReadServer);
  // Sprzątanie starych wpisów: publiczna brama w `brain_read_server` dawała linki
  // do notatek na api.*, czyli 404. Taki adres nie ma prawa zostać w konfiguracji.
  const storedRead = (localStorage.getItem("brain_read_server") || "").trim();
  if (storedRead && !isPrivateReadBase(storedRead)) {
    localStorage.removeItem("brain_read_server");
  }
  window.location.reload();
}

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);
settingsSaveBtn.addEventListener("click", saveSettings);

// Kod połączenia: wklejenie (Ctrl+V) od razu wypełnia pola; „Zapisz” zostaje
// decyzją użytkownika, żeby nie nadpisać konfiguracji bez jego wiedzy.
if (settingsConnectInput) {
  const onConnectCode = () => {
    const ok = applyConnectCode(settingsConnectInput.value);
    if (ok) {
      settingsConnectInput.value = "";
      if (settingsConnectHint) {
        settingsConnectHint.textContent = "✓ Kod wczytany — sprawdź pola i zapisz.";
      }
    }
  };
  settingsConnectInput.addEventListener("paste", () => window.setTimeout(onConnectCode, 0));
  settingsConnectInput.addEventListener("change", onConnectCode);
  settingsConnectInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onConnectCode();
  });
}

settingsServerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveSettings();
});

if (deviceLabelEl) deviceLabelEl.textContent = DEVICE_LABEL;

async function openExternalLink(url: string) {
  if (!url) return;
  try {
    await openUrl(url);
  } catch (err) {
    console.warn("openUrl failed, fallback to window.open:", err);
    window.open(url, "_blank");
  }
}

// Recording state
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let isRecording = false;
let isRecordingCancelled = false;
let recordStartTime = 0;
let timerInterval: number | null = null;

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let dataArray: Uint8Array | null = null;
let animFrameId: number | null = null;

// Update queue indicator badge
async function updateQueueBadge() {
  try {
    const count = await countOfflineTasks();
    if (count > 0) {
      offlineQueueBadge.classList.remove("hidden");
      queueCountEl.textContent = `${count} w kolejce`;
    } else {
      offlineQueueBadge.classList.add("hidden");
    }
  } catch (err) {
    console.warn("Error updating queue badge:", err);
  }
}

// Flush pending offline tasks to active server
async function flushOfflineQueue() {
  if (isFlushingQueue) return;
  const tasks = await getOfflineTasks();
  if (tasks.length === 0) {
    await updateQueueBadge();
    return;
  }

  isFlushingQueue = true;
  serverStatusBadge.className = "server-badge syncing";
  if (serverStatusDot) serverStatusDot.className = "status-dot syncing";

  console.log(`Synchronizacja bufora offline (${tasks.length} zadań)...`);

  for (const item of tasks) {
    try {
      const formData = new FormData();
      if (item.type === 'audio' && item.blob) {
        const audioExt = (item.blob.type || item.mimeType || "").includes("mp4") ? "mp4" : "webm";
        formData.append("file", item.blob, `thought.${audioExt}`);
      } else if (item.type === 'text' && item.content) {
        formData.append("text", item.content);
      } else {
        await removeOfflineTask(item.id);
        continue;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(`${activeServerUrl}/api/v1/voice/inbox`, {
        method: "POST",
        headers: {
          "X-Brain-Token": BRAIN_API_TOKEN
        },
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        await removeOfflineTask(item.id);
        await updateQueueBadge();
        console.log(`Wysłano zbuforowane zadanie ${item.id}`);
      } else {
        console.warn(`Błąd wysyłania ${item.id}: status ${res.status}`);
        break; // stop flushing on error
      }
    } catch (err) {
      console.warn(`Przerwano synchronizację kolejki:`, err);
      break;
    }
  }

  isFlushingQueue = false;
  const remaining = await countOfflineTasks();
  await updateQueueBadge();

  if (remaining === 0) {
    serverStatusBadge.className = "server-badge online";
    if (serverStatusDot) serverStatusDot.className = "status-dot online";
    loadRecentFeed();
  }
}

// Initialize Server Ping & Auto-Discovery
async function discoverWorkingServer() {
  for (const url of CANDIDATE_SERVERS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${url}/health`, { 
        signal: controller.signal,
        headers: { "X-Brain-Token": BRAIN_API_TOKEN }
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        activeServerUrl = url;
        if (url.startsWith("https://")) {
          serverLabel.textContent = "🚀 Cloud Engine";
        } else {
          serverLabel.textContent = "Local / VPN";
        }
        serverStatusBadge.className = "server-badge online";
        if (serverStatusDot) serverStatusDot.className = "status-dot online";
        console.log(`Connected to Brain GTD Engine at ${url}`);
        flushOfflineQueue();
        return true;
      }
    } catch {
      // try next
    }
  }
  serverLabel.textContent = "Brak połączenia";
  serverStatusBadge.className = "server-badge offline";
  if (serverStatusDot) serverStatusDot.className = "status-dot offline";
  return false;
}

// Visualizer Waveform Loop
function drawWaveform() {
  if (!analyser || !dataArray || !canvasCtx) return;
  animFrameId = requestAnimationFrame(drawWaveform);
  analyser.getByteFrequencyData(dataArray as any);

  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = 4;
  const gap = 2;
  const numBars = Math.floor(canvas.width / (barWidth + gap));
  const step = Math.floor(dataArray.length / numBars);

  for (let i = 0; i < numBars; i++) {
    const value = dataArray[i * step] || 0;
    const barHeight = Math.max(3, (value / 255) * canvas.height * 0.9);

    const x = i * (barWidth + gap);
    const y = canvas.height - barHeight;

    canvasCtx.fillStyle = isRecording ? "#ef4444" : "#6366f1";
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, y, barWidth, barHeight, 2);
    canvasCtx.fill();
  }
}

// Start Recording
async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Interfejs getUserMedia nie jest dostępny w tym środowisku.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Audio Context for live visualizer
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    drawWaveform();

    // Determine supported mimeType
    let mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported("audio/webm")) {
      if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      else mimeType = "";
    }

    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (audioContext && audioContext.state !== "closed") audioContext.close();
      stream.getTracks().forEach((track) => track.stop());
      if (canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      if (isRecordingCancelled) {
        audioChunks = [];
        isRecordingCancelled = false;
        return;
      }

      const audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
      await uploadAudioThought(audioBlob);
    };

    mediaRecorder.start(250);
    isRecording = true;
    isRecordingCancelled = false;
    recordStartTime = Date.now();

    // Haptics
    if ("vibrate" in navigator) navigator.vibrate(60);

    // UI Updates
    recordBtn.classList.add("recording");
    micIcon.classList.add("hidden");
    stopIcon.classList.remove("hidden");
    cancelRecordBtn.classList.remove("hidden");
    recordStatus.textContent = "Nagrywanie... Dotknij, aby wysłać";

    timerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      recordTimer.textContent = `${mins}:${secs}`;
    }, 500);

  } catch (err: any) {
    console.error("Mic access failed:", err);
    alert(`Nie udało się uzyskać dostępu do mikrofonu: ${err.message}`);
  }
}

// Stop Recording
function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  mediaRecorder.stop();
  isRecording = false;

  if (timerInterval) clearInterval(timerInterval);
  recordBtn.classList.remove("recording");
  micIcon.classList.remove("hidden");
  stopIcon.classList.add("hidden");
  cancelRecordBtn.classList.add("hidden");
  recordStatus.textContent = "Przetwarzanie notatki...";
  recordTimer.textContent = "00:00";

  if ("vibrate" in navigator) navigator.vibrate([40, 40, 80]);
}

// Cancel Recording
function cancelRecording() {
  if (!mediaRecorder || !isRecording) return;
  isRecordingCancelled = true;
  mediaRecorder.stop();
  isRecording = false;

  if (timerInterval) clearInterval(timerInterval);
  recordBtn.classList.remove("recording");
  micIcon.classList.remove("hidden");
  stopIcon.classList.add("hidden");
  cancelRecordBtn.classList.add("hidden");
  recordStatus.textContent = "Nagranie anulowane";
  recordTimer.textContent = "00:00";

  setTimeout(() => {
    if (!isRecording) {
      recordStatus.textContent = "Dotknij, aby nagrać myśl";
    }
  }, 2000);

  if ("vibrate" in navigator) navigator.vibrate(100);
}

// Upload Audio (Try sending, buffer offline on failure)
async function uploadAudioThought(blob: Blob) {
  processingBanner.classList.remove("hidden");
  bannerStage.textContent = "Groq Whisper STT...";
  if (bannerDetail) bannerDetail.textContent = "Wysyłanie do silnika GTD...";
  
  const audioExt = (blob.type || "").includes("mp4") ? "mp4" : "webm";
  const formData = new FormData();
  formData.append("file", blob, `thought.${audioExt}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${activeServerUrl}/api/v1/voice/inbox`, {
      method: "POST",
      headers: {
        "X-Brain-Token": BRAIN_API_TOKEN
      },
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Serwer zwrócił status ${res.status}`);
    const data = await res.json();
    handleSuccessResult(data);
    flushOfflineQueue();
  } catch (err: any) {
    console.warn("Błąd wysyłania audio — zapisuję do pamięci podręcznej offline:", err);
    await enqueueOfflineTask({
      type: 'audio',
      blob: blob,
      mimeType: blob.type || "audio/webm"
    });
    await updateQueueBadge();

    // Verify connection in background without immediately turning indicator red
    discoverWorkingServer();

    recordStatus.textContent = "💾 Nagranie zapisane w pamięci podręcznej offline! Zostanie wysłane po połączeniu.";
    setTimeout(() => {
      if (!isRecording) recordStatus.textContent = "Dotknij, aby nagrać myśl";
    }, 4500);

    if ("vibrate" in navigator) navigator.vibrate([150, 60, 150]);
  } finally {
    processingBanner.classList.add("hidden");
  }
}

// Upload Text Thought (Try sending, buffer offline on failure)
async function sendTextThought(text: string) {
  if (!text.trim()) return;
  const rawText = text.trim();
  quickTextInput.value = "";

  processingBanner.classList.remove("hidden");
  bannerStage.textContent = "Groq Qwen GTD Router...";
  if (bannerDetail) bannerDetail.textContent = "Analiza i routing...";

  try {
    const formData = new FormData();
    formData.append("text", rawText);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${activeServerUrl}/api/v1/voice/inbox`, {
      method: "POST",
      headers: {
        "X-Brain-Token": BRAIN_API_TOKEN
      },
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Serwer zwrócił status ${res.status}`);
    const data = await res.json();
    handleSuccessResult(data);
    flushOfflineQueue();
  } catch (err: any) {
    console.warn("Błąd wysyłania tekstu — zapisuję do bufora offline:", err);
    await enqueueOfflineTask({
      type: 'text',
      content: rawText
    });
    await updateQueueBadge();

    // Verify connection in background without immediately turning indicator red
    discoverWorkingServer();

    recordStatus.textContent = "💾 Myśl zapisana w buforze offline! Zostanie wysłana po połączeniu.";
    setTimeout(() => {
      if (!isRecording) recordStatus.textContent = "Dotknij, aby nagrać myśl";
    }, 4000);

    if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
  } finally {
    processingBanner.classList.add("hidden");
  }
}

// Handle Successful GTD Processing
function handleSuccessResult(data: any) {
  if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
  recordStatus.textContent = "Zapisano i posegregowano!";

  const decision = data.decision || {};
  const clickup = data.clickup || {};

  resultCard.classList.remove("hidden");
  cardTypeBadge.textContent = (decision.type || "NOTE").toUpperCase();
  
  const target = decision.target || "human";
  cardTargetBadge.textContent = target === "ai_agent" ? "AGENT AI" : "DANIEL";
  cardTargetBadge.className = `badge target-badge ${target === "ai_agent" ? "ai" : ""}`;

  cardTitle.textContent = decision.title || "Notatka";
  cardSummary.textContent = data.notification || decision.markdown_content || "";

  cardActions.innerHTML = "";
  if (clickup.task_url) {
    const cuBtn = document.createElement("button");
    cuBtn.type = "button";
    cuBtn.className = "action-link-btn primary";
    cuBtn.innerHTML = `<span>🎯 Otwórz w ClickUp</span>`;
    cuBtn.addEventListener("click", () => openExternalLink(clickup.task_url));
    cardActions.appendChild(cuBtn);
  }
  if (decision.project_slug) {
    const docBtn = document.createElement("button");
    docBtn.type = "button";
    docBtn.className = "action-link-btn";
    docBtn.innerHTML = `<span>📄 Notatki Projektu</span>`;
    docBtn.addEventListener("click", () => openNoteViewer(decision.project_slug));
    cardActions.appendChild(docBtn);
  }

  loadRecentFeed();
}

// In-App Note Viewer Modal Controller
function closeNoteViewer() {
  if (noteModal) {
    noteModal.classList.add("hidden");
    noteModal.setAttribute("aria-hidden", "true");
  }
}

async function openNoteViewer(slug: string) {
  const cleanSlug = (slug || "general").replace(/^#/, "").trim().toLowerCase();
  
  if (noteModalBadge) noteModalBadge.textContent = `#${cleanSlug}`;
  if (noteModalTitle) noteModalTitle.textContent = `Notatki Projektu`;
  if (noteModalBody) noteModalBody.innerHTML = `<div class="loading-spinner">Ładowanie notatek dla #${cleanSlug}...</div>`;
  
  if (noteModal) {
    noteModal.classList.remove("hidden");
    noteModal.setAttribute("aria-hidden", "false");
  }

  const readUrl = readServerUrl();
  // Bez prywatnego adresu nie ma czego otwierać: publiczna brama odczytu nie
  // serwuje. Przycisk chowamy, żeby nie był martwym klikiem (wcześniej nic nie
  // robił, a przy złej konfiguracji prowadził na api.gustawdaniel.com → 404).
  if (noteOpenBrowserBtn) {
    noteOpenBrowserBtn.classList.toggle("hidden", !readUrl);
    noteOpenBrowserBtn.title = readUrl
      ? `Otwórz ${readUrl}/docs/projects/${cleanSlug}`
      : "Wymaga tailnetu — brak prywatnego adresu odczytu";
    noteOpenBrowserBtn.onclick = () => {
      if (readUrl) openExternalLink(`${readUrl}/docs/projects/${cleanSlug}`);
    };
  }

  try {
    if (!readUrl) throw new Error(TAILNET_ONLY_MSG);
    const res = await fetch(`${readUrl}/api/v1/projects/${cleanSlug}/note`, {
      headers: {
        "X-Brain-Token": BRAIN_API_TOKEN
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (noteModalBody) {
      noteModalBody.innerHTML = data.html || "<p><em>Brak treści notatek.</em></p>";
      
      const links = noteModalBody.querySelectorAll("a");
      links.forEach((a) => {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const href = a.getAttribute("href");
          if (href) {
            const finalUrl = href.startsWith("/") ? `${readUrl}${href}` : href;
            openExternalLink(finalUrl);
          }
        });
      });
    }
  } catch (err: any) {
    console.error("Failed to load note:", err);
    if (noteModalBody) {
      // Przycisk „Otwórz w przeglądarce” renderujemy tylko wtedy, gdy naprawdę
      // jest dokąd otwierać — inaczej był martwym klikiem.
      const retryButton = readUrl
        ? `<button id="modal-retry-external-btn" class="action-link-btn primary" style="width: auto; margin: 0 auto; display: inline-flex;">
            🌐 Otwórz w przeglądarce (${escapeHtml(readUrl)})
          </button>`
        : '';
      noteModalBody.innerHTML = `
        <div style="text-align: center; padding: 24px 10px;">
          <p style="color: #ef4444; margin-bottom: 8px; font-weight: 600;">Nie udało się pobrać notatek dla #${cleanSlug}.</p>
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 20px;">${escapeHtml(err.message || String(err))}</p>
          ${retryButton}
        </div>
      `;
      const retryBtn = document.getElementById("modal-retry-external-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          if (readUrl) openExternalLink(`${readUrl}/docs/projects/${cleanSlug}`);
        });
      }
    }
  }
}


// Feed Caching & Filtering
let cachedInboxItems: any[] = [];
let currentFilter = "all";

function initFilterTabs() {
  const tabs = document.querySelectorAll(".filter-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.getAttribute("data-filter") || "all";
      renderFeedItems();
    });
  });
}

// Hydrate feed from local cache immediately
function loadCachedFeed() {
  try {
    const raw = localStorage.getItem(FEED_CACHE_KEY);
    if (raw) {
      cachedInboxItems = JSON.parse(raw);
      renderFeedItems();
    }
  } catch (err) {
    console.warn("Błąd odczytu pamięci podręcznej feedu:", err);
  }
}

// Load Recent Feed
async function loadRecentFeed() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const readUrl = readServerUrl();
    if (!readUrl) throw new Error(TAILNET_ONLY_MSG);
    const res = await fetch(`${readUrl}/api/v1/recent?limit=100`, { 
      signal: controller.signal,
      headers: {
        "X-Brain-Token": BRAIN_API_TOKEN
      }
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedInboxItems = await res.json();
    try {
      localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(cachedInboxItems));
    } catch {
      // quota or private mode ignore
    }
    renderFeedItems();
  } catch (err) {
    console.warn("Feed load failed (używam pamięci podręcznej):", err);
    if (!cachedInboxItems || cachedInboxItems.length === 0) {
      loadCachedFeed();
    }
    if (!cachedInboxItems || cachedInboxItems.length === 0) {
      feedList.innerHTML = `<div class="empty-state">Brak połączenia z silnikiem Brain. Zadania i myśli zostaną zbuforowane w trybie offline.</div>`;
    }
  }
}

// Render Filtered Feed Items
function renderFeedItems() {
  if (!cachedInboxItems || cachedInboxItems.length === 0) {
    feedList.innerHTML = `<div class="empty-state">Brak zarejestrowanych myśli. Nagraj pierwszą!</div>`;
    return;
  }

  const filtered = cachedInboxItems.filter((item: any) => {
    if (currentFilter === "human") return item.target === "human" && item.item_type !== "note";
    if (currentFilter === "ai_agent") return item.target === "ai_agent";
    if (currentFilter === "notes") return item.item_type === "note" || (!item.clickup_url && item.doc_url);
    return true;
  });

  if (filtered.length === 0) {
    feedList.innerHTML = `<div class="empty-state">Brak wpisów w wybranej kategorii.</div>`;
    return;
  }

  feedList.innerHTML = filtered.map((item: any) => {
    const timeStr = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isAi = item.target === 'ai_agent';
    const isNote = item.item_type === 'note';
    
    const targetClass = isAi ? "target-ai" : (isNote ? "target-note" : "target-human");
    const badgeText = isAi ? "🤖 AGENT AI" : (isNote ? "📄 NOTATKA" : "👤 DANIEL");
    const badgeClass = isAi ? "badge target-badge ai" : "badge target-badge";

    let actionsHtml = "";
    if (item.clickup_url) {
      actionsHtml += `<button type="button" data-url="${escapeHtml(item.clickup_url)}" class="feed-btn clickup action-clickup-btn">🎯 ClickUp</button>`;
    }
    if (item.doc_url || item.project_slug) {
      const slugVal = (item.project_slug || "general").replace(/^#/, "").trim().toLowerCase();
      actionsHtml += `<button type="button" data-slug="${escapeHtml(slugVal)}" class="feed-btn docs action-note-btn">📄 Notatki</button>`;
    }

    return `
      <div class="feed-item ${targetClass}">
        <div class="feed-item-top">
          <span class="project-tag">#${escapeHtml(item.project_slug)}</span>
          <span class="time-ago">${timeStr}</span>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <div class="feed-title">${escapeHtml(item.title)}</div>
        <div class="feed-summary">${escapeHtml(item.summary)}</div>
        ${actionsHtml ? `<div class="feed-item-actions">${actionsHtml}</div>` : ""}
      </div>
    `;
  }).join("");
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Event Listeners
recordBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

cancelRecordBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  cancelRecording();
});

quickTextSendBtn.addEventListener("click", () => {
  sendTextThought(quickTextInput.value);
});

quickTextInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendTextThought(quickTextInput.value);
  }
});

refreshFeedBtn.addEventListener("click", () => {
  loadRecentFeed();
});

offlineQueueBadge.addEventListener("click", async () => {
  await discoverWorkingServer();
  await flushOfflineQueue();
});

window.addEventListener("online", async () => {
  console.log("Wykryto połączenie sieciowe — sprawdzam serwer...");
  await discoverWorkingServer();
  await flushOfflineQueue();
});

window.addEventListener("offline", () => {
  serverLabel.textContent = "Brak Sieci";
  serverStatusBadge.className = "server-badge offline";
  if (serverStatusDot) serverStatusDot.className = "status-dot offline";
});

// Periodic server discovery & offline queue sync every 15s
setInterval(async () => {
  await discoverWorkingServer();
}, 15000);

// Boot
window.addEventListener("DOMContentLoaded", async () => {
  // Modal listeners
  if (noteCloseBtn) noteCloseBtn.addEventListener("click", closeNoteViewer);
  if (noteModalBackdrop) noteModalBackdrop.addEventListener("click", closeNoteViewer);

  // Feed list delegation for ClickUp and Notes
  if (feedList) {
    feedList.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const clickupBtn = target.closest(".action-clickup-btn") as HTMLElement;
      if (clickupBtn) {
        const url = clickupBtn.getAttribute("data-url");
        if (url) openExternalLink(url);
        return;
      }
      const noteBtn = target.closest(".action-note-btn") as HTMLElement;
      if (noteBtn) {
        const slug = noteBtn.getAttribute("data-slug");
        if (slug) openNoteViewer(slug);
        return;
      }
    });
  }

  loadCachedFeed();
  await updateQueueBadge();
  await discoverWorkingServer();
  initFilterTabs();
  await loadRecentFeed();
  await flushOfflineQueue();
});
