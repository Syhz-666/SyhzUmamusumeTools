const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { validateState } = require('./store.cjs');
const { PersistentCollection } = require('./persistence.cjs');
let window,
  catalog,
  file,
  collection,
  canQuit = false,
  closing = false,
  closeTimer;
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
      const legacyFiles = isQa
        ? []
        : ['优俊补杯助手', 'syhz-trophy-planner'].map((name) =>
            path.join(app.getPath('appData'), name, 'collection-v1.json'),
          );
      collection = new PersistentCollection(file, catalog, legacyFiles);
      const log = async (event, detail) => {
        try {
          await fs.mkdir(dataRoot, { recursive: true });
          await fs.appendFile(
            path.join(dataRoot, 'persistence.log'),
            JSON.stringify({
              at: new Date().toISOString(),
              event,
              ...detail,
            }) + '\n',
          );
        } catch {}
      };
      // Finish reading disk before creating an editable window.
      try {
        const result = await collection.initialize();
        await log('loaded', {
          file,
          trophies: Object.values(result.state.progress).reduce((n, ids) => n + ids.length, 0),
        });
      } catch (error) {
        await log('load-failed', { file, error: error.message });
      }
      ipcMain.handle('state:load', async () => {
        try {
          return JSON.stringify({
            ...(await collection.load()),
            dataPath: file,
            isTestProfile: isQa,
          });
        } catch (e) {
          await log('load-failed', { file, error: e.message });
          return JSON.stringify({
            state: null,
            error: `无法读取存档：${e.message}`,
            dataPath: file,
          });
        }
      });
      ipcMain.handle('state:save', async (_event, input) => {
        try {
          return await collection.save(JSON.parse(input));
        } catch (e) {
          await log('save-failed', { file, error: e.message });
          throw e;
        }
      });
      ipcMain.handle('state:restore', async (_event, input) => {
        return await collection.restore(JSON.parse(input));
      });
      ipcMain.on('state:flush-ready', async (event, result) => {
        if (!closing || event.sender !== window?.webContents) return;
        clearTimeout(closeTimer);
        try {
          if (result?.error) throw new Error(result.error);
          await collection.flush();
          canQuit = true;
          window.close();
        } catch (error) {
          closing = false;
          await log('close-save-failed', { file, error: error.message });
          dialog.showErrorBox('数据尚未保存，已取消退出', error.message);
        }
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
      window.on('close', (event) => {
        if (canQuit) return;
        event.preventDefault();
        if (closing) return;
        closing = true;
        window.webContents.send('state:flush-request');
        closeTimer = setTimeout(() => {
          closing = false;
          dialog.showErrorBox('尚未完成保存', '退出已取消，请等待保存完成后重试。');
        }, 10000);
      });
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
              `JSON.stringify({title:document.title,cards:document.querySelectorAll('.trophy-item').length,characters:document.querySelectorAll('.character-option').length,error:document.querySelector('.fatal')?.textContent,api:typeof window.desktop?.load,trophies:parseInt(document.querySelector('.hero-count strong')?.textContent),character:document.querySelector('.character-hero h1')?.textContent,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length})`,
            );
            console.log('SMOKE', result);
            const parsed = JSON.parse(result);
            const stored = (await collection.load()).state;
            const expectedCount = (stored.progress[stored.selectedCharacter] || []).length;
            if (
              parsed.error ||
              parsed.cards !== 35 ||
              parsed.characters !== 87 ||
              parsed.api !== 'function' ||
              parsed.brokenImages ||
              parsed.trophies !== expectedCount ||
              parsed.character !==
                catalog.characters.find((c) => c.id === stored.selectedCharacter)?.name ||
              (process.env.SYHZ_EXPECT_TROPHIES &&
                parsed.trophies !== +process.env.SYHZ_EXPECT_TROPHIES) ||
              remoteRequests
            )
              throw new Error('Renderer smoke failed');
            const img = await window.webContents.capturePage();
            await fs.mkdir(qaRoot, { recursive: true });
            await fs.writeFile(path.join(qaRoot, 'trophy-room.png'), img.toPNG());
            if (process.argv.includes('--persistence-exercise')) {
              const target = catalog.races.find(
                (r) =>
                  r.grade === 'G1' &&
                  !(stored.progress[stored.selectedCharacter] || []).includes(r.id),
              );
              if (!target) throw new Error('No missing G1 trophy for persistence test');
              await window.webContents.executeJavaScript(
                `document.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify('点亮 ' + target.name)}) + ']').click()`,
              );
              // Exercise the actual close handshake immediately after a click.
              window.close();
            } else app.exit(0);
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
  if (window && !window.isDestroyed() && !canQuit) {
    event.preventDefault();
    window.close();
  }
});
app.on('window-all-closed', () => app.quit());
