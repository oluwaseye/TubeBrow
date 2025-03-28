const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  getYoutubeUrl: () => ipcRenderer.invoke("get-youtube-url"),
  getYoutubeVideos: () => ipcRenderer.invoke("get-youtube-videos"),
  getBacklinksSites: () => ipcRenderer.invoke("get-backlinks-sites"),
  getCurrentUserAgent: () => ipcRenderer.invoke("get-current-user-agent"),
  getCurrentGeolocation: () => ipcRenderer.invoke("get-current-geolocation"),
  rotateGeolocation: () => ipcRenderer.invoke("rotate-geolocation"),

  // VPN controls
  getVpnConfigurations: () => ipcRenderer.invoke("get-vpn-configurations"),
  getVpnStatus: () => ipcRenderer.invoke("get-vpn-status"),
  connectVpn: (configIndex) => ipcRenderer.invoke("connect-vpn", configIndex),
  disconnectVpn: () => ipcRenderer.invoke("disconnect-vpn"),
  rotateVpn: () => ipcRenderer.invoke("rotate-vpn"),

  // Virtualization controls
  startVirtualization: () => ipcRenderer.invoke("start-virtualization"),
  stopVirtualization: () => ipcRenderer.invoke("stop-virtualization"),

  // Event listeners
  onYoutubeUrl: (callback) =>
    ipcRenderer.on("youtube-url", (_, url) => callback(url)),
  onYoutubeVideos: (callback) =>
    ipcRenderer.on("youtube-videos", (_, videos) => callback(videos)),
  onBacklinksSites: (callback) =>
    ipcRenderer.on("backlinks-sites", (_, sites) => callback(sites)),
  onSettingsUpdated: (callback) =>
    ipcRenderer.on("settings-updated", (_, settings) => callback(settings)),
  onUserAgentChanged: (callback) =>
    ipcRenderer.on("user-agent-changed", (_, userAgent) => callback(userAgent)),
  onGeolocationChanged: (callback) =>
    ipcRenderer.on("geolocation-changed", (_, geo) => callback(geo)),
  onVpnStatusChanged: (callback) =>
    ipcRenderer.on("vpn-status-changed", (_, status) => callback(status)),
});
