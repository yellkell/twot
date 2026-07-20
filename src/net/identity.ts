/**
 * Who you are, durably: Firebase ANONYMOUS auth (zero friction, no signup)
 * plus your profile doc at players/{uid} — callsign, accent, and the
 * lifetime stat sheet the leaderboards will rank. Lives behind the lazy
 * boundary (only meshImpl imports this), so the SDK stays out of the main
 * chunk.
 *
 * The db() singleton idiom is the reference project's: initialize once,
 * reuse everywhere.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig.js';

let firebaseApp: FirebaseApp | undefined;

function app(): FirebaseApp {
  firebaseApp ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  return firebaseApp;
}

export function db(): Firestore {
  return getFirestore(app());
}

export function auth(): Auth {
  return getAuth(app());
}

/** Sign in anonymously (or recover the existing session). Returns the uid. */
export async function ensureSignedIn(): Promise<string> {
  const a = auth();
  const existing = a.currentUser;
  if (existing) return existing.uid;
  // Give a persisted session one tick to restore before minting a new one.
  await new Promise<void>((resolve) => {
    const stop = onAuthStateChanged(a, () => {
      stop();
      resolve();
    });
  });
  // Fresh handle: TS pins the first reference's readonly currentUser to
  // null after the early return above, even across the await.
  const restored = auth().currentUser;
  if (restored) return restored.uid;
  const cred = await signInAnonymously(a);
  return cred.user.uid;
}

/** The lifetime stat sheet a fresh profile starts with. */
function zeroStats(): Record<string, number> {
  return {
    aura: 0, goals: 0, assists: 0, saves: 0, passes: 0, touches: 0,
    shots: 0, halfVolleys: 0, bestCombo: 0, keeperSeconds: 0,
    keeperStints: 0, slapsGiven: 0, slapsTaken: 0, highFives: 0,
  };
}

/** Create-or-refresh players/{uid}. Never touches an existing stat sheet. */
export async function syncProfile(uid: string, callsign: string, accent: number): Promise<void> {
  const ref = doc(db(), 'players', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      callsign,
      accent,
      stats: zeroStats(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, { callsign, accent, updatedAt: serverTimestamp() }, { merge: true });
  }
}
