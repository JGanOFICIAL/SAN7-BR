// Protege página
protegerPagina();

const listaUbs = document.getElementById("listaUbs");
const areaDias = document.getElementById("areaDias");
const areaServicos = document.getElementById("areaServicos");
const diasDiv = document.getElementById("dias");
const selectServico = document.getElementById("selectServico");
const selectTurno = document.getElementById("selectTurno");
const qtdFichas = document.getElementById("qtdFichas");
const btnSolicitar = document.getElementById("btnSolicitar");

// Feriados de João Câmara/RN (exemplo simplificado)
const feriados = ["2025-01-01","2025-04-18","2025-04-21","2025-05-01","2025-09-07","2025-10-12","2025-11-02","2025-11-15","2025-12-25"];

let ubsSelecionada = null;
let diaSelecionado = null;

// Carrega UBSs do Firebase
firebase.database().ref("ubs").on("value", snap=>{
  listaUbs.innerHTML = "";
  snap.forEach(child=>{
    const u = child.val();
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = u.nome + " — " + u.localizacao;
    div.onclick = ()=>selecionarUbs(child.key, u);
    listaUbs.appendChild(div);
  });
});

function selecionarUbs(id, ubs){
  ubsSelecionada = {id, ...ubs};
  areaDias.style.display="block";
  areaServicos.style.display="none";
  gerarDiasDisponiveis(ubs);
}

function gerarDiasDisponiveis(ubs){
  diasDiv.innerHTML = "";
  const hoje = new Date();
  for(let i=0;i<15;i++){
    const d = new Date(hoje);
    d.setDate(d.getDate()+i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    const iso = `${yyyy}-${mm}-${dd}`;
    const semana = d.getDay();
    const btn = document.createElement("div");
    btn.className="dia";
    btn.textContent = dd+"/"+mm;
    if(semana==0||semana==6||feriados.includes(iso)){
      btn.classList.add("bloq");
    }else{
      btn.classList.add("disp");
      btn.onclick=()=>selecionarDia(iso);
    }
    diasDiv.appendChild(btn);
  }
}

function selecionarDia(iso){
  diaSelecionado = iso;
  areaServicos.style.display="block";
  // Carrega serviços
  selectServico.innerHTML="";
  if(ubsSelecionada.servicos){
    ubsSelecionada.servicos.forEach(s=>{
      const opt=document.createElement("option");
      opt.value=s.nome;
      opt.textContent=s.nome;
      selectServico.appendChild(opt);
    });
  }
  atualizarFichas();
}

function atualizarFichas(){
  if(!diaSelecionado||!ubsSelecionada) return;
  const turno = selectTurno.value;
  const serv = selectServico.value;
  firebase.database().ref(`agendamentos/${ubsSelecionada.id}/${diaSelecionado}/${turno}/${serv}`)
    .on("value", snap=>{
      const usados = snap.numChildren();
      const limite = ubsSelecionada.fichas?.[turno] || 0;
      qtdFichas.textContent = `${limite-usados} de ${limite}`;
    });
}
selectTurno.onchange = atualizarFichas;
selectServico.onchange = atualizarFichas;

// Solicitar
btnSolicitar.onclick = async ()=>{
  const user = firebase.auth().currentUser;
  if(!user) return;
  const serv = selectServico.value;
  const turno = selectTurno.value;
  const protocolo = gerarProtocolo();
  const serie = gerarSerie();
  const dados = {
    uid:user.uid,servico:serv,turno,dia:diaSelecionado,
    ubs:ubsSelecionada.nome,protocolo,serie,status:"pendente",
    timestamp:Date.now()
  };
  await firebase.database().ref(`agendamentos/${ubsSelecionada.id}/${diaSelecionado}/${turno}/${serv}`).push(dados);
  await firebase.database().ref(`usuarios/${user.uid}/extrato`).push(dados);
  mostrarComprovante(dados);
};

function mostrarComprovante(d){
  document.getElementById("overlayComp").style.display="flex";
  document.getElementById("comprovante").innerHTML=`
    <div><strong>UBS:</strong> ${d.ubs}</div>
    <div><strong>Data:</strong> ${d.dia}</div>
    <div><strong>Turno:</strong> ${d.turno}</div>
    <div><strong>Serviço:</strong> ${d.servico}</div>
    <div><strong>Protocolo:</strong> #${d.protocolo}</div>
    <div><strong>Série:</strong> ${d.serie}</div>
    <div><em>Status:</em> ${d.status}</div>
  `;
}

// Extrato
document.getElementById("btnExtrato").onclick=()=>{
  document.getElementById("overlayExtrato").style.display="flex";
  const user=firebase.auth().currentUser;
  firebase.database().ref(`usuarios/${user.uid}/extrato`).on("value",snap=>{
    const list=document.getElementById("listaExtrato");
    list.innerHTML="";
    snap.forEach(c=>{
      const d=c.val();
      const div=document.createElement("div");
      div.className="comprovante";
      div.innerHTML=`<strong>${d.dia} — ${d.servico}</strong><br>
      UBS: ${d.ubs}<br>Turno: ${d.turno}<br>Protocolo: #${d.protocolo}<br>Série: ${d.serie}<br>Status: ${d.status}`;
      list.appendChild(div);
    });
  });
};

// Helpers
function gerarProtocolo(){
  return Math.random().toString(36).substring(2,10).toUpperCase();
}
function gerarSerie(){
  return Math.floor(1000+Math.random()*9000)+"-"+Math.random().toString(36).substring(2,10).toUpperCase();
}
