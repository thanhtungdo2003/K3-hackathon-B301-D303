/**
 * Vỏ Electron của AGORA.
 *
 * Lý do phải có: cửa sổ trình chiếu cần không viền, khoá kích thước, không cho
 * kéo đi và không cho đóng. Trình duyệt thường không làm được mấy việc đó —
 * `window.open` vẫn cho người dùng kéo và đóng cửa sổ.
 */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

const APP_URL = process.env.AGORA_APP_URL || "http://localhost:3000";

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let presentWindow = null;
/** Đường dẫn trang trình chiếu đang mở — dùng khi phải dựng lại cửa sổ. */
let presentPath = null;
/** Bật khi thật sự muốn đóng (thoát app), để bỏ qua lớp chặn đóng. */
let allowPresentClose = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    backgroundColor: "#f4f7fd",
    title: "AGORA",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
    allowPresentClose = true;
    destroyPresentWindow();
  });

  // Cửa sổ trình chiếu dán theo cửa sổ chính: cha đi đâu thì con theo đó.
  const follow = () => applyBounds();
  mainWindow.on("move", follow);
  mainWindow.on("resize", follow);
}

/** Khung cuối cùng renderer gửi sang, tính theo toạ độ trong trang. */
let lastViewportBounds = null;

/**
 * Đổi khung trong trang thành khung màn hình.
 *
 * Phải cộng gốc vùng nội dung của cửa sổ chính (không phải gốc cửa sổ) rồi nhân
 * theo mức phóng to, nếu không cửa sổ trình chiếu sẽ lệch trên màn hình HiDPI.
 */
function toScreenBounds(viewport) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const content = mainWindow.getContentBounds();
  const zoom = mainWindow.webContents.getZoomFactor() || 1;
  return {
    x: Math.round(content.x + viewport.x * zoom),
    y: Math.round(content.y + viewport.y * zoom),
    width: Math.max(320, Math.round(viewport.width * zoom)),
    height: Math.max(180, Math.round(viewport.height * zoom)),
  };
}

function applyBounds() {
  if (!presentWindow || presentWindow.isDestroyed() || !lastViewportBounds) return;
  const bounds = toScreenBounds(lastViewportBounds);
  if (!bounds) return;

  // Kẹp vào vùng làm việc của màn hình đang chứa cửa sổ chính.
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  bounds.x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
  bounds.y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);

  presentWindow.setBounds(bounds);
}

function createPresentWindow(urlPath, viewport) {
  lastViewportBounds = viewport;
  const bounds = toScreenBounds(viewport) || { x: 100, y: 100, width: 960, height: 540 };
  presentPath = urlPath;

  presentWindow = new BrowserWindow({
    ...bounds,
    parent: mainWindow ?? undefined,
    frame: false,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  presentWindow.loadURL(APP_URL + urlPath);
  presentWindow.setMenuBarVisibility(false);

  // Chặn đóng: người dùng bấm Alt+F4 hay lệnh đóng nào cũng bị giữ lại, trừ khi
  // chính app yêu cầu đóng. Buổi dạy không được mất màn chiếu giữa chừng.
  presentWindow.on("close", (event) => {
    if (allowPresentClose) return;
    event.preventDefault();
  });

  presentWindow.on("closed", () => {
    presentWindow = null;
  });

  return presentWindow;
}

function destroyPresentWindow() {
  if (!presentWindow || presentWindow.isDestroyed()) {
    presentWindow = null;
    return;
  }
  allowPresentClose = true;
  presentWindow.destroy();
  presentWindow = null;
}

/* ── kênh gọi từ renderer ─────────────────────────────────────────────── */

ipcMain.handle("present:open", (_event, urlPath, viewport) => {
  if (presentWindow && !presentWindow.isDestroyed()) {
    // Đã mở rồi thì chỉ dán lại vị trí và nạp đúng trang, không dựng cửa sổ mới.
    lastViewportBounds = viewport;
    applyBounds();
    if (presentPath !== urlPath) {
      presentPath = urlPath;
      presentWindow.loadURL(APP_URL + urlPath);
    }
    presentWindow.showInactive();
    return true;
  }
  allowPresentClose = false;
  createPresentWindow(urlPath, viewport);
  return true;
});

ipcMain.handle("present:bounds", (_event, viewport) => {
  lastViewportBounds = viewport;
  applyBounds();
  return true;
});

ipcMain.handle("present:is-open", () => {
  return Boolean(presentWindow && !presentWindow.isDestroyed());
});

ipcMain.handle("present:close", () => {
  destroyPresentWindow();
  allowPresentClose = false;
  return true;
});

/* ── vòng đời app ─────────────────────────────────────────────────────── */

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  allowPresentClose = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
