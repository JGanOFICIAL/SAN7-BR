// script.js
// Firebase config + inicialização (mantive o seu bloco)
// ===== Firebase (Compat) — Config =====
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

// ===== Util (mantive as suas) =====
function onlyDigits(str){ return (str||'').replace(/\D/g,''); }

function traduzErroAuth(err){
  const code = err?.code || '';
  const map = {
    'auth/invalid-email':'E-mail inválido.',
    'auth/user-not-found':'Usuário não encontrado.',
    'auth/wrong-password':'Senha incorreta.',
    'auth/too-many-requests':'Muitas tentativas. Tente novamente em alguns minutos.',
    'auth/email-already-in-use':'Este e-mail já está em uso.',
    'auth/weak-password':'Senha fraca. Use 6+ caracteres.',
    'auth/network-request-failed':'Falha de rede. Verifique sua conexão.',
  };
  return map[code] || (err?.message || 'Ocorreu um erro. Tente novamente.');
}

function onAuthReady(callback){
  const unsub = auth.onAuthStateChanged((user)=>{
    callback(user);
    unsub();
  });
}

async function protegerPagina(){
  return new Promise((resolve)=>{
    auth.onAuthStateChanged((user)=>{
      if(!user){ location.href='login.html'; return; }
      resolve(true);
    });
  });
}

async function loginComEmail(email, senha){
  return auth.signInWithEmailAndPassword(email, senha);
}

async function enviarResetSenha(email){
  return auth.sendPasswordResetEmail(email);
}

async function sair(){
  return auth.signOut();
}

// cadastro etc (mantive as suas funções de exemplo)
async function registrarCidadao(perfil, senha){
  const cpfNum = onlyDigits(perfil.cpf);
  const refIdx = db.ref('cpf_to_uid/'+cpfNum);
  const uidReservado = await refIdx.transaction(current=>{
    if(current === null){ return 'PENDING'; }
    return;
  }, undefined, false).then(res=>res.committed ? res.snapshot.val() : null);

  if(uidReservado === null){
    throw {code:'cpf/duplicado', message:'CPF já cadastrado.'};
  }

  try{
    const cred = await auth.createUserWithEmailAndPassword(perfil.email, senha);
    const uid = cred.user.uid;
    const dados = {
      uid,
      nomeCompleto: perfil.nomeCompleto,
      cpf: perfil.cpf,
      nascimento: perfil.nascimento,
      telefone: perfil.telefone || '',
      endereco: perfil.endereco || {cep:'',cidade:'',rua:'',numero:''},
      cadunico: perfil.cadunico || null,
      email: perfil.email,
      criadoEm: Date.now()
    };
    await db.ref('users/'+uid).set(dados);
    await refIdx.set(uid);
    return uid;
  }catch(err){
    await db.ref('cpf_to_uid/'+cpfNum).set(null);
    throw err;
  }
}

async function obterPerfil(uid){
  const snap = await db.ref('users/'+uid).get();
  return snap.exists() ? snap.val() : null;
}

async function atualizarContatoEndereco(uid, {telefone, endereco}){
  const updates = {};
  if(typeof telefone === 'string') updates['users/'+uid+'/telefone'] = telefone;
  if(endereco && typeof endereco === 'object'){
    updates['users/'+uid+'/endereco'] = {
      cep: endereco.cep||'',
      cidade: endereco.cidade||'',
      rua: endereco.rua||'',
      numero: endereco.numero||''
    };
  }
  await db.ref().update(updates);
  const novo = await obterPerfil(uid);
  return novo;
}

/* ===========================
   Início — Sistema de chamadas (WebRTC + Firebase)
   NÓS NO DB:
   /calls/{protocol} = {
     protocol, nomeCompleto, cpf, status: aguardando|em_chamada|desligado|nao_atendido, createdAt, agentId, agentName
     sdp/offer, sdp/answer, candidates/{uid}/...
   }
   =========================== */

const ICE_CONFIG = { iceServers: [{urls:['stun:stun.l.google.com:19302']}] };

// Mapas locais
const localClients = {}; // protocolo -> clientState
const adminPeers = {}; // protocolo -> peer object for admin side
const clientPeers = {}; // protocol -> peer object for client side

// Ping probe (simple RTT): writes timestamps and compute roundtrip via db
function startPingProbe(){
  const pingRef = db.ref('pingProbe/__server__'); // use serverless timestamp loop
  setInterval(()=>{
    const t = Date.now();
    pingRef.set({ts:t});
  }, 5000);
  // Listen
  db.ref('pingProbe/__server__').on('value', snap=>{
    const val = snap.val();
    if(!val) return;
    // measure diff
    const ms = Math.max(0, Date.now() - val.ts);
    // expose to UI (client)
    if(typeof window.__onPingUpdate === 'function') window.__onPingUpdate(ms);
    if(typeof window.__onAdminPing === 'function') window.__onAdminPing(ms);
  });
  // connection state
  window.addEventListener('online', ()=>{ if(window.__onConnState) window.__onConnState('online'); if(window.__onAdminConn) window.__onAdminConn('online');});
  window.addEventListener('offline', ()=>{ if(window.__onConnState) window.__onConnState('offline'); if(window.__onAdminConn) window.__onAdminConn('offline');});
}
startPingProbe();

// Helper: notification
async function showLocalNotification(title, body){
  try{
    if("Notification" in window){
      if(Notification.permission === 'granted'){ new Notification(title, {body}); }
      else if(Notification.permission !== 'denied'){ 
        const p = await Notification.requestPermission();
        if(p === 'granted') new Notification(title, {body});
      }
    }
  }catch(e){}
}

// Create client call (called by client UI)
async function appStartClientCall({protocol, nome, cpf}){
  // prevent duplicate by cpf if active
  const existingSnap = await db.ref('calls').orderByChild('cpf').equalTo(cpf).once('value');
  const existing = existingSnap.val();
  if(existing){
    // check statuses
    for(const [k,v] of Object.entries(existing)){
      if(v.status === 'aguardando' || v.status === 'em_chamada'){
        throw new Error('Já existe uma solicitação ativa para esse CPF.');
      }
    }
  }
  // create call node
  const callRef = db.ref('calls/' + protocol);
  const now = Date.now();
  await callRef.set({
    protocol, nomeCompleto: nome, cpf, status: 'aguardando', createdAt: now,
    sdp: null, answer: null
  });
  // set onDisconnect cleanup (in case client disappears)
  callRef.onDisconnect().update({status: 'desligado', disconnectedAt: Date.now()});
  // start monitoring state locally
  monitorClientCall(protocol);
  // show notification to admins
  showLocalNotification('Nova solicitação', `Protocolo ${protocol} — ${nome}`);
  return protocol;
}

// Monitor a client call node to reflect state to UI (client side)
function monitorClientCall(protocol){
  const ref = db.ref('calls/' + protocol);
  ref.on('value', snap=>{
    const data = snap.val();
    if(!data){
      // cleared
      if(typeof window.__onClientCallUpdate === 'function') window.__onClientCallUpdate({protocol:null});
      return;
    }
    // map statuses
    let status = data.status || 'aguardando';
    if(status === 'nao_atendido' || status === 'desligado' || status === 'desconhecido') {
      // ended
      if(typeof window.__onClientCallUpdate === 'function') window.__onClientCallUpdate({protocol:null});
      // remove node
      db.ref('calls/' + protocol).remove().catch(()=>{});
      return;
    }
    // if accepted & agent assigned and sdp exchange finished, start WebRTC flow (client creates answer on offer)
    if(status === 'em_chamada' && data.sdp && !data.answer){
      // client should create peer, set remote description = offer, create answer, push answer
      if(!clientPeers[protocol]) clientCreateAnswer(protocol, data.sdp);
    }
    // notify UI
    if(typeof window.__onClientCallUpdate === 'function') window.__onClientCallUpdate({
      protocol: protocol,
      status: status==='aguardando' ? 'aguardando' : (status==='em_chamada'?'em chamada':'finalizado'),
      startedAt: data.createdAt,
      agent: data.agentName || null
    });
  });

  // Watch for timeout >10mins to mark nao_atendido
  const createdAtRef = db.ref('calls/' + protocol + '/createdAt');
  createdAtRef.once('value').then(snap=>{
    const created = snap.val() || Date.now();
    setTimeout(async ()=>{
      const node = (await db.ref('calls/' + protocol).get()).val();
      if(node && node.status === 'aguardando'){
        await db.ref('calls/' + protocol).update({status:'nao_atendido', finishedAt: Date.now()});
        showLocalNotification('Solicitação não atendida', `Protocolo ${protocol} não foi atendido em 10 minutos.`);
        // remove after short delay
        setTimeout(()=>db.ref('calls/' + protocol).remove().catch(()=>{}), 30*1000);
      }
    }, 10*60*1000 + 1000);
  }).catch(()=>{});
}

// Client cancels call
async function appClientCancel(protocol){
  await db.ref('calls/' + protocol).transaction(curr=>{
    if(!curr) return null;
    curr.status = 'desligado';
    curr.finishedAt = Date.now();
    return curr;
  });
  // cleanup
  db.ref('calls/' + protocol).remove().catch(()=>{});
  // close any peer
  if(clientPeers[protocol] && clientPeers[protocol].pc){ clientPeers[protocol].pc.close(); delete clientPeers[protocol]; }
}

// Client side: create answer when admin set sdp offer
async function clientCreateAnswer(protocol, offerSdp){
  try{
    const pc = new RTCPeerConnection(ICE_CONFIG);
    clientPeers[protocol] = {pc, remoteStream: new MediaStream()};
    // attach remote tracks
    pc.ontrack = (ev)=>{
      clientPeers[protocol].remoteStream.addTrack(ev.track);
      if(typeof window.__attachRemoteAudio === 'function'){
        window.__attachRemoteAudio(clientPeers[protocol].remoteStream);
      }else{
        // fallback: create audio element
        const a = document.createElement('audio'); a.autoplay = true; a.srcObject = clientPeers[protocol].remoteStream;
        document.body.appendChild(a);
      }
    };
    // gather candidates
    pc.onicecandidate = (event)=>{
      if(event.candidate){
        const candRef = db.ref(`calls/${protocol}/candidates/client`).push();
        candRef.set(event.candidate.toJSON());
      }
    };
    // add local audio
    const localStream = await navigator.mediaDevices.getUserMedia({audio:true});
    localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
    // set remote offer
    await pc.setRemoteDescription(new RTCSessionDescription({type:'offer', sdp:offerSdp}));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // push answer to db
    await db.ref(`calls/${protocol}/answer`).set({sdp: answer.sdp, createdAt: Date.now()});
    // listen for admin candidates
    db.ref(`calls/${protocol}/candidates/admin`).on('child_added', snap=>{
      const c = snap.val();
      try{ pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){}
    });
    // store
    clientPeers[protocol].pc = pc;
    // update state
    await db.ref('calls/' + protocol).update({status:'em_chamada', answeredAt: Date.now()});
  }catch(e){
    console.error('clientCreateAnswer error', e);
  }
}

// Admin side: fetch queue and listen
function appAdminInitUI(){
  // subscribe to calls
  db.ref('calls').on('value', snap=>{
    const calls = snap.val() || {};
    if(typeof window.__renderQueue === 'function') window.__renderQueue(calls);
    // if selected call exists, update detail UI as well
    if(typeof window.__selectedAdminProtocol !== 'undefined'){
      const sel = window.__selectedAdminProtocol;
      if(calls[sel]) {
        // nothing here; selection handled by admin UI
      }else{
        // cleared
      }
    }
  });
  // initial fetch
  appAdminFetchQueue();
}

async function appAdminFetchQueue(){
  const snap = await db.ref('calls').get();
  const calls = snap.val() || {};
  if(typeof window.__renderQueue === 'function') window.__renderQueue(calls);
  return calls;
}

async function appAdminReject(protocol){
  // mark as desligado + remove node
  await db.ref('calls/' + protocol).transaction(curr=>{
    if(!curr) return null;
    curr.status = 'desligado';
    curr.finishedAt = Date.now();
    return curr;
  });
  await db.ref('calls/' + protocol).remove().catch(()=>{});
  return true;
}

// Admin answer flow: create offer and push SDP
async function appAdminAnswer(protocol){
  try{
    // ensure node exists and status is aguardando
    const snap = await db.ref('calls/' + protocol).get();
    const node = snap.val();
    if(!node) throw new Error('Solicitação não encontrada.');
    // prevent double-answer: use transaction to claim agent
    const agentClaim = await db.ref('calls/' + protocol + '/agentId').transaction(curr=>{
      if(curr) return; // someone already claimed
      return 'AGENT-' + (Math.random()*1e6|0);
    });
    if(!agentClaim.committed) throw new Error('Outra sessão já está atendendo.');
    // Now create peer
    const pc = new RTCPeerConnection(ICE_CONFIG);
    adminPeers[protocol] = {pc, localStream: null};
    // get local audio
    const localStream = await navigator.mediaDevices.getUserMedia({audio:true});
    adminPeers[protocol].localStream = localStream;
    localStream.getTracks().forEach(t=> pc.addTrack(t, localStream));
    // remote stream
    const remoteStream = new MediaStream();
    pc.ontrack = (ev)=> {
      ev.streams && ev.streams[0] && (remoteStream.addTrack(ev.track));
      // attach to admin UI
      const el = document.getElementById('remotePreview');
      if(el){ el.srcObject = remoteStream; try{ el.play().catch(()=>{}); }catch(e){} }
    };
    // candidates from admin -> push to db
    pc.onicecandidate = (event)=>{
      if(event.candidate){
        db.ref(`calls/${protocol}/candidates/admin`).push().set(event.candidate.toJSON());
      }
    };
    // Listen for client candidates
    db.ref(`calls/${protocol}/candidates/client`).on('child_added', snap=>{
      const c = snap.val();
      try{ pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){}
    });

    // create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // store offer in db
    await db.ref('calls/' + protocol).update({
      sdp: offer.sdp,
      status: 'em_chamada',
      agentName: (auth.currentUser && auth.currentUser.displayName) ? auth.currentUser.displayName : 'Atendente',
      agentId: agentClaim.snapshot.val() || 'agent-unknown',
      answeredAt: Date.now()
    });

    // listen for answer
    db.ref(`calls/${protocol}/answer`).on('value', async snap=>{
      const ans = snap.val();
      if(ans && ans.sdp){
        try{
          await pc.setRemoteDescription(new RTCSessionDescription({type:'answer', sdp: ans.sdp}));
        }catch(e){
          console.error('setRemoteDescription error', e);
        }
      }
    });

    // store handle
    adminPeers[protocol].pc = pc;

    // attach local preview to admin UI
    const lp = document.getElementById('localPreview');
    if(lp){ lp.srcObject = localStream; try{ lp.play().catch(()=>{});}catch(e){} }

    // when connection closes, cleanup
    pc.onconnectionstatechange = ()=>{
      const state = pc.connectionState;
      if(state === 'disconnected' || state === 'failed' || state === 'closed'){
        // mark finished
        db.ref('calls/' + protocol).update({status:'desligado', finishedAt: Date.now()});
        // remove after short delay
        setTimeout(()=> db.ref('calls/' + protocol).remove().catch(()=>{}), 2000);
        // close pc
        try{ pc.close(); }catch(e){}
        delete adminPeers[protocol];
      }
    };

    // show admin UI update
    if(typeof window.__onAdminCallStarted === 'function') window.__onAdminCallStarted(protocol);

    return true;
  }catch(e){
    console.error('appAdminAnswer error', e);
    throw e;
  }
}

// Admin end call
async function appAdminEnd(protocol){
  // update node and remove
  await db.ref('calls/' + protocol).update({status:'desligado', finishedAt: Date.now()});
  await db.ref('calls/' + protocol).remove().catch(()=>{});
  // close peer
  if(adminPeers[protocol] && adminPeers[protocol].pc){ try{ adminPeers[protocol].pc.close(); }catch(e){} delete adminPeers[protocol]; }
  return true;
}

// Toggle mute (admin/client)
function appToggleMute(){
  // toggle tracks
  Object.values(adminPeers).forEach(p=>{
    if(p.localStream){
      p.localStream.getAudioTracks().forEach(t=> t.enabled = !t.enabled);
    }
  });
  Object.values(clientPeers).forEach(p=>{
    if(p.localStream){
      p.localStream.getAudioTracks().forEach(t=> t.enabled = !t.enabled);
    }
  });
}

// Admin fetch single call detail (optionally used by UI)
async function appGetCall(protocol){
  const snap = await db.ref('calls/' + protocol).get();
  return snap.val();
}

/* ==============
   Real-time listeners for admin UI queue rendering and cleanup
   ============== */
db.ref('calls').on('child_removed', snap=>{
  const protocol = snap.key;
  // cleanup local peers if any
  if(adminPeers[protocol] && adminPeers[protocol].pc){ try{ adminPeers[protocol].pc.close(); }catch(e){} delete adminPeers[protocol]; }
  if(clientPeers[protocol] && clientPeers[protocol].pc){ try{ clientPeers[protocol].pc.close(); }catch(e){} delete clientPeers[protocol]; }
  // notify UIs to clear selection if necessary
  if(typeof window.__onCallRemoved === 'function') window.__onCallRemoved(protocol);
});

// When calls change, push to admin UI renderer
db.ref('calls').on('value', snap=>{
  const calls = snap.val() || {};
  if(typeof window.__renderQueue === 'function') window.__renderQueue(calls);
});

/* =============
   Expose functions to global (used by the HTML pages)
   ============= */
window.appStartClientCall = appStartClientCall;
window.appClientCancel = appClientCancel;
window.appAdminInitUI = appAdminInitUI;
window.appAdminFetchQueue = appAdminFetchQueue;
window.appAdminReject = appAdminReject;
window.appAdminAnswer = appAdminAnswer;
window.appAdminEnd = appAdminEnd;
window.appGetCall = appGetCall;
window.appToggleMute = appToggleMute;

// Optional hooks UIs can implement:
// window.__onClientCallUpdate(obj) -> client UI updates
// window.__attachRemoteAudio(stream) -> attach remote audio
// window.__renderQueue(calls) -> admin renders queue
// window.__onPingUpdate(ms) -> ping
// window.__onAdminPing(ms) -> admin ping
// window.__onAdminConn(s) -> connection status

// ----------------- END script.js -----------------
