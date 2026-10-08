// Purplehat Shared Protocol (client-side)
// Simple message protocol over WebSocket
const MSG = {
  // controller -> screen
  JOIN: 'join',
  ADD_SONG: 'add_song',
  REMOVE_SONG: 'remove_song',
  PLAY_PAUSE: 'play_pause',
  NEXT: 'next',
  REPLAY: 'replay',
  SEEK: 'seek',
  VOLUME: 'volume',
  REQUEST_STATE: 'request_state',
  SHUFFLE: 'shuffle',
  LOOP: 'loop',
  LOOP_QUEUE: 'loop_queue',
  MOVE_SONG: 'move_song',
  // screen -> controller
  STATE_SYNC: 'state_sync',
  QUEUE_UPDATE: 'queue_update',
  NOW_PLAYING: 'now_playing',
  ERROR: 'error',
  CONTROLLER_JOINED: 'controller_joined',
  CONTROLLER_LEFT: 'controller_left'
};

function createMsg(type, payload = {}) {
  return { type, payload, ts: Date.now() };
}

if (typeof window !== 'undefined') {
  window.PH = window.PH || {};
  window.PH.MSG = MSG;
  window.PH.createMsg = createMsg;
}
