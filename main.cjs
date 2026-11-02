const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { validateState, writeAtomic, loadOrMigrate, emptyState } = require('./store.cjs');
let window,
  catalog,
  file,
  saveQueue = Promise.resolve(),
  loadBlocked = false,
  pendingSaves = 0,
  canQuit = false;
const isSmoke = process.argv.includes('--smoke-test');
const isQa = isSmoke || (process.argv.includes('--qa') && !!process.env.SYHZ_QA_DIR);
const qaRoot =
  process.env.SYHZ_QA_DIR ||
  path.join(app.isPackaged ? app.getPath('temp') : __dirname, 'outputs/app-qa');
const dataRoot = isQa
  ? path.join(qaRoot, 'profile')
  : path.join(app.getPath('appData'), 'SyhzUmamusumeTools');
app.setPath('userData', dataRoot);
app.setName('SyhzUmamusumeTools');
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
if (hasLock)
  app
    .whenReady()
    .then(async () => {
      catalog = JSON.parse(
        await fs.readFile(path.join(__dirname, 'app/dist/catalog.json'), 'utf8'),
      );
      file = path.join(app.getPath('userData'), 'collection-v1.json');
      ipcMain.handle('state:load', async () => {
        try {
          const legacyFiles = isQa
            ? []
            : ['优俊补杯助手', 'syhz-trophy-planner'].map((name) =>
                path.join(app.getPath('appData'), name, 'collection-v1.json'),
              );
          return {
            ...(await loadOrMigrate(file, legacyFiles, catalog)),
            dataPath: file,
            isTestProfile: isQa,
          };
        } catch (e) {
          loadBlocked = true;
          return { state: emptyState(), error: e.message, dataPath: file, isTestProfile: isQa };
        }
      });
      ipcMain.handle('state:save', (_event, input) => {
        if (loadBlocked) throw new Error('原存档损坏，已停止写入。请通过数据与备份恢复有效备份。');
        const state = validateState(input, catalog);
        pendingSaves++;
        const operation = saveQueue.then(() => writeAtomic(file, state, catalog));
        saveQueue = operation.catch(() => {}).finally(() => pendingSaves--);
        return operation.then(() => ({ ok: true }));
      });
      ipcMain.handle('state:restore', async (_event, input) => {
        const state = validateState(input, catalog);
        await saveQueue;
        if (loadBlocked) {
          try {
            await fs.copyFile(file, file + '.corrupt-' + Date.now());
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
        await writeAtomic(file, state, catalog);
        loadBlocked = false;
        return { ok: true };
      });
      ipcMain.handle('backup:export', async (_event, input) => {
        const state = validateState(input, catalog),
          result = await dialog.showSaveDialog(window, {
            defaultPath: `优俊补杯备份-${new Date().toISOString().slice(0, 10)}.json`,
            filters: [{ name: 'JSON 备份', extensions: ['json'] }],
          });
        if (result.canceled) return false;
        await fs.writeFile(result.filePath, JSON.stringify(state, null, 2));
        return true;
      });
      ipcMain.handle('backup:import', async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'JSON 备份', extensions: ['json'] }],
        });
        if (result.canceled) return null;
        const stat = await fs.stat(result.filePaths[0]);
        if (stat.size > 5_000_000) throw new Error('备份超过 5 MB');
        return validateState(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')), catalog);
      });
      ipcMain.handle('file:export', async (_event, payload) => {
        if (
          !payload ||
          !['txt', 'png'].includes(payload.type) ||
          typeof payload.data !== 'string' ||
          payload.data.length > 30_000_000
        )
          throw new Error('导出数据无效');
        const result = await dialog.showSaveDialog(window, {
          defaultPath: `优俊赛程.${payload.type}`,
          filters: [
            { name: payload.type === 'png' ? 'PNG 图片' : '纯文本', extensions: [payload.type] },
          ],
        });
        if (result.canceled) return false;
        if (payload.type === 'png') {
          if (!payload.data.startsWith('data:image/png;base64,')) throw new Error('图片格式无效');
          await fs.writeFile(result.filePath, Buffer.from(payload.data.split(',')[1], 'base64'));
        } else await fs.writeFile(result.filePath, payload.data, 'utf8');
        return true;
      });
      ipcMain.handle('source:open', async (_event, url) => {
        const u = new URL(url);
        if (
          u.protocol !== 'https:' ||
          ![
            'wiki.biligame.com',
            'www.taptap.cn',
            'game.bilibili.com',
            'umamusume.jp',
            'gamewith.jp',
            'www.gaoshouyou.com',
            'tma.main.jp',
          ].includes(u.hostname)
        )
          throw new Error('不支持的资料链接');
        await shell.openExternal(u.href);
      });
      window = new BrowserWindow({
        width: 1440,
        height: 1000,
        minWidth: 1040,
        minHeight: 720,
        title: `SyhzUmamusumeTools${isQa ? ' [测试存档]' : ''}`,
        icon: path.join(__dirname, 'build/icon.png'),
        backgroundColor: '#eef5ea',
        show: !isSmoke,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith('file:')) e.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      if (isSmoke) {
        let remoteRequests = 0;
        window.webContents.session.webRequest.onBeforeRequest(
          { urls: ['http://*/*', 'https://*/*'] },
          (_details, callback) => {
            remoteRequests++;
            callback({ cancel: true });
          },
        );
        window.webContents.on('console-message', (event) => {
          if (event.level === 'error') console.error(event.message);
        });
        window.webContents.once('did-finish-load', async () => {
          try {
            await new Promise((r) => setTimeout(r, 1800));
            const result = await window.webContents.executeJavaScript(
              `JSON.stringify({title:document.title,cards:document.querySelectorAll('.trophy-item').length,characters:document.querySelectorAll('.character-option').length,error:document.querySelector('.fatal')?.textContent,api:typeof window.desktop?.load,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length})`,
            );
            console.log('SMOKE', result);
            const parsed = JSON.parse(result);
            if (
              parsed.error ||
              parsed.cards !== 35 ||
              parsed.characters !== 87 ||
              parsed.api !== 'function' ||
              parsed.brokenImages ||
              remoteRequests
            )
              throw new Error('Renderer smoke failed');
            const img = await window.webContents.capturePage();
            await fs.mkdir(qaRoot, { recursive: true });
            await fs.writeFile(path.join(qaRoot, 'trophy-room.png'), img.toPNG());
            app.exit(0);
          } catch (e) {
            console.error(e);
            app.exit(1);
          }
        });
      }
      await window.loadFile(path.join(__dirname, 'app/dist/index.html'));
    })
    .catch((e) => {
      console.error(e);
      dialog.showErrorBox('应用无法启动', e.message);
      app.exit(1);
    });
app.on('before-quit', (event) => {
  if (pendingSaves && !canQuit) {
    event.preventDefault();
    saveQueue.finally(() => {
      canQuit = true;
      app.quit();
    });
  }
});
app.on('window-all-closed', () => app.quit());
