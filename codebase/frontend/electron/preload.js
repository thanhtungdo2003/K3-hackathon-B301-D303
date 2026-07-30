/**
 * Cầu nối duy nhất giữa trang web và Electron.
 *
 * Chỉ mở đúng bốn việc liên quan tới cửa sổ trình chiếu. Trang không chạm được
 * vào Node, không đọc được file — contextIsolation vẫn bật.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agoraDesktop", {
  isDesktop: true,
  openPresentation: (url, bounds) => ipcRenderer.invoke("present:open", url, bounds),
  setPresentationBounds: (bounds) => ipcRenderer.invoke("present:bounds", bounds),
  isPresentationOpen: () => ipcRenderer.invoke("present:is-open"),
  closePresentation: () => ipcRenderer.invoke("present:close"),
});
