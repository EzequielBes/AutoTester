'use strict';

function configureWindowSecurity(webContents, trustedUrl) {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (url !== trustedUrl) event.preventDefault();
  });
}

module.exports = { configureWindowSecurity };
