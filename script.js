// script.js
// =======================
// Parte inicial (mantida do seu código enviado)
// =======================

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
/**
 * Regras:
 * - Ninguém pode ter mais de uma conta com o mesmo CPF.
 * - Usamos nó índice: /cpf_to_uid/{cpfNumerico} = uid
 * - Salvamos perfil em /users/{uid}
 * - "Transação" garante exclusividade contra corrida
 */
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


// =======================
// PARTE NOVA: WebRTC + Signaling + Fluxo de Atendimento
// =======================

/**
 Data model (Realtime DB):
 /calls/{protocol} = {
   protocol: string,
   nomeCompleto,
   cpf,
   createdAt,
   status: 'waiting'|'accepted'|'ongoing'|'ended'|'not_answered'|'cancelled',
   supportId: (uid do suporte) | null,
   offer: {type,sdp} // criada pelo solicitante
   answer: {type,sdp} // criada pelo suporte
   candidates: {
     caller: { pushId: candidateObj, ...},
     callee: { pushId: candidateObj, ...}
   }
   heartbeat: { callerPing: timestamp, calleePing: timestamp }
 }
*/

// STUN servers padrão (pode adicionar TURN se precisar)
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// gera protocolo de 12 dígitos
function gerarProtocolo12(){
  const n = Math.floor(Math.random()*1e12).toString().padStart(12,'0');
  return n;
}

// verifica se já existe chamada ativa para um CPF
async function existeChamadaAtiva(cpf){
  const cpfNum = onlyDigits(cpf);
  const snap = await db.ref('calls').orderByChild('cpfNum').equalTo(cpfNum).get();
  if(!snap.exists()) return false;
  const vals = snap.val();
  for(const k in vals){
    const s = vals[k].status;
    if(s === 'waiting' || s === 'accepted' || s === 'ongoing') return true;
  }
  return false;
}

// cria solicitação (usada no cliente)
async function criarSolicitacao({nomeCompleto, cpf}){
  const cpfNum = onlyDigits(cpf);
  // checa duplicidade
  const has = await existeChamadaAtiva(cpf);
  if(has) throw new Error('Já existe uma solicitação ativa para este CPF.');

  const protocol = gerarProtocolo12();
  const now = Date.now();
  const node = {
    protocol,
    nomeCompleto,
    cpf,
    cpfNum,
    createdAt: now,
    status: 'waiting',
    supportId: null,
    heartbeat: { callerPing: now },
  };
  await db.ref('calls/'+protocol).set(node);

  // timeout de 10 minutos -> não atendido
  setTimeout(async ()=>{
    const s = (await db.ref('calls/'+protocol+'/status').get()).val();
    if(s === 'waiting'){
      await db.ref('calls/'+protocol+'/status').set('not_answered');
      // pode manter o registro por alguns segundos e depois limpar
      setTimeout(()=> db.ref('calls/'+protocol).remove().catch(()=>{}), 20*1000);
    }
  }, 10*60*1000);

  return { protocol };
}

// cancelar solicitação (antes de atendido)
async function cancelarSolicitacao(protocol){
  const snap = await db.ref('calls/'+protocol).get();
  if(!snap.exists()) return;
  const s = snap.val().status;
  if(s === 'accepted' || s === 'ongoing'){
    // se já estiver em atendimento, tratamos como endCall
    return endCall(protocol);
  }
  await db.ref('calls/'+protocol+'/status').set('cancelled');
  await db.ref('calls/'+protocol).remove();
}

// Listener para o status de uma chamada (util para cliente)
function listenCallStatus(protocol, cb){
  const ref = db.ref('calls/'+protocol);
  const fn = ref.on('value', snap=>{
    const v = snap.exists() ? snap.val() : null;
    cb(v);
  });
  return ()=> ref.off('value', fn);
}

// LISTENER para painel de suporte: retorna array com solicitações em "waiting" ordenadas por createdAt
function listenIncomingRequests(cb){
  const ref = db.ref('calls');
  const fn = ref.orderByChild('createdAt').on('value', snap=>{
    const arr = [];
    snap.forEach(ch=>{
      const v = ch.val();
      if(v.status === 'waiting') arr.push({protocol: v.protocol, data: v});
    });
    // ordenar por createdAt asc
    arr.sort((a,b)=> a.data.createdAt - b.data.createdAt);
    cb(arr);
  });
  return ()=> ref.off('value', fn);
}

// get call once
async function getCallOnce(protocol){
  const snap = await db.ref('calls/'+protocol).get();
  if(!snap.exists()) return null;
  return snap.val();
}

// Aceitar requisição (admin)
async function acceptRequest(protocol){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) throw new Error('Solicitação não encontrada');
  const data = snap.val();
  if(data.status !== 'waiting') throw new Error('Solicitação não pode ser atendida.');
  // marca accepted
  await ref.update({ status:'accepted', supportId:'support-'+Date.now(), acceptedAt: Date.now() });
}

// Recusar requisição
async function rejectRequest(protocol){
  await db.ref('calls/'+protocol+'/status').set('cancelled');
  await db.ref('calls/'+protocol).remove();
}

// Finalizar (desligar) - por qualquer lado
async function endCall(protocol){
  // set status ended then remove node
  await db.ref('calls/'+protocol+'/status').set('ended');
  // remover sinais e nós de SDP / candidates
  await db.ref('calls/'+protocol).remove();
}

// Monitor ping (escreve heartbeat e mostra diferença)
function monitorPing(protocol, elementToUpdate){
  const ref = db.ref('calls/'+protocol+'/heartbeat');
  let interval = setInterval(async ()=>{
    try{
      const now = Date.now();
      await db.ref('calls/'+protocol+'/heartbeat/callerPing').set(now);
      const snap = await ref.get();
      const val = snap.exists() ? snap.val() : {};
      const calleePing = val.calleePing || null;
      const delta = calleePing ? Math.abs(now - calleePing) : null;
      if(delta !== null){
        elementToUpdate.innerText = 'Ping aproximado: ' + delta + ' ms';
      }else{
        elementToUpdate.innerText = 'Conexão: aguardando atendente';
      }
    }catch(e){
      elementToUpdate.innerText = 'Conexão: indisponível';
    }
  }, 5000);
  return interval;
}

// ===========================
// WebRTC Signaling via Firebase Realtime DB
// ===========================

/**
  Estrutura simplificada:
  /calls/{protocol}/offer -> {type, sdp}
  /calls/{protocol}/answer -> {type, sdp}
  /calls/{protocol}/candidates/caller/{pushId} -> candidate
  /calls/{protocol}/candidates/callee/{pushId} -> candidate
*/

// Util: push candidato
async function pushCandidate(protocol, who, candidate){
  await db.ref(`calls/${protocol}/candidates/${who}`).push(candidate);
}

// Util: listen candidates
function listenCandidates(protocol, who, onCandidate){
  const ref = db.ref(`calls/${protocol}/candidates/${who}`);
  const fn = ref.on('child_added', snap=>{
    onCandidate(snap.val());
  });
  return ()=> ref.off('child_added', fn);
}

// Iniciar como caller (solicitante). Retorna peer connection.
async function startAsCaller(protocol, remoteAudioElem, handlers = {}){
  // obtém mic
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // adicionar track local
  stream.getTracks().forEach(t=> pc.addTrack(t, stream));

  // evitar eco: não reproduzir local diretamente
  // set remote audio
  pc.ontrack = (ev)=>{
    try{ remoteAudioElem.srcObject = ev.streams[0]; }catch(e){ console.warn(e); }
  };

  // ICE candidates -> push para DB
  pc.onicecandidate = (ev)=>{
    if(ev.candidate){
      pushCandidate(protocol, 'caller', ev.candidate.toJSON()).catch(()=>{});
    }
  };

  // createOffer and store
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await db.ref('calls/'+protocol+'/offer').set({ type: offer.type, sdp: offer.sdp });

  // listen answer
  const ansRef = db.ref('calls/'+protocol+'/answer');
  const ansListener = ansRef.on('value', async snap=>{
    const ans = snap.exists() ? snap.val() : null;
    if(ans && ans.sdp){
      const remoteDesc = new RTCSessionDescription(ans);
      await pc.setRemoteDescription(remoteDesc);
      // mark ongoing
      await db.ref('calls/'+protocol+'/status').set('ongoing');
      handlers.onConnected && handlers.onConnected();
    }
  });

  // listen remote candidates (callee)
  const unlistenRemoteCands = listenCandidates(protocol, 'callee', async (cand)=>{
    try{ await pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){ console.warn(e); }
  });

  // clean on disconnect
  pc._cleanup = async ()=>{
    try{ pc.getSenders().forEach(s=> s.track && s.track.stop()); }catch(e){}
    try{ pc.close(); }catch(e){}
    ansRef.off('value', ansListener);
    unlistenRemoteCands && unlistenRemoteCands();
    handlers.onEnded && handlers.onEnded();
    // remove call node (end)
    await db.ref('calls/'+protocol).remove().catch(()=>{});
  };

  // listen DB status (if ended by support)
  const statusRef = db.ref('calls/'+protocol+'/status');
  statusRef.on('value', async snap=>{
    const st = snap.exists() ? snap.val() : null;
    if(st === 'ended' || st === 'cancelled' || st === 'not_answered'){
      // encerra localmente
      if(pc && pc._cleanup) pc._cleanup();
      statusRef.off();
    }
  });

  // publish local ICE candidates listeners already set
  return pc;
}

// Iniciar como callee (suporte). Ele pega offer do DB, cria answer e responde.
async function startAsCallee(protocol, remoteAudioElem, handlers = {}){
  // pega offer
  const offerSnap = await db.ref('calls/'+protocol+'/offer').get();
  if(!offerSnap.exists()) throw new Error('Offer não encontrada');
  const offer = offerSnap.val();

  // marca status accepted antes (feita pelo painel)
  // prepara local mic
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // reproduzir remote tracks (local recebe a voz do solicitante)
  pc.ontrack = (ev)=>{
    try{ remoteAudioElem.srcObject = ev.streams[0]; }catch(e){ console.warn(e); }
  };

  // adicionar local track (suporte -> enviando voz)
  stream.getTracks().forEach(t=> pc.addTrack(t, stream));

  // ICE -> push to DB under callee
  pc.onicecandidate = (ev)=>{
    if(ev.candidate){
      pushCandidate(protocol, 'callee', ev.candidate.toJSON()).catch(()=>{});
    }
  };

  // setRemoteDescription(offer)
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  // createAnswer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await db.ref('calls/'+protocol+'/answer').set({ type: answer.type, sdp: answer.sdp });

  // add listener for caller candidates
  const unlistenCallerCands = listenCandidates(protocol, 'caller', async (cand)=>{
    try{ await pc.addIceCandidate(new RTCIceCandidate(cand)); }catch(e){ console.warn(e); }
  });

  // mark ongoing
  await db.ref('calls/'+protocol+'/status').set('ongoing');

  pc._cleanup = async ()=>{
    try{ pc.getSenders().forEach(s=> s.track && s.track.stop()); }catch(e){}
    try{ pc.close(); }catch(e){}
    unlistenCallerCands && unlistenCallerCands();
    handlers.onEnded && handlers.onEnded();
    // remove call node
    await db.ref('calls/'+protocol).remove().catch(()=>{});
  };

  // status listener to end
  const statusRef = db.ref('calls/'+protocol+'/status');
  statusRef.on('value', async snap=>{
    const st = snap.exists() ? snap.val() : null;
    if(st === 'ended' || st === 'cancelled'){
      if(pc && pc._cleanup) pc._cleanup();
      statusRef.off();
    }
  });

  handlers.onConnected && handlers.onConnected();
  return pc;
}

// ===========================
// LISTENERS EXTRAS (para admin UI) — exposição para admin UI usar
// ===========================
/*
 * Expose minimal API functions that admin/client pages call:
 * - listenIncomingRequests(cb)
 * - getCallOnce(protocol)
 * - acceptRequest(protocol)
 * - rejectRequest(protocol)
 * - startAsCallee(protocol, remoteAudioElem, handlers)
 * - startAsCaller(protocol, remoteAudioElem, handlers)
 * - criarSolicitacao({nomeCompleto, cpf})
 * - cancelarSolicitacao(protocol)
 * - listenCallStatus(protocol, cb)
 * - monitorPing(protocol, element)
 * - endCall(protocol)
 */

// As funções já estão no escopo global — nada a fazer extra.
// Se quiser, exponha explicitamente:
window.criarSolicitacao = criarSolicitacao;
window.cancelarSolicitacao = cancelarSolicitacao;
window.listenCallStatus = listenCallStatus;
window.listenIncomingRequests = listenIncomingRequests;
window.getCallOnce = getCallOnce;
window.acceptRequest = acceptRequest;
window.rejectRequest = rejectRequest;
window.startAsCallee = startAsCallee;
window.startAsCaller = startAsCaller;
window.monitorPing = monitorPing;
window.endCall = endCall;

// ===========================
// Regras extra de segurança / integridade
// - evita que um CPF abra múltiplas chamadas (existeChamadaAtiva)
// - quando desligar, a chamada é removida e não fica salva
// - timeout de 10 minutos para 'não atendido'
// - ping heartbeat gravado no DB
// - teardown sempre tenta remover o nó / sinais
// ===========================

/* Nota final:
 - Para produção, considere adicionar TURN servers (especialmente em mobile/webview).
 - Integre notificações push (FCM) no backend para notificar o suporte quando houver nova chamada.
 - Se desejar, posso adicionar o código de notificação do navegador (Notification API) e exemplo de integração FCM.
*/
