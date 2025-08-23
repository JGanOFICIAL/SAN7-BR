protegerPagina();

const listaUbs=document.getElementById("listaUbs");
const btnNova=document.getElementById("btnNova");
const overlayUbs=document.getElementById("overlayUbs");
const overlaySolic=document.getElementById("overlaySolic");
const btnSalvarUbs=document.getElementById("btnSalvarUbs");

let editId=null;

// Abrir modal cadastro
btnNova.onclick=()=>{
  editId=null;
  document.getElementById("tituloUbs").textContent="Cadastrar UBS";
  overlayUbs.style.display="flex";
  limparCampos();
};
btnSalvarUbs.onclick=salvarUbs;

function fecharModal(id){document.getElementById(id).style.display="none";}
function limparCampos(){
  ["ubsNome","ubsLocal","ubsHorarioManha","ubsHorarioTarde","ubsFichasManha","ubsFichasTarde","ubsServicos"]
  .forEach(id=>document.getElementById(id).value="");
}

function salvarUbs(){
  const dados={
    nome:document.getElementById("ubsNome").value,
    localizacao:document.getElementById("ubsLocal").value,
    horarios:{manha:document.getElementById("ubsHorarioManha").value,tarde:document.getElementById("ubsHorarioTarde").value},
    fichas:{manha:+document.getElementById("ubsFichasManha").value,tarde:+document.getElementById("ubsFichasTarde").value},
    servicos:document.getElementById("ubsServicos").value.split(",").map(s=>({nome:s.trim()})).filter(s=>s.nome)
  };
  if(editId){
    firebase.database().ref("ubs/"+editId).set(dados);
  }else{
    firebase.database().ref("ubs").push(dados);
  }
  fecharModal("overlayUbs");
}

// Listar UBSs
firebase.database().ref("ubs").on("value",snap=>{
  listaUbs.innerHTML="";
  snap.forEach(c=>{
    const u=c.val();
    const div=document.createElement("div");
    div.className="ubs";
    div.innerHTML=`<h3>${u.nome}</h3>
      <div>${u.localizacao}</div>
      <div>Manhã: ${u.horarios?.manha} (${u.fichas?.manha} fichas) | Tarde: ${u.horarios?.tarde} (${u.fichas?.tarde} fichas)</div>
      <div>Serviços: ${(u.servicos||[]).map(s=>s.nome).join(", ")}</div>
      <div class="acoes">
        <button class="btn btn-sec btn-mini" onclick="abrirSolic('${c.key}')">Ver solicitações</button>
        <button class="btn btn-sec btn-mini" onclick="editarUbs('${c.key}')">✎ Editar</button>
        <button class="btn btn-sec btn-mini" onclick="excluirUbs('${c.key}')">🗑 Excluir</button>
      </div>`;
    listaUbs.appendChild(div);
  });
});

function editarUbs(id){
  editId=id;
  document.getElementById("tituloUbs").textContent="Editar UBS";
  firebase.database().ref("ubs/"+id).once("value").then(snap=>{
    const u=snap.val();
    document.getElementById("ubsNome").value=u.nome||"";
    document.getElementById("ubsLocal").value=u.localizacao||"";
    document.getElementById("ubsHorarioManha").value=u.horarios?.manha||"";
    document.getElementById("ubsHorarioTarde").value=u.horarios?.tarde||"";
    document.getElementById("ubsFichasManha").value=u.fichas?.manha||0;
    document.getElementById("ubsFichasTarde").value=u.fichas?.tarde||0;
    document.getElementById("ubsServicos").value=(u.servicos||[]).map(s=>s.nome).join(", ");
    overlayUbs.style.display="flex";
  });
}
function excluirUbs(id){if(confirm("Excluir UBS?")) firebase.database().ref("ubs/"+id).remove();}

// Solicitações
function abrirSolic(ubsId){
  overlaySolic.style.display="flex";
  const lista=document.getElementById("listaSolic");
  const busca=document.getElementById("buscaSolic");
  firebase.database().ref("agendamentos/"+ubsId).on("value",snap=>{
    lista.innerHTML="";
    snap.forEach(dia=>{
      dia.forEach(turno=>{
        turno.forEach(serv=>{
          serv.forEach(sol=>{
            const s=sol.val();
            const div=document.createElement("div");
            div.className="solic";
            div.innerHTML=`<strong>${s.dia} — ${s.servico}</strong><br>
              Paciente: ${s.uid}<br>
              Protocolo: #${s.protocolo}<br>
              Série: ${s.serie}<br>
              Turno: ${s.turno}<br>
              Status: ${s.status}
              <div class="acoes">
                <button class="btn btn-sec btn-mini" onclick="atendido('${ubsId}','${dia.key}','${turno.key}','${serv.key}','${sol.key}', '${s.uid}')">✔ Atendido</button>
                <button class="btn btn-sec btn-mini" onclick="excluirSolic('${ubsId}','${dia.key}','${turno.key}','${serv.key}','${sol.key}')">🗑 Excluir</button>
              </div>`;
            lista.appendChild(div);
          });
        });
      });
    });
  });
  busca.oninput=()=>{
    [...lista.children].forEach(div=>{
      div.style.display=div.textContent.toLowerCase().includes(busca.value.toLowerCase())?"block":"none";
    });
  };
}

function excluirSolic(ubs,dia,turno,serv,solId){
  if(confirm("Excluir solicitação?"))
    firebase.database().ref(`agendamentos/${ubs}/${dia}/${turno}/${serv}/${solId}`).remove();
}

async function atendido(ubs,dia,turno,serv,solId,uid){
  if(!confirm("Confirmar atendimento?")) return;
  const ref=firebase.database().ref(`agendamentos/${ubs}/${dia}/${turno}/${serv}/${solId}`);
  const snap=await ref.once("value");
  const dados=snap.val();
  dados.status="concluído";
  await firebase.database().ref(`usuarios/${uid}/extrato`).push(dados);
  await ref.remove();
}
