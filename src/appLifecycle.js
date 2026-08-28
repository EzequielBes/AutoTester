'use strict';

function startSingleInstanceApp(app, createWindow) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.whenReady().then(createWindow);
  return true;
}

module.exports = { startSingleInstanceApp };
