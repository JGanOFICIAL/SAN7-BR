/* script.js — compatável com firebase (compat libs).
   Contém:
   - firebase init (usa config que você incluiu)
   - funções de chamadas (createCall, onIncomingCalls, acceptCall, rejectCall, cancelCall, endCall)
   - signaling via Realtime DB
   - WebRTC (áudio) com echoCancellation/noiseSuppression
   - helpers: protocolo, modal personalizado, notifications placeholder, ping/connection
*/

/* ====== FIREBASE CONFIG (use your config) ======
   You already provided firebaseConfig in the user message: reuse it here.
*/
const firebaseConfig = {
  apiKey: "AIzaSyBPiznHCVkTAgx6m02bZB8b0FFaot9UkBU",
  authDomain: "prefeitura-de-joao-camara.firebaseapp.com",
  projectId: "prefeitura-de-joao-camara",
  storageBucket: "prefeitura-de-joao-camara.firebasestorage.app",
  messagingSenderId: "269299041577",
  appId: "1:269299041577:web:fd41b2939240e9eb476338",
  measurementId: "G-YT7NHR342J"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

/* ======= GLOBAL STATE ======= */
window._CA = window._CA || {};
window._CA.iceServers = [{urls: 'stun:stun.l.google.com:19302'}]; // add TURN in production
window._CA.activePeerConnections = {}; // callId -> RTCPeerConnection
window._CA.localStreams = {}; // callId -> MediaStream
window._CA.callListeners = {}; // callbacks

/* ======= UTIL ======= */
function makeProtocol12(){
  // 12 digits numeric (not sequential)
  let s = '';
  for(let i=0;i<12;i++) s += Math.floor(Math.random()*10);
  return s;
}
function now(){ return Date.now(); }
function onlyDigits(str){ return (str||'').replace(/\D/g,''); }

/* ===== MODAL & notification helpers (modernized) ===== */
window.showModal = function(title, msg){
  // if a global modal exists in DOM (admin/client), use it; else fallback to alert
  const modal = document.getElementById('modal') || document.getElementById('how-modal');
  if(modal){
    const titleEl = modal.querySelector('#modal-title') || modal.querySelector('h2');
    const msgEl = modal.querySelector('#modal-msg') || modal.querySelector('p');
    if(titleEl) titleEl.textContent = title;
    if(msgEl) msgEl.textContent = msg;
    modal.classList.remove('hidden');
    return;
  }
  alert(title + '\n\n' + msg);
};

window.showLocalNotification = async function(title, body){
  if("Notification" in window){
    if(Notification.permission === "granted"){
      new Notification(title, {body});
    }else if(Notification.permission !== "denied"){
      try{
        let perm = await Notification.requestPermission();
        if(perm === 'granted') new Notification(title, {body});
      }catch(e){console.warn('Notification request failed', e);}
    }
  }
};

/* Placeholder to integrate Firebase Cloud Messaging (FCM) push later.
   To fully deliver push across devices use FCM + service worker registration.
*/
window.deliverPushPlaceholder = function(title, body){
  console.log('PUSH placeholder:', title, body);
  // integrate firebase.messaging() and service worker in production
};

/* ===== CONNECTION MONITOR ===== */
(function monitorConnection(){
  const connRef = db.ref('.info/connected');
  connRef.on('value', snap=>{
    const connected = !!snap.val();
    if(window.onConnectionStateChanged) window.onConnectionStateChanged(connected);
  });
})();

/* ====== CALL LIFECYCLE (Realtime DB structure) =====
  /calls/{callId} = {
    protocol, nomeCompleto, cpf, status: waiting|in-call|ended|recused|nao_atendido,
    createdAt, agentId?, agentName?
  }
  /signals/{callId}/{offer/answer/ice}/{...}
  /heartbeats/{callId}/{who} = timestamp
*/

/* --- NEW: createCall (client) --- */
window.createCall = async function({nomeCompleto, cpf, meta}){
  const protocol = makeProtocol12();
  // callId can be protocol for simplicity, or push key
  const callId = 'call_' + protocol;
  const path = 'calls/' + callId;

  const payload = {
    protocol,
    nomeCompleto,
    cpf,
    meta: meta || {},
    status: 'waiting',
    createdAt: now()
  };

  await db.ref(path).set(payload);

  // set timeout for 10 minutes -> nao_atendido if not accepted
  setTimeout(async ()=>{
    const snap = await db.ref(path).get();
    if(!snap.exists()) return; // removed
    const data = snap.val();
    if(data.status === 'waiting'){
      await db.ref(path).update({status:'nao_atendido', reason:'nao_atendido', endedAt: now()});
      // auto remove after small delay to free DB (user asked no history)
      setTimeout(()=> db.ref(path).remove().catch(()=>{}), 5*1000);
    }
  }, 10*60*1000); // 10 minutes

  // start tiny heartbeat for connectivity
  const hbRef = db.ref(`heartbeats/${callId}/client`);
  function hb(){ hbRef.set(now()).catch(()=>{}); }
  const hbInterval = setInterval(hb, 10*1000);
  hb();

  // expose helper to cancel from client
  window._CA.lastCallRef = path;
  window._CA.lastCall = {callId, protocol};

  return {ref: path, callId, protocol};
};

/* --- NEW: onCallUpdate (client listens to its own call changes) --- */
window.onCallUpdate = function(callPath, cb){
  // callPath like 'calls/call_123...'
  const ref = db.ref(callPath);
  const handler = ref.on('value', snap=>{
    const val = snap.exists() ? snap.val() : null;
    cb(val);
  });
  // return unsubscribe
  return ()=> ref.off('value', handler);
};

/* --- NEW: cancelCall (client) --- */
window.cancelCall = async function(callPath, {reason} = {}){
  try{
    const update = {status: 'ended', reason: reason || 'cancelado_pelo_usuario', endedAt: now()};
    await db.ref(callPath).update(update);
    // remove after small delay
    setTimeout(()=> db.ref(callPath).remove().catch(()=>{}), 3000);
  }catch(e){ console.error('cancelCall error', e); throw e; }
};

/* --- NEW: rejectCall (admin) --- */
window.rejectCall = async function(callId, {reason} = {}){
  const path = 'calls/' + callId;
  await db.ref(path).transaction(current=>{
    if(!current) return;
    if(current.status === 'waiting') current.status = 'recused';
    current.reason = reason || 'recusado_pelo_suporte';
    current.endedAt = now();
    return current;
  });
  // remove quickly
  setTimeout(()=> db.ref(path).remove().catch(()=>{}), 3000);
};

/* --- NEW: endCall (either side) --- */
window.endCall = async function(callIdOrPath, {reason} = {}){
  const path = callIdOrPath.startsWith('calls/') ? callIdOrPath : 'calls/'+callIdOrPath;
  try{
    await db.ref(path).update({status:'ended', reason:reason||'desligado', endedAt: now()});
    // close peer connections if exist
    const callKey = path.split('/').pop();
    if(window._CA.activePeerConnections[callKey]){
      try{ window._CA.activePeerConnections[callKey].close(); }catch(e){}
      delete window._CA.activePeerConnections[callKey];
    }
    if(window._CA.localStreams[callKey]){
      window._CA.localStreams[callKey].getTracks().forEach(t=>t.stop());
      delete window._CA.localStreams[callKey];
    }
    // remove node shortly after
    setTimeout(()=> db.ref(path).remove().catch(()=>{}), 3000);
  }catch(e){ console.error('endCall', e); throw e; }
};

/* --- NEW: onIncomingCalls (admin subscribes to calls list) --- */
window.onIncomingCalls = function(cb){
  const ref = db.ref('calls');
  ref.on('value', snap=>{
    const val = snap.exists() ? snap.val() : {};
    // filter only waiting + in-call (active)
    const filtered = {};
    for(const k in val){
      const v = val[k];
      if(v && (v.status === 'waiting' || v.status === 'in-call')) filtered[k] = v;
    }
    cb(filtered);
  });
};

/* ====== WEBRTC SIGNALING helpers (using Realtime DB) ====== */
async function writeSignal(callId, type, payload){
  const ref = db.ref(`signals/${callId}/${type}`);
  await ref.push({payload, ts: now()});
}
function onSignal(callId, type, cb){
  const ref = db.ref(`signals/${callId}/${type}`);
  const handler = ref.on('child_added', snap=> cb(snap.key, snap.val()));
  return ()=> ref.off('child_added', handler);
}

/* --- NEW: acceptCall (admin) -> creates RTCPeerConnection, initiates offer flow --- */
window.acceptCall = async function(callId, {agentName} = {}){
  const callPath = 'calls/' + callId;
  // mark in DB as in-call
  await db.ref(callPath).transaction(current=>{
    if(!current) return;
    if(current.status !== 'waiting') return current; // someone else already took
    current.status = 'in-call';
    current.agentName = agentName || 'Suporte';
    current.agentId = 'agent_' + Math.floor(Math.random()*100000);
    current.acceptedAt = now();
    return current;
  });

  // create PeerConnection
  const pc = new RTCPeerConnection({iceServers: window._CA.iceServers});
  window._CA.activePeerConnections[callId] = pc;

  // get local microphone
  const localStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  window._CA.localStreams[callId] = localStream;
  // attach tracks to pc
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // remote audio element
  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.controls = false;
  remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);

  // when remote track arrives
  pc.addEventListener('track', (ev)=>{
    const [stream] = ev.streams;
    remoteAudio.srcObject = stream;
  });

  // ICE candidates -> write to DB
  pc.addEventListener('icecandidate', (ev)=>{
    if(ev.candidate) {
      writeSignal(callId, 'ice_admin', ev.candidate.toJSON()).catch(()=>{});
    }
  });

  // listen for client's ice + offer/answer
  const offIceClient = onSignal(callId, 'ice_client', async (k, d) => {
    try{
      await pc.addIceCandidate(d.payload).catch(()=>{});
    }catch(e){ console.warn('addIceCandidate admin', e); }
  });

  const offOffer = onSignal(callId, 'offer', async (k, d)=>{
    // client's offer arrives, setRemoteDescription and createAnswer
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(d.payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // send answer back
      await writeSignal(callId, 'answer', answer.toJSON());
    }catch(e){ console.error('handle offer', e); }
  });

  // also listen for 'end' signals via DB (call status changes) — handled elsewhere

  // expose toggle mute for admin
  window.toggleAdminMute = function(){
    const s = window._CA.localStreams[callId];
    if(!s) return;
    s.getAudioTracks().forEach(t => t.enabled = !t.enabled);
  };

  return pc;
};

/* --- NEW: client side listens to offer by admin? Flow: client creates offer OR admin accepts and waits for client offer?
   We'll design client to createOffer after admin flags 'in-call'.
   Client listening code below will detect status change to 'in-call' and create offer sending to 'offer'.
 */

/* client auto-handling when status becomes 'in-call' */
(function clientCallSignalHandler(){
  // Observe any calls that belong to this client (we saved lastCallRef when creating)
  // Instead we observe 'calls' and react when our created call changes to in-call.
  const ref = db.ref('calls');
  ref.on('child_changed', async snap=>{
    const callId = snap.key;
    const data = snap.val();
    // find if this client is the owner by checking window._CA.lastCall
    if(window._CA.lastCall && ('call_' + window._CA.lastCall.protocol) === callId){
      if(data.status === 'in-call'){
        // start WebRTC as client: create PeerConnection, createOffer and wait answer from admin
        try{
          await clientStartWebRTC(callId);
        }catch(e){ console.error('clientStartWebRTC error', e); }
      }
      if(data.status === 'ended' || data.status === 'recused' || data.status === 'nao_atendido'){
        // cleanup local media/pc
        const callKey = callId;
        if(window._CA.activePeerConnections[callKey]){
          try{ window._CA.activePeerConnections[callKey].close(); }catch(e){}
          delete window._CA.activePeerConnections[callKey];
        }
        if(window._CA.localStreams[callKey]){
          window._CA.localStreams[callKey].getTracks().forEach(t=>t.stop());
          delete window._CA.localStreams[callKey];
        }
      }
    }
  });
})();

/* --- NEW: clientStartWebRTC (client creates offer) --- */
async function clientStartWebRTC(callId){
  const pc = new RTCPeerConnection({iceServers: window._CA.iceServers});
  window._CA.activePeerConnections[callId] = pc;

  const localStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  window._CA.localStreams[callId] = localStream;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.controls = false;
  remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);

  pc.addEventListener('track', (ev)=>{
    const [stream] = ev.streams;
    remoteAudio.srcObject = stream;
  });

  pc.addEventListener('icecandidate', (ev)=>{
    if(ev.candidate) writeSignal(callId, 'ice_client', ev.candidate.toJSON()).catch(()=>{});
  });

  // listen for admin's answer
  const offAnswer = onSignal(callId, 'answer', async (k, d)=>{
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(d.payload));
    }catch(e){ console.error('setRemoteDescription answer', e); }
  });

  // listen for admin ICE
  const offIceAdmin = onSignal(callId, 'ice_admin', async (k,d)=>{
    try{ await pc.addIceCandidate(d.payload).catch(()=>{}); }catch(e){ console.warn('addIceCandidate client', e); }
  });

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await writeSignal(callId, 'offer', offer.toJSON());

  // expose client mute toggle
  window.setLocalMute = function(mute){
    const s = window._CA.localStreams[callId];
    if(!s) return;
    s.getAudioTracks().forEach(t => t.enabled = !mute);
  };

  return pc;
}

/* --- NEW: onIncomingNotification (generic) --- */
db.ref('calls').on('child_added', snap=>{
  const data = snap.val();
  if(!data) return;
  // Show notification to admins (if permission)
  window.showLocalNotification('Nova solicitação', `${data.nomeCompleto} — ${data.protocol}`);
  // optional push placeholder
  window.deliverPushPlaceholder('Nova solicitação', `${data.nomeCompleto} — ${data.protocol}`);
});

/* --- NEW: Ping / connectivity quality check (simple) --- */
(function startPing(){
  // use Firebase's .info/connected + heartbeat timestamps
  // periodically compute last heartbeat for active calls
  setInterval(async ()=>{
    // optional: compute general latency by writing small value and reading it
    // but for simplicity we use navigator.onLine + .info/connected
    const conn = await db.ref('.info/connected').get();
    const ok = !!conn.val();
    if(window.onConnectionStateChanged) window.onConnectionStateChanged(ok);
  }, 5000);
})();

/* ====== CLEANUP on unload ====== */
window.addEventListener('beforeunload', ()=> {
  // Close any pc and stop local streams
  for(const k in window._CA.activePeerConnections){ try{ window._CA.activePeerConnections[k].close(); }catch(e){} }
  for(const k in window._CA.localStreams){ try{ window._CA.localStreams[k].getTracks().forEach(t=>t.stop()); }catch(e){} }
});

/* ========== END of script.js ========== */

/* Notes & next steps:
   - To enable push (FCM): include firebase-messaging and register a service worker.
   - To avoid NAT issues: add TURN server credentials to window._CA.iceServers.
   - For production, secure DB rules to prevent abuse (only authenticated users can write calls).
   - Consider limiting one active call per CPF: you can enforce by checking index / activeCallsByCPF before createCall.
*/
