// script.js (completo - mantenha o header compat firebase que você já usa)

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

// ===== Util (preservadas) =====
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

// ===== Cadastro com CPF único =====
async function registrarCidadao(perfil, senha){
  const cpfNum = onlyDigits(perfil.cpf);
  const refIdx = db.ref('cpf_to_uid/'+cpfNum);
  const uidReservado = await refIdx.transaction(current=>{
    if(current === null){ return 'PENDING'; } // reserva
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

/* =========================
   CHAMADAS / WEBRTC (NOVAS)
   - sinalização via RTDB: /calls/rooms/{roomId} e /calls/requests/{protocol}
   - protege duplicidade por /calls/active_by_cpf/{cpf}
   - estados em requests: aguardando, atendido, recusado, desligado, nao_atendido, cancelado
   ========================= */

async function createCallRequest(nome, cpf){
  const proto = (function(){
    const digits = '0123456789'; let s='';
    for(let i=0;i<12;i++) s+=digits[Math.floor(Math.random()*10)];
    return s;
  })();
  const now = Date.now();
  const cpfDigits = onlyDigits(cpf);
  // check duplication
  const active = await db.ref('calls/active_by_cpf/'+cpfDigits).get();
  if(active.exists()){
    throw new Error('Já existe uma chamada ativa para este CPF.');
  }
  const req = {
    protocol: proto,
    nome,
    cpf: cpfDigits,
    estado: 'aguardando',
    criadoEm: now,
    lastPing: now,
    deviceHint: navigator.userAgent || 'web',
    notifyIcon: null
  };
  await db.ref('calls/requests/'+proto).set(req);
  await db.ref('calls/active_by_cpf/'+cpfDigits).set(proto);
  return proto;
}

async function cancelCallRequest(protocol){
  const snap = await db.ref('calls/requests/'+protocol).get();
  if(!snap.exists()) return;
  const cpf = snap.val().cpf;
  await db.ref('calls/requests/'+protocol+'/estado').set('cancelado');
  if(cpf) await db.ref('calls/active_by_cpf/'+cpf).remove();
  await db.ref('calls/rooms/'+('room-'+protocol)).remove().catch(()=>{});
  await db.ref('calls/requests/'+protocol).remove().catch(()=>{});
}

async function markNotAnswered(protocol){
  await db.ref('calls/requests/'+protocol+'/estado').set('nao_atendido');
  const cpf = (await db.ref('calls/requests/'+protocol+'/cpf').get()).val();
  if(cpf) await db.ref('calls/active_by_cpf/'+cpf).remove();
  await db.ref('calls/requests/'+protocol).remove().catch(()=>{});
}

// helper to remove after end
async function clearCall(protocol){
  const snap = await db.ref('calls/requests/'+protocol).get();
  if(!snap.exists()) return;
  const cpf = snap.val().cpf;
  if(cpf) await db.ref('calls/active_by_cpf/'+cpf).remove();
  const roomId = snap.val().roomId;
  if(roomId) await db.ref('calls/rooms/'+roomId).remove().catch(()=>{});
  await db.ref('calls/requests/'+protocol).remove().catch(()=>{});
}

// utility for server-side like timeouts: you can also run cron or cloud function. But client sets a timeout on creation
function startAutoTimeoutFor(protocol, ms=10*60*1000){
  setTimeout(async ()=>{
    const snap = await db.ref('calls/requests/'+protocol+'/estado').get();
    if(snap.exists() && snap.val() === 'aguardando'){
      await markNotAnswered(protocol);
    }
  }, ms);
}

/* =========================
   Signaling helpers (room creation)
   ========================= */

async function createRoomForSupport(protocol){
  const roomId = 'room-'+protocol;
  await db.ref('calls/rooms/'+roomId).set({createdBy:'support', createdAt:Date.now()});
  await db.ref('calls/requests/'+protocol+'/roomId').set(roomId);
  await db.ref('calls/requests/'+protocol+'/estado').set('atendido');
  return roomId;
}

/* =========================
   Small helpers for ping / connection quality
   ========================= */
function clientStartPing(protocol){
  const ref = db.ref('calls/requests/'+protocol+'/lastPing');
  const id = setInterval(()=> ref.set(Date.now()), 5000);
  return ()=> clearInterval(id);
}

/* =========================
   Export functions so pages can call them if needed
   ========================= */
window.calls = {
  createCallRequest,
  cancelCallRequest,
  startAutoTimeoutFor,
  createRoomForSupport,
  clearCall,
  markNotAnswered,
  clientStartPing
};
