<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Validação - Academia</title>
  <style>
    :root{
      --verde:#8FD19E;
      --preto:#000;
      --cinza:#f2f2f2;
      --branco:#fff;
      --radius:12px;
      font-family: Inter, Arial, sans-serif;
    }
    body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#f0f0f0}
    header{position:absolute;top:0;left:0;right:0;height:70px;background:var(--preto);display:flex;align-items:center;padding:0 20px;color:#fff}
    header img{height:50px;border-radius:8px;background:#fff}
    .card{background:#fff;padding:20px;border-radius:var(--radius);box-shadow:0 4px 12px rgba(0,0,0,.1);width:90%;max-width:400px;text-align:center}
    input{width:100%;height:50px;font-size:20px;margin-bottom:15px;border:1px solid #ddd;border-radius:var(--radius);padding:0 10px;text-align:center}
    button{width:100%;height:50px;border:0;border-radius:var(--radius);font-size:18px;font-weight:bold;background:linear-gradient(90deg,var(--verde),#6fcf8f);cursor:pointer}
    #status{margin-top:15px;font-size:16px;font-weight:600}
    .toast{position:fixed;top:20px;right:20px;background:#111;color:#fff;padding:10px 14px;border-radius:8px;display:none;z-index:100}
  </style>
</head>
<body>
  <header><img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEieDkDEd8V0agIvU0-l68tHaDR4X4g9grql7OgrCIrEyGFfJbJkSRGP4ISG-zLOXj-svxS1bQfl-2NuR1T4Lb7FzfFf5hScBg2Hd10mLgMwftTX9GhVWyl1s9pNoQ7ovvMlg0LwVKeHOSVTN0KhKtWV5wgY1tMC9g87qSdCQF1m-8UIxxE-MiNWqyLMty0/s765/D9CA10E4-3834-4477-9C61-1FF2283D9A0D.jpeg" alt="Logo"></header>
  <div class="card">
    <h2>Digite sua Matrícula</h2>
    <input type="text" id="matricula" maxlength="6" placeholder="000000">
    <button id="btnValidar">Validar</button>
    <div id="status"></div>
  </div>
  <div class="toast" id="toast"></div>

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase, ref, get, push, set } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPiznHCVkTAgx6m02bZB8b0FFaot9UkBU",
  authDomain: "prefeitura-de-joao-camara.firebaseapp.com",
  projectId: "prefeitura-de-joao-camara",
  storageBucket: "prefeitura-de-joao-camara.firebasestorage.app",
  messagingSenderId: "269299041577",
  appId: "1:269299041577:web:fd41b2939240e9eb476338",
  measurementId: "G-YT7NHR342J"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const btn = document.getElementById('btnValidar');
const statusDiv = document.getElementById('status');
const toast = document.getElementById('toast');

function showToast(msg, ok=true){
  toast.textContent = msg;
  toast.style.background = ok ? 'rgba(24,144,0,0.95)' : 'rgba(204,40,40,0.95)';
  toast.style.display = 'block';
  setTimeout(()=>toast.style.display='none',2000);
}

function diasRestantes(fim){
  if(!fim) return -999;
  const d = new Date(fim);
  const hoje = new Date();
  return Math.floor((d - hoje)/(1000*60*60*24));
}

btn.addEventListener('click', async ()=>{
  const mat = document.getElementById('matricula').value.trim();
  if(mat.length!==6){ showToast('Matrícula inválida',false); return; }
  statusDiv.textContent="Validando...";
  try{
    const snap = await get(ref(db,'alunos/'+mat));
    if(!snap.exists()){ statusDiv.textContent="Não encontrado"; showToast('Aluno não encontrado',false); return; }
    const a = snap.val();
    const dias = diasRestantes(a.planoFim);
    if(dias>=0 || dias>=-3){
      await set(push(ref(db,'presencas/'+mat)),{timestamp:Date.now()});
      statusDiv.textContent=`Bem-vindo, ${a.nome}!`;
      showToast('Presença registrada');
      setTimeout(()=>{statusDiv.textContent='';document.getElementById('matricula').value='';},2000);
    }else{
      statusDiv.textContent="Plano vencido!";
      showToast('Plano vencido',false);
    }
  }catch(e){
    console.error(e);
    statusDiv.textContent="Erro";
    showToast('Erro de conexão',false);
  }
});
</script>
</body>
</html>