// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBs2GrFPGib7Nz02F03Eeo5DTW-8OTJmFI",
  authDomain: "san7-2b351.firebaseapp.com",
  databaseURL: "https://san7-2b351-default-rtdb.firebaseio.com",
  projectId: "san7-2b351",
  storageBucket: " san7-2b351.appspot.com",
  messagingSenderId: "511547914036",
  appId: "1:511547914036:web:0595e39aef88258c649761"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const saldoEl = document.getElementById('saldo');
let saldo = 0;

// Atualizar saldo
function atualizarSaldo(valor) {
  saldo += valor;
  saldoEl.textContent = `Saldo: R$ ${saldo.toFixed(2)}`;
}

// Abrir/Fechar Modal de Cadastro
document.getElementById('abrirCadastroBtn').onclick = () => {
  document.getElementById('cadastroForm').style.display = 'block';
};
document.getElementById('fecharCadastro').onclick = () => {
  document.getElementById('cadastroForm').style.display = 'none';
};

// Abrir/Fechar Modal de Venda
const vendaModal = document.getElementById('vendaModal');
const vendaProdutoNome = document.getElementById('vendaProdutoNome');
let produtoSelecionadoId = null;

document.getElementById('fecharVenda').onclick = () => {
  vendaModal.style.display = 'none';
};

// Adicionar Produto
document.getElementById('adicionarBtn').onclick = () => {
  const nome = document.getElementById('nome').value.trim();
  const marca = document.getElementById('marca').value.trim();
  const quantidade = parseInt(document.getElementById('quantidade').value);
  const precoVista = parseFloat(document.getElementById('precoVista').value);
  const precoCartao = parseFloat(document.getElementById('precoCartao').value);

  if (nome && marca && quantidade && precoVista && precoCartao) {
    const novoProduto = {
      nome, marca, quantidade, precoVista, precoCartao
    };
    db.ref('produtos').push(novoProduto);
    document.getElementById('cadastroForm').style.display = 'none';
    limparFormulario();
  } else {
    alert('Preencha todos os campos!');
  }
};

// Carregar Produtos
function carregarProdutos() {
  db.ref('produtos').on('value', snapshot => {
    const produtosTable = document.getElementById('produtosTable');
    produtosTable.innerHTML = '';
    snapshot.forEach(child => {
      const produto = child.val();
      const id = child.key;
      const tr = document.createElement('tr');
      if (produto.quantidade <= 5) tr.classList.add('quantidade-baixa');
      tr.innerHTML = `
        <td>${produto.nome}</td>
        <td>${produto.marca}</td>
        <td>${produto.quantidade}</td>
        <td>R$ ${produto.precoVista.toFixed(2)}</td>
        <td>R$ ${produto.precoCartao.toFixed(2)}</td>
        <td>
          <button onclick="abrirVenda('${id}', '${produto.nome}')">Vender</button>
          <button onclick="editarQuantidade('${id}', ${produto.quantidade})">✎</button>
          <button onclick="excluirProduto('${id}')">Excluir</button>
        </td>
      `;
      produtosTable.appendChild(tr);
    });
  });
}
carregarProdutos();

// Vender Produto
function abrirVenda(id, nome) {
  produtoSelecionadoId = id;
  vendaProdutoNome.textContent = `Produto: ${nome}`;
  vendaModal.style.display = 'block';
}

document.getElementById('confirmarVendaBtn').onclick = () => {
  const tipoVenda = document.querySelector('input[name="tipoVenda"]:checked').value;
  const quantidadeVenda = parseInt(document.getElementById('quantidadeVenda').value);

  if (produtoSelecionadoId && quantidadeVenda > 0) {
    const produtoRef = db.ref(`produtos/${produtoSelecionadoId}`);
    produtoRef.once('value').then(snapshot => {
      const produto = snapshot.val();
      if (produto.quantidade >= quantidadeVenda) {
        produto.quantidade -= quantidadeVenda;
        produtoRef.update({ quantidade: produto.quantidade });
        const valor = tipoVenda === 'avista' ? produto.precoVista * quantidadeVenda : produto.precoCartao * quantidadeVenda;
        atualizarSaldo(valor);
        vendaModal.style.display = 'none';
      } else {
        alert('Estoque insuficiente.');
      }
    });
  } else {
    alert('Informe a quantidade.');
  }
};

// Editar Quantidade
function editarQuantidade(id, quantidadeAtual) {
  const novaQuantidade = prompt('Nova quantidade:', quantidadeAtual);
  if (novaQuantidade !== null) {
    const produtoRef = db.ref(`produtos/${id}`);
    produtoRef.update({ quantidade: parseInt(novaQuantidade) });
  }
}

// Excluir Produto
function excluirProduto(id) {
  if (confirm('Deseja excluir este produto?')) {
    db.ref(`produtos/${id}`).remove();
  }
}

// Limpar Formulário
function limparFormulario() {
  document.getElementById('nome').value = '';
  document.getElementById('marca').value = '';
  document.getElementById('quantidade').value = '';
  document.getElementById('precoVista').value = '';
  document.getElementById('precoCartao').value = '';
}

// Pesquisa de Produtos
document.getElementById('pesquisaInput').addEventListener('input', e => {
  const termo = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#produtosTable tr');
  rows.forEach(row => {
    const nome = row.children[0].textContent.toLowerCase();
    if (nome.startsWith(termo)) {
      row.style.fontSize = '1.5rem';
      row.style.backgroundColor = '#e0e0e0';
    } else {
      row.style.fontSize = '1.2rem';
      row.style.backgroundColor = '';
    }
  });
});

// Finalizar Dia
document.getElementById('finalizarDiaBtn').onclick = () => {
  window.location.href = 'historico.html';
};
