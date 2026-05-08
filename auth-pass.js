

let currentUser = null;


function showSlideAlert(message, type = 'error') {
    const existingAlert = document.querySelector('.slide-alert');
    if (existingAlert) existingAlert.remove();
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `slide-alert slide-alert-${type}`;
    alertDiv.innerHTML = `
        <div class="alert-content">
            <span class="alert-icon">${type === 'success' ? '✓' : '⚠'}</span>
            <span class="alert-message">${message}</span>
            <button class="alert-close" onclick="this.parentElement.parentElement.remove()">✕</button>
        </div>
    `;
    
    document.body.insertBefore(alertDiv, document.body.firstChild);
    
    setTimeout(() => {
        alertDiv.classList.add('slide-out');
        setTimeout(() => alertDiv.remove(), 300);
    }, 4000);
}

// Login
function doLogin() {
    const email = document.getElementById('loginEmail')?.value;
    const password = document.getElementById('loginPassword')?.value;
    const btn = event?.target;
    
    if (!email || !password) {
        showSlideAlert('Preencha todos os campos');
        return;
    }
    
    if (btn) btn.classList.add('btn-loading');
    
    auth.signInWithEmailAndPassword(email, password)
        .then(() => {
            if (btn) btn.classList.remove('btn-loading');
            showSlideAlert('Login realizado com sucesso!', 'success');
            setTimeout(() => {
                if (typeof window.loadUserData === 'function') window.loadUserData();
                if (typeof window.showMainLibrary === 'function') window.showMainLibrary();
            }, 500);
        })
        .catch((error) => {
            if (btn) btn.classList.remove('btn-loading');
            showSlideAlert('Erro: ' + error.message);
        });
}

// Registro
function doRegister() {
    const name = document.getElementById('regName')?.value;
    const email = document.getElementById('regEmail')?.value;
    const phone = document.getElementById('regPhone')?.value;
    const password = document.getElementById('regPassword')?.value;
    const btn = event?.target;
    
    if (!name || !email || !phone || !password) {
        showSlideAlert('Preencha todos os campos');
        return;
    }
    
    if (btn) btn.classList.add('btn-loading');
    
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            return database.ref('users/' + user.uid).set({
                name: name,
                email: email,
                phone: phone,
                createdAt: new Date().toISOString()
            });
        })
        .then(() => {
            if (btn) btn.classList.remove('btn-loading');
            showSlideAlert('Cadastro realizado com sucesso!', 'success');
            if (typeof window.showReceipt === 'function') {
                window.showReceipt({name, email, phone});
            }
        })
        .catch((error) => {
            if (btn) btn.classList.remove('btn-loading');
            showSlideAlert('Erro: ' + error.message);
        });
}

// Logout
function doLogout() {
    auth.signOut().then(() => {
        showSlideAlert('Você saiu do sistema', 'success');
        if (typeof window.showLoginForm === 'function') {
            window.showLoginForm();
        }
    });
}


auth.onAuthStateChanged((user) => {
    currentUser = user;
    const logoutMenuItem = document.getElementById('logoutMenuItem');
    
    if (user) {
        if (logoutMenuItem) logoutMenuItem.style.display = 'block';
        if (typeof window.loadUserBookmarks === 'function') window.loadUserBookmarks();
        if (typeof window.showMainLibrary === 'function') window.showMainLibrary();
    } else {
        if (logoutMenuItem) logoutMenuItem.style.display = 'none';
        if (typeof window.showLoginForm === 'function') window.showLoginForm();
    }
});


window.doLogin = doLogin;
window.doRegister = doRegister;
window.doLogout = doLogout;
window.showSlideAlert = showSlideAlert;
window.currentUser = () => currentUser;