const { app, BrowserWindow, ipcMain, session, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let settingsWindow;
const isDev = !app.isPackaged;

// Config path for saving settings
const configPath = path.join(app.getPath("userData"), "config.json");

// Default settings
const defaultSettings = {
  youtubeChannelUrl: "https://www.youtube.com",
  youtubeVideosList: "",
  backlinksList: "",
  vpnList: "",
  userAgentList: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36`,
  geolocationList: "40.712800,-74.006000,100,USA,New York",
  windowsPerSession: 1,
  intervalBetweenSessions: 30,
};

// Current user agent index
let currentUserAgentIndex = 0;
let userAgents = [];

// Current geolocation index
let currentGeoIndex = 0;
let geolocations = [];

// Current backlink site index
let currentBacklinkIndex = 0;
let backlinkSites = [];

// Session management
let sessionWindows = [];
let sessionTimer = null;

// Load settings
function loadSettings() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (e) {
    console.error("Error loading settings:", e);
  }
  return defaultSettings;
}

// Save settings
function saveSettings(settings) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2));

    // Update user agents list
    if (settings.userAgentList) {
      userAgents = settings.userAgentList
        .split("\n")
        .filter((ua) => ua.trim().length > 0);
      if (userAgents.length === 0) {
        userAgents = [defaultSettings.userAgentList.split("\n")[0]];
      }
      currentUserAgentIndex = 0;
    }

    // Update geolocation list
    if (settings.geolocationList) {
      geolocations = settings.geolocationList
        .split("\n")
        .filter((geo) => geo.trim().length > 0)
        .map(parseGeolocation);
      if (geolocations.length === 0) {
        geolocations = [parseGeolocation(defaultSettings.geolocationList)];
      }
      currentGeoIndex = 0;
    }

    // Update backlinks sites list
    if (settings.backlinksList) {
      backlinkSites = settings.backlinksList
        .split("\n")
        .filter((site) => site.trim().length > 0);
      currentBacklinkIndex = 0;
    }
  } catch (e) {
    console.error("Error saving settings:", e);
  }
}

// Parse geolocation string to object
function parseGeolocation(geoString) {
  try {
    const parts = geoString.split(",");
    if (parts.length >= 2) {
      return {
        latitude: parseFloat(parts[0]),
        longitude: parseFloat(parts[1]),
        accuracy: parts.length > 2 ? parseInt(parts[2]) : 100,
        country: parts.length > 3 ? parts[3] : "",
        city: parts.length > 4 ? parts[4] : "",
      };
    }
  } catch (e) {
    console.error("Error parsing geolocation:", e);
  }

  // Return default if parsing fails
  return {
    latitude: 40.7128,
    longitude: -74.006,
    accuracy: 100,
    country: "USA",
    city: "New York",
  };
}

// Get next user agent from rotation
function getNextUserAgent() {
  if (userAgents.length === 0) {
    const settings = loadSettings();
    userAgents = (settings.userAgentList || defaultSettings.userAgentList)
      .split("\n")
      .filter((ua) => ua.trim().length > 0);
    if (userAgents.length === 0) {
      userAgents = [defaultSettings.userAgentList.split("\n")[0]];
    }
  }

  const userAgent = userAgents[currentUserAgentIndex];
  currentUserAgentIndex = (currentUserAgentIndex + 1) % userAgents.length;
  return userAgent;
}

// Get next geolocation from rotation
function getNextGeolocation() {
  if (geolocations.length === 0) {
    const settings = loadSettings();
    geolocations = (settings.geolocationList || defaultSettings.geolocationList)
      .split("\n")
      .filter((geo) => geo.trim().length > 0)
      .map(parseGeolocation);
    if (geolocations.length === 0) {
      geolocations = [parseGeolocation(defaultSettings.geolocationList)];
    }
  }

  const geolocation = geolocations[currentGeoIndex];
  currentGeoIndex = (currentGeoIndex + 1) % geolocations.length;
  return geolocation;
}

// Get next backlink site from rotation
function getNextBacklinkSite() {
  if (backlinkSites.length === 0) {
    const settings = loadSettings();
    backlinkSites = (settings.backlinksList || "")
      .split("\n")
      .filter((site) => site.trim().length > 0);
  }

  if (backlinkSites.length === 0) {
    return null; // No backlink sites available
  }

  const site = backlinkSites[currentBacklinkIndex];
  currentBacklinkIndex = (currentBacklinkIndex + 1) % backlinkSites.length;
  return site;
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  if (!url) return null;

  let videoId = null;

  // Regular YouTube URL format: youtube.com/watch?v=VIDEO_ID
  if (url.includes("youtube.com/watch?v=")) {
    videoId = url.split("v=")[1];
    if (videoId.includes("&")) {
      videoId = videoId.split("&")[0];
    }
  }
  // Short YouTube URL format: youtu.be/VIDEO_ID
  else if (url.includes("youtu.be/")) {
    videoId = url.split("youtu.be/")[1];
    if (videoId.includes("?")) {
      videoId = videoId.split("?")[0];
    }
  }

  return videoId;
}

// Get a random YouTube video ID from the videos list
function getRandomVideoId() {
  const settings = loadSettings();
  const videosList = settings.youtubeVideosList || "";
  const videos = videosList.split("\n").filter((v) => v.trim().length > 0);

  if (videos.length === 0) {
    return null;
  }

  const randomVideo = videos[Math.floor(Math.random() * videos.length)];
  return extractVideoId(randomVideo);
}

// Override geolocation for a webContents
function overrideGeolocation(webContents) {
  const geolocation = getNextGeolocation();

  // Use the correct API approach for geolocation override
  webContents.executeJavaScript(`
    navigator.geolocation.getCurrentPosition = function(success) {
      success({
        coords: {
          latitude: ${geolocation.latitude},
          longitude: ${geolocation.longitude},
          accuracy: ${geolocation.accuracy},
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      });
    };
    navigator.geolocation.watchPosition = function(success) {
      success({
        coords: {
          latitude: ${geolocation.latitude},
          longitude: ${geolocation.longitude},
          accuracy: ${geolocation.accuracy},
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      });
      return 0;
    };
  `);

  console.log(
    `Geolocation set to: ${geolocation.city}, ${geolocation.country} (${geolocation.latitude}, ${geolocation.longitude})`
  );

  return geolocation;
}

// Create a session window with possibly using a backlink site
function createSessionWindow(url) {
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
      devTools: isDev,
      webSecurity: false,
    },
  });

  // Check if we should use a backlink site
  const backlinkSite = getNextBacklinkSite();
  let finalUrl = url;

  if (backlinkSite) {
    const videoId = getRandomVideoId();
    if (videoId) {
      // Construct URL based on the backlink site pattern
      if (backlinkSite.includes("youplay.nimtools.com")) {
        finalUrl = `${backlinkSite}/watch/?v=${videoId}`;
      } else if (
        backlinkSite.includes("yewtu.be") ||
        backlinkSite.includes("invidious")
      ) {
        finalUrl = `${backlinkSite}/watch?v=${videoId}`;
      } else {
        // Generic pattern - append /watch?v=VIDEO_ID
        finalUrl = `${backlinkSite}/watch?v=${videoId}`;
      }
      console.log(`Using backlink site: ${finalUrl}`);
    }
  }

  window.loadFile("index.html");

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("youtube-url", finalUrl);

    // Override geolocation for this window
    const geo = overrideGeolocation(window.webContents);
    window.webContents.send("geolocation-changed", geo);
  });

  // Clean up when window is closed
  window.on("closed", () => {
    const index = sessionWindows.indexOf(window);
    if (index !== -1) {
      sessionWindows.splice(index, 1);
    }
  });

  return window;
}

// Start virtualization session with multiple windows
function startVirtualizationSession() {
  const settings = loadSettings();
  const windowsPerSession = settings.windowsPerSession || 1;
  const intervalBetweenSessions = settings.intervalBetweenSessions || 30;
  const url = settings.youtubeChannelUrl;

  // Clear any existing session
  stopVirtualizationSession();

  // Create new windows for this session
  for (let i = 0; i < windowsPerSession; i++) {
    const sessionWindow = createSessionWindow(url);
    sessionWindows.push(sessionWindow);
  }

  // Set timer for next session if interval is greater than 0
  if (intervalBetweenSessions > 0) {
    console.log(
      `Next virtualization session in ${intervalBetweenSessions} seconds`
    );
    sessionTimer = setTimeout(() => {
      startVirtualizationSession();
    }, intervalBetweenSessions * 1000);
  }
}

// Stop virtualization session
function stopVirtualizationSession() {
  // Clear timer if exists
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }

  // Close all session windows
  for (const window of sessionWindows) {
    if (!window.isDestroyed()) {
      window.close();
    }
  }

  sessionWindows = [];
}

function createMainWindow() {
  const settings = loadSettings();

  // Initialize user agents list
  userAgents = (settings.userAgentList || defaultSettings.userAgentList)
    .split("\n")
    .filter((ua) => ua.trim().length > 0);
  if (userAgents.length === 0) {
    userAgents = [defaultSettings.userAgentList.split("\n")[0]];
  }

  // Initialize geolocation list
  geolocations = (settings.geolocationList || defaultSettings.geolocationList)
    .split("\n")
    .filter((geo) => geo.trim().length > 0)
    .map(parseGeolocation);
  if (geolocations.length === 0) {
    geolocations = [parseGeolocation(defaultSettings.geolocationList)];
  }

  // Initialize backlinks sites list
  backlinkSites = (settings.backlinksList || "")
    .split("\n")
    .filter((site) => site.trim().length > 0);

  // Configure session for webviews
  const ses = session.defaultSession;

  // Set persistent permissions for media
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = [
      "media",
      "geolocation",
      "notifications",
      "midi",
      "midiSysex",
      "pointerLock",
      "fullscreen",
    ];
    if (allowedPermissions.includes(permission)) {
      return callback(true);
    }

    // Deny all other permission requests
    callback(false);
  });

  // Add additional session configurations for improved compatibility
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details;

    // Set User-Agent
    requestHeaders["User-Agent"] = getNextUserAgent();

    // Additional headers that might help with YouTube access
    requestHeaders["Accept-Language"] = "en-US,en;q=0.9";

    callback({ requestHeaders });
  });

  // Add permission handling for the session
  const youtubePartition = session.fromPartition("persist:youtube");
  youtubePartition.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = [
        "media",
        "geolocation",
        "notifications",
        "midi",
        "midiSysex",
        "pointerLock",
        "fullscreen",
      ];
      if (allowedPermissions.includes(permission)) {
        return callback(true);
      }
      callback(false);
    }
  );

  // Also add user agent handling to the youtube partition
  youtubePartition.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details;
    requestHeaders["User-Agent"] = getNextUserAgent();
    requestHeaders["Accept-Language"] = "en-US,en;q=0.9";
    callback({ requestHeaders });
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true, // Enable webview tag
      devTools: true,
      webSecurity: false, // Disable web security for embedded webviews
    },
  });

  // Load the main HTML page
  mainWindow.loadFile("index.html");

  // Pass the YouTube URL and videos list to the renderer
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("youtube-url", settings.youtubeChannelUrl);
    mainWindow.webContents.send(
      "youtube-videos",
      settings.youtubeVideosList || ""
    );
    mainWindow.webContents.send(
      "backlinks-sites",
      settings.backlinksList || ""
    );

    // Set initial geolocation
    const geo = overrideGeolocation(mainWindow.webContents);
    mainWindow.webContents.send("geolocation-changed", geo);
  });

  // Open DevTools if in development mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
    console.log("Running in development mode with DevTools enabled");
    console.log("Settings file location:", configPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Create application menu
  const menu = Menu.buildFromTemplate([
    {
      label: "TubeBrow",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Options",
      submenu: [
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            if (!settingsWindow) {
              createSettingsWindow();
            }
          },
        },
        { type: "separator" },
        {
          label: "Rotate User Agent",
          accelerator: "CmdOrCtrl+U",
          click: () => {
            const userAgent = getNextUserAgent();
            if (mainWindow) {
              mainWindow.webContents.send("user-agent-changed", userAgent);
            }
          },
        },
        {
          label: "Rotate Geolocation",
          accelerator: "CmdOrCtrl+G",
          click: () => {
            if (mainWindow) {
              const geo = overrideGeolocation(mainWindow.webContents);
              mainWindow.webContents.send("geolocation-changed", geo);
            }
          },
        },
        { type: "separator" },
        {
          label: "Start Virtualization",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => {
            startVirtualizationSession();
          },
        },
        {
          label: "Stop Virtualization",
          accelerator: "CmdOrCtrl+Shift+X",
          click: () => {
            stopVirtualizationSession();
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 800, // Increased height to accommodate new settings
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      devTools: true,
    },
  });

  settingsWindow.loadFile("settings.html");

  // Open DevTools for settings window if in development mode
  if (isDev) {
    settingsWindow.webContents.openDevTools();
  }

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
  // Set global user agent to improve compatibility with YouTube
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders["User-Agent"] = getNextUserAgent();
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Stop virtualization session if running
  stopVirtualizationSession();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers for settings
ipcMain.handle("get-settings", () => {
  return loadSettings();
});

ipcMain.handle("save-settings", (event, settings) => {
  saveSettings(settings);
  // Notify the main window to reload with the new URL and videos
  if (mainWindow) {
    mainWindow.webContents.send("settings-updated", settings);
  }
  return true;
});

ipcMain.handle("open-settings", () => {
  if (!settingsWindow) {
    createSettingsWindow();
  }
});

// Get the current URL
ipcMain.handle("get-youtube-url", () => {
  const settings = loadSettings();
  return settings.youtubeChannelUrl;
});

// Get the YouTube videos list
ipcMain.handle("get-youtube-videos", () => {
  const settings = loadSettings();
  return settings.youtubeVideosList || "";
});

// Get the backlinks sites list
ipcMain.handle("get-backlinks-sites", () => {
  const settings = loadSettings();
  return settings.backlinksList || "";
});

// Get the current user agent
ipcMain.handle("get-current-user-agent", () => {
  return userAgents[currentUserAgentIndex];
});

// Get the current geolocation
ipcMain.handle("get-current-geolocation", () => {
  return geolocations[currentGeoIndex];
});

// Rotate to next geolocation
ipcMain.handle("rotate-geolocation", () => {
  if (mainWindow) {
    const geo = overrideGeolocation(mainWindow.webContents);
    return geo;
  }
  return null;
});

// Virtualization controls
ipcMain.handle("start-virtualization", () => {
  startVirtualizationSession();
  return true;
});

ipcMain.handle("stop-virtualization", () => {
  stopVirtualizationSession();
  return true;
});
