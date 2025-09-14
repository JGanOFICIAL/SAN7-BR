// script.js (versão com WebRTC + suas funções preservadas)

/* -----------------------
   Firebase (Compat) — Config
   ----------------------- */
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

/* ======================
   Suas funções já dadas
   (mantive conforme você enviou)
   ====================== */

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

// ===== Auth =====
async function loginComEmail(email, senha){
  return auth.signInWithEmailAndPassword(email, senha);
}

async function enviarResetSenha(email){
  return auth.sendPasswordResetEmail(email);
}

async function sair(){
  return auth.signOut();
}

// ===== Cadastro com CPF único =====
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

// ===== Perfil =====
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
   WebRTC + Call management
   via Firebase Realtime DB
   =========================== */

/*
Data model (Realtime DB):

/calls/{protocol} = {
  meta: {
    protocol: string,
    nomeCompleto: string,
    cpf: string,
    status: 'waiting'|'accepted'|'not_answered'|'ended'|'cancelled',
    createdAt: number,
    acceptedAt?: number,
    supportUid?: string
  },
  offer: { type, sdp }        // criado pelo suporte ao aceitar
  answer: { type, sdp }       // criado pelo cliente em resposta
  callerCandidates: { pushId: cand }
  supportCandidates: { pushId: cand }
}

Regras:
- createCall cria /calls/{protocol}
- adminAccept cria pc (getUserMedia), cria offer e grava /calls/{protocol}/offer
- client escuta offer, cria answer e grava /calls/{protocol}/answer
- Ambos trocam ICE candidates em seus nós respectivos
- Ao hangup/decline -> remove /calls/{protocol}
- Se waiting > 10 minutos -> marca not_answered e remove depois (1 min)
*/

const CALLS_ROOT = 'calls';

// helpers de caminho
function callRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}`); }
function callMetaRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}/meta`); }
function callOfferRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}/offer`); }
function callAnswerRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}/answer`); }
function callCallerCandidatesRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}/callerCandidates`); }
function callSupportCandidatesRef(protocol){ return db.ref(`${CALLS_ROOT}/${protocol}/supportCandidates`); }

/* UTIL: gerar protocolo (caso queira gerar aqui) */
function genProtocol12(){
  return ('' + Math.floor(100000000000 + Math.random()*900000000000));
}

/* Cria chamado (diretamente usado pelo widget) */
async function createCall({protocol, nomeCompleto, cpf}){
  const now = Date.now();
  const meta = {
    protocol,
    nomeCompleto,
    cpf,
    status: 'waiting',
    createdAt: now
  };
  await callRef(protocol).set({ meta });
  // agenda expiração not_answered em 10 minutos (rodará no cliente)
  scheduleNotAnswered(protocol, 10*60*1000);
}

/* Cancela pelo cidadão antes de atendimento */
async function cancelCall(protocol){
  // se existir, remove o nó
  try{
    await callRef(protocol).remove();
  }catch(e){
    console.warn('Erro ao cancelar', e);
  }
}

/* Hangup (invocado por cliente ou admin durante a chamada) */
async function hangupCall(protocol){
  try{
    await callRef(protocol).remove();
  }catch(e){
    console.warn('Erro ao hangup', e);
  }
}

/* Remove e limpa candidate listeners — internal helpers */
function safeRemove(ref){ if(!ref) return; try{ ref.off(); }catch(e){} }

/* SUBSCRIBE para cliente (widget) — escuta offer/answer/status/removal */
function subscribeToCall(protocol, handlers = {}){
  const r = callRef(protocol);
  const offerRef = callOfferRef(protocol);
  const metaRef = callMetaRef(protocol);
  const removalListener = r.on('value', (snap)=>{
    if(!snap.exists()){
      handlers.onRemoved && handlers.onRemoved();
      // remove listeners
      safeRemove(r); safeRemove(offerRef); safeRemove(metaRef);
      return;
    }
    const val = snap.val();
    const meta = val.meta || {};
    // status change
    handlers.onStatusChange && handlers.onStatusChange(meta.status);
    // if offer exists, forward to handler
    if(val.offer && handlers.onOffer){
      handlers.onOffer(val.offer);
    }
  });
  return {
    unsubscribe: ()=>{ r.off(); offerRef.off(); metaRef.off(); }
  };
}

/* Quando o cliente recebe offer -> responder (callees) */
async function handleIncomingOfferAsCallee(protocol, offer, hooks = {}){
  // cria PeerConnection local
  const pc = new RTCPeerConnection({
    iceServers: [{urls:'stun:stun.l.google.com:19302'}]
  });

  // local mic
  let localStream = null;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }catch(e){
    console.warn('Sem microfone no cliente', e);
    throw e;
  }

  // Players/handlers - para simplicidade não adicionamos elementos visuais de <audio>.
  // Mas para ouvir o suporte, criamos um <audio> element dinamicamente.
  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;
  document.body.appendChild(remoteAudio);

  pc.ontrack = (ev)=>{
    // ev.streams[0] pode ter o áudio do suporte
    if(ev.streams && ev.streams[0]){
      remoteAudio.srcObject = ev.streams[0];
    }else{
      // combinar tracks manual
      const s = new MediaStream();
      ev.streams && ev.streams.forEach(st => st.getAudioTracks().forEach(t => s.addTrack(t)));
      remoteAudio.srcObject = s;
    }
  };

  // ICE candidates: quando local gera, envia para supportCandidates
  pc.onicecandidate = (event)=>{
    if(!event.candidate) return;
    const c = event.candidate.toJSON();
    callCallerCandidatesRef(protocol).push(c).catch(()=>{});
  };

  // set remote offer
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  // create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  // grava answer no DB
  await callAnswerRef(protocol).set(pc.localDescription.toJSON());

  // escuta suporte candidates (supportCandidates) e adiciona
  const supportCandidatesRef = callSupportCandidatesRef(protocol);
  const supportListener = supportCandidatesRef.on('child_added', (snap)=>{
    const cand = snap.val();
    if(!cand) return;
    pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e=>console.warn(e));
  });

  // Escuta remoção do nó para encerrar
  const rootRef = callRef(protocol);
  const onRemoved = rootRef.on('value', (s)=>{
    if(!s.exists()){
      // encerrar peer
      try{
        pc.getSenders().forEach(s=>{ try{s.track && s.track.stop();}catch(e){} });
      }catch(e){}
      try{ pc.close(); }catch(e){}
      hooks.onEnded && hooks.onEnded();
      // cleanup
      rootRef.off();
      supportCandidatesRef.off();
      if(remoteAudio && remoteAudio.parentNode) remoteAudio.remove();
    }
  });

  // Informa o hook que conexão começou
  hooks.onStartCall && hooks.onStartCall();

  return {
    pc,
    localStream,
    remoteAudio,
    stop: async ()=>{
      try{ localStream && localStream.getTracks().forEach(t=>t.stop()); }catch(e){}
      try{ pc.close(); }catch(e){}
      try{ await callRef(protocol).remove(); }catch(e){}
    }
  };
}

/* ADMIN (suporte) functions:
   - listenForCalls: função que avisa quando chamadas chegam / mudam / removem
   - adminAccept(protocol): cria offer (suporte como offerer), grava offer no DB e aguarda answer
   - adminDecline(protocol): remove node
   - adminHangup(protocol): remove node
*/

function listenForCalls(handlers = {}){
  const root = db.ref(CALLS_ROOT);
  // Query: apenas nós onde meta.status === 'waiting' (ou outros se quiser)
  root.on('child_added', (snap)=>{
    const val = snap.val();
    const meta = val.meta || {};
    // informar apenas se waiting
    if(meta.status === 'waiting' || meta.status === 'accepted'){
      handlers.onCallAdded && handlers.onCallAdded(Object.assign({}, meta));
    }
  });
  root.on('child_removed', (snap)=>{
    const val = snap.val();
    const meta = val?.meta || {};
    handlers.onCallRemoved && handlers.onCallRemoved(meta.protocol);
  });
  root.on('child_changed', (snap)=>{
    const val = snap.val();
    const meta = val?.meta || {};
    handlers.onCallChanged && handlers.onCallChanged(meta);
  });
  return {
    unsubscribe: ()=> root.off()
  };
}

/* adminAccept: suporte aceita e cria offer */
async function adminAccept(protocol, hooks = {}){
  const pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });

  // get mic
  let localStream = null;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }catch(e){
    console.warn('Sem microfone (admin)', e);
    throw e;
  }

  // prepare audio playback for incoming tracks (do cliente)
  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;
  document.body.appendChild(remoteAudio);

  pc.ontrack = (ev)=>{
    if(ev.streams && ev.streams[0]){
      remoteAudio.srcObject = ev.streams[0];
    }else{
      const s = new MediaStream();
      ev.streams && ev.streams.forEach(st => st.getAudioTracks().forEach(t => s.addTrack(t)));
      remoteAudio.srcObject = s;
    }
  };

  // ICE -> gravar em supportCandidates
  pc.onicecandidate = (event)=>{
    if(!event.candidate) return;
    const c = event.candidate.toJSON();
    callSupportCandidatesRef(protocol).push(c).catch(()=>{});
  };

  // grava no meta: mark accepted
  const acceptedAt = Date.now();
  await callMetaRef(protocol).update({ status:'accepted', acceptedAt, supportUid:'SUPPORT' });

  // cria offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await callOfferRef(protocol).set(pc.localDescription.toJSON());

  // escuta answer
  const answerRef = callAnswerRef(protocol);
  const answerListener = answerRef.on('value', async (snap)=>{
    const val = snap.val();
    if(val && val.sdp){
      try{
        await pc.setRemoteDescription(new RTCSessionDescription(val));
        // conexão estabelecida
        hooks.onConnected && hooks.onConnected();
      }catch(e){ console.warn('setRemoteDescription failed', e); }
    }
  });

  // escuta callerCandidates e adiciona
  const callerCandidatesRef = callCallerCandidatesRef(protocol);
  const callerListener = callerCandidatesRef.on('child_added', (snap)=>{
    const cand = snap.val();
    if(!cand) return;
    pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e=>console.warn(e));
  });

  // escuta remoção do call (hangup)
  const rootRef = callRef(protocol);
  const removedListener = rootRef.on('value', (s)=>{
    if(!s.exists()){
      try{ localStream && localStream.getTracks().forEach(t=>t.stop()); }catch(e){}
      try{ pc.close(); }catch(e){}
      hooks.onEnded && hooks.onEnded();
      rootRef.off(); callerCandidatesRef.off(); answerRef.off();
      if(remoteAudio && remoteAudio.parentNode) remoteAudio.remove();
    }
  });

  return {
    pc, localStream, remoteAudio,
    stop: async ()=>{
      try{ localStream && localStream.getTracks().forEach(t=>t.stop()); }catch(e){}
      try{ pc.close(); }catch(e){}
      try{ await callRef(protocol).remove(); }catch(e){}
    }
  };
}

/* adminDecline: remove pedido */
async function adminDecline(protocol){
  try{
    await callRef(protocol).remove();
  }catch(e){
    console.warn(e);
  }
}

/* adminHangup: remove pedido (encerrar) */
async function adminHangup(protocol){
  try{
    await callRef(protocol).remove();
  }catch(e){ console.warn(e); }
}

/* agendamento de not_answered no cliente (local timer) */
const notAnsweredTimers = {};
function scheduleNotAnswered(protocol, ms){
  if(notAnsweredTimers[protocol]) clearTimeout(notAnsweredTimers[protocol]);
  notAnsweredTimers[protocol] = setTimeout(async ()=>{
    // verifica se ainda waiting
    const snap = await callMetaRef(protocol).get();
    if(snap.exists()){
      const meta = snap.val();
      if(meta.status === 'waiting'){
        // marca not_answered
        await callMetaRef(protocol).update({ status:'not_answered' });
        // remove o pedido após 60s
        setTimeout(async ()=> { try{ await callRef(protocol).remove(); }catch(e){} }, 60*1000);
      }
    }
  }, ms);
}

/* utility: quando admin aceita, chamador recebe offer -> a função handleIncomingOfferAsCallee trata isso.
   Exportar as funções para uso direto pelos HTMLs (global namespace)
*/
window.createCall = createCall;
window.cancelCall = cancelCall;
window.subscribeToCall = subscribeToCall;
window.handleIncomingOfferAsCallee = handleIncomingOfferAsCallee;
window.listenForCalls = listenForCalls;
window.adminAccept = adminAccept;
window.adminDecline = adminDecline;
window.adminHangup = adminHangup;
window.hangupCall = hangupCall;

/* FIM script.js */
