// script.js - Configurações do Firebase e funções globais

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCVdKIP6jl-mLaqHNMW-IwK3pVkvHuSvSI",
    databaseURL: "https://san7-brasil-default-rtdb.firebaseio.com",
    projectId: "san7-brasil",
    authDomain: "san7-brasil.firebaseapp.com"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Funções globais de utilidade
function gerarProtocolo() {
    const ano = new Date().getFullYear();
    const random = Math.floor(Math.random() * 90000000) + 10000000;
    return `${random}-${ano}`;
}

function formatarCNPJ(cnpj) {
    return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/g, '$1.$2.$3/$4-$5');
}

function mostrarCarregamento(elemento, ativo = true) {
    if (ativo) {
        elemento.classList.add('loading');
        elemento.disabled = true;
    } else {
        elemento.classList.remove('loading');
        elemento.disabled = false;
    }
}

function mostrarNotificacao(titulo, mensagem, tipo = 'info') {
    const notificacao = document.createElement('div');
    notificacao.className = `notificacao-popup ${tipo}`;
    notificacao.innerHTML = `
        <div class="notificacao-header">
            <h4>${titulo}</h4>
            <button class="fechar-notificacao"><i class="fas fa-times"></i></button>
        </div>
        <div class="notificacao-body">
            <p>${mensagem}</p>
        </div>
    `;
    document.body.appendChild(notificacao);
    
    setTimeout(() => {
        notificacao.classList.add('show');
    }, 100);
    
    notificacao.querySelector('.fechar-notificacao').addEventListener('click', () => {
        notificacao.classList.remove('show');
        setTimeout(() => notificacao.remove(), 300);
    });
}

// Função para buscar municípios em tempo real
function buscarMunicipios(termo, callback) {
    const municipiosRef = database.ref('municipios');
    municipiosRef.once('value', (snapshot) => {
        const municipios = [];
        snapshot.forEach((childSnapshot) => {
            const municipio = childSnapshot.val();
            const nome = municipio.nome.toLowerCase();
            const termoLower = termo.toLowerCase();
            
            if (nome.includes(termoLower) || 
                nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(termoLower)) {
                municipios.push({
                    id: childSnapshot.key,
                    ...municipio
                });
            }
        });
        callback(municipios);
    });
}