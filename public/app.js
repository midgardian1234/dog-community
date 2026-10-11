// dog community — browser voice chat.
// Audio is peer-to-peer WebRTC (mesh). Supabase Realtime is the meeting point:
//   presence  = who is in the room (+ the host's moderation list)
//   broadcast = WebRTC signaling (offers / answers / ICE)
// Host = whoever has been in the room longest. Only the host's moderation list counts.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const ROOM = 'dog-community';
const MAX_USERS = 36;
const KICK_BAN_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const panel = $('panel'), joinBox = $('join'), bar = $('bar'), menu = $('menu'), muteBtn = $('muteBtn');

const cfg = window.DOG_CONFIG || {};
let sb = cfg.url && cfg.anonKey ? supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } }) : null;

let channel, myId, myName, joinedAt, hostId, localStream, audioCtx;
let selfMuted = false;
let mod = { forceMuted: [], kicked: [] }; // the host's moderation list
const peers = new Map(); // id -> { info, tile, audio, pc, pending, analyser, volume }

$('name').value = load('dc-name') || '';
$('name').addEventListener('keydown', (e) => e.key === 'Enter' && join());
$('joinBtn').onclick = join;
$('leaveBtn').onclick = () => leave('');
muteBtn.onclick = () => setSelfMuted(!selfMuted);
window.addEventListener('beforeunload', () => channel && sb.removeChannel(channel));

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch {} }

async function join() {
  if (!sb) { $('msg').textContent = 'site is not configured yet (config.js).'; return; }
  const bannedUntil = Number(load('dc-kicked-until') || 0);
  if (bannedUntil > Date.now()) { $('msg').textContent = 'you were kicked. try again in a few minutes.'; return; }

  myName = $('name').value.trim().slice(0, 24) || 'dog';
  save('dc-name', myName);
  $('msg').textContent = 'asking for microphone…';
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    $('msg').textContent = 'microphone permission is needed to join.';
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  $('msg').textContent = 'connecting…';

  myId = crypto.randomUUID();
  joinedAt = Date.now();
  selfMuted = false;
  channel = sb.channel(ROOM, { config: { presence: { key: myId }, broadcast: { self: false } } });
  channel.on('presence', { event: 'sync' }, onSync);
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => payload.to === myId && onSignal(payload.from, payload.data));
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') publish();
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') leave('could not connect. try again.');
  });
}

// my presence entry; the host also carries the moderation list
function publish() {
  channel && channel.track({ name: myName, muted: selfMuted, joinedAt, mod: myId === hostId ? mod : null });
}

function signal(to, data) {
  channel && channel.send({ type: 'broadcast', event: 'signal', payload: { from: myId, to, data } });
}

// ---------- room state ----------
function onSync() {
  const members = Object.entries(channel.presenceState())
    .map(([id, metas]) => ({ id, ...metas[0] }))
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  if (!members.some((m) => m.id === myId)) return; // my own entry hasn't landed yet

  const host = members[0];
  const wasHost = hostId === myId;
  hostId = host.id;
  if (hostId === myId) {
    if (!wasHost) publish(); // just became host: keep the previous host's list and announce it
  } else if (host.mod) {
    mod = host.mod;
  }

  if (mod.kicked.includes(myId)) {
    save('dc-kicked-until', String(Date.now() + KICK_BAN_MS));
    return leave('you were kicked from the room.');
  }
  const inRoom = members.filter((m) => !mod.kicked.includes(m.id));
  if (inRoom.findIndex((m) => m.id === myId) >= MAX_USERS) return leave('room is full.');

  if (!peers.has(myId)) { // first sync: show the room
    joinBox.style.display = 'none'; bar.classList.add('on'); $('msg').textContent = '';
  }

  const ids = new Set(inRoom.map((m) => m.id));
  for (const id of [...peers.keys()]) if (!ids.has(id)) removePeer(id);

  const forced = mod.forceMuted.includes(myId);
  localStream.getAudioTracks().forEach((t) => (t.enabled = !selfMuted && !forced));

  for (const m of inRoom) {
    const forceMuted = mod.forceMuted.includes(m.id);
    const info = { id: m.id, name: m.name, muted: !!m.muted || forceMuted, forceMuted };
    const p = peers.get(m.id) || addPeer(info, m.id === myId ? localStream : null);
    p.info = info;
    if (m.id !== myId && !p.pc && myId < m.id) connect(m.id, true); // lower id makes the offer
  }
  refreshAll();
}

// ---------- WebRTC mesh ----------
function connect(id, initiator) {
  const p = peers.get(id) || addPeer({ id, name: 'dog', muted: false, forceMuted: false });
  if (p.pc) return p.pc;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  p.pc = pc;
  p.pending = [];
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => e.candidate && signal(id, { candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => {
    p.audio.srcObject = e.streams[0];
    p.audio.play().catch(() => {});
    watchLevel(p, e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    // let the initiator retry if the link drops
    if (pc.connectionState === 'failed' && myId < id) { pc.close(); p.pc = null; connect(id, true); }
  };
  if (initiator) {
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => signal(id, { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }));
  }
  return pc;
}

async function onSignal(from, data) {
  if (!localStream || mod.kicked.includes(from)) return;
  const pc = connect(from, false);
  const p = peers.get(from);
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      signal(from, { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    }
    for (const c of p.pending.splice(0)) pc.addIceCandidate(c).catch(() => {});
  } else if (data.candidate) {
    if (!pc.remoteDescription) p.pending.push(data.candidate);
    else pc.addIceCandidate(data.candidate).catch(() => {});
  }
}

// ---------- tiles ----------
function addPeer(info, stream) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (info.id === myId ? ' me' : '');
  tile.innerHTML = '<span class="crown">👑</span><img src="dog.png" alt=""><span class="badge">' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V4a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2m14 0v2c0 .8-.1 1.5-.4 2.2M12 19v3"/></svg></span>';
  tile.onclick = (e) => { e.stopPropagation(); openMenu(info.id, tile); };
  const audio = new Audio();
  audio.autoplay = true;
  const p = { info, tile, audio, pc: null, pending: [], volume: 1 };
  peers.set(info.id, p);
  panel.appendChild(tile);
  if (stream) watchLevel(p, stream);
  return p;
}

function removePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  p.pc && p.pc.close();
  p.audio.srcObject = null;
  p.tile.remove();
  peers.delete(id);
  if (menu.dataset.id === id) closeMenu();
}

function refresh(p) {
  p.tile.title = p.info.name + (p.info.id === myId ? ' (you)' : '');
  p.tile.classList.toggle('muted', p.info.muted);
  p.tile.classList.toggle('host', p.info.id === hostId);
  // mutes are applied on the listening side too, so a muted person can't sneak audio through
  if (p.info.id !== myId) p.audio.muted = p.info.muted;
  if (p.info.id === myId) {
    muteBtn.textContent = p.info.forceMuted ? 'muted by host' : p.info.muted ? 'unmute' : 'mute';
    muteBtn.classList.toggle('is-muted', p.info.muted);
    muteBtn.disabled = p.info.forceMuted;
  }
}
function refreshAll() { peers.forEach(refresh); }

function setSelfMuted(muted) {
  const me = peers.get(myId);
  if (!me || me.info.forceMuted) return;
  selfMuted = muted;
  me.info.muted = muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  refresh(me);
  publish();
}

// ---------- host moderation ----------
function hostMute(id, muted) {
  if (myId !== hostId) return;
  mod = { ...mod, forceMuted: muted ? [...new Set([...mod.forceMuted, id])] : mod.forceMuted.filter((x) => x !== id) };
  publish();
}
function hostKick(id) {
  if (myId !== hostId) return;
  mod = { forceMuted: mod.forceMuted.filter((x) => x !== id), kicked: [...mod.kicked, id].slice(-100) };
  removePeer(id);
  publish();
}

// ---------- speaking ring ----------
function watchLevel(p, stream) {
  try {
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    p.analyser = an;
    p.buf = new Uint8Array(an.fftSize);
  } catch {}
}
(function loop() {
  peers.forEach((p) => {
    if (!p.analyser) return;
    p.analyser.getByteTimeDomainData(p.buf);
    let sum = 0;
    for (const v of p.buf) sum += (v - 128) * (v - 128);
    p.tile.classList.toggle('speaking', !p.info.muted && Math.sqrt(sum / p.buf.length) > 6);
  });
  requestAnimationFrame(loop);
})();

// ---------- click menu: mute / kick / volume ----------
function openMenu(id, tile) {
  const p = peers.get(id);
  const isMe = id === myId, amHost = myId === hostId;
  let html = '<div class="who"></div>';
  if (isMe) {
    html += `<button data-a="self">${p.info.muted ? 'unmute myself' : 'mute myself'}</button>`;
  } else {
    html += `<div class="label">volume</div><input type="range" min="0" max="1" step="0.05" value="${p.volume}" data-a="vol">`;
    if (amHost) {
      html += `<button data-a="mute">${p.info.forceMuted ? 'unmute' : 'mute'} for everyone</button>`;
      html += '<button data-a="kick" class="danger">kick</button>';
    }
  }
  menu.innerHTML = html;
  menu.querySelector('.who').textContent = p.info.name + (isMe ? ' (you)' : '') + (id === hostId ? ' 👑' : '');
  menu.dataset.id = id;
  menu.classList.add('on');
  const r = tile.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  const top = r.bottom + 8 + menu.offsetHeight > window.innerHeight ? r.top - menu.offsetHeight - 8 : r.bottom + 8;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
}
function closeMenu() { menu.classList.remove('on'); delete menu.dataset.id; }
menu.addEventListener('click', (e) => {
  e.stopPropagation();
  const a = e.target.dataset.a, id = menu.dataset.id, p = peers.get(id);
  if (!a || !p) return;
  if (a === 'self') setSelfMuted(!selfMuted);
  if (a === 'mute') hostMute(id, !p.info.forceMuted);
  if (a === 'kick') hostKick(id);
  if (a !== 'vol') closeMenu();
});
menu.addEventListener('input', (e) => {
  const p = peers.get(menu.dataset.id);
  if (p && e.target.dataset.a === 'vol') { p.volume = Number(e.target.value); p.audio.volume = p.volume; }
});
document.addEventListener('click', closeMenu);

// ---------- leave ----------
function leave(reason) {
  if (channel) { sb.removeChannel(channel); channel = null; }
  [...peers.keys()].forEach(removePeer);
  myId = null; hostId = null;
  mod = { forceMuted: [], kicked: [] };
  localStream && localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
  audioCtx && audioCtx.close(); audioCtx = null;
  closeMenu();
  bar.classList.remove('on');
  joinBox.style.display = '';
  $('msg').textContent = reason;
}

// ---------- corner buttons: X link + meme gallery ----------
if (cfg.xUrl) $('xLink').href = cfg.xUrl;
const gallery = $('gallery');
$('hookBtn').onclick = (e) => {
  e.stopPropagation();
  if (gallery.classList.contains('on')) return gallery.classList.remove('on');
  const memes = cfg.memes || [];
  $('memeCount').textContent = memes.length + (memes.length === 1 ? ' meme' : ' memes');
  $('memeGrid').innerHTML = '';
  for (const src of memes) {
    const a = document.createElement('a');
    a.href = src; a.target = '_blank'; a.rel = 'noopener';
    const img = document.createElement('img');
    img.src = src; img.alt = 'meme'; img.loading = 'lazy';
    a.appendChild(img);
    $('memeGrid').appendChild(a);
  }
  gallery.classList.add('on');
};
gallery.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => gallery.classList.remove('on'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && gallery.classList.remove('on'));
