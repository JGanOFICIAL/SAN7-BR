// Configuracao do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCVdKIP6jl-mLaqHNMW-IwK3pVkvhuSvSI",
    databaseURL: "https://san7-brasil-default-rtdb.firebaseio.com",
    projectId: "san7-brasil",
    authDomain: "san7-brasil.firebaseapp.com"
};

// Inicializar Firebase
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Configuracoes do Cloudinary
const CLOUD_NAME = "dzmjto17f";
const UPLOAD_PRESET = "ml_default";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

// Funcao de upload para o Cloudinary
async function uploadToCloudinary(file) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', UPLOAD_PRESET);
        
        fetch(CLOUDINARY_URL, {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.secure_url) {
                resolve(data.secure_url);
            } else {
                reject(new Error('Falha no upload'));
            }
        })
        .catch(error => {
            console.error('Erro no upload:', error);
            reject(error);
        });
    });
}

// Disponibilizar funcao globalmente
window.CloudinaryUpload = uploadToCloudinary;

console.log("Firebase e Cloudinary configurados.");