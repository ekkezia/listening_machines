import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAFeq8xEofgz0wqq_wJ2EdD-VNJ9eq-RgI",
  authDomain: "we-listen-4c6d5.firebaseapp.com",
  projectId: "we-listen-4c6d5",
  storageBucket: "we-listen-4c6d5.firebasestorage.app",
  messagingSenderId: "724954058990",
  appId: "1:724954058990:web:0f9f833f35488cd8b363ff",
  measurementId: "G-P35QHJ9HVM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage, collection, addDoc, doc, setDoc, getDoc, updateDoc, query, where, onSnapshot, orderBy, ref, uploadBytes, getDownloadURL };
