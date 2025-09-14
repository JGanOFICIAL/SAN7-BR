// script.js — completo (mantive suas funções e adicionei WebRTC + sinalização)

/* ===========================================================
   ====== Seu código original (Firebase compat + utilidades) =
   ===========================================================
*/
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

/* ===========================================================
   ====== FIM do código original / INÍCIO da extensão WebRTC =
   ===========================================================
*/

/**
 * Estrutura no Realtime DB:
 * /calls/{protocol} = {
 *   protocol: '123456789012',
 *   nomeCompleto, cpf, createdAt, status: 'waiting'|'accepted'|'in_call'|'ended'|'missed'|'rejected',
 *   deviceId, notification:{title,body,icon}, offer: {...}, answer: {...}, candidates: {support:[], user:[]}, lastPing...
 * }
 *
 * Quando o cidadão cria:
 *  - cria o nó /calls/{protocol} com status 'waiting'
 *  - cria subnós: offers/candidates serão preenchidos
 *
 * Quando suporte aceitar:
 *  - muda status para 'accepted' e cria answer/sets via offer/answer
 *
 * Timeout:
 *  - se ficar > 10 minutos em waiting => status 'missed' (não atendido)
 *
 * Observações:
 *  - todas as remoções são feitas ao desligar/recusar (call é removida)
 *  - chamadas atendidas NÃO ficam salvas (apagar após final)
 */

// helpers
function generateProtocol12(){
  // Gera número de 12 dígitos (base em timestamp + random)
  const t = String(Date.now()).slice(-9); // 9 dígitos
  const r = String(Math.floor(Math.random()*1e3)).padStart(3,'0'); // 3 dígitos
  return (t + r).slice(0,12);
}

function now(){ return Date.now(); }

function deviceId(){
  // simples id pra dispositivo (localStorage)
  let id = localStorage.getItem('deviceId_v1');
  if(!id){ id = 'd-'+Math.random().toString(36).slice(2,12); localStorage.setItem('deviceId_v1', id); }
  return id;
}

/* ========================
   Criação de chamada (usuário)
   ======================== */
async function createCallUser({ nomeCompleto, cpf, notification }){
  // evita múltiplas chamadas com mesmo CPF ativas
  const cpfNum = onlyDigits(cpf);
  const activeSnap = await db.ref('calls').orderByChild('cpf').equalTo(cpfNum).once('value');
  const existing = activeSnap.val();
  if(existing){
    // verificar se algum ativo
    const keys = Object.keys(existing);
    for(const k of keys){
      const st = existing[k].status;
      if(['waiting','accepted','in_call'].includes(st)){
        throw new Error('Já existe uma solicitação ativa para esse CPF neste dispositivo/conta.');
      }
    }
  }

  const protocol = generateProtocol12();
  const callRef = db.ref('calls/'+protocol);
  const payload = {
    protocol,
    nomeCompleto,
    cpf: cpfNum,
    createdAt: now(),
    status: 'waiting',
    deviceId: deviceId(),
    notification: notification || { title: 'Novo atendimento', body: 'Novo cidadão aguardando', icon: '' },
    lastPing: { user: now() }
  };

  await callRef.set(payload);

  // criar timeout para não atendido (10 min)
  setTimeout(async ()=>{
    const snap = await db.ref('calls/'+protocol+'/status').get();
    if(!snap.exists()) return; // já removido
    const status = snap.val();
    if(status === 'waiting'){
      await db.ref('calls/'+protocol).update({ status:'missed', missedAt: now(), lastAction:'timeout' });
      // mantém por 1 minuto e remove
      setTimeout(()=> db.ref('calls/'+protocol).remove(), 60*1000);
    }
  }, 10 * 60 * 1000);

  // return protocol info
  return { protocol, createdAt: payload.createdAt };
}

/* ========================
   Listen status for user side
   ======================== */
function listenCallStatus(protocol, onChange){
  const ref = db.ref('calls/'+protocol+'/status');
  const cb = ref.on('value', snap=>{
    const val = snap.exists() ? snap.val() : null;
    if(val === 'waiting') onChange('Aguardando');
    else if(val === 'accepted') onChange('Aceito');
    else if(val === 'in_call') onChange('Em chamada');
    else if(val === 'missed') onChange('Não atendido');
    else if(val === 'ended') onChange('Desligado');
    else if(val === 'rejected') onChange('Recusado');
    else onChange(val);
  });
  return ()=> ref.off('value', cb);
}

/* ========================
   Monitor ping: usuário escreve timestamp, suporte responde
   ======================== */
function monitorPing(protocol, onPing){
  // usuário updates lastPing.user with timestamp periodically
  const pingRef = db.ref('calls/'+protocol+'/lastPing');
  let interval = setInterval(()=> {
    pingRef.update({ user: now() });
  }, 5000);
  // suporte pode escrever lastPing.support and we measure diff
  const cb = pingRef.on('value', snap=>{
    const v = snap.val();
    if(!v) return;
    if(v.support && v.user) {
      const ping = Math.abs(v.support - v.user);
      onPing(Math.round(ping));
    }
  });
  return ()=> { clearInterval(interval); pingRef.off('value', cb); };
}

/* ========================
   Cancelar/Cancelar antes de atender (usuário)
   ======================== */
async function cancelCall(protocol){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) return;
  const data = snap.val();
  if(['waiting'].includes(data.status)){
    await ref.remove(); // remove pedido
  }else{
    // se já in_call ou accepted, pedir hangup
    await hangupCall(protocol, 'Cancelado pelo usuário');
  }
}

/* ========================
   Hangup: finaliza chamada e remove entry
   ======================== */
async function hangupCall(protocol, reason){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) return;
  const data = snap.val();

  // marcar ended para informar
  await ref.update({ status:'ended', endedAt: now(), lastAction: reason });
  // apagar a entry após 3 segundos para permitir listeners
  setTimeout(()=> ref.remove(), 3000);

  // fechar peerconn local se existir (mantenho um mapa)
  if(window._pcMap && window._pcMap[protocol]){
    try{ window._pcMap[protocol].close(); }catch(e){}
    delete window._pcMap[protocol];
  }
}

/* ========================
   Suporte: listar chamadas waiting em tempo real
   ======================== */
function listenWaitingCalls(onList){
  const ref = db.ref('calls').orderByChild('status').equalTo('waiting');
  const cb = ref.on('value', snap=>{
    const val = snap.val();
    const arr = [];
    if(val){
      Object.keys(val).forEach(k=>{
        arr.push(val[k]);
      });
      // ordenar por createdAt
      arr.sort((a,b)=>a.createdAt - b.createdAt);
    }
    onList(arr);
  });
  return ()=> ref.off('value', cb);
}

/* ========================
   Suporte: aceitar chamada
   - muda status para accepted
   - inicia processo WebRTC via startSupportCall
   ======================== */
async function acceptCall(protocol){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) return false;
  const data = snap.val();
  if(!data || data.status!=='waiting') return false;

  // marca accepted (race condition: transaction to avoid double accept)
  const committed = await db.ref('calls/'+protocol+'/status').transaction(current=>{
    if(current === 'waiting') return 'accepted';
    return; // abort
  }).then(r=>r.committed);

  return committed;
}

/* ========================
   Suporte: recusar chamada
   ======================== */
async function rejectCall(protocol, reason='Recusado pelo suporte'){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) return;
  await ref.update({ status:'rejected', rejectedAt: now(), lastAction: reason });
  setTimeout(()=> ref.remove(), 2500);
}

/* ========================
   Suporte: obter detalhes da chamada
   ======================== */
async function getCallDetails(protocol){
  const snap = await db.ref('calls/'+protocol).get();
  return snap.exists() ? snap.val() : null;
}

/* ======================================================
   ====== WebRTC signaling using Firebase Realtime DB =====
   - We keep a global map window._pcMap to manage connections
   - user side creates offer and writes under /calls/{protocol}/offer
   - support reads offer, creates answer and writes under /calls/{protocol}/answer
   - both push ICE candidates under /calls/{protocol}/candidates/user and /candidates/support
   ====================================================== */

window._pcMap = window._pcMap || {}; // protocol -> RTCPeerConnection container
window._localStreamMap = window._localStreamMap || {}; // protocol -> local MediaStream

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // pode adicionar TURN se tiver
  ]
};

// UTIL: create peer connection and hook events
function createPeerConnection(protocol, role, onRemoteStream, onStats){
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // keep
  window._pcMap[protocol] = pc;

  // remote stream
  const remoteStream = new MediaStream();
  pc.ontrack = (evt) => {
    evt.streams && evt.streams[0] && evt.streams[0].getAudioTracks().length && onRemoteStream(evt.streams[0]);
  };

  // icecandidate -> push to firebase
  pc.onicecandidate = (e)=>{
    if(!e.candidate) return;
    const node = 'calls/'+protocol+'/candidates/'+(role==='user' ? 'user' : 'support');
    db.ref(node).push(e.candidate.toJSON());
  };

  // connection state
  pc.onconnectionstatechange = ()=>{
    // console.log('pc state', protocol, pc.connectionState);
  };

  // periodic stats/ping
  if(onStats){
    let last = Date.now();
    const t = setInterval(async ()=>{
      try{
        // basic ping from DB timestamps
        const pingSnap = await db.ref('calls/'+protocol+'/lastPing').get();
        if(pingSnap.exists()){
          const v = pingSnap.val();
          if(v.support && v.user) onStats(Math.abs(v.support - v.user));
        }
      }catch(e){}
    }, 3000);
    pc._statsInterval = t;
  }

  return pc;
}

/* ========================
   Usuário: inicia oferta (quando cria chamada) e aguarda answer
   - Esta função é chamada automaticamente pelo UI (index.html) quando criar a solicitação
   ======================== */
async function startUserCall(protocol){
  const callRef = db.ref('calls/'+protocol);
  // pegar microfone
  const stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }});
  window._localStreamMap[protocol] = stream;
  const pc = createPeerConnection(protocol, 'user', (remoteStream)=>{
    // tocar audio remoto
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = remoteStream;
    audio.play().catch(()=>{});
  }, (p)=> { /* ping handler user side */ });

  // add tracks
  stream.getTracks().forEach(t=> pc.addTrack(t, stream));

  // create data for candidates
  const candidatesUserRef = db.ref('calls/'+protocol+'/candidates/user');
  // cleanup old candidates
  await db.ref('calls/'+protocol+'/candidates').remove();

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await callRef.update({ offer: offer.toJSON(), lastAction:'offer' });

  // listen for answer
  const ansRef = db.ref('calls/'+protocol+'/answer');
  const ansCb = ansRef.on('value', async snap=>{
    if(!snap.exists()) return;
    const ans = snap.val();
    if(ans && ans.sdp){
      const remoteDesc = new RTCSessionDescription(ans);
      await pc.setRemoteDescription(remoteDesc);
      // mark as in_call
      await callRef.update({ status:'in_call', connectedAt: now() });
    }
  });

  // listen for support candidates
  const supportCandRef = db.ref('calls/'+protocol+'/candidates/support');
  const candCb = supportCandRef.on('child_added', snap=>{
    const c = snap.val();
    if(c){
      try{ pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){ console.warn(e); }
    }
  });

  // handle status changes (ended -> cleanup)
  const statusRef = db.ref('calls/'+protocol+'/status');
  const statusCb = statusRef.on('value', snap=>{
    const v = snap.val();
    if(v === 'ended' || v === 'rejected' || v === 'missed'){
      // cleanup
      try{ pc.close(); }catch(e){}
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      if(window._pcMap[protocol]) delete window._pcMap[protocol];
      if(window._localStreamMap[protocol]) delete window._localStreamMap[protocol];
      statusRef.off('value', statusCb);
      ansRef.off('value', ansCb);
      supportCandRef.off('child_added', candCb);
    }
  });

  return true;
}

/* ========================
   Suporte: quando aceita, cria answer e envia para user
   - startSupportCall faz:
     1) ler offer
     2) criar RTCPeerConnection, setRemoteDescription(offer)
     3) criar answer, setLocalDescription(answer) e escrever em /calls/{protocol}/answer
     4) trocar ICE candidates (listen user candidates and push support candidates)
   ======================== */
async function startSupportCall(protocol, onStats){
  const callRef = db.ref('calls/'+protocol);
  const snap = await callRef.get();
  if(!snap.exists()) throw new Error('Chamada não encontrada');

  const call = snap.val();
  if(!call.offer) throw new Error('Offer não encontrada');

  // pedir permissão de microfone
  const stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }});
  window._localStreamMap[protocol] = stream;

  const pc = createPeerConnection(protocol, 'support', (remoteStream)=>{
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = remoteStream;
    audio.play().catch(()=>{});
  }, onStats);

  // add local audio tracks
  stream.getTracks().forEach(t=> pc.addTrack(t, stream));

  // set offer as remote desc
  const offerDesc = new RTCSessionDescription(call.offer);
  await pc.setRemoteDescription(offerDesc);

  // create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // write answer to DB
  await callRef.update({ answer: answer.toJSON(), status:'in_call', acceptedAt: now(), lastAction:'answer' });

  // listen for user ICE candidates
  const userCandRef = db.ref('calls/'+protocol+'/candidates/user');
  userCandRef.on('child_added', snap=>{
    const c = snap.val();
    if(c){
      try{ pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){ console.warn(e); }
    }
  });

  // push our candidates
  pc.onicecandidate = (e)=>{
    if(!e.candidate) return;
    db.ref('calls/'+protocol+'/candidates/support').push(e.candidate.toJSON());
  };

  // monitor status to cleanup
  const statusRef = db.ref('calls/'+protocol+'/status');
  const statusCb = statusRef.on('value', snap=>{
    const v = snap.val();
    if(v === 'ended' || v === 'rejected' || v === 'missed'){
      try{ pc.close(); }catch(e){}
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      if(window._pcMap[protocol]) delete window._pcMap[protocol];
      if(window._localStreamMap[protocol]) delete window._localStreamMap[protocol];
      statusRef.off('value', statusCb);
      userCandRef.off();
    }
  });

  // also start ping writer for support
  const pingRef = db.ref('calls/'+protocol+'/lastPing');
  const interval = setInterval(()=> pingRef.update({ support: now() }), 5000);

  return true;
}

/* ========================
   Suporte: aceitar fluxo com proteção de concorrência
   ======================== */
async function acceptCall(protocol){
  const ref = db.ref('calls/'+protocol);
  const snap = await ref.get();
  if(!snap.exists()) return false;
  const data = snap.val();
  if(!data || data.status !== 'waiting') return false;

  // transaction to avoid double accept
  const res = await db.ref('calls/'+protocol+'/status').transaction(current=>{
    if(current === 'waiting') return 'accepted';
    return; // abort
  });

  return res.committed;
}

/* ========================
   Listeners util for admin
   ======================== */
function listenActiveCount(onCount){
  const ref = db.ref('calls');
  const cb = ref.on('value', snap=>{
    const v = snap.val();
    let n = 0;
    if(v){
      Object.keys(v).forEach(k=>{
        if(['accepted','in_call'].includes(v[k].status)) n++;
      });
    }
    onCount(n);
  });
  return ()=> ref.off('value', cb);
}

/* ========================
   monitor admin ping global (estimate)
   ======================== */
function monitorAdminPing(onPing){
  // crude: sample last 100 calls lastPing diff
  setInterval(async ()=>{
    const snap = await db.ref('calls').orderByChild('createdAt').limitToLast(50).get();
    if(!snap.exists()) { onPing('—'); return; }
    const v = snap.val();
    const arr = Object.values(v || {});
    let pings = [];
    arr.forEach(item=>{
      if(item.lastPing && item.lastPing.user && item.lastPing.support) {
        pings.push(Math.abs(item.lastPing.user - item.lastPing.support));
      }
    });
    const avg = pings.length ? Math.round(pings.reduce((a,b)=>a+b,0)/pings.length) : '—';
    onPing(avg);
  }, 5000);
}

/* ========================
   Listen waiting calls (wrapper used by admin UI)
   ======================== */
function listenWaitingCalls(onList){
  const ref = db.ref('calls').orderByChild('status').equalTo('waiting');
  const cb = ref.on('value', snap=>{
    const val = snap.val();
    const arr = [];
    if(val) Object.keys(val).forEach(k=> arr.push(val[k]));
    arr.sort((a,b)=>a.createdAt - b.createdAt);
    onList(arr);
  });
  return ()=> ref.off('value', cb);
}

/* ========================
   monitor call details (helper)
   ======================== */
function getCallDetails(protocol){
  return db.ref('calls/'+protocol).get().then(s=> s.exists() ? s.val() : null);
}

/* ========================
   startSupportCall wrapper (ensures accept + start)
   ======================== */
async function startSupportCall(protocol, onStats){
  // try accept
  const ok = await acceptCall(protocol);
  if(!ok) throw new Error('Não foi possível aceitar a chamada (já aceita por outro).');
  return startSupportCallInternal(protocol, onStats);
}
async function startSupportCallInternal(protocol, onStats){
  // internal that actually starts (to avoid name collision)
  // renamed earlier implementation to startSupportCallInternal; keep compatibility
  // We'll call the previously defined startSupportCall logic:
  return startSupportCall_actual(protocol, onStats);
}

// Because of function name duplication earlier, define actual function:
async function startSupportCall_actual(protocol, onStats){
  // delegate to startSupportCall (the previously defined long implementation)
  // The long implementation above is already named startSupportCall, so call it:
  return startSupportCall_real(protocol, onStats);
}

// To avoid confusion, we assign the full implementation to startSupportCall_real earlier;
// but earlier we already defined startSupportCall (full). To ensure correct binding,
// redefine startSupportCall_real to be the implementation we already wrote.

const startSupportCall_real = (async function(protocol, onStats){
  // This function duplicates the full implementation previously defined in this file.
  // To avoid repetition, we invoke the earlier declared startSupportCallImplementation if present.
  // However, to keep the code coherent: we'll call the earlier defined startSupportCallImplementation that we used.
  // Because of possible re-declarations, fallback to a fresh implementation:

  const callRef = db.ref('calls/'+protocol);
  const snap = await callRef.get();
  if(!snap.exists()) throw new Error('Chamada não encontrada');

  const call = snap.val();
  if(!call.offer) throw new Error('Offer não encontrada');

  // pedir permissão de microfone
  const stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true }});
  window._localStreamMap[protocol] = stream;

  const pc = createPeerConnection(protocol, 'support', (remoteStream)=>{
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = remoteStream;
    audio.play().catch(()=>{});
  }, onStats);

  // add local audio tracks
  stream.getTracks().forEach(t=> pc.addTrack(t, stream));

  // set offer as remote desc
  const offerDesc = new RTCSessionDescription(call.offer);
  await pc.setRemoteDescription(offerDesc);

  // create answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // write answer to DB
  await callRef.update({ answer: answer.toJSON(), status:'in_call', acceptedAt: now(), lastAction:'answer' });

  // listen for user ICE candidates
  const userCandRef = db.ref('calls/'+protocol+'/candidates/user');
  userCandRef.on('child_added', snap=>{
    const c = snap.val();
    if(c){
      try{ pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){ console.warn(e); }
    }
  });

  // push our candidates
  pc.onicecandidate = (e)=>{
    if(!e.candidate) return;
    db.ref('calls/'+protocol+'/candidates/support').push(e.candidate.toJSON());
  };

  // monitor status to cleanup
  const statusRef = db.ref('calls/'+protocol+'/status');
  const statusCb = statusRef.on('value', snap=>{
    const v = snap.val();
    if(v === 'ended' || v === 'rejected' || v === 'missed'){
      try{ pc.close(); }catch(e){}
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      if(window._pcMap[protocol]) delete window._pcMap[protocol];
      if(window._localStreamMap[protocol]) delete window._localStreamMap[protocol];
      statusRef.off('value', statusCb);
      userCandRef.off();
    }
  });

  // also start ping writer for support
  const pingRef = db.ref('calls/'+protocol+'/lastPing');
  const interval = setInterval(()=> pingRef.update({ support: now() }), 5000);

  return true;
});

/* ========================
   Monitor ping helper for user UI (wrapper)
   ======================== */
function monitorPing(protocol, cb){
  // user writes user timestamp and reads support timestamp to show ping
  const pingRef = db.ref('calls/'+protocol+'/lastPing');
  const interval = setInterval(()=> {
    pingRef.update({ user: now() }).catch(()=>{});
  }, 5000);
  const listener = pingRef.on('value', snap=>{
    const v = snap.val();
    if(v && v.support && v.user) {
      cb(Math.abs(v.support - v.user));
    }
  });
  return ()=> { clearInterval(interval); pingRef.off('value', listener); };
}

/* ========================
   Small compatibility wrappers (avoid duplicates)
   ======================== */
window.createCallUser = createCallUser;
window.listenCallStatus = listenCallStatus;
window.cancelCall = cancelCall;
window.hangupCall = hangupCall;
window.listenWaitingCalls = listenWaitingCalls;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.getCallDetails = getCallDetails;
window.startSupportCall = startSupportCall_real; // export the real impl
window.startUserCall = startUserCall;
window.monitorPing = monitorPing;
window.listenActiveCount = listenActiveCount;
window.monitorAdminPing = monitorAdminPing;

/* End of script.js */
