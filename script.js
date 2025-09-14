// script.js
// Conteúdo: suas funções originais + WebRTC + chamadas em tempo real.
// ***** Mantenha este arquivo no mesmo diretório que as páginas HTML *****


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
  // Chama callback quando estado de auth estiver resolvido
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
// (mantive exatamente suas funções originais)
async function registrarCidadao(perfil, senha){
  const cpfNum = onlyDigits(perfil.cpf);
  // 1) Verifica/Reserva CPF via transação
  const refIdx = db.ref('cpf_to_uid/'+cpfNum);
  const uidReservado = await refIdx.transaction(current=>{
    if(current === null){ return 'PENDING'; } // reserva
    return; // abortar
  }, undefined, false).then(res=>res.committed ? res.snapshot.val() : null);

  if(uidReservado === null){
    throw {code:'cpf/duplicado', message:'CPF já cadastrado.'};
  }

  try{
    // 2) Cria usuário
    const cred = await auth.createUserWithEmailAndPassword(perfil.email, senha);
    const uid = cred.user.uid;

    // 3) Salva perfil
    const dados = {
      uid,
      nomeCompleto: perfil.nomeCompleto,
      cpf: perfil.cpf, // formatado
      nascimento: perfil.nascimento,
      telefone: perfil.telefone || '',
      endereco: perfil.endereco || {cep:'',cidade:'',rua:'',numero:''},
      cadunico: perfil.cadunico || null,
      email: perfil.email,
      criadoEm: Date.now()
    };
    await db.ref('users/'+uid).set(dados);

    // 4) Confirma índice CPF -> UID
    await refIdx.set(uid);

    return uid;
  }catch(err){
    // rollback índice se falhar após reserva
    await db.ref('cpf_to_uid/'+cpfNum).set(null);
    throw err;
  }
}

// ===== Perfil =====
async function obterPerfil(uid){
  const snap = await db.ref('users/'+uid).get();
  return snap.exists() ? snap.val() : null;
}

/**
 * Atualiza somente telefone + endereço.
 * Persistência imediata; retorna perfil atualizado.
 */
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


// ==================== NOVAS FUNÇÕES: CHAMADAS + WEBRTC ====================
// Estrutura no Realtime DB:
// /calls/{protocol} = {
//   protocol, nomeCompleto, cpf, obs, deviceId, status: 'waiting'|'accepted'|'in-call'|'ended'|'rejected'|'not-answered',
//   ts, expiresAt, supportId, ping: {client:ms, support:ms}, signal: {messages...}
// }
//
// signaling: /calls/{protocol}/signal/ -> child_added messages {from:'user'|'support', type:'offer'/'answer'/'candidate', data:...}

// Configuração WebRTC STUN/TURN (adapte TURN se tiver)
const RTC_CONFIG = {
  iceServers: [
    {urls: "stun:stun.l.google.com:19302"}
    // adicione TURN se tiver
  ]
};

// Tempo de não atendimento (10 minutos)
const NOT_ANSWER_TIMEOUT_MS = 10 * 60 * 1000;

// util gerador de protocolo 12 dígitos
function genProtocol12(){
  const now = Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const rnd = Math.floor(Math.random()*1e9).toString(36).toUpperCase();
  let s = (now+rnd).replace(/[^A-Z0-9]/g,'').slice(0,12);
  while(s.length<12) s+=Math.floor(Math.random()*10);
  return s;
}

// ======= Regras exclusividade: verifica se CPF ou device já tem chamada ativa ========
async function hasActiveCallForCpfOrDevice(cpf, deviceId){
  const snap = await db.ref('calls').orderByChild('ts').limitToLast(200).get();
  if(!snap.exists()) return false;
  const vals = snap.val();
  for(const k in vals){
    const c = vals[k];
    if(!c) continue;
    if(['waiting','accepted','in-call'].includes(c.status)){
      if(onlyDigits(c.cpf) === onlyDigits(cpf) || (c.deviceId && c.deviceId === deviceId)){
        return true;
      }
    }
  }
  return false;
}

// ======= Criação do chamado (cidadão) =======
async function createCallForCitizen({nomeCompleto, cpf, obs, deviceId}){
  // checa duplicidade
  if(await hasActiveCallForCpfOrDevice(cpf, deviceId)){
    throw new Error('Já existe um atendimento ativo para este CPF ou dispositivo.');
  }
  const protocol = genProtocol12();
  const ts = Date.now();
  const expiresAt = ts + NOT_ANSWER_TIMEOUT_MS;
  const callObj = {
    protocol,
    nomeCompleto,
    cpf,
    obs: obs||'',
    deviceId: deviceId||null,
    status: 'waiting',
    ts,
    expiresAt,
    supportId: null,
    ping: {},
    // sinalização será em /calls/{protocol}/signal
  };
  await db.ref('calls/'+protocol).set(callObj);

  // criar timeout (serverless approach via client: mark not answered after 10min if still waiting)
  setTimeout(async ()=>{
    const snap = await db.ref('calls/'+protocol+'/status').get();
    if(!snap.exists()) return;
    const status = snap.val();
    if(status === 'waiting'){
      await db.ref('calls/'+protocol+'/status').set('not-answered');
      // remove after short delay
      setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 4000);
    }
  }, NOT_ANSWER_TIMEOUT_MS + 1000);

  return {protocol};
}

// ======= Listen para atualizações do chamado (usado no cliente) =======
function listenCallUpdates(protocol, cb){
  const ref = db.ref('calls/'+protocol);
  const handler = ref.on('value', snapshot=>{
    if(!snapshot.exists()){ cb(null); return; }
    cb(snapshot.val());
  });
  // retorna função para remover listener (se quiser, não necessário aqui)
  return ()=> ref.off('value', handler);
}

// ======= Cancelar chamado (pelo usuário) =======
async function cancelCall(protocol, {initiator='user'}={}){
  // set status ended and remove node
  await db.ref('calls/'+protocol+'/status').set('ended');
  // small grace then remove
  await new Promise(r=>setTimeout(r,400));
  await db.ref('calls/'+protocol).remove();
}

// ======= Aceitar chamado (suporte) =======
async function acceptCall(protocol, {supportId}){
  // atomic: only accept if waiting
  const ref = db.ref('calls/'+protocol+'/status');
  const res = await ref.transaction(curr=>{
    if(curr === 'waiting') return 'accepted';
    return; // abort
  });
  if(!res.committed) throw new Error('Chamado já não está disponível para aceitar.');
  // set supportId
  await db.ref('calls/'+protocol+'/supportId').set(supportId);
  await db.ref('calls/'+protocol+'/acceptedAt').set(Date.now());
  return true;
}

// ======= Rejeitar chamado (suporte) =======
async function rejectCallBySupport(protocol){
  await db.ref('calls/'+protocol+'/status').set('rejected');
  // remove after small delay
  setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 3000);
}

// ======= Recusar (apenas um nome separado) =======
async function rejectCallBySupportManual(protocol){
  return rejectCallBySupport(protocol);
}

// ======= Hangup (qualquer lado) - finaliza chamada e remove registro =======
async function hangupCall(protocol, {by} = {}){
  await db.ref('calls/'+protocol+'/status').set('ended');
  // enviar um evento de sinalização para informar hangup
  await db.ref('calls/'+protocol+'/signal').push({from: by || 'system', type:'hangup', ts:Date.now()});
  // remove call after small delay
  setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 900);
}

// ======= LISTEN incoming calls for admin UI =======
function listenIncomingCalls(callback){
  // callback receives array of calls (waiting + accepted + in-call)
  const ref = db.ref('calls');
  ref.on('value', snap=>{
    const out = [];
    if(snap.exists()){
      const val = snap.val();
      for(const k in val){
        const c = val[k];
        if(!c) continue;
        if(['waiting','accepted','in-call'].includes(c.status)){
          out.push(Object.assign({}, c));
        }
      }
    }
    callback(out);
  });
}

// ======= SIGNALING helpers (push messages under /calls/{protocol}/signal) =======
function pushSignalMessage(protocol, msg){
  return db.ref('calls/'+protocol+'/signal').push(msg);
}
function listenSignal(protocol, cb){
  const ref = db.ref('calls/'+protocol+'/signal');
  const handler = ref.on('child_added', snap=>{
    cb(snap.val());
  });
  return ()=> ref.off('child_added', handler);
}

// ======= PING loop (measures RTT) =======
// For client (user): startPingLoopForCall(protocol, cb(ms)) -> writes timestamp and reads response ping from support
function startPingLoopForCall(protocol, cb){
  let stopped = false;
  async function loop(){
    while(!stopped){
      const t0 = Date.now();
      // write ping request
      await db.ref('calls/'+protocol+'/ping/request').set({t0});
      // wait small interval for support to echo
      await new Promise(res=>setTimeout(res, 700));
      const snap = await db.ref('calls/'+protocol+'/ping/response').get();
      if(snap.exists()){
        const obj = snap.val();
        if(obj.t0 === t0 && obj.t1){
          const ms = Math.max(0, (obj.t1 - obj.t0));
          try{ cb(ms); }catch(e){}
        }
      }
      await new Promise(res=>setTimeout(res, 2000));
    }
  }
  loop();
  return ()=> stopped=true;
}

// For admin: startAdminPingLoop(cb)
function startAdminPingLoop(cb){
  let stopped = false;
  async function loop(){
    while(!stopped){
      const t0 = Date.now();
      // read all waiting calls and write echo response if exist
      const snap = await db.ref('calls').get();
      if(snap.exists()){
        const val = snap.val();
        for(const p in val){
          const c = val[p];
          if(!c) continue;
          // if there's a ping/request and it was recently written, echo back
          const reqSnap = await db.ref('calls/'+p+'/ping/request').get();
          if(reqSnap.exists()){
            const r = reqSnap.val();
            await db.ref('calls/'+p+'/ping/response').set({t0:r.t0, t1:Date.now()});
          }
        }
      }
      // compute admin ping: rough network ping to db (ms)
      const pingMs = Date.now() - t0;
      try{ cb(pingMs); }catch(e){}
      await new Promise(r=>setTimeout(r, 3000));
    }
  }
  loop();
  return ()=> stopped=true;
}

// ======= WEBRTC: process roles =======
// We keep a map of peer connections per protocol for support
const RT_MAP = {}; // protocol -> {pc, localStream, remoteStream, listeners...}

// helper to get user media (audio only) with echo cancellation
async function getLocalAudioStream(){
  const constraints = { audio: { echoCancellation:true, noiseSuppression:true, sampleRate: 48000 } };
  return await navigator.mediaDevices.getUserMedia(constraints);
}

// start as caller (user creates offer)
async function startAsCaller(protocol){
  const localStream = await getLocalAudioStream();
  // keep local stream to stop later
  RT_MAP[protocol] = RT_MAP[protocol] || {};
  RT_MAP[protocol].localStream = localStream;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  RT_MAP[protocol].pc = pc;

  // add tracks
  for(const t of localStream.getTracks()) pc.addTrack(t, localStream);

  // create remote audio element
  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;
  RT_MAP[protocol].remoteAudio = remoteAudio;

  pc.ontrack = (ev)=>{
    try{
      remoteAudio.srcObject = ev.streams[0];
    }catch(e){ console.warn(e); }
  };

  // ICE candidates -> push to firebase
  pc.onicecandidate = (ev)=>{
    if(ev.candidate){
      pushSignalMessage(protocol, {from:'user', type:'candidate', candidate: ev.candidate.toJSON(), ts:Date.now()});
    }
  };

  // listen signaling
  const offSignal = listenSignal(protocol, async (msg)=>{
    if(!msg) return;
    if(msg.from === 'support' && msg.type === 'answer' && msg.sdp){
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      // mark in-call
      await db.ref('calls/'+protocol+'/status').set('in-call');
    }else if(msg.from === 'support' && msg.type === 'candidate' && msg.candidate){
      try{ await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }catch(e){}
    }else if(msg.type === 'hangup'){
      // support hung up
      await db.ref('calls/'+protocol+'/status').set('ended');
      // cleanup
      cleanupRT(protocol);
    }
  });
  RT_MAP[protocol].offSignal = offSignal;

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // send offer via firebase
  await pushSignalMessage(protocol, {from:'user', type:'offer', sdp: offer, ts:Date.now()});
  // update status accepted? We'll wait for support to set accepted->answer
}

// start as callee (support) - must call acceptCall before this
async function startAsCallee(protocol, supportId, onState){
  RT_MAP[protocol] = RT_MAP[protocol] || {};
  const localStream = await getLocalAudioStream();
  RT_MAP[protocol].localStream = localStream;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  RT_MAP[protocol].pc = pc;

  // add tracks
  for(const t of localStream.getTracks()) pc.addTrack(t, localStream);

  const remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;
  RT_MAP[protocol].remoteAudio = remoteAudio;

  pc.ontrack = (ev)=>{
    try{ remoteAudio.srcObject = ev.streams[0]; }catch(e){}
  };

  pc.onicecandidate = (ev)=>{
    if(ev.candidate){
      pushSignalMessage(protocol, {from:'support', type:'candidate', candidate: ev.candidate.toJSON(), ts:Date.now()});
    }
  };

  // listen for offer
  const offSignal = listenSignal(protocol, async (msg)=>{
    if(!msg) return;
    if(msg.from === 'user' && msg.type === 'offer' && msg.sdp){
      try{
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        // create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await pushSignalMessage(protocol, {from:'support', type:'answer', sdp: answer, ts:Date.now()});
        // mark in-call
        await db.ref('calls/'+protocol+'/status').set('in-call');
        if(typeof onState === 'function') onState('in-call');
      }catch(e){
        console.error('Erro ao processar offer:', e);
      }
    }else if(msg.from === 'user' && msg.type === 'candidate' && msg.candidate){
      try{ await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); }catch(e){}
    }else if(msg.type === 'hangup'){
      // user hung up
      await db.ref('calls/'+protocol+'/status').set('ended');
      cleanupRT(protocol);
    }
  });
  RT_MAP[protocol].offSignal = offSignal;

  // also send a notification in DB that support is online and accepted
  await db.ref('calls/'+protocol+'/supportId').set(supportId);
  await db.ref('calls/'+protocol+'/status').set('accepted');
}

// cleanup peers
function cleanupRT(protocol){
  const obj = RT_MAP[protocol];
  if(!obj) return;
  try{ if(obj.pc){ obj.pc.close(); } }catch(e){}
  try{ if(obj.localStream){ obj.localStream.getTracks().forEach(t=>t.stop()); } }catch(e){}
  if(obj.offSignal) obj.offSignal();
  delete RT_MAP[protocol];
}

// ======= Prevent double-call from same device or CPF is handled on createCallForCitizen =======

// ======= Additional behaviours: realtime in-app notifications (via DB events) =======
// The admin and user pages already listen to /calls and /calls/{protocol} respectively.
// For push notifications (native), you must integrate FCM in your APK and subscribe to events.
// POINT OF INTEGRATION (FCM):
//  - When a new call is created, write /notifications/{token} or use Cloud Functions to push via FCM.
//  - Here we keep in-app notifications using listeners.

// ======= Extra: measure ping for connection quality (client/server) =======
// See startPingLoopForCall, startAdminPingLoop above.

// =================================================================================
// APIs exported for the HTML pages
window.createCallForCitizen = createCallForCitizen;
window.listenCallUpdates = listenCallUpdates;
window.cancelCall = cancelCall;
window.hangupCall = hangupCall;
window.acceptCall = acceptCall;
window.rejectCallBySupport = rejectCallBySupport;
window.listenIncomingCalls = listenIncomingCalls;
window.startAsCaller = startAsCaller;
window.startAsCallee = startAsCallee;
window.startAdminPingLoop = startAdminPingLoop;
window.startPingLoopForCall = startPingLoopForCall;

// =================================================================================
// NOTES & LIMITAÇÕES IMPORTANTES (leitura obrigatória):
// - Este sistema usa Firebase Realtime Database como canal de sinalização. Para chamadas em produção
//   e em larga escala recomenda-se usar servidor de sinalização dedicado e TURN servers robustos.
// - Para push notifications nativas (Android APK / iOS) use Firebase Cloud Messaging (FCM) e Cloud Functions.
//   Aqui deixei o local pronto para integrar (quando um novo chamado é criado, gere uma notificação).
// - Chamadas atendidas NÃO são persistidas: após encerramento (hangup) o nó /calls/{protocol} é removido.
// - Para suportar todos os navegadores e webviews: verifique permissões de getUserMedia no WebView / config do APK.
// - Eco: a API tenta reduzir eco via constraints (echoCancellation), mas se o ambiente tiver acústica ruim, recomenda-se processamento adicional.
// =================================================================================
