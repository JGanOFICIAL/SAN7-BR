// script.js
// ========= Básico Firebase (compat) e suas funções já existentes (preservadas + pequenas integrações) =========

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
  const res = await refIdx.transaction(current=>{
    if(current === null){ return 'PENDING'; }
    return;
  }, undefined, false);
  if(!res.committed){
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

// =====================================================================================
// ================================ LAYER: CALLS (WebRTC via Realtime DB) ==============
// =====================================================================================

/**
Structure in DB (calls):
/calls/{protocol}: {
  protocol, nomeCompleto, cpf, status: waiting|in_call|ended|rejected|cancelled|no_answer,
  createdAt, startedAt, callerDeviceId, offer?, answer?, heartbeat:{client:ts, support:ts}, ping:{...}
}
Candidates:
 /callCandidates/{protocol}/{role}/{autoId} = {candidate, type, sdpMid, sdpMLineIndex}
*/

const Calls = (function(){
  // config
  const CALLS_NODE = 'calls';
  const CAND_NODE = 'callCandidates';
  const WAITING_INDEX = 'waiting_index';

  // local runtime
  let clientPc = null;
  let adminPc = null;
  let localStream = null;
  let remoteStream = null;
  let localRole = null; // 'client' or 'support'
  let currentProtocol = null;
  let listeners = {};
  let waitingCallback = null;
  let waitingRef = db.ref(CALLS_NODE);

  // helper to generate 12-digit protocol
  function generateProtocol(){
    let s = '';
    for(let i=0;i<12;i++) s += String(Math.floor(Math.random()*10));
    return s;
  }

  // prevent multiple calls from same CPF/device
  async function hasActiveCallForCpf(cpfDigits){
    const snap = await db.ref(CALLS_NODE).orderByChild('cpfDigits').equalTo(cpfDigits).get();
    if(!snap.exists()) return false;
    const data = snap.val();
    for(const k in data){
      const st = data[k].status;
      if(st==='waiting' || st==='in_call') return true;
    }
    return false;
  }

  // create call (client)
  async function createCall({nomeCompleto, cpf}){
    const cpfDigits = onlyDigits(cpf);
    // check duplicates
    const already = await hasActiveCallForCpf(cpfDigits);
    if(already) throw {message:'Já existe uma solicitação ativa para esse CPF no momento.'};
    // generate protocol
    const protocol = generateProtocol();
    const now = Date.now();
    const deviceId = (navigator.userAgent || '') + '|' + Math.random().toString(36).slice(2,8);
    const payload = {
      protocol,
      nomeCompleto,
      cpf,
      cpfDigits,
      status: 'waiting',
      createdAt: now,
      callerDeviceId: deviceId,
      // placeholders for signaling
      offer: null,
      answer: null,
      startedAt: null,
      heartbeat: {},
    };
    await db.ref(`${CALLS_NODE}/${protocol}`).set(payload);

    // set up listener for status changes
    listenCall(protocol, (data)=>{
      // show browser notification for certain transitions
      if(data && data.status && data.status === 'in_call'){
        if(window.Notification && Notification.permission === "granted"){
          new Notification(`Atendimento iniciado - protocolo ${protocol}`, {body:`${data.nomeCompleto}`});
        }
      }else if(data && data.status && data.status === 'rejected'){
        if(window.Notification && Notification.permission === "granted"){
          new Notification(`Atendimento recusado - protocolo ${protocol}`);
        }
      }
    });

    // schedule "not answered" after 10min if still waiting
    setTimeout(async ()=>{
      const snap = await db.ref(`${CALLS_NODE}/${protocol}/status`).get();
      if(snap.exists() && snap.val()==='waiting'){
        await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'no_answer', finishedAt:Date.now()});
        // keep short trace then remove after 10s
        setTimeout(()=> db.ref(`${CALLS_NODE}/${protocol}`).remove(), 10000);
      }
    }, 10*60*1000);

    // heartbeats (client)
    startHeartbeat(protocol,'client');

    return {protocol, status:'waiting'};
  }

  // listen single call updates
  function listenCall(protocol, cb){
    const ref = db.ref(`${CALLS_NODE}/${protocol}`);
    const onValue = ref.on('value', snap=>{
      const val = snap.exists() ? snap.val() : null;
      cb(val);
      // if ended -> cleanup
      if(val === null) {
        ref.off();
      }
    });
    return () => ref.off('value', onValue);
  }

  // fetch single call (once)
  async function getCall(protocol){
    const snap = await db.ref(`${CALLS_NODE}/${protocol}`).get();
    return snap.exists() ? snap.val() : null;
  }

  // cancel call (before answered) - by client
  async function cancelCall(protocol, reason='cancelled'){
    await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'cancelled', finishedAt:Date.now(), reason});
    // remove after short delay
    setTimeout(()=> db.ref(`${CALLS_NODE}/${protocol}`).remove(), 4000);
  }

  // reject call (support)
  async function rejectCall(protocol){
    await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'rejected', finishedAt:Date.now()});
    setTimeout(()=> db.ref(`${CALLS_NODE}/${protocol}`).remove(), 4000);
  }

  // end call (either side)
  async function endCall(protocol, reason='ended'){
    // set status -> will trigger cleanup
    await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'ended', finishedAt:Date.now(), reason});
    // close peer connections & streams
    cleanupRTC();
    // remove after short time
    setTimeout(()=> db.ref(`${CALLS_NODE}/${protocol}`).remove(), 6000);
  }

  // fetch waiting calls list snapshot
  async function fetchWaiting(){
    const snap = await db.ref(CALLS_NODE).orderByChild('status').equalTo('waiting').get();
    if(!snap.exists()) return [];
    const arr = Object.values(snap.val());
    // sort by createdAt
    arr.sort((a,b)=>a.createdAt - b.createdAt);
    return arr;
  }

  // listen waiting calls live
  function listenWaiting(cb){
    waitingCallback = cb;
    const ref = db.ref(CALLS_NODE);
    ref.on('value', snap=>{
      const list = [];
      if(snap.exists()){
        const all = snap.val();
        for(const id in all){
          const item = all[id];
          if(item.status === 'waiting') list.push(item);
        }
      }
      list.sort((a,b)=>a.createdAt - b.createdAt);
      if(waitingCallback) waitingCallback(list);
      // show Notification for new calls
      if(window.Notification && Notification.permission === "granted"){
        // naive: notify when list length increases (could be improved)
      }
    });
  }

  // ============ WebRTC signaling helpers =============
  function candidatesRef(protocol, role){
    return db.ref(`${CAND_NODE}/${protocol}/${role}`);
  }

  async function pushCandidate(protocol, role, candidate){
    await candidatesRef(protocol, role).push(candidate.toJSON());
  }

  // set up candidate listeners for a role
  function listenCandidates(protocol, role, onCandidate){
    const other = role === 'client' ? 'support' : 'client';
    const ref = candidatesRef(protocol, other);
    ref.on('child_added', snap=>{
      const cand = snap.val();
      if(!cand) return;
      try{
        onCandidate(new RTCIceCandidate(cand));
      }catch(e){
        console.warn('candidate parse fail', e);
      }
    });
    return ()=> ref.off();
  }

  // heartbeat for ping / connectivity
  function startHeartbeat(protocol, role){
    const hbRef = db.ref(`${CALLS_NODE}/${protocol}/heartbeat/${role}`);
    const tick = ()=> hbRef.set(Date.now());
    tick();
    const iv = setInterval(tick, 3000);
    // return stop function
    return ()=> clearInterval(iv);
  }

  // ========== CLIENT-SIDE (cidadão) — responde offer with answer ==========
  async function clientListenForOfferAndAnswer(protocol){
    currentProtocol = protocol;
    localRole = 'client';
    // subscribe to call node
    const callRef = db.ref(`${CALLS_NODE}/${protocol}`);
    callRef.on('value', async snap=>{
      const data = snap.exists()?snap.val():null;
      if(!data) return;
      // if there's an offer and we haven't created PC yet -> answer
      if(data.offer && !data.answer && (!clientPc)){
        try{
          await createClientPeerAndAnswer(protocol, data.offer);
        }catch(e){
          console.error('Fail answer', e);
        }
      }
      // if support set to in_call -> start timers etc
      if(data.status === 'in_call'){
        // launched by admin when accepted
      }
      if(['ended','cancelled','rejected','no_answer'].includes(data.status)){
        // cleanup local
        cleanupRTC();
        // remove listener
        callRef.off();
      }
    });
  }

  // create client peer, set remote offer, create answer, push answer & candidates
  async function createClientPeerAndAnswer(protocol, offer){
    clientPc = new RTCPeerConnection();
    remoteStream = new MediaStream();

    // get user audio
    try{
      localStream = await navigator.mediaDevices.getUserMedia({audio:true});
    }catch(e){
      console.error('mic denied',e);
      throw e;
    }

    localStream.getTracks().forEach(track => clientPc.addTrack(track, localStream));

    // when remote track arrives
    clientPc.ontrack = (ev)=>{
      ev.streams.forEach(s => {
        remoteStream = s;
      });
    };

    clientPc.onicecandidate = (ev)=>{
      if(ev.candidate){
        pushCandidate(protocol,'client', ev.candidate).catch(console.error);
      }
    };

    // set remote and create answer
    await clientPc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await clientPc.createAnswer();
    await clientPc.setLocalDescription(answer);

    // push answer
    await db.ref(`${CALLS_NODE}/${protocol}/answer`).set(clientPc.localDescription.toJSON());
    // update status -> support will detect
    await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'in_call', startedAt:Date.now()});
    // start listening other candidates
    listenCandidates(protocol,'client',(cand)=> clientPc.addIceCandidate(cand).catch(()=>{}));
    // heartbeat
    startHeartbeat(protocol,'client');
  }

  // ========== ADMIN-SIDE (support) — create offer ==========
  async function adminAccept(protocol, supportStream, onUpdateCb){
    currentProtocol = protocol;
    localRole = 'support';
    // attach local stream
    localStream = supportStream;
    // create peer
    adminPc = new RTCPeerConnection();
    remoteStream = new MediaStream();

    // add local tracks
    localStream.getTracks().forEach(t => adminPc.addTrack(t, localStream));

    adminPc.ontrack = (ev)=> {
      ev.streams.forEach(s => remoteStream = s);
    };

    adminPc.onicecandidate = (ev)=>{
      if(ev.candidate){
        pushCandidate(protocol,'support', ev.candidate).catch(console.error);
      }
    };

    // create offer
    const offer = await adminPc.createOffer();
    await adminPc.setLocalDescription(offer);

    // store offer in DB
    await db.ref(`${CALLS_NODE}/${protocol}/offer`).set(adminPc.localDescription.toJSON());
    // listen for answer
    const answerRef = db.ref(`${CALLS_NODE}/${protocol}/answer`);
    const answerListener = answerRef.on('value', async snap=>{
      if(!snap.exists()) return;
      const answer = snap.val();
      if(answer && adminPc){
        await adminPc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    // listen for candidates from client
    listenCandidates(protocol,'support',(cand)=> adminPc.addIceCandidate(cand).catch(()=>{}));

    // set status to in_call once answer arrived is handled above.
    // also make sure call status becomes in_call (client sets it, but admin can set fallback)
    await db.ref(`${CALLS_NODE}/${protocol}`).update({status:'in_call', startedAt:Date.now()});

    // subscribe to call changes to update admin UI
    const ref = db.ref(`${CALLS_NODE}/${protocol}`);
    ref.on('value', snap=>{
      const val = snap.exists()?snap.val():null;
      if(onUpdateCb) onUpdateCb(val);
      if(!val) ref.off();
    });

    // start heartbeat
    startHeartbeat(protocol,'support');

    // expose remote stream via getter
    return;
  }

  function getRemoteStream(){ return remoteStream; }

  // cleanup RTC state
  function cleanupRTC(){
    try{
      if(clientPc){ clientPc.close(); clientPc = null; }
      if(adminPc){ adminPc.close(); adminPc = null; }
      if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null;}
      remoteStream = null;
      currentProtocol = null;
      localRole = null;
    }catch(e){ console.warn('cleanup fail', e); }
  }

  // ===================================================================
  // Expose API
  // ===================================================================

  return {
    // call management
    createCall,
    cancelCall,
    rejectCall,
    endCall,
    getCall,
    listenCall,
    fetchWaiting,
    listenWaiting,
    // rtc admin actions
    adminAccept,
    // streaming helpers
    getRemoteStream,
  };
})();

// expose global
window.Calls = Calls;

// ===================================================================
// Small util: ask permission for Notification API
// ===================================================================
if(window.Notification && Notification.permission !== "granted" && Notification.permission !== "denied"){
  Notification.requestPermission().then(()=>{ /* ok */ });
}

// ===================================================================
// Optional: small ping monitor (global) - reports to console and DB (keeps UI informed)
// ===================================================================
// This can be expanded; currently heartbeats are created per-call by Calls.startHeartbeat.

// End of script.js
