// script.js — atualizado com WebRTC + Firebase signaling
// Preserva funções existentes (do seu bundle original) e adiciona as integrações de WebRTC.
// Substitua o conteúdo do seu script.js por este se desejar a integração completa.


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

// ===== Util =====
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

// ===== Auth helpers (mantidos) =====
async function loginComEmail(email, senha){
  return auth.signInWithEmailAndPassword(email, senha);
}
async function enviarResetSenha(email){
  return auth.sendPasswordResetEmail(email);
}
async function sair(){
  return auth.signOut();
}

// ===== Cadastro / perfil (mantidos) =====
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

// ===== WebRTC + Signaling (centralizado) =====
// Paths used:
// /calls/{protocol} -> { protocol, nome, cpf, status, createdAt, offer, answer, candidates }
// /calls/{protocol}/candidates/{branch} -> pushed ICEs
// /active_by_cpf/{cpf} -> {protocol, createdAt} - prevents duplicate calls per CPF
// Status values: waiting, accepted, rejected, ended, cancelled, not_answered

const WebRTCService = (function(){
  // utility
  function formatProto(n){ return String(n).padStart(12,'0'); }
  function genProtocol(){
    return formatProto(Math.floor(Math.random()*1e12));
  }

  // create offer from caller
  async function createOfferAndPublish(proto, localStream){
    const peerId = 'caller-'+Date.now();
    const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));

    const candidateBranchRef = db.ref(`calls/${proto}/candidates/${peerId}`);
    pc.onicecandidate = (ev)=>{
      if(ev.candidate) candidateBranchRef.push(JSON.stringify(ev.candidate));
    };

    pc.onconnectionstatechange = ()=>{/* optional state handling */}

    // remote audio handling must be done by caller UI
    pc.ontrack = (ev)=>{/* handled by UI attaching remote streams */}

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref('calls/'+proto+'/offer').set({sdp:offer.sdp, type:offer.type, createdAt:Date.now(), callerPeerId:peerId});
    // listen for answer and remote candidates externally (UI)
    return {pc, peerId};
  }

  // create answer on support side
  async function createAnswerFromOffer(proto, localStream){
    const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));

    const supportBranch = 'support-'+Date.now();
    const candidateBranchRef = db.ref(`calls/${proto}/candidates/${supportBranch}`);
    pc.onicecandidate = (ev)=>{
      if(ev.candidate) candidateBranchRef.push(JSON.stringify(ev.candidate));
    };

    const offerSnap = await db.ref('calls/'+proto+'/offer').get();
    if(!offerSnap.exists()) throw new Error('Offer não encontrada');
    const offer = offerSnap.val();
    await pc.setRemoteDescription(new RTCSessionDescription({type:offer.type, sdp:offer.sdp}));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await db.ref('calls/'+proto+'/answer').set({sdp:answer.sdp, type:answer.type, createdAt:Date.now(), supportPeerId: supportBranch});
    return {pc, supportBranch};
  }

  // Help: attach listeners to exchange ICE candidates for both branches
  function attachCandidatesListener(proto, onRemoteCandidate){
    const ref = db.ref(`calls/${proto}/candidates`);
    const handler = ref.on('child_added', snap=>{
      const branch = snap.key;
      const val = snap.val();
      // val could be either single pushed string or object with keys
      if(typeof val === 'string'){
        try{
          const cand = JSON.parse(val);
          onRemoteCandidate(cand, branch);
        }catch(e){}
      }else if(typeof val === 'object'){
        Object.values(val).forEach(v=>{
          try{
            const cand = JSON.parse(v);
            onRemoteCandidate(cand, branch);
          }catch(e){}
        });
      }
    });
    return () => ref.off('child_added', handler);
  }

  return {
    genProtocol,
    createOfferAndPublish,
    createAnswerFromOffer,
    attachCandidatesListener
  };
})();

// Export some utilities to window for easier debugging/integration
window.WebRTCService = WebRTCService;
window.db = db;
window.auth = auth;

// ===== Additional helpers for the app (push placeholders, ping, connectivity) =====
async function markActiveByCpf(cpf, protocol){
  if(!cpf) return;
  await db.ref('active_by_cpf/'+onlyDigits(cpf)).set({protocol, createdAt:Date.now()});
}
async function unmarkActiveByCpf(cpf){
  if(!cpf) return;
  await db.ref('active_by_cpf/'+onlyDigits(cpf)).remove();
}

// Simple ping test utilities (write timestamp and read back)
async function pingTest(){
  const t0 = Date.now();
  await db.ref('/ping_test/t').set({t:t0});
  const snap = await db.ref('/ping_test/t').get();
  if(!snap.exists()) return null;
  const t1 = Date.now();
  return Math.abs(t1 - t0);
}

// ===== Exposed high-level call flow helpers (for integration by UI scripts) =====
/**
 * startUserCall(profile, localStream, callbacks)
 * - profile: {nome, cpf}
 * - localStream: MediaStream (microfone)
 * - callbacks: {onStatusChange, onRemoteStream, onEnd}
 *
 * returns {protocol, pc}
 */
async function startUserCall(profile, localStream, callbacks){
  // prevent active_by_cpf duplicate
  const cpfKey = onlyDigits(profile.cpf || '');
  if(!cpfKey) throw new Error('CPF inválido');

  const activeSnap = await db.ref('active_by_cpf/'+cpfKey).get();
  if(activeSnap.exists()) throw new Error('Já existe chamada ativa para este CPF');

  const protocol = WebRTCService.genProtocol();

  // write call metadata
  const payload = {
    protocol,
    nome: profile.nome || '',
    cpf: profile.cpf || '',
    status: 'waiting',
    createdAt: Date.now(),
    device: navigator.userAgent || 'web'
  };
  await db.ref('calls/'+protocol).set(payload);
  await markActiveByCpf(profile.cpf, protocol);

  // create offer and publish
  const {pc, peerId} = await WebRTCService.createOfferAndPublish(protocol, localStream);

  // attach remote track handler
  pc.ontrack = (ev)=>{
    if(typeof callbacks?.onRemoteStream === 'function') callbacks.onRemoteStream(ev.streams[0]);
  };

  // listen for answer
  const answerRef = db.ref('calls/'+protocol+'/answer');
  const answerListener = answerRef.on('value', async snap=>{
    const val = snap.val();
    if(val && val.sdp){
      try{
        await pc.setRemoteDescription(new RTCSessionDescription({type: val.type, sdp: val.sdp}));
      }catch(e){}
    }
  });

  // attach candidate listener to add remote candidates when they appear
  const detachCandidates = WebRTCService.attachCandidatesListener(protocol, (cand, branch)=>{
    // ignore our own branch
    if(branch === peerId) return;
    try{ pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){}
  });

  // listen for status changes (accepted/rejected/ended)
  const statusRef = db.ref('calls/'+protocol+'/status');
  const statusHandler = statusRef.on('value', snap=>{
    const val = snap.val();
    if(typeof callbacks?.onStatusChange === 'function') callbacks.onStatusChange(val);
    if(val === 'rejected' || val === 'ended' || val === 'not_answered' || val === 'cancelled'){
      // cleanup
      statusRef.off('value', statusHandler);
      answerRef.off('value', answerListener);
      detachCandidates();
      unmarkActiveByCpf(profile.cpf);
      try{ pc.close(); }catch(e){}
      if(typeof callbacks?.onEnd === 'function') callbacks.onEnd(val);
      // remove call from DB after short delay
      setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 3000);
    }
  });

  return {protocol, pc};
}

/**
 * supportAcceptCall(protocol, localStream, callbacks)
 * - localStream: MediaStream
 * - callbacks: {onRemoteStream, onEnd}
 * returns {pc}
 */
async function supportAcceptCall(protocol, localStream, callbacks){
  // set status accepted
  await db.ref('calls/'+protocol+'/status').set('accepted');

  // create answer and publish
  const {pc, supportBranch} = await WebRTCService.createAnswerFromOffer(protocol, localStream);

  // attach remote stream handler
  pc.ontrack = (ev)=>{
    if(typeof callbacks?.onRemoteStream === 'function') callbacks.onRemoteStream(ev.streams[0]);
  };

  // attach candidates listener
  const detachCandidates = WebRTCService.attachCandidatesListener(protocol, (cand, branch)=>{
    // ignore our own branch
    if(branch === supportBranch) return;
    try{ pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){}
  });

  // listen for status changes
  const statusRef = db.ref('calls/'+protocol+'/status');
  const statusHandler = statusRef.on('value', snap=>{
    const val = snap.val();
    if(val === 'ended' || val === 'cancelled' || val === 'rejected' || val === 'not_answered'){
      statusRef.off('value', statusHandler);
      detachCandidates();
      try{ pc.close(); }catch(e){}
      if(typeof callbacks?.onEnd === 'function') callbacks.onEnd(val);
      // cleanup DB
      setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 3000);
    }
  });

  return {pc};
}

/**
 * supportRejectCall(protocol)
 */
async function supportRejectCall(protocol){
  await db.ref('calls/'+protocol+'/status').set('rejected');
  // remove active_by_cpf
  const snap = await db.ref('calls/'+protocol).get();
  if(snap.exists()){
    const c = snap.val();
    if(c.cpf) await db.ref('active_by_cpf/'+onlyDigits(c.cpf)).remove();
  }
  setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 3000);
}

/**
 * endCall(protocol, originCpf)
 */
async function endCall(protocol){
  await db.ref('calls/'+protocol+'/status').set('ended');
  const snap = await db.ref('calls/'+protocol).get();
  if(snap.exists()){
    const c = snap.val();
    if(c.cpf) await db.ref('active_by_cpf/'+onlyDigits(c.cpf)).remove();
  }
  setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 3000);
}

// expose public API
window.startUserCall = startUserCall;
window.supportAcceptCall = supportAcceptCall;
window.supportRejectCall = supportRejectCall;
window.endCall = endCall;
window.pingTest = pingTest;

// ===== Notes for integration =====
// - This script provides WebRTC signaling via Firebase Realtime Database.
// - The UI pages (call_widget.html and admincall.html) call startUserCall/supportAcceptCall etc.
// - The database nodes used are described at the top of this script.
// - The code removes the call entry after end/reject/not_answered to keep DB clean.

// End of script.js
