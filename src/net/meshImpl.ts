/**
 * The mesh IMPLEMENTATION — Firestore matchmaking + WebRTC signaling,
 * ported from the Iron Balls raid mesh and reshaped for a PERSISTENT park:
 * one park doc that players drop into and out of, not a lobby that
 * launches and disbands.
 *
 * Firestore is ONLY the noticeboard: seat claims (transactional),
 * heartbeats, and per-pair WebRTC signaling. Every live byte — poses,
 * identity, and later the shared rally — travels P2P over DataChannels.
 *
 * Lessons carried from the reference, in code below:
 *  - trickle-ICE candidates are BUFFERED until setRemoteDescription;
 *  - transient 'disconnected' is ignored (Quest Wi-Fi blips), only
 *    'failed'/'closed' count;
 *  - transports never mutate game state — everything lands in the
 *    bounded inbox on the facade;
 *  - abandoned seats are janitored by heartbeat age, because a crashed
 *    tab cleans up nothing.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, ensureSignedIn, syncProfile } from './identity.js';
import { PARK_ID } from './firebaseConfig.js';
import { NET } from './config.js';
import { iceServers } from './iceConfig.js';
import { unpackPose, type EvtMessage } from './protocol.js';
import { ensurePeer, mesh, pushInbox, resetMesh } from './mesh.js';
import { park } from './parkState.js';

interface ParkDoc {
  capacity: number;
  open: boolean;
  seats: string[];
  uids: string[];
  callsigns: string[];
  accents: number[];
  beats?: Record<string, Timestamp>;
}

interface PeerConn {
  pc: RTCPeerConnection;
  evt: RTCDataChannel | null;
  pose: RTCDataChannel | null;
  /** The offer epoch this connection belongs to (stale-signal filter). */
  epoch: number;
  caller: boolean;
  remoteSet: boolean;
  pending: RTCIceCandidateInit[];
  unsubs: Unsubscribe[];
}

const conns = new Map<number, PeerConn>();
let unsubRoom: Unsubscribe | null = null;
let unsubSig: Unsubscribe | null = null;
let beatTimer: ReturnType<typeof setInterval> | null = null;
let lastRoom: ParkDoc | null = null;
let joined = false;
let myEpoch = 0;
let calledExisting = false;
let pagehideHooked = false;

const parkRef = () => doc(db(), 'parks', PARK_ID);
const sigCol = () => collection(parkRef(), 'sig');
const pairId = (a: number, b: number): string => `${Math.min(a, b)}_${Math.max(a, b)}`;
const sigRef = (other: number) => doc(sigCol(), pairId(mesh.seat, other));
/** Candidates FROM `seat` for this pair live in sig/{pair}/c{seat}. */
const candCol = (other: number, from: number) => collection(sigRef(other), `c${from}`);

const blank = (): string[] => Array.from({ length: NET.capacity }, () => '');

// Reshape a stored array to the CURRENT capacity (a capacity change —
// like the 8→6 trim — normalizes the park doc on the next write).
const trimS = (a?: string[]): string[] =>
  Array.from({ length: NET.capacity }, (_, i) => a?.[i] ?? '');
const trimN = (a?: number[]): number[] =>
  Array.from({ length: NET.capacity }, (_, i) => a?.[i] ?? 0);

// --- Join / leave ----------------------------------------------------------

export async function join(callsign: string, accent: number): Promise<void> {
  if (joined) return;
  const uid = await ensureSignedIn();
  myEpoch = Date.now();
  calledExisting = false;

  const seat = await runTransaction(db(), async (txn) => {
    const snap = await txn.get(parkRef());
    if (!snap.exists()) {
      // First punter ever: the park doc is born with them in seat 0.
      const seats = blank();
      const uids = blank();
      const callsigns = blank();
      const accents = Array.from({ length: NET.capacity }, () => 0);
      seats[0] = mesh.clientId;
      uids[0] = uid;
      callsigns[0] = callsign;
      accents[0] = accent;
      txn.set(parkRef(), {
        capacity: NET.capacity,
        open: true,
        createdAt: serverTimestamp(),
        seats, uids, callsigns, accents,
        beats: { s0: serverTimestamp() },
      });
      return 0;
    }
    const d = snap.data() as ParkDoc;
    const seats = trimS(d.seats);
    const uids = trimS(d.uids);
    const callsigns = trimS(d.callsigns);
    const accents = trimN(d.accents);
    // A refresh of THIS tab reclaims its old seat before hunting a new one.
    let free = seats.findIndex((s) => s === mesh.clientId);
    if (free < 0) free = seats.findIndex((s) => !s);
    if (free < 0) throw new Error('the park is full — try again in a bit');
    seats[free] = mesh.clientId;
    uids[free] = uid;
    callsigns[free] = callsign;
    accents[free] = accent;
    txn.update(parkRef(), {
      seats, uids, callsigns, accents,
      [`beats.s${free}`]: serverTimestamp(),
    });
    return free;
  });

  mesh.seat = seat;
  mesh.uid = uid;
  mesh.status = 'in-park';
  park.status = 'in-park';
  joined = true;
  injectSenders();
  watchRoom();
  watchSig();
  startBeat();
  hookPagehide();
  syncProfile(uid, callsign, accent).catch(() => {
    /* profile sync is best-effort; the park works without it */
  });
}

export async function leave(): Promise<void> {
  if (!joined) return;
  joined = false;
  mesh.sendEvt({ k: 'bye', seat: mesh.seat });
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  unsubRoom?.();
  unsubSig?.();
  unsubRoom = unsubSig = null;
  const mySeat = mesh.seat;
  for (const other of [...conns.keys()]) closeConn(other);
  await vacate(mySeat, mesh.clientId).catch(() => {});
  await cleanSigDocs(mySeat).catch(() => {});
  resetMesh();
  park.count = 0;
}

/** Vacate a seat IF it's still held by the expected claimant. */
async function vacate(seat: number, expectCid: string): Promise<void> {
  if (seat < 0) return;
  await runTransaction(db(), async (txn) => {
    const snap = await txn.get(parkRef());
    if (!snap.exists()) return;
    const d = snap.data() as ParkDoc;
    if (d.seats[seat] !== expectCid) return;
    const seats = trimS(d.seats);
    const uids = trimS(d.uids);
    const callsigns = trimS(d.callsigns);
    const accents = trimN(d.accents);
    seats[seat] = '';
    uids[seat] = '';
    callsigns[seat] = '';
    accents[seat] = 0;
    txn.update(parkRef(), { seats, uids, callsigns, accents });
  });
}

/** Best-effort teardown of my pair signaling docs (and their candidates). */
async function cleanSigDocs(mySeat: number): Promise<void> {
  for (let other = 0; other < NET.capacity; other++) {
    if (other === mySeat) continue;
    const ref = doc(sigCol(), pairId(mySeat, other));
    for (const side of [mySeat, other]) {
      const cands = await getDocs(collection(ref, `c${side}`)).catch(() => null);
      if (cands) for (const c of cands.docs) await deleteDoc(c.ref).catch(() => {});
    }
    await deleteDoc(ref).catch(() => {});
  }
}

/** A closing tab can't await — fire the writes and let the janitor mop up. */
function hookPagehide(): void {
  if (pagehideHooked) return;
  pagehideHooked = true;
  window.addEventListener('pagehide', () => {
    if (joined) void leave();
  });
}

// --- The room watch --------------------------------------------------------

function watchRoom(): void {
  unsubRoom = onSnapshot(parkRef(), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data() as ParkDoc;
    lastRoom = d;

    // Evicted (janitored while asleep, or seat reclaimed): stand down.
    if (joined && mesh.seat >= 0 && d.seats[mesh.seat] !== mesh.clientId) {
      void leave().then(() => {
        park.status = 'idle';
      });
      return;
    }

    let count = 0;
    for (let s = 0; s < NET.capacity; s++) {
      const cid = d.seats[s];
      if (!cid) {
        if (mesh.peers.has(s)) {
          mesh.peers.delete(s);
          closeConn(s);
        }
        continue;
      }
      count++;
      if (s === mesh.seat) continue;
      const peer = ensurePeer(s);
      if (peer.clientId && peer.clientId !== cid) closeConn(s); // replaced occupant
      peer.clientId = cid;
      peer.uid = d.uids[s];
      peer.callsign = d.callsigns[s];
      peer.accent = d.accents[s];
    }
    mesh.count = count;
    park.count = count;

    // First sight of the room after MY join: I'm the newcomer, so I place
    // the calls to everyone already seated. Later arrivals call me.
    if (!calledExisting) {
      calledExisting = true;
      for (const [s] of mesh.peers) {
        if (!conns.has(s)) void openCaller(s);
      }
    }
  });
}

// --- Signaling -------------------------------------------------------------

interface SigDoc {
  offerFrom?: number;
  offerEpoch?: number;
  offer?: string;
  answerFrom?: number;
  answerEpoch?: number;
  answer?: string;
}

function watchSig(): void {
  unsubSig = onSnapshot(sigCol(), (snap) => {
    for (const change of snap.docChanges()) {
      const id = change.doc.id;
      const [loS, hiS] = id.split('_');
      const lo = Number(loS);
      const hi = Number(hiS);
      if (lo !== mesh.seat && hi !== mesh.seat) continue;
      const other = lo === mesh.seat ? hi : lo;
      const d = change.doc.data() as SigDoc;

      // An offer for me.
      if (d.offer && d.offerFrom === other && d.offerEpoch) {
        const existing = conns.get(other);
        if (existing && existing.epoch >= d.offerEpoch) {
          // GLARE: we both called. Lower seat stays the caller; the higher
          // seat yields and answers. Equal-epoch reruns are ignored.
          const bothCalled = existing.caller && existing.epoch !== d.offerEpoch;
          if (!(bothCalled && other < mesh.seat)) continue;
        }
        closeConn(other);
        void openCallee(other, d);
        continue;
      }

      // An answer to my offer.
      if (d.answer && d.answerFrom === other && d.answerEpoch) {
        const conn = conns.get(other);
        if (!conn || !conn.caller || conn.remoteSet || conn.epoch !== d.answerEpoch) continue;
        void applyRemote(conn, JSON.parse(d.answer) as RTCSessionDescriptionInit);
      }
    }
  });
}

async function openCaller(other: number): Promise<void> {
  const conn = createConn(other, true, myEpoch);
  conn.evt = conn.pc.createDataChannel('evt', { ordered: true });
  conn.pose = conn.pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 });
  wireChannel(conn.evt);
  wireChannel(conn.pose);
  const offer = await conn.pc.createOffer();
  await conn.pc.setLocalDescription(offer);
  await setDoc(sigRef(other), {
    offerFrom: mesh.seat,
    offerEpoch: conn.epoch,
    offer: JSON.stringify(offer),
    answerFrom: -1,
    answerEpoch: 0,
    answer: '',
  } satisfies SigDoc & Record<string, unknown>);
}

async function openCallee(other: number, sig: SigDoc): Promise<void> {
  const conn = createConn(other, false, sig.offerEpoch ?? 0);
  conn.pc.ondatachannel = (e) => {
    if (e.channel.label === 'evt') conn.evt = e.channel;
    else conn.pose = e.channel;
    wireChannel(e.channel);
  };
  await applyRemote(conn, JSON.parse(sig.offer!) as RTCSessionDescriptionInit);
  const answer = await conn.pc.createAnswer();
  await conn.pc.setLocalDescription(answer);
  await updateDoc(sigRef(other), {
    answerFrom: mesh.seat,
    answerEpoch: conn.epoch,
    answer: JSON.stringify(answer),
  });
}

function createConn(other: number, caller: boolean, epoch: number): PeerConn {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  const conn: PeerConn = {
    pc, evt: null, pose: null, epoch, caller,
    remoteSet: false, pending: [], unsubs: [],
  };
  conns.set(other, conn);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      void addDoc(candCol(other, mesh.seat), { ...e.candidate.toJSON(), epoch }).catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => {
    // 'disconnected' is deliberately ignored — headset Wi-Fi blips recover.
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      const peer = mesh.peers.get(other);
      if (peer) peer.hasPose = false;
    }
  };

  // Their trickle-ICE. Candidates arriving before setRemoteDescription are
  // buffered — skipping this silently breaks pairs (reference war story).
  conn.unsubs.push(
    onSnapshot(candCol(other, other), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const c = change.doc.data() as RTCIceCandidateInit & { epoch?: number };
        if ((c.epoch ?? 0) < conn.epoch) continue;
        if (conn.remoteSet) void conn.pc.addIceCandidate(c).catch(() => {});
        else conn.pending.push(c);
      }
    }),
  );
  return conn;
}

async function applyRemote(conn: PeerConn, desc: RTCSessionDescriptionInit): Promise<void> {
  await conn.pc.setRemoteDescription(desc);
  conn.remoteSet = true;
  for (const c of conn.pending) void conn.pc.addIceCandidate(c).catch(() => {});
  conn.pending.length = 0;
}

function wireChannel(ch: RTCDataChannel): void {
  ch.binaryType = 'arraybuffer';
  ch.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        pushInbox(JSON.parse(e.data) as EvtMessage);
      } catch {
        /* garbage frame — drop it */
      }
    } else {
      const pose = unpackPose(e.data as ArrayBuffer);
      if (pose) pushInbox(pose);
    }
  };
}

function closeConn(other: number): void {
  const conn = conns.get(other);
  if (!conn) return;
  for (const u of conn.unsubs) u();
  conn.evt?.close();
  conn.pose?.close();
  conn.pc.close();
  conns.delete(other);
}

function injectSenders(): void {
  mesh.sendEvt = (msg: EvtMessage): void => {
    const s = JSON.stringify(msg);
    for (const c of conns.values()) {
      if (c.evt?.readyState === 'open') c.evt.send(s);
    }
  };
  mesh.sendPose = (buf: ArrayBuffer): void => {
    for (const c of conns.values()) {
      if (c.pose?.readyState === 'open') c.pose.send(buf);
    }
  };
}

// --- Heartbeat + janitor ---------------------------------------------------

function startBeat(): void {
  beatTimer = setInterval(() => {
    if (!joined) return;
    void updateDoc(parkRef(), { [`beats.s${mesh.seat}`]: serverTimestamp() }).catch(() => {});
    void janitor();
  }, NET.beatSec * 1000);
}

/**
 * Any member may sweep: a seat whose heartbeat is older than staleSeatSec
 * belongs to a tab that died without cleaning up. Uses SDK server-time
 * (modest local clock skew is fine against a 2-minute threshold).
 */
async function janitor(): Promise<void> {
  const d = lastRoom;
  if (!d?.beats) return;
  const now = Timestamp.now().toMillis();
  for (let s = 0; s < NET.capacity; s++) {
    if (s === mesh.seat || !d.seats[s]) continue;
    const beat = d.beats[`s${s}`];
    if (!beat) continue;
    if (now - beat.toMillis() > NET.staleSeatSec * 1000) {
      await vacate(s, d.seats[s]).catch(() => {});
    }
  }
}
