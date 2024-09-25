const path = require('path');
const url = require('url');
// const { Buffer } = require('buffer');

const {
  app,
  ipcMain,
  systemPreferences,
  protocol,
  dialog,

  BrowserWindow,
  Tray,
} = require('electron');

const fs = require('fs-extra');
const logger = require('electron-log');
const { Telegraf } = require('telegraf');

const { downloadModels, setupServer, launchServer } = require('./llama');

process.argv.push('--enable-dawn-features=allow_unsafe_apis');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'file',
    privileges: { bypassCSP: true }
  },
]);

const {
  APP_DEBUG = 'no',
  APP_URL = url.format({
    pathname: path.join(__dirname, 'app/index.html'),
    protocol: 'file:',
    slashes: true
  }),
} = process.env;

const WINHEIGHT = 640;  
const WINWIDTH = 640; 

const ISWIN = process.platform === 'win32';

let tray;
let mainWindow;
let SERVER;
let REPORT;
let QUITTING = false

const quit = () => {
  QUITTING = true;

  if (SERVER)
    SERVER.kill('SIGTERM'); 

  app.quit();
}

const display = () => {
  if (!mainWindow) return;

  mainWindow.show();
  mainWindow.focus();
};

const trayIcon = () => {
  let icon = 'trayd.png';
  if (ISWIN) icon = 'tray.ico';

  return path.join(__dirname, 'assets', icon);
};

const createWindow = () => {
  if (mainWindow) mainWindow.close();

  mainWindow = new BrowserWindow({
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'loader.js')
    }
  });

  mainWindow.once('ready-to-show', async () => {
    try {
      logger.error(REPORT)
      updateProgress();
      await requestPermissions();
    } catch (err) {
      console.error(err);
    }
  });

  mainWindow.webContents.on('did-fail-load', () =>
    setTimeout(() => mainWindow.loadURL(APP_URL), 1000));

  if (APP_DEBUG !== 'no') 
    mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setSize(WINWIDTH, WINHEIGHT);
  mainWindow.loadURL(APP_URL);

  tray = new Tray(trayIcon());
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    display();
  });
};

const requestPermissions = async () => {
  const permissions = ['microphone', 'camera'];
  for (const permission of permissions) {
    if (systemPreferences.getMediaAccessStatus(permission) !== 'granted')
      await systemPreferences.askForMediaAccess(permission);
  }
};

const updateProgress = (report) => {
  REPORT = report || REPORT;

  if (mainWindow) 
    mainWindow.webContents.send('from-loader', REPORT);
}

!app.requestSingleInstanceLock() && quit();

app.on('before-quit', (ev) => {
  if (QUITTING) return;
  ev.preventDefault();
  quit();
});
app.on('activate', display);
app.on('second-instance', display);
app.on('ready', async () => {
  const workDir = path.join(app.getPath('userData'), 'llamacpp');

  try {
    createWindow();

    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o755);
  
    const onProgress = updateProgress;
    await downloadModels({ workDir, onProgress });
    await setupServer({ workDir, onProgress });
    SERVER = await launchServer({ workDir, onProgress, logger });
    updateProgress({ log: 'completed' });

  } catch (err) {
    logger.error(err);

    await dialog.showMessageBox({
      type: 'error',
      title: 'Error',
      message: 'Houston we had a problem! Please restart the app.',
      detail: err.message,
      buttons: ['Close']
    });

    quit();
  }
});


let telegramBot;
let ISTYPING = false;
let CTX;

const launchTelegram = ({ key }) => {
  if (telegramBot?.telegram.token === key) return;
  if (!key) return;

  logger.info('Launching Telegram bot...');

  const sendMessage = async (ctx, message) => {
    const handleElectronMessage = async (event, arg = {}) => {
      const { last, content: message } = arg;
      if (last?.id !== ctx.message.message_id) return;

      await reply({ ctx, message });
      ipcMain.removeListener('message-to-electron', handleElectronMessage);
    };
    ipcMain.on('message-to-electron', handleElectronMessage);
    
    mainWindow.webContents.send('from-telegram', message);
  };

  const bot = new Telegraf(key);

  bot.on('text', async (ctx) => {
    const { message } = ctx;
    CTX = ctx;
    
    if (message.text === '/start') return;

    sendMessage(ctx, { type: 'text', message });
  });

  bot.on('message', async (ctx) => {
    const { message } = ctx;
    
    if (message.photo) {
      const pics = message.photo;
      const pic = pics[pics.length - 1];

      const { file_id } = pic;
      const { href } = await ctx.telegram.getFileLink(file_id);

      sendMessage(ctx, { type: 'image', message: { ...message, href } });
    }

    if (message.audio) {
      const { file_id } = message.audio;
      const { href } = await ctx.telegram.getFileLink(file_id);

      sendMessage(ctx, { type: 'audio', message: { ...message, href } });
    }

    if (message.voice) {
      const { file_id } = message.voice;
      const { href } = await ctx.telegram.getFileLink(file_id);

      sendMessage(ctx, { type: 'audio', message: { ...message, href } });
    }
  });

  const reply = async ({ ctx, message }) => {
    // broken emoji 😊;
    logger.info(message)

    const reply_to_message_id = ctx.message.message_id !== CTX.message.message_id ? ctx.message.message_id: undefined;
    if (message.emojis?.length) {
      try {
        await ctx.react(message.emojis);
      } catch (err) {
        await ctx.reply(message.emojis, { reply_to_message_id });
      }
    }

    if (message.text) {
      await ctx.reply(message.text, { reply_to_message_id });
    }
    
    /*
    if (message.send_picture) {
      const buffer = Buffer.from(message.image64, 'base64');
      await ctx.replyWithPhoto({ source: buffer });
    }

    if (message.send_audio) {
      const buffer = Buffer.from(message.voice64, 'base64');
      await ctx.replyWithVoice({ source: buffer});
    }
    */
  };

  bot.launch({ allowedUpdates: ['message', 'message_reaction'] });
  
  telegramBot = bot;

  setInterval(() => {
    if (ISTYPING) CTX?.sendChatAction('typing');
  }, 1000);
}

ipcMain.on('telegram-start', (event, args) => launchTelegram(args));
ipcMain.on('set-typing', (event, value) => { ISTYPING = value });
ipcMain.on('quit', quit);
