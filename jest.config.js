module.exports = {
  preset: 'react-native',
  // axios ships ESM; let babel transform it along with the RN packages.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-svg|axios)/)',
  ],
};
