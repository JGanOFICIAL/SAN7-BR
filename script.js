// ====================== script.js ======================
// Mantive todas as funções que você havia fornecido (e acrescentei módulos WebRTC abaixo)
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

// ================= WebRTC / Call management module =================
//
// Usamos Realtime Database para sinalização em /calls/{protocol}
// Estrutura mínima:
// calls/{protocol} = {
//   protocol, nome, cpf, status: 'waiting'|'accepted'|'ended'|'nao_atendido'|'canceled', createdAt, acceptedAt, adminId, adminName, callerPing, adminPing
// }
// calls/{protocol}/offer
// calls/{protocol}/answer
// calls/{protocol}/callerIce (child nodes push)
// calls/{protocol}/adminIce (child nodes push)
// active_by_cpf/{cpf} = {protocol, createdAt}  <-- bloqueia duplicados
//
// Regras:
// - caller cria o nó e escreve status 'waiting'
// - admin aceita -> escreve status 'accepted' + adminId/adminName + acceptedAt
// - sinalização por offer/answer e ICE arrays
// - se não atendido em 10 minutos -> status 'nao_atendido'
// - ao encerrar/recusar -> status 'ended'|'rejected'/'canceled' e removemos nós
// - chamadas atendidas não ficam salvas permanentemente (remoção ao encerrar)

async function cleanupCallNode(protocol){
  try{
    await db.ref('calls/' + protocol).remove();
    // cleanup any active_by_cpf referencing it
    const snap = await db.ref('active_by_cpf').get();
    if(snap.exists()){
      snap.forEach(child=>{
        const v = child.val();
        if(v && v.protocol === protocol) child.ref.set(null);
      });
    }
  }catch(e){
    console.warn('Erro ao limpar nó da chamada', e);
  }
}

// Observações:
// - O widget/admin HTML implementa a lógica de inicialização de getUserMedia e RTCPeerConnection.
// - Esse script.js fornece utilitários e a configuração do banco (já inicializada).
// - As rotinas específicas de criação/offer/answer são executadas nos próprios componentes client (veja códigos das páginas).

// ==================== Fim do script.js ====================
