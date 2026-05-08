// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBjyzlX2rbICpUPilnMRKZoetwSgpk-DC0",
    authDomain: "biblioteca-virtual-jc.firebaseapp.com",
    databaseURL: "https://biblioteca-virtual-jc-default-rtdb.firebaseio.com",
    projectId: "biblioteca-virtual-jc",
    storageBucket: "biblioteca-virtual-jc.firebasestorage.app",
    messagingSenderId: "1076464689785",
    appId: "1:1076464689785:web:39d332b1125abe17166aa8",
    measurementId: "G-SYN0J9DCPB"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();