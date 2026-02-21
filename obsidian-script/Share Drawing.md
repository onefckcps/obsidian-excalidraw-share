/**
 * Share Excalidraw Drawing
 * 
 * This script uploads the current Excalidraw drawing to your self-hosted
 * Excalidraw Share server and copies the public link to your clipboard.
 * 
 * Setup:
 * 1. Deploy the excalidraw-share server (see /backend and /nixos)
 * 2. Replace API_URL and API_KEY below with your server details
 * 3. Place this script in your Obsidian vault at:
 *    Excalidraw/Scripts/Downloaded/Share Drawing.md
 * 4. Run via Command Palette or add a button to the Excalidraw toolbar
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Adjust these values for your setup
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Your self-hosted server URL (without trailing slash)
  apiUrl: "https://notes.leyk.me",
  
  // API key - WARNING: For better security, consider reading from a vault file
  // Example: await app.vault.read(app.vault.getAbstractFileByPath(".excalidraw-share-key"))
  apiKey: "CHANGE_ME_TO_YOUR_API_KEY",
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

const apiUrl = CONFIG.apiUrl.replace(/\/$/, "");
const apiKey = CONFIG.apiKey;

// Validate configuration
if (apiKey === "CHANGE_ME_TO_YOUR_API_KEY") {
  new Notice("⚠️ Please configure your API key in the Share Drawing script.");
  return;
}

// Get the current Excalidraw file
const file = ea.targetView?.file;
if (!file) {
  new Notice("No active Excalidraw drawing found.");
  return;
}

// Check if this is actually an Excalidraw file
if (!ea.isExcalidrawFile(file)) {
  new Notice("The active file is not an Excalidraw drawing.");
  return;
}

try {
  new Notice("📤 Uploading drawing...");

  // Get the scene data from the current file
  const scene = await ea.getSceneFromFile(file);
  
  if (!scene || !scene.elements || scene.elements.length === 0) {
    new Notice("Drawing is empty.");
    return;
  }

  // Get embedded files/images from the Excalidraw API
  const excalidrawAPI = ea.getExcalidrawAPI();
  const files = excalidrawAPI?.getFiles?.() ?? {};

  // Build the Excalidraw-compatible JSON payload
  const payload = {
    type: "excalidraw",
    version: 2,
    source: "obsidian-excalidraw-share",
    elements: scene.elements,
    appState: {
      viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
      theme: scene.appState?.theme ?? "light",
      gridSize: scene.appState?.gridSize ?? null,
      ...scene.appState,
    },
    files: files,
  };

  // Upload to the server
  const response = await requestUrl({
    url: `${apiUrl}/api/upload`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (response.status !== 200 && response.status !== 201) {
    const errorMsg = response.json?.error || `Server returned ${response.status}`;
    new Notice(`❌ Upload failed: ${errorMsg}`);
    console.error("Upload error:", response);
    return;
  }

  const { url } = response.json;

  // Copy the share URL to clipboard
  await navigator.clipboard.writeText(url);

  // Show success notification with the URL
  new Notice(`✅ Link copied to clipboard!\n\n${url}`);

  // Optional: Also open in browser
  // window.open(url, '_blank');

} catch (err) {
  const errorMessage = err?.message || err?.toString() || "Unknown error";
  new Notice(`❌ Error: ${errorMessage}`);
  console.error("Share Drawing Error:", err);
}
