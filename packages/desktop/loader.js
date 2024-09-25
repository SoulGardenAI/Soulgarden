const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  quit: (payload) => ipcRenderer.send('quit', payload),
  telegramStart: (payload) => ipcRenderer.send('telegram-start', payload),
  sendMessage: (payload) => ipcRenderer.send('message-to-electron', payload),
  onMessage: (callback) => {
    ipcRenderer.on('from-telegram', (event, response) => callback(response));
  },
  removeMessageListener: (callback = () => {}) => {
    ipcRenderer.removeListener('from-telegram', callback);
  },
  setTyping: (istyping) => ipcRenderer.send('set-typing', istyping),
  onLoaderMessage: (callback) => {
    ipcRenderer.on('from-loader', (event, response) => callback(response));
  },
});
