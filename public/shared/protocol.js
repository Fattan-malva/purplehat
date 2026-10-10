// Purplehat Shared Protocol (client-side)
// Simple message protocol over WebSocket
const MSG = {
  // controller -> screen
  JOIN: 'join',
  ADD_SONG: 'add_song',
  REMOVE_SONG: 'remove_song',
  PLAY_PAUSE: 'play_pause',
  NEXT: 'next',
  // Stop: hentikan lagu yang sedang diputar dan kembalikan layar ke menu idle.
  STOP: 'stop',
  REPLAY: 'replay',
  SEEK: 'seek',
  VOLUME: 'volume',
  REQUEST_STATE: 'request_state',
  SHUFFLE: 'shuffle',
  LOOP: 'loop',
  LOOP_QUEUE: 'loop_queue',
  MOVE_SONG: 'move_song',
  // Spotify: kirim/perbarui sp_dc (cookie login) milik room.
  SET_SPDC: 'set_sp_dc',
  // Spotify: buka/tutup tampilan lirik di frame player (dipakai tombol FX).
  LYRICS: 'lyrics',
  // screen -> controller
  STATE_SYNC: 'state_sync',
  QUEUE_UPDATE: 'queue_update',
  NOW_PLAYING: 'now_playing',
  ERROR: 'error',
  CONTROLLER_JOINED: 'controller_joined',
  CONTROLLER_LEFT: 'controller_left',
  // Logout sengaja dari controller. Layar TIDAK me-reset: room tetap hidup
  // agar controller bisa menyambung lagi dengan kode yang sama.
  CONTROLLER_LOGOUT: 'controller_logout',
  // Room dihapus di server -> controller kembali ke layar pairing.
  ROOM_CLOSED: 'room_closed',
  // Server -> screen: sp_dc tersimpan (kirim saat connect / setelah diubah).
  SPDC: 'sp_dc',
  // Screen -> controller: sp_dc hilang/kedaluwarsa -> controller buka modal input.
  SPDC_INVALID: 'sp_dc_invalid',
  // Screen -> controller: lagu Spotify aktif punya lirik tersinkron (true)
  // atau tidak (false). null = belum diketahui.
  LYRICS_AVAIL: 'lyrics_available'
};

function createMsg(type, payload = {}) {
  return { type, payload, ts: Date.now() };
}

if (typeof window !== 'undefined') {
  window.PH = window.PH || {};
  window.PH.MSG = MSG;
  window.PH.createMsg = createMsg;
}
