const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  Menu,
  clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");

let mainWindow;
let settingsWindow;
const isDev = !app.isPackaged;

// Config path for saving settings
const configPath = path.join(app.getPath("userData"), "config.json");

// VPN Process Management
let activeVpnProcess = null;
let vpnConnected = false;
let currentVpnConfig = null;

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
  vpnEnabled: false,
  mullvadFolderPath: "",
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

// Available VPN configurations
let vpnConfigurations = [];
let currentVpnIndex = 0;

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

    // Update VPN settings
    if (settings.mullvadFolderPath && settings.mullvadFolderPath !== "") {
      loadVpnConfigurations(settings.mullvadFolderPath);
    }
  } catch (e) {
    console.error("Error saving settings:", e);
  }
}

// Load VPN configurations from Mullvad folder
function loadVpnConfigurations(folderPath) {
  try {
    console.log(`Loading VPN configurations from: ${folderPath}`);
    if (!fs.existsSync(folderPath)) {
      console.error(`VPN folder does not exist: ${folderPath}`);
      return;
    }

    // Find all .tblk directories
    const tblkFolders = fs
      .readdirSync(folderPath)
      .filter(
        (file) =>
          file.endsWith(".tblk") &&
          fs.statSync(path.join(folderPath, file)).isDirectory()
      );

    vpnConfigurations = [];

    // For each .tblk folder, find configuration files
    for (const tblkFolder of tblkFolders) {
      const tblkPath = path.join(folderPath, tblkFolder);
      const files = fs.readdirSync(tblkPath);

      // Find .conf files (OpenVPN configuration files)
      const confFiles = files.filter((file) => file.endsWith(".conf"));

      for (const confFile of confFiles) {
        const configPath = path.join(tblkPath, confFile);
        const content = fs.readFileSync(configPath, "utf8");

        // Extract location from filename or content
        let location = "";
        if (confFile.includes("_")) {
          // Extract from filename like mullvad_au_adl.conf
          const parts = confFile.replace(".conf", "").split("_");
          if (parts.length >= 3) {
            location = `${parts[1]}-${parts[2]}`.toUpperCase(); // Format as AU-ADL
          }
        } else {
          // Try to extract from content by finding remote lines
          const remoteLines = content
            .split("\n")
            .filter((line) => line.startsWith("remote ") && line.includes("#"));

          if (remoteLines.length > 0) {
            const commentPart = remoteLines[0].split("#")[1].trim();
            location = commentPart;
          }
        }

        if (!location) location = confFile.replace(".conf", "");

        vpnConfigurations.push({
          name: location,
          path: configPath,
          tblkPath: tblkPath,
        });
      }
    }

    console.log(`Found ${vpnConfigurations.length} VPN configurations`);
    currentVpnIndex = 0;
  } catch (error) {
    console.error("Error loading VPN configurations:", error);
    vpnConfigurations = [];
  }
}

// Get next VPN configuration in rotation
function getNextVpnConfiguration() {
  if (vpnConfigurations.length === 0) {
    console.log("No VPN configurations available");
    return null;
  }

  const config = vpnConfigurations[currentVpnIndex];
  currentVpnIndex = (currentVpnIndex + 1) % vpnConfigurations.length;
  return config;
}

// Connect to VPN using the specified configuration
async function connectToVpn(vpnConfig) {
  if (!vpnConfig) {
    console.error("No VPN configuration provided");
    return false;
  }

  // Disconnect any existing VPN connection
  await disconnectVpn();

  try {
    console.log(`Connecting to VPN: ${vpnConfig.name}`);

    // For macOS, we need to use a different approach because OpenVPN GUI is more reliable
    // than directly invoking OpenVPN binary
    if (process.platform === "darwin") {
      // Check if the file exists
      if (!fs.existsSync(vpnConfig.path)) {
        console.error(`VPN configuration file not found: ${vpnConfig.path}`);
        return false;
      }

      // Check if we're running with sudo, if not, warn the user
      const uid = process.getuid ? process.getuid() : -1;
      if (uid !== 0) {
        console.warn(
          "Warning: VPN connection may require sudo privileges. Consider running the app with sudo."
        );
      }

      // For macOS, attempt to use the open command to utilize the Tunnelblick app if installed
      try {
        // First check if Tunnelblick is installed
        fs.accessSync("/Applications/Tunnelblick.app", fs.constants.F_OK);

        // Use the open command to open the .tblk file with Tunnelblick
        const vpnProcess = spawn(
          "open",
          ["-a", "Tunnelblick", vpnConfig.tblkPath],
          {
            detached: true,
          }
        );

        activeVpnProcess = vpnProcess;
        currentVpnConfig = vpnConfig;

        // Set status and notify
        vpnConnected = true; // Assume successfully sent to Tunnelblick

        if (mainWindow) {
          mainWindow.webContents.send("vpn-status-changed", {
            connected: true,
            location: vpnConfig.name,
          });
        }

        return true;
      } catch (e) {
        console.error("Tunnelblick not found, falling back to OpenVPN CLI:", e);

        // Fallback to OpenVPN CLI
        const openvpnPath = "/usr/local/bin/openvpn";

        if (!fs.existsSync(openvpnPath)) {
          console.error(
            "OpenVPN not found. Please install it with Homebrew: brew install openvpn"
          );
          return false;
        }

        // Run OpenVPN in the background
        const vpnProcess = spawn(
          "sudo",
          [openvpnPath, "--config", vpnConfig.path],
          {
            detached: true,
            stdio: "pipe",
          }
        );

        activeVpnProcess = vpnProcess;
        currentVpnConfig = vpnConfig;

        // Set connected status after a delay since we can't easily parse OpenVPN output
        setTimeout(() => {
          vpnConnected = true;
          console.log(
            `Assumed connected to VPN: ${vpnConfig.name} (delayed status)`
          );

          // Notify the main window
          if (mainWindow) {
            mainWindow.webContents.send("vpn-status-changed", {
              connected: true,
              location: vpnConfig.name,
            });
          }
        }, 3000);

        return true;
      }
    } else {
      // For other platforms (Windows/Linux), we can try a direct approach with OpenVPN
      const vpnProcess = spawn("openvpn", ["--config", vpnConfig.path], {
        detached: true,
        stdio: "pipe",
      });

      activeVpnProcess = vpnProcess;
      currentVpnConfig = vpnConfig;

      // Listen for process events
      vpnProcess.stdout.on("data", (data) => {
        const output = data.toString();
        console.log(`VPN stdout: ${output}`);

        // Check for successful connection
        if (output.includes("Initialization Sequence Completed")) {
          vpnConnected = true;
          console.log(`Connected to VPN: ${vpnConfig.name}`);

          // Notify the main window
          if (mainWindow) {
            mainWindow.webContents.send("vpn-status-changed", {
              connected: true,
              location: vpnConfig.name,
            });
          }
        }
      });

      vpnProcess.stderr.on("data", (data) => {
        console.error(`VPN stderr: ${data.toString()}`);
      });

      return true;
    }
  } catch (error) {
    console.error("Error connecting to VPN:", error);
    return false;
  }
}

// Disconnect from VPN
async function disconnectVpn() {
  if (!activeVpnProcess && !vpnConnected) {
    console.log("No active VPN connection to disconnect");
    return true;
  }

  try {
    console.log("Disconnecting from VPN");

    if (process.platform === "darwin") {
      // For macOS, try to disconnect through Tunnelblick if it's being used
      try {
        if (fs.existsSync("/Applications/Tunnelblick.app")) {
          // First, get list of connected configurations
          exec(
            "osascript -e 'tell application \"Tunnelblick\" to get name of configurations where state is connected'",
            async (error, stdout, stderr) => {
              if (error) {
                console.error("Error getting Tunnelblick connections:", error);
                // Fall back to force kill method
                await forceKillVpn();
                return;
              }

              const connectedConfigs = stdout.trim().split(", ");

              // Find our configuration
              if (currentVpnConfig) {
                const configName = path.basename(
                  currentVpnConfig.tblkPath,
                  ".tblk"
                );

                if (connectedConfigs.includes(configName)) {
                  // Disconnect the specific configuration
                  exec(
                    `osascript -e 'tell application "Tunnelblick" to disconnect "${configName}"'`,
                    (error, stdout, stderr) => {
                      if (error) {
                        console.error(
                          "Error disconnecting from Tunnelblick:",
                          error
                        );
                      } else {
                        console.log(`Disconnected from VPN: ${configName}`);
                      }
                    }
                  );
                }
              } else {
                // Disconnect all configurations
                exec(
                  "osascript -e 'tell application \"Tunnelblick\" to disconnect all'",
                  (error, stdout, stderr) => {
                    if (error) {
                      console.error(
                        "Error disconnecting all from Tunnelblick:",
                        error
                      );
                    } else {
                      console.log("Disconnected all VPN connections");
                    }
                  }
                );
              }
            }
          );
        } else {
          // Tunnelblick not found, fall back to force kill
          await forceKillVpn();
        }
      } catch (e) {
        console.error("Error with Tunnelblick disconnect:", e);
        await forceKillVpn();
      }
    } else {
      // For other platforms, kill the OpenVPN process
      if (activeVpnProcess) {
        activeVpnProcess.kill("SIGTERM");
      }

      // Force kill any remaining processes
      await forceKillVpn();
    }

    // Reset state
    vpnConnected = false;
    activeVpnProcess = null;
    currentVpnConfig = null;

    // Notify the main window
    if (mainWindow) {
      mainWindow.webContents.send("vpn-status-changed", {
        connected: false,
        location: "",
      });
    }

    return true;
  } catch (error) {
    console.error("Error disconnecting from VPN:", error);
    return false;
  }
}

// Helper function to force kill OpenVPN processes
async function forceKillVpn() {
  return new Promise((resolve) => {
    if (process.platform === "darwin" || process.platform === "linux") {
      exec("pkill -f openvpn", (error) => {
        if (error && error.code !== 1) {
          // Error code 1 just means no processes were found
          console.error("Error killing openvpn process:", error);
        }
        resolve();
      });
    } else {
      // Windows
      exec("taskkill /F /IM openvpn.exe", (error) => {
        if (error && error.code !== 128) {
          // Error code 128 means no processes were found
          console.error("Error killing openvpn process:", error);
        }
        resolve();
      });
    }
  });
}

// Rotate VPN connection
async function rotateVpn() {
  const config = getNextVpnConfiguration();
  if (!config) {
    console.error("No VPN configurations available to rotate to");
    return false;
  }

  return await connectToVpn(config);
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
  const vpnEnabled = settings.vpnEnabled || false;

  // Clear any existing session
  stopVirtualizationSession();

  // Connect to VPN if enabled
  if (vpnEnabled && vpnConfigurations.length > 0) {
    rotateVpn().then((success) => {
      if (success) {
        console.log("Connected to VPN for virtualization session");
      } else {
        console.error("Failed to connect to VPN for virtualization session");
      }

      // Continue with window creation regardless of VPN connection status
      createSessionWindows(windowsPerSession, url);
    });
  } else {
    // Create windows without VPN
    createSessionWindows(windowsPerSession, url);
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

// Helper function to create session windows
function createSessionWindows(count, url) {
  for (let i = 0; i < count; i++) {
    const sessionWindow = createSessionWindow(url);
    sessionWindows.push(sessionWindow);
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

  // Disconnect from VPN if connected
  if (vpnConnected) {
    disconnectVpn().then((success) => {
      if (success) {
        console.log("Disconnected from VPN after stopping virtualization");
      } else {
        console.error(
          "Failed to disconnect from VPN after stopping virtualization"
        );
      }
    });
  }
}

// Helper function to setup browser window with proper paste support
function createWindowWithPasteSupport(options) {
  const win = new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      spellcheck: true,
    },
  });

  // Setup clipboard menu for all windows
  win.webContents.on("context-menu", (event, params) => {
    const { selectionText, isEditable, editFlags } = params;

    if (isEditable) {
      const menuTemplate = [
        { label: "Cut", role: "cut", enabled: editFlags.canCut },
        { label: "Copy", role: "copy", enabled: editFlags.canCopy },
        { label: "Paste", role: "paste", enabled: editFlags.canPaste },
        { type: "separator" },
        { label: "Select All", role: "selectAll" },
      ];

      Menu.buildFromTemplate(menuTemplate).popup(win);
    } else if (selectionText && selectionText.trim() !== "") {
      // Text selection menu
      Menu.buildFromTemplate([
        { label: "Copy", role: "copy" },
        { type: "separator" },
        { label: "Select All", role: "selectAll" },
      ]).popup(win);
    }
  });

  return win;
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

  // Load VPN configurations if path is set
  if (settings.mullvadFolderPath && settings.mullvadFolderPath !== "") {
    loadVpnConfigurations(settings.mullvadFolderPath);
  }

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
      "clipboard-read",
      "clipboard-write",
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
        "clipboard-read",
        "clipboard-write",
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

  // Create main window using our helper
  mainWindow = createWindowWithPasteSupport({
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
        {
          label: "Rotate VPN",
          accelerator: "CmdOrCtrl+V",
          click: () => {
            rotateVpn().then((success) => {
              if (success && mainWindow) {
                mainWindow.webContents.send("vpn-status-changed", {
                  connected: vpnConnected,
                  location: currentVpnConfig ? currentVpnConfig.name : "",
                });
              }
            });
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
  // Create settings window using our helper
  settingsWindow = createWindowWithPasteSupport({
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

// IPC handlers for VPN
ipcMain.handle("get-vpn-configurations", () => {
  return vpnConfigurations.map((config) => ({
    name: config.name,
    path: config.path,
  }));
});

ipcMain.handle("get-vpn-status", () => {
  return {
    connected: vpnConnected,
    location: currentVpnConfig ? currentVpnConfig.name : "",
    configurations: vpnConfigurations.length,
  };
});

ipcMain.handle("connect-vpn", async (event, configIndex) => {
  if (configIndex >= 0 && configIndex < vpnConfigurations.length) {
    return await connectToVpn(vpnConfigurations[configIndex]);
  }
  return false;
});

ipcMain.handle("disconnect-vpn", async () => {
  return await disconnectVpn();
});

ipcMain.handle("rotate-vpn", async () => {
  return await rotateVpn();
});

// Add IPC handlers for clipboard operations
ipcMain.handle("clipboard-read-text", () => {
  return clipboard.readText();
});

ipcMain.handle("clipboard-write-text", (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("clipboard-read-html", () => {
  return clipboard.readHTML();
});

ipcMain.handle("clipboard-write-html", (event, html) => {
  clipboard.writeHTML(html);
  return true;
});
