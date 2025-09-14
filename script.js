// script.js - compat + WebRTC signaling via Firebase Realtime DB
// Baseado no firebaseConfig que você já forneceu.
// -------------------------------------------------

// ===== Inicialização Firebase (compat) =====
// Substitua/mescle se já tiver em seu script.js
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
function genProtocol(){ // 12 dígitos
  let s=''; for(let i=0;i<12;i++) s += Math.floor(Math.random()*10);
  return s;
}
function now(){ return Date.now(); }

// ICE servers - adicione TURN se tiver
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ===== Estrutura Realtime (sinalização) =====
// /calls/{protocol} => {
//   protocol, nomeCompleto, cpf, createdAt, status: 'waiting'|'in_call'|'ended'|'not_answered'|'canceled',
//   offer? / answer? / iceCandidates/{id}
//   heartbeatCitizenAt, heartbeatSupportAt
// }

// ===== Funções principais para o cidadão (widget) =====
async function iniciarChamadaCidadao({nomeCompleto, cpf}){
  // validações simples
  const cpfNum = onlyDigits(cpf);
  if(!cpfNum) throw new Error('CPF inválido');

  // Verifica se já existe uma chamada ativa para esse CPF
  const existing = await db.ref('calls_by_cpf/'+cpfNum+'/active').get();
  if(existing.exists() && existing.val()){
    throw new Error('Já existe uma solicitação ativa para este CPF.');
  }

  // cria protocolo
  const protocol = genProtocol();
  const callRef = db.ref('calls/'+protocol);

  const createdAt = now();
  const callData = {
    protocol,
    nomeCompleto,
    cpf: cpfNum,
    createdAt,
    status: 'waiting',
    citizenConnected: false,
    heartbeatCitizenAt: createdAt,
    lastPingMs: null
  };

  await callRef.set(callData);
  // index por cpf para impedir nova chamada
  await db.ref('calls_by_cpf/'+cpfNum).set({ active: true, protocol, createdAt });

  // criar objeto de controle da chamada
  const session = createCitizenSession(protocol, callRef, cpfNum);
  // cria notificação em DB para admin (ecosistema de push pode ler isso)
  await db.ref('notifications/'+protocol).set({ type:'incoming_call', protocol, createdAt, nomeCompleto, cpf:cpfNum });
  return session;
}

// cria a sessão do cidadão — retorna { protocol, cancel(), hangup(), onStatus(fn), onPing(fn) }
function createCitizenSession(protocol, callRef, cpfNum){
  let pc = null;
  let localStream = null;
  let statusCb = ()=>{};
  let pingCb = ()=>{};
  let remoteStream = null;
  let inCall = false;
  let opened = true;
  let heartbeatInt = null;
  let pingStart = null;

  // Atualiza heartbeat do cidadão
  function startHeartbeat(){
    heartbeatInt = setInterval(()=>{ callRef.child('heartbeatCitizenAt').set(now()); }, 5000);
  }
  function stopHeartbeat(){ if(heartbeatInt){ clearInterval(heartbeatInt); heartbeatInt=null; } }

  // Escuta mudanças de status
  const statusListener = callRef.on('value', async snap=>{
    const val = snap.val();
    if(!val) return;
    const st = val.status;
    statusCb(st);
    if(st === 'in_call' && !inCall){
      // admin aceitou — trocaremos SDP
      inCall = true;
      // join como peer: criar pc, enviar offer? — modelo: citizen cria offer or waits?
      // Vamos fazer: citizen cria offer e administrador responde com answer.
      await startPeerAsCaller(callRef);
    }else if(st === 'ended' || st === 'canceled' || st === 'not_answered'){
      // encerrar localmente
      await cleanup();
    }
  });

  // Monitor de timeout: se passar 10 minutos sem atendimento => marcar como not_answered
  const timeoutCheck = setInterval(async ()=>{
    const snap = await callRef.get();
    const v = snap.val();
    if(!v) return;
    const diff = now() - (v.createdAt || 0);
    if(v.status === 'waiting' && diff > (10*60*1000)){
      await callRef.update({ status:'not_answered', endedAt: now() });
      // liberar index por cpf
      await db.ref('calls_by_cpf/'+cpfNum).set({ active:false });
    }
  }, 30*1000);

  // startPeerAsCaller: cria PeerConnection e envia offer
  async function startPeerAsCaller(callRef){
    // já criou?
    if(pc) return;
    pc = new RTCPeerConnection(ICE_CONFIG);
    pc.onicecandidate = (e)=>{
      if(e.candidate) callRef.child('offerCandidates').push(JSON.stringify(e.candidate));
    };
    pc.ontrack = (ev)=>{
      // apenas áudio para reprodução
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.srcObject = ev.streams[0];
      // anexar à DOM invisível (ou deixar reproduzir)
      document.body.appendChild(audioEl);
      remoteStream = ev.streams[0];
    };

    try{
      localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
    }catch(e){
      console.error('Permissão microfone negada', e);
      throw e;
    }

    // adicionar tracks
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await callRef.child('offer').set(JSON.stringify(offer));
    // enviar heartbeat
    startHeartbeat();

    // escutar answer
    callRef.child('answer').on('value', async snap=>{
      if(!snap.exists()) return;
      const ans = JSON.parse(snap.val());
      await pc.setRemoteDescription(new RTCSessionDescription(ans));
    });
    // escutar candidate do admin
    callRef.child('answerCandidates').on('child_added', snap=>{
      const candidate = JSON.parse(snap.val());
      pc.addIceCandidate(candidate).catch(console.error);
    });

    // monitor ping simples: medimos tempo entre setOffer e confirmação de answer
    pingStart = Date.now();
    // Quando setRemoteDescription acontece, mediremos ping
    const originalSetRemote = pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription = async function(desc){
      const result = await originalSetRemote(desc);
      if(pingStart){
        const ms = Date.now() - pingStart;
        // atualiza lastPingMs
        callRef.child('lastPingMs').set(ms);
        pingCb(ms);
        pingStart = null;
      }
      return result;
    };
  }

  async function cancel(){
    // cancela antes de atendimento
    await callRef.update({ status:'canceled', endedAt: now() });
    await db.ref('calls_by_cpf/'+cpfNum).set({ active:false });
    await cleanup();
  }

  async function hangup(){
    await callRef.update({ status:'ended', endedAt: now() });
    await db.ref('calls_by_cpf/'+cpfNum).set({ active:false });
    await cleanup();
  }

  async function cleanup(){
    opened = false;
    stopHeartbeat();
    if(pc){ try{ pc.close(); }catch(e){} pc=null; }
    if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
    if(heartbeatInt) { clearInterval(heartbeatInt); heartbeatInt=null; }
    try{ callRef.off(); }catch(e){}
    try{ // remove call node after short delay to ensure admin cleaned state (policy: calls não ficam salvas)
      await callRef.remove();
    }catch(e){}
    clearInterval(timeoutCheck);
  }

  function onStatus(fn){ statusCb = fn; }
  function onPing(fn){ pingCb = fn; }

  return { protocol, cancel, hangup, onStatus, onPing };
}

// ===== Funções admin (painel) =====
// listarChamadasAtivas(cb) => callback com lista de chamadas
function listarChamadasAtivas(cb){
  // pega as chamadas com status waiting ordenadas por createdAt
  db.ref('calls').orderByChild('createdAt').limitToLast(50).get().then(snap=>{
    const out = [];
    snap.forEach(ch=>{
      const v = ch.val();
      if(v && (v.status === 'waiting' || v.status === 'in_call')){
        const ageMin = Math.floor((now()- (v.createdAt||0))/60000);
        out.push({ protocol: v.protocol, nomeCompleto: v.nomeCompleto, cpf: v.cpf, createdAt: v.createdAt, status: v.status, ageMin });
      }
    });
    // ordenar ascending por createdAt
    out.sort((a,b)=>a.createdAt - b.createdAt);
    cb(out);
  });
}

// subscribeChamadasRealtime(cb) => chama cb quando algo muda
function subscribeChamadasRealtime(cb){
  db.ref('calls').on('value', snap=>{
    cb();
  });
}

// recusarChamada(protocol)
async function recusarChamada(protocol){
  const ref = db.ref('calls/'+protocol);
  await ref.update({ status:'canceled', endedAt: now() });
  // liberar index cpf
  const snap = await ref.get();
  const v = snap.val();
  if(v && v.cpf) await db.ref('calls_by_cpf/'+v.cpf).set({ active:false });
  // remove
  setTimeout(()=>ref.remove().catch(()=>{}), 1500);
}

// iniciarSessaoAdmin(protocol, hooks) => retorna promise que resolve com session object
function iniciarSessaoAdmin(protocol, hooks){
  // hooks: { onInfo(info), onLog(text), onStatus(status), onPing(ms) }
  return new Promise(async (resolve, reject)=>{
    const callRef = db.ref('calls/'+protocol);
    const snap = await callRef.get();
    if(!snap.exists()) return reject(new Error('Chamada não encontrada'));
    const info = snap.val();
    if(info.status !== 'waiting') return reject(new Error('Chamada já não está aguardando'));
    // atualizar status para ringing (opcional)
    await callRef.update({ status:'ringing', supportSeenAt: now() });

    hooks.onInfo && hooks.onInfo(info);

    // criar sessão admin: esperar offer, enviar answer
    let pc = new RTCPeerConnection(ICE_CONFIG);
    let localStream = null;
    let answerCandidatesRef = callRef.child('answerCandidates');
    let offerCandidatesRef = callRef.child('offerCandidates');

    pc.onicecandidate = (e)=>{
      if(e.candidate) answerCandidatesRef.push(JSON.stringify(e.candidate));
    };
    pc.ontrack = (ev)=>{
      // admin pode receber audio? In our design citizen sends audio, admin receives
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.srcObject = ev.streams[0];
      document.body.appendChild(audioEl);
    };

    // obter microfone do suporte
    try{
      localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
    }catch(e){
      hooks.onLog && hooks.onLog('Permissão microfone negada: '+e.message);
      return reject(new Error('Permissão microfone negada'));
    }

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // escutar offer
    const offerSnap = await callRef.child('offer').get();
    if(!offerSnap.exists()) return reject(new Error('Offer não encontrada'));
    const offer = JSON.parse(offerSnap.val());
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await callRef.child('answer').set(JSON.stringify(answer));

    // escutar candidatos de offer (citizen)
    offerCandidatesRef.on('child_added', snap=>{
      const candidate = JSON.parse(snap.val());
      pc.addIceCandidate(candidate).catch(console.error);
    });

    // marcar status in_call
    await callRef.update({ status:'in_call', supportAcceptedAt: now() });
    hooks.onStatus && hooks.onStatus('in_call');

    // heartbeat support
    const hbInt = setInterval(()=>{ callRef.child('heartbeatSupportAt').set(now()); }, 5000);

    // monitor ping: ler lastPingMs
    const pingRef = callRef.child('lastPingMs');
    pingRef.on('value', s=>{
      const ms = s.exists() ? s.val() : null;
      if(ms !== null) hooks.onPing && hooks.onPing(ms);
    });

    // logs
    hooks.onLog && hooks.onLog('Chamada aceita. Conversa iniciada.');

    // session object para admin UI
    const session = {
      protocol,
      answer: async ()=>{
        // já está respondida; função mantida para UI (operacional, answer já configurado)
        hooks.onLog && hooks.onLog('Atendimento em andamento...');
      },
      decline: async ()=>{
        await callRef.update({ status:'canceled', endedAt: now() });
        // limpa
        try{ clearInterval(hbInt); }catch(e){}
        try{ pc.close(); }catch(e){}
        await db.ref('calls_by_cpf/'+ (info.cpf||'') ).set({ active:false });
        hooks.onStatus && hooks.onStatus('ended');
      },
      hangup: async ()=>{
        await callRef.update({ status:'ended', endedAt: now() });
        try{ clearInterval(hbInt); }catch(e){}
        try{ pc.close(); }catch(e){}
        await db.ref('calls_by_cpf/'+ (info.cpf||'') ).set({ active:false });
        hooks.onStatus && hooks.onStatus('ended');
        // remover registro
        setTimeout(()=>callRef.remove().catch(()=>{}), 1500);
      },
      onInfo: hooks.onInfo,
      onLog: hooks.onLog,
      onStatus: hooks.onStatus,
      onPing: hooks.onPing
    };

    // ouvir se citizen terminou
    callRef.on('value', snap=>{
      const v = snap.val();
      if(!v) return;
      if(v.status === 'ended' || v.status === 'canceled' || v.status === 'not_answered'){
        // encerrar pc
        try{ pc.close(); }catch(e){}
        try{ clearInterval(hbInt); }catch(e){}
        hooks.onStatus && hooks.onStatus(v.status);
        // remover call node
        setTimeout(()=>callRef.remove().catch(()=>{}), 1500);
      }
    });

    resolve(session);
  });
}

// ===== Hooks utilitários para UI (expostos globalmente) =====
window.iniciarChamadaCidadao = iniciarChamadaCidadao;
window.listarChamadasAtivas = listarChamadasAtivas;
window.subscribeChamadasRealtime = subscribeChamadasRealtime;
window.recusarChamada = recusarChamada;
window.iniciarSessaoAdmin = iniciarSessaoAdmin;

// ===== Ping / conexão geral (ping simples) =====
// função auxiliar para medir latência via salvar timestamp e ler diferença
async function measurePing(protocol){
  const ref = db.ref('calls/'+protocol+'/lastPingMs');
  const start = Date.now();
  await ref.set(0);
  // small delay to allow answer set by other side — but here we just compute locally.
  const ms = Date.now() - start;
  await ref.set(ms);
  return ms;
}
window.measurePing = measurePing;

// ===== Cleanup on unload =====
window.addEventListener('beforeunload', ()=>{ /* opcional: limpar nós temporários */ });

