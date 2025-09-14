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

// ===== PUSH NOTIFICATIONS =====
let messaging;
try {
  messaging = firebase.messaging();
} catch(e) {
  console.warn("Push não disponível neste ambiente.");
}

// Registrar Service Worker para notificações
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
  .then(reg => {
    console.log('Service Worker registrado:', reg);
  })
  .catch(err => console.error('Erro ao registrar SW:', err));
}

async function solicitarPermissaoPush(uid){
  if (!messaging) return;
  try {
    const token = await messaging.getToken({
      vapidKey: "BOM_COLOCAR_SUA_VAPID_KEY_AQUI" // 🔑 coloque sua chave pública aqui
    });
    if (token) {
      await db.ref('fcmTokens/'+uid).set(token);
    }
  } catch (err) {
    console.error("Erro ao obter token de notificação:", err);
  }
}

// Receber notificações foreground
if (messaging) {
  messaging.onMessage(payload => {
    console.log("Mensagem recebida em foreground:", payload);
    const { title, body, icon } = payload.notification;
    new Notification(title, {
      body,
      icon: icon || "/icone.png" // 🔔 local reservado para imagem
    });
  });
}

// ===== Função disparo de notificação =====
async function enviarNotificacaoPara(uidDestino, titulo, mensagem, icone="/icone.png"){
  const snap = await db.ref('fcmTokens/'+uidDestino).get();
  if (!snap.exists()) return;

  const token = snap.val();
  // Aqui normalmente você usaria Cloud Functions para enviar via FCM HTTP v1
  // Exemplo: fetch para endpoint do Firebase Cloud Messaging
  // Por simplicidade, deixo o local preparado
  console.log("Enviar push para:", token, titulo, mensagem);
}
