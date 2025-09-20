// script.js  -- colocar na mesma pasta e referenciar em todos os HTML
// Firebase compat libs devem ser incluídas em cada HTML antes deste script.

const firebaseConfig = {
  apiKey: "AIzaSyBPiznHCVkTAgx6m02bZB8b0FFaot9UkBU",
  authDomain: "prefeitura-de-joao-camara.firebaseapp.com",
  projectId: "prefeitura-de-joao-camara",
  storageBucket: "prefeitura-de-joao-camara.firebasestorage.app",
  messagingSenderId: "269299041577",
  appId: "1:269299041577:web:fd41b2939240e9eb476338",
  measurementId: "G-YT7NHR342J"
};

// Inicializa Firebase
if(!firebase.apps.length){
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// Utilidades comuns
function formatCPF(v){
  v = v.replace(/\D/g,'').slice(0,11);
  v = v.replace(/^(\d{3})(\d)/, '$1.$2');
  v = v.replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3');
  v = v.replace(/\.(\d{3})(\d)/, '.$1-$2');
  return v;
}
function calculateAge(dobString){
  if(!dobString) return '';
  const today = new Date();
  const parts = dobString.split('-'); // yyyy-mm-dd
  if(parts.length<3) return '';
  const dob = new Date(parts[0], parts[1]-1, parts[2]);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if(m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}
function maskPhone(v){
  v = v.replace(/\D/g,'').slice(0,11);
  if(v.length<=10){
    v = v.replace(/^(\d{2})(\d)/g,'($1) $2');
    v = v.replace(/(\d{4})(\d)/,'$1-$2');
  } else {
    v = v.replace(/^(\d{2})(\d)/g,'($1) $2');
    v = v.replace(/(\d{5})(\d)/,'$1-$2');
  }
  return v;
}

// Salva inscrição
async function saveInscription(courseId, formData){
  const ref = db.ref('inscriptions/' + courseId);
  const pushRef = await ref.push();
  await pushRef.set(formData);
  return pushRef.key;
}

// Buscar cursos (snapshot -> array)
async function fetchCourses(){
  const snap = await db.ref('courses').once('value');
  const data = snap.val() || {};
  return Object.keys(data).map(k => ({ id: k, ...data[k] }));
}

// Buscar inscrições de um curso
async function fetchInscriptions(courseId){
  const snap = await db.ref('inscriptions/' + courseId).once('value');
  const data = snap.val() || {};
  return Object.keys(data).map(k => ({ id: k, ...data[k] }));
}

// Cadastrar curso (admin)
async function createCourse(course){
  const ref = db.ref('courses');
  const newRef = await ref.push();
  await newRef.set(course);
  return newRef.key;
}

// Atualizar curso
async function updateCourse(courseId, updates){
  await db.ref('courses/' + courseId).update(updates);
}

// Consultar inscrição por telefone (no campo consulta)
async function queryByPhone(phone){
  const norm = phone.replace(/\D/g,'');
  const snap = await db.ref('inscriptions').once('value');
  const result = [];
  const all = snap.val() || {};
  for(const courseId of Object.keys(all)){
    const entries = all[courseId] || {};
    for(const id of Object.keys(entries)){
      const item = entries[id];
      const ph = (item.telefone || '').replace(/\D/g,'');
      if(ph === norm){
        result.push({ courseId, id, ...item });
      }
    }
  }
  return result;
}

// Export CSV helper
function toCSV(rows){
  if(!rows || rows.length===0) return '';
  const keys = Object.keys(rows[0]);
  const esc = v => `"${String(v || '').replace(/"/g,'""')}"`;
  const header = keys.map(esc).join(',');
  const lines = rows.map(r => keys.map(k => esc(r[k])).join(','));
  return [header, ...lines].join('\r\n');
}