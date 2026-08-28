'use strict';

function startSingleInstanceApp(app, createWindow, focusWindow = () => {}) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', focusWindow);
  app.whenReady().then(createWindow);
  return true;
}

module.exports = { startSingleInstanceApp };
