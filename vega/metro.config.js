const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration.
 * The app imports the shared core from ../packages/core, outside this project.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../packages/core')],
  // Files there resolve their Babel helpers from this project's node_modules.
  resolver: {nodeModulesPaths: [path.resolve(__dirname, 'node_modules')]},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
