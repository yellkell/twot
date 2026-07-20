/**
 * ICE servers for the park's WebRTC mesh.
 *
 * STUN-only at launch: fine for the majority of home NATs. Pairs stuck
 * behind symmetric NATs will fail to connect (they'll see the park roster
 * but no live avatars) — the fix is a TURN relay. When we're ready, make
 * an account with a TURN provider (Metered / Cloudflare / Twilio) and add
 * the relay entries here. Do NOT copy the reference project's Metered
 * credentials — that's someone else's bill.
 */

export function iceServers(): RTCIceServer[] {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
}
