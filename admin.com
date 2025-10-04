<!-- admin.html -->
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  
  <title>Administração - Academia</title>
  <style>
    :root{
      --verde:#8FD19E;
      --preto:#000;
      --cinza:#f2f2f2;
      --branco:#fff;
      --radius:12px;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial;
    }
    *{box-sizing:border-box}
    body{margin:0;background:#fafafa;color:#333}
    header{background:var(--preto);color:var(--branco);height:72px;display:flex;align-items:center;padding:0 20px;justify-content:space-between}
    header img{height:48px;border-radius:8px;background:#fff}
    header button{background:transparent;border:0;color:#fff;cursor:pointer;font-size:15px}

    main{padding:20px;max-width:1200px;margin:auto}
    h1{font-size:20px}

    .form-card{background:#fff;border-radius:var(--radius);padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-bottom:24px}
    .form-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}
    .form-row label{flex:1;display:flex;flex-direction:column;font-size:14px}
    .form-row input, .form-row select{height:44px;border:1px solid #ddd;border-radius:var(--radius);padding:0 10px;font-size:15px}
    button.primary{background:linear-gradient(90deg,var(--verde),#6fcf8f);border:0;border-radius:999px;height:44px;padding:0 20px;cursor:pointer;font-weight:600}

    .table-card{background:#fff;border-radius:var(--radius);padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.1)}
    .search{margin-bottom:12px}
    .search input{width:100%;height:44px;border:1px solid #ddd;border-radius:var(--radius);padding:0 12px}

    table{width:100%;border-collapse:collapse}
    th,td{padding:10px;text-align:left;font-size:14px;border-bottom:1px solid #eee}
    tr.alerta{background:#ffeaea}
    .actions button{margin-right:6px;padding:6px 10px;border-radius:8px;border:0;cursor:pointer}
    .actions .info{background:#eef}
    .actions .presenca{background:#efe}
    .actions .excluir{background:#fee}

    .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:50}
    .modal{background:#fff;border-radius:var(--radius);padding:20px;max-width:720px;width:100%;max-height:90vh;overflow:auto}
    .modal h3{margin-top:0}
    .modal .close{float:right;border:0;background:transparent;cursor:pointer;font-size:18px}

    .toast{position:fixed;top:20px;right:20px;background:#111;color:#fff;padding:10px 14px;border-radius:8px;display:none;z-index:100}

    @media(max-width:720px){
      .form-row{flex-direction:column}
      .actions button{margin-bottom:4px}
    }
  </style>
</head>
<body>
  <header>
    <div class="logo"><img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEieDkDEd8V0agIvU0-l68tHaDR4X4g9grql7OgrCIrEyGFfJbJkSRGP4ISG-zLOXj-svxS1bQfl-2NuR1T4Lb7FzfFf5hScBg2Hd10mLgMwftTX9GhVWyl1s9pNoQ7ovvMlg0LwVKeHOSVTN0KhKtWV5wgY1tMC9g87qSdCQF1m-8UIxxE-MiNWqyLMty0/s765/D9CA10E4-3834-4477-9C61-1FF2283D9A0D.jpeg" alt="Logo"></div>
    <button id="btnLogout"></button>
  </header>

  <main>
    <h1>Cadastro de Alunos</h1>
    <section class="form-card">
      <form id="formCadastro">
        <div class="form-row">
          <label>Nome<input type="text" id="nome" required></label>
          <label>CPF<input type="text" id="cpf" required maxlength="14"></label>
        </div>
        <div class="form-row">
          <label>Início do Plano<input type="date" id="planoInicio" required></label>
          <label>Fim do Plano<input type="date" id="planoFim" required></label>
        </div>
        <div class="form-row">
          <label>Valor<input type="text" id="valor"></label>
          <label>Forma de Pagamento
            <select id="forma">
              <option value="dinheiro">Dinheiro</option>
              <option value="cartao">Cartão</option>
              <option value="pix">Pix</option>
              <option value="transferencia">Transferência</option>
            </select>
          </label>
        </div>
        <button class="primary" type="submit">Cadastrar Aluno</button>
      </form>
    </section>

    <section class="table-card">
      <div class="search"><input type="text" id="busca" placeholder="Buscar por matrícula, nome ou CPF"></div>
      <table>
        <thead>
          <tr><th>Matrícula</th><th>Nome</th><th>CPF</th><th>Plano</th><th>Dias Restantes</th><th>Ações</th></tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
    </section>
  </main>

  <!-- Modal Info -->
  <div class="modal-backdrop" id="modalInfo">
    <div class="modal">
      <button class="close" onclick="document.getElementById('modalInfo').style.display='none'">✕</button>
      <h3 id="infoNome">Aluno</h3>
      <p><b>Matrícula:</b> <span id="infoMatricula"></span></p>
      <p><b>CPF:</b> <span id="infoCpf"></span></p>
      <p><b>Plano:</b> <span id="infoPlano"></span></p>

      <h4>Renovar / Editar</h4>
      <form id="formEdita">
        <input type="hidden" id="editMatricula">
        <div class="form-row">
          <label>Início<input type="date" id="editInicio"></label>
          <label>Fim<input type="date" id="editFim"></label>
        </div>
        <div class="form-row">
          <label>Valor<input type="text" id="editValor"></label>
          <label>Forma<select id="editForma">
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
            <option value="pix">Pix</option>
            <option value="transferencia">Transferência</option>
          </select></label>
        </div>
        <button class="primary" type="submit">Salvar</button>
      </form>

      <h4>Histórico</h4>
      <div id="infoHistorico"></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
    import { getDatabase, ref, set, push, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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

    const formCadastro = document.getElementById('formCadastro');
    const tbody = document.getElementById('tbody');
    const busca = document.getElementById('busca');
    const toast = document.getElementById('toast');

    function showToast(msg, ok=true){
      toast.textContent = msg;
      toast.style.background = ok ? 'rgba(24,144,0,0.95)' : 'rgba(204,40,40,0.95)';
      toast.style.display = 'block';
      setTimeout(()=>toast.style.display='none',2000);
    }

    function gerarMatricula(){
      return Math.floor(100000 + Math.random()*900000).toString();
    }

    // CPF mask
    const cpfInput = document.getElementById('cpf');
    cpfInput.addEventListener('input', ()=>{
      let v = cpfInput.value.replace(/\D/g,'');
      if(v.length>11) v=v.slice(0,11);
      v = v.replace(/(\d{3})(\d)/,'$1.$2')
           .replace(/(\d{3})(\d)/,'$1.$2')
           .replace(/(\d{3})(\d{1,2})$/,'$1-$2');
      cpfInput.value = v;
    });

    formCadastro.addEventListener('submit', async e=>{
      e.preventDefault();
      const matricula = gerarMatricula();
      const nome = document.getElementById('nome').value;
      const cpf = document.getElementById('cpf').value;
      const planoInicio = document.getElementById('planoInicio').value;
      const planoFim = document.getElementById('planoFim').value;
      const valor = document.getElementById('valor').value;
      const forma = document.getElementById('forma').value;

      try{
        await set(ref(db,'alunos/'+matricula), {nome,cpf,planoInicio,planoFim});
        await set(push(ref(db,'pagamentos/'+matricula)), {valor,forma,data:planoInicio,timestamp:Date.now(),descricao:"Cadastro"});
        await set(push(ref(db,'historico/'+matricula)), {timestamp:Date.now(),tipo:"cadastro",descricao:`Plano ${planoInicio} → ${planoFim}`});
        showToast('Aluno cadastrado!');
        formCadastro.reset();
      }catch(err){
        console.error(err);
        showToast('Erro no cadastro',false);
      }
    });

    function diasRestantes(fim){
      if(!fim) return null;
      const d = new Date(fim);
      const hoje = new Date();
      const diff = Math.floor((d - hoje)/(1000*60*60*24));
      return diff;
    }

    function renderTabela(snapshot){
      const alunos = snapshot.val()||{};
      tbody.innerHTML='';
      Object.keys(alunos).forEach(mat=>{
        const a=alunos[mat];
        const dias=diasRestantes(a.planoFim);
        const tr=document.createElement('tr');
        if(dias!==null && dias<=5) tr.classList.add('alerta');
        tr.innerHTML=`<td>${mat}</td><td>${a.nome}</td><td>${a.cpf}</td>
          <td>${a.planoInicio||''} → ${a.planoFim||''}</td>
          <td>${dias!==null?dias:'—'}</td>
          <td class="actions">
            <button class="info" data-mat="${mat}">Info</button>
            <button class="presenca" data-mat="${mat}">Presença</button>
            <button class="excluir" data-mat="${mat}">Excluir</button>
          </td>`;
        tbody.appendChild(tr);
      });
    }

    onValue(ref(db,'alunos'), renderTabela);

    // busca em tempo real
    busca.addEventListener('input', async ()=>{
      const q = busca.value.toLowerCase();
      const snap=await get(ref(db,'alunos'));
      const alunos=snap.val()||{};
      tbody.innerHTML='';
      Object.keys(alunos).forEach(mat=>{
        const a=alunos[mat];
        if(mat.includes(q)||a.nome.toLowerCase().includes(q)|| (a.cpf||'').includes(q)){
          const dias=diasRestantes(a.planoFim);
          const tr=document.createElement('tr');
          if(dias!==null && dias<=5) tr.classList.add('alerta');
          tr.innerHTML=`<td>${mat}</td><td>${a.nome}</td><td>${a.cpf}</td>
            <td>${a.planoInicio||''} → ${a.planoFim||''}</td>
            <td>${dias!==null?dias:'—'}</td>
            <td class="actions">
              <button class="info" data-mat="${mat}">Info</button>
              <button class="presenca" data-mat="${mat}">Presença</button>
              <button class="excluir" data-mat="${mat}">Excluir</button>
            </td>`;
          tbody.appendChild(tr);
        }
      });
    });

    // Delegar botões da tabela
    tbody.addEventListener('click', async e=>{
      const btn=e.target;
      if(btn.dataset.mat){
        const mat=btn.dataset.mat;
        if(btn.classList.contains('info')) abrirInfo(mat);
        if(btn.classList.contains('presenca')) registrarPresenca(mat);
        if(btn.classList.contains('excluir')) excluirAluno(mat);
      }
    });

    async function abrirInfo(mat){
      const snap=await get(ref(db,'alunos/'+mat));
      if(!snap.exists()) return;
      const a=snap.val();
      document.getElementById('infoNome').textContent=a.nome;
      document.getElementById('infoMatricula').textContent=mat;
      document.getElementById('infoCpf').textContent=a.cpf;
      document.getElementById('infoPlano').textContent=`${a.planoInicio} → ${a.planoFim}`;
      document.getElementById('editMatricula').value=mat;
      document.getElementById('editInicio').value=a.planoInicio||'';
      document.getElementById('editFim').value=a.planoFim||'';

      // carregar histórico
      const pres=await get(ref(db,'presencas/'+mat));
      const pays=await get(ref(db,'pagamentos/'+mat));
      let html='';
      if(pres.exists()){
        html+='<h5>Presenças:</h5>';
        Object.values(pres.val()).forEach(p=>{
          const d=new Date(p.timestamp||Date.now());
          html+=`<div>${d.toLocaleString()}</div>`;
        });
      }
      if(pays.exists()){
        html+='<h5>Pagamentos:</h5>';
        Object.values(pays.val()).forEach(p=>{
          const d=new Date(p.timestamp||Date.now());
          html+=`<div>${d.toLocaleDateString()} - R$${p.valor||''} (${p.forma||''})</div>`;
        });
      }
      document.getElementById('infoHistorico').innerHTML=html||'<i>Nada registrado</i>';

      document.getElementById('modalInfo').style.display='flex';
    }

    document.getElementById('formEdita').addEventListener('submit', async e=>{
      e.preventDefault();
      const mat=document.getElementById('editMatricula').value;
      const inicio=document.getElementById('editInicio').value;
      const fim=document.getElementById('editFim').value;
      const valor=document.getElementById('editValor').value;
      const forma=document.getElementById('editForma').value;
      try{
        await update(ref(db,'alunos/'+mat),{planoInicio:inicio,planoFim:fim});
        await set(push(ref(db,'pagamentos/'+mat)),{valor,forma,data:inicio,timestamp:Date.now(),descricao:"Renovação"});
        await set(push(ref(db,'historico/'+mat)),{timestamp:Date.now(),tipo:"renovacao",descricao:`Plano ${inicio} → ${fim}`});
        showToast('Plano renovado!');
        document.getElementById('modalInfo').style.display='none';
      }catch(err){console.error(err);showToast('Erro',false);}
    });

        async function excluirAluno(mat){
      if(!confirm('Excluir aluno '+mat+'?')) return;
      try{
        await remove(ref(db,'alunos/'+mat));
        await remove(ref(db,'pagamentos/'+mat));
        await remove(ref(db,'presencas/'+mat));
        await remove(ref(db,'historico/'+mat));
        showToast('Aluno excluído');
      }catch(e){
        console.error(e);
        showToast('Erro ao excluir',false);
      }
    }

    // Botão logout
    document.getElementById('btnLogout').addEventListener('click', ()=>{
      // Aqui você pode limpar o localStorage ou redirecionar para login.html
      window.location.href="login.html";
    });
  </script>
</body>
</html>

<!-- script para incorporar em outros sites (notificação de validação) -->
<div id="notificacao-validacao" style="position:fixed;top:25px;right:25px;z-index:9999;display:none;padding:14px 18px;border-radius:8px;font-weight:500;color:#fff;background:#111;box-shadow:0 4px 12px rgba(0,0,0,.3);"></div>

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase, ref, onChildAdded } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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

const box = document.getElementById("notificacao-validacao");

function mostrarNotificacao(msg, ok=true){
  box.textContent = msg;
  box.style.background = ok ? 'rgba(24,144,0,0.95)' : 'rgba(204,40,40,0.95)';
  box.style.display = "block";
  setTimeout(()=>{ box.style.display="none"; },1000);
}

onChildAdded(ref(db,'logsValidacao'),snap=>{
  const data = snap.val();
  if(data && data.nome && data.matricula){
    mostrarNotificacao(`${data.nome} (${data.matricula}) - ${data.status}`, data.status==="Aprovado");
  }
});
</script>
