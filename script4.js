const firebaseConfig = {
    apiKey: "AIzaSyCVdKIP6jl-mLaqHNMW-IwK3pVkvhuSvSI",
    databaseURL: "https://san7-brasil-default-rtdb.firebaseio.com",
    projectId: "san7-brasil",
    authDomain: "san7-brasil.firebaseapp.com"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.database();