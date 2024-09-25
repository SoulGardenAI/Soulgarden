const { notarize } = require('electron-notarize');
const { APPLE_ID, APPLE_ID_PASS, CI } = process.env;

exports.default = async function notarizing(context) {
  if (!CI) return;

  const { electronPlatformName } = context;
  if (electronPlatformName !== 'darwin') return;

  const result = await notarize({
    tool: 'notarytool',
    appPath: 'build/mac-universal/Soulgarden.app',
    teamId: '9GTLT3AM43',
    appleId: APPLE_ID,
    appleIdPassword: APPLE_ID_PASS,
  });

  console.log('Notarized', result);

  return result;
};
