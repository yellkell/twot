/**
 * Firebase web-app config for TWOT (project `curveball-a147e`, app "TWOT").
 *
 * A Firebase web API key is a PUBLIC IDENTIFIER, not a secret — access
 * control lives in firestore.rules (anonymous auth required, writes scoped
 * to your own docs). Safe to commit, same as the reference project did.
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyCbvSWrwAY1Yn9woq1L6HgEadE7bo12YL8',
  authDomain: 'curveball-a147e.firebaseapp.com',
  projectId: 'curveball-a147e',
  storageBucket: 'curveball-a147e.firebasestorage.app',
  messagingSenderId: '507240626084',
  appId: '1:507240626084:web:a691e4c3e03785a419b331',
};

/**
 * Dev builds use their own park doc so desktop testing never puts phantom
 * players in the live park. Profiles (players/{uid}) are shared either way.
 */
export const PARK_ID = import.meta.env.DEV ? 'park-dev' : 'park-main';
