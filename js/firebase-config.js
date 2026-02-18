// Importar funciones del SDK que necesitemos
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// TU CONFIGURACIÓN DE FIREBASE
// Reemplaza esto con los datos de tu consola de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBIv7sXPkd6iYHZMW6iBi9CdU_uAeBMb4g",
  authDomain: "infotechlibros.firebaseapp.com",
  projectId: "infotechlibros",
  storageBucket: "infotechlibros.firebasestorage.app",
  messagingSenderId: "813230196829",
  appId: "1:813230196829:web:60dc02db2dfef6e488e5b4"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar servicios y exportarlos
const db = getFirestore(app);
const storage = getStorage(app);

console.log("Firebase inicializado correctamente");

export { db, storage };
