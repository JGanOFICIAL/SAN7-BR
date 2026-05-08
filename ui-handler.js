
function showLoginForm() {
    document.getElementById('dynamicContent').innerHTML = `
        <div class="form-container">
            <h2>Acessar Biblioteca</h2>
            <div class="form-group">
                <label>E-mail</label>
                <input type="email" id="loginEmail" placeholder="seu@email.com">
            </div>
            <div class="form-group">
                <label>Senha</label>
                <input type="password" id="loginPassword" placeholder="Digite sua senha">
            </div>
            <button class="btn" onclick="doLogin()">Entrar</button>
            <button class="btn btn-secondary" onclick="showRegisterForm()">Criar Conta</button>
        </div>
    `;
}

function showRegisterForm() {
    document.getElementById('dynamicContent').innerHTML = `
        <div class="form-container">
            <h2>Criar Conta</h2>
            <div class="form-group">
                <label>Nome Completo</label>
                <input type="text" id="regName" placeholder="Seu nome completo">
            </div>
            <div class="form-group">
                <label>E-mail</label>
                <input type="email" id="regEmail" placeholder="seu@email.com">
            </div>
            <div class="form-group">
                <label>Telefone</label>
                <input type="tel" id="regPhone" placeholder="(84) 99999-9999">
            </div>
            <div class="form-group">
                <label>Senha</label>
                <input type="password" id="regPassword" placeholder="Digite sua senha">
            </div>
            <button class="btn" onclick="doRegister()">Cadastrar</button>
            <button class="btn btn-secondary" onclick="showLoginForm()">Voltar ao Login</button>
        </div>
    `;
}

function showReceipt(userData) {
    document.getElementById('dynamicContent').innerHTML = `
        <div class="form-container">
            <h2>Comprovante de Cadastro</h2>
            <div class="receipt">
                <div class="receipt-line"><strong>Nome:</strong> ${userData.name}</div>
                <div class="receipt-line"><strong>E-mail:</strong> ${userData.email}</div>
                <div class="receipt-line"><strong>Telefone:</strong> ${userData.phone}</div>
                <div class="receipt-line"><strong>Data:</strong> ${new Date().toLocaleString()}</div>
            </div>
            <button class="btn btn-secondary" onclick="showLoginForm()">Voltar ao Login</button>
        </div>
    `;
}

function showAcervos() {
    database.ref('acervos').once('value', (snapshot) => {
        const acervos = [];
        snapshot.forEach((child) => {
            acervos.push({id: child.key, ...child.val()});
        });
        
        document.getElementById('dynamicContent').innerHTML = `
            <h2 class="section-title">Acervos Disponíveis</h2>
            <div class="acervos-grid" id="acervosGrid">
                ${acervos.map(acervo => `
                    <div class="acervo-card">
                        <img src="${acervo.imageUrl || 'https://via.placeholder.com/300x150?text=Acervo'}" class="acervo-image" onerror="this.src='https://via.placeholder.com/300x150?text=Acervo'">
                        <div class="acervo-content">
                            <h3 class="acervo-title">${acervo.name}</h3>
                            <p class="acervo-description">${acervo.description || ''}</p>
                            <a href="${acervo.link}" target="_blank" class="btn acervo-btn">Acessar Acervo</a>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${acervos.length === 0 ? '<p class="empty-message">Nenhum acervo cadastrado no momento.</p>' : ''}
        `;
    });
}

function showPublishInfo() {
    document.getElementById('dynamicContent').innerHTML = `
        <div class="form-container">
            <h2>Publicar um Livro</h2>
            <div class="receipt">
                <p>Para publicar seu livro em nossa biblioteca virtual, siga as instruções abaixo:</p>
                <br>
                <p>Envie seu livro para o e-mail: <strong>biblioteca@joaocamara.rn.gov.br</strong></p>
                <p>Prazo de análise: <strong>até 30 dias úteis.</strong></p>
                <p>O envio de livros para a Biblioteca Virtual da Câmara Municipal de João Câmara, Rio Grande do Norte, deve seguir um padrão definido de formatação e organização, sendo aceitos arquivos nos formatos DOC ou PDF, o autor ou autora deve encaminhar o material diretamente pelo próprio e-mail juntamente com a documentação que comprove a autoria da obra e a autorização para publicação, todo o processo respeita a Lei Geral de Proteção de Dados (Lei nº 13.709/2018) e a Lei de Direitos Autorais (Lei nº 9.610/1998), garantindo segurança, privacidade e proteção das obras, após o envio o material poderá passar por análise para verificação das diretrizes da biblioteca, e ao enviar o conteúdo o responsável declara estar de acordo com as normas e que possui os direitos sobre o material encaminhado.
</p>
                <br>
                <p>Aguardamos sua publicação!</p>
            </div>
        </div>
    `;
}

function showMyData() {
    if (!auth.currentUser) {
        showSlideAlert('Faça login primeiro!');
        showLoginForm();
        return;
    }
    
    database.ref('users/' + auth.currentUser.uid).once('value', (snapshot) => {
        const userData = snapshot.val();
        document.getElementById('dynamicContent').innerHTML = `
            <button class="btn btn-back" onclick="showMainLibrary()">← Voltar</button>
            <div class="my-data-container">
                <div class="my-data-card">
                    <h2>Meus Dados</h2>
                    <div class="form-group">
                        <label>Nome</label>
                        <input type="text" value="${userData.name}" disabled>
                    </div>
                    <div class="form-group">
                        <label>E-mail</label>
                        <input type="email" value="${auth.currentUser.email}" disabled>
                    </div>
                    <div class="form-group">
                        <label>Telefone</label>
                        <input type="tel" id="editPhone" value="${userData.phone || ''}">
                    </div>
                    <div class="form-group">
                        <label>Nova Senha</label>
                        <input type="password" id="editPassword" placeholder="Deixe em branco para manter">
                    </div>
                    <button class="btn" onclick="saveMyData()">Salvar Alterações</button>
                </div>
            </div>
        `;
    });
}

function saveMyData() {
    const phone = document.getElementById('editPhone').value;
    const newPassword = document.getElementById('editPassword').value;
    
    database.ref('users/' + auth.currentUser.uid).update({phone: phone});
    
    if (newPassword) {
        auth.currentUser.updatePassword(newPassword)
            .then(() => showSlideAlert('Senha atualizada com sucesso!', 'success'))
            .catch(err => showSlideAlert('Erro: ' + err.message));
    }
    
    showSlideAlert('Dados atualizados!', 'success');
    showMainLibrary();
}

// Exportar para escopo global
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;
window.showReceipt = showReceipt;
window.showAcervos = showAcervos;
window.showPublishInfo = showPublishInfo;
window.showMyData = showMyData;
window.saveMyData = saveMyData;