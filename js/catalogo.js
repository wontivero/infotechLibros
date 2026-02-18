import { db, storage } from './firebase-config.js';
import { collection, addDoc, updateDoc, deleteDoc, doc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

let booksCache = [];
let bookForm;
let unsubBooks = null;
let imageModal, modalImagePreview;

// Constantes de Precios (Duplicadas por ahora, idealmente en un config.js compartido)
const COSTO_ANILLADO = 2000;
const COSTO_HOJA_BN = 50;
const COSTO_HOJA_COLOR = 80;

export async function init() {
    console.log("Inicializando sección Catálogo...");
    bookForm = document.getElementById('bookForm');
    
    // Inicializar Modal de Imagen
    modalImagePreview = document.getElementById('modalImagePreview');
    imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
    
    // Listeners
    document.getElementById('btnAddBook').addEventListener('click', () => {
        resetBookForm();
        toggleCatalogView('form');
    });
    document.getElementById('btnCancelBook').addEventListener('click', () => toggleCatalogView('list'));
    bookForm.addEventListener('submit', handleSaveBook);
    
    document.getElementById('btnDeleteImage').addEventListener('click', () => {
        document.getElementById('bookImagenFile').value = '';
        document.getElementById('bookImagenCurrentURL').value = '';
        document.getElementById('imagePreviewContainer').classList.add('d-none');
    });

    document.getElementById('bookPaginas').addEventListener('input', (e) => {
        const pags = parseInt(e.target.value) || 0;
        if (pags > 0) {
            document.getElementById('bookPrecioBN').value = (pags * COSTO_HOJA_BN) + COSTO_ANILLADO;
            document.getElementById('bookPrecioColor').value = (pags * COSTO_HOJA_COLOR) + COSTO_ANILLADO;
        }
    });

    document.getElementById('catalogSearchInput').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = booksCache.filter(b => b.titulo.toLowerCase().includes(term) || (b.editorial && b.editorial.toLowerCase().includes(term)));
        renderCatalogTable(filtered);
    });

    // Cargar datos
    loadBooks();

    // Exponer funciones globales para la tabla
    window.editBook = editBook;
    window.deleteBook = deleteBook;
    window.viewImage = viewImage;
    window.copyImageToClipboard = copyImageToClipboard;
}

export function destroy() {
    console.log("Limpiando sección Catálogo...");
    if (unsubBooks) unsubBooks();
}

function loadBooks() {
    const q = query(collection(db, "libros"), orderBy("titulo"));
    unsubBooks = onSnapshot(q, (snapshot) => {
        booksCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderCatalogTable(booksCache);
    });
}

function renderCatalogTable(books) {
    const tableBody = document.getElementById('catalogTableBody');
    tableBody.innerHTML = '';
    if (books.length === 0) { tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay libros.</td></tr>'; return; }
    
    books.forEach(book => {
        const imageSrc = book.imagenURL || 'https://via.placeholder.com/150x200?text=Sin+Img';
        const isPlaceholder = !book.imagenURL || book.imagenURL.includes('via.placeholder');
        const copyImgBtn = isPlaceholder ? '' : `<button class="btn btn-sm btn-copy-mini" onclick="event.stopPropagation(); copyImageToClipboard('${imageSrc}')" title="Copiar Imagen"><i class="bi bi-clipboard"></i></button>`;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><div class="book-thumbnail-container" style="width: 60px; height: 80px;" onclick="viewImage('${imageSrc}')"><img src="${imageSrc}" class="book-thumbnail" style="max-height: 100%;" alt="Tapa">${copyImgBtn}</div></td>
            <td class="fw-bold">${book.titulo}</td><td>${book.editorial || '-'}</td>
            <td><div class="small">BN: $${book.precioBN}</div><div class="small text-primary">Color: $${book.precioColor}</div></td>
            <td>${book.isWaitlist ? '<span class="badge bg-danger">Waitlist</span>' : '<span class="badge bg-success">Stock</span>'}</td>
            <td class="text-end"><button class="btn btn-sm btn-outline-primary me-1" onclick="editBook('${book.id}')"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger" onclick="deleteBook('${book.id}')"><i class="bi bi-trash"></i></button></td>`;
        tableBody.appendChild(row);
    });
}

function toggleCatalogView(view) {
    const listView = document.getElementById('catalogListView');
    const formView = document.getElementById('catalogFormView');
    if (view === 'list') { listView.classList.remove('d-none'); formView.classList.add('d-none'); }
    else { listView.classList.add('d-none'); formView.classList.remove('d-none'); }
}

async function handleSaveBook(e) {
    e.preventDefault();
    const btnSave = document.getElementById('btnSaveBook');
    const originalBtnText = btnSave.innerText;
    btnSave.disabled = true;
    btnSave.innerText = "Procesando...";

    const id = document.getElementById('bookId').value;
    const paginas = parseInt(document.getElementById('bookPaginas').value) || 0;
    const fileInput = document.getElementById('bookImagenFile');
    let imagenURL = document.getElementById('bookImagenCurrentURL').value;
    
    const oldBook = booksCache.find(b => b.id === id);
    const oldImageUrl = oldBook ? oldBook.imagenURL : null;

    if (fileInput.files.length > 0) {
        try {
            btnSave.innerText = "Subiendo imagen...";
            const storageRef = ref(storage, `libros/${Date.now()}_${fileInput.files[0].name}`);
            const snapshot = await uploadBytes(storageRef, fileInput.files[0]);
            imagenURL = await getDownloadURL(snapshot.ref);
            if (oldImageUrl && !oldImageUrl.includes('via.placeholder')) try { await deleteObject(ref(storage, oldImageUrl)); } catch(e) {}
        } catch (error) {
            console.error(error);
            alert("Error al subir imagen");
            btnSave.disabled = false;
            btnSave.innerText = originalBtnText;
            return;
        }
    } else if (imagenURL === '' && oldImageUrl) {
        try { await deleteObject(ref(storage, oldImageUrl)); } catch(e) {}
    }

    const data = {
        titulo: document.getElementById('bookTitulo').value,
        editorial: document.getElementById('bookEditorial').value,
        paginas: paginas,
        imagenURL: imagenURL,
        precioBN: parseFloat(document.getElementById('bookPrecioBN').value) || 0,
        precioColor: parseFloat(document.getElementById('bookPrecioColor').value) || 0,
        isWaitlist: document.getElementById('bookIsWaitlist').checked
    };

    try {
        if (id) await updateDoc(doc(db, "libros", id), data);
        else await addDoc(collection(db, "libros"), data);
        toggleCatalogView('list');
    } catch (error) {
        console.error(error);
        alert("Error al guardar");
    } finally {
        btnSave.disabled = false;
        btnSave.innerText = originalBtnText;
    }
}

function editBook(id) {
    const book = booksCache.find(b => b.id === id);
    if (!book) return;
    document.getElementById('bookId').value = book.id;
    document.getElementById('bookTitulo').value = book.titulo;
    document.getElementById('bookEditorial').value = book.editorial || '';
    document.getElementById('bookPaginas').value = book.paginas || '';
    document.getElementById('bookPrecioBN').value = book.precioBN;
    document.getElementById('bookPrecioColor').value = book.precioColor;
    document.getElementById('bookIsWaitlist').checked = book.isWaitlist;
    document.getElementById('bookImagenCurrentURL').value = book.imagenURL || '';
    const previewContainer = document.getElementById('imagePreviewContainer');
    if (book.imagenURL) {
        document.getElementById('imagePreview').src = book.imagenURL;
        previewContainer.classList.remove('d-none');
    } else {
        previewContainer.classList.add('d-none');
    }
    document.getElementById('formTitle').innerText = "Editar Libro";
    toggleCatalogView('form');
}

async function deleteBook(id) {
    if (!confirm("¿Eliminar libro?")) return;
    try { await deleteDoc(doc(db, "libros", id)); } catch (e) { console.error(e); }
}

function resetBookForm() {
    bookForm.reset();
    document.getElementById('bookId').value = '';
    document.getElementById('bookImagenCurrentURL').value = '';
    document.getElementById('imagePreviewContainer').classList.add('d-none');
    document.getElementById('formTitle').innerText = "Nuevo Libro";
}

// --- FUNCIONES DE IMAGEN (Copiadas de home.js para funcionalidad local) ---

function viewImage(url) {
    if (!url || url.includes('via.placeholder')) return;
    modalImagePreview.src = url;
    document.getElementById('btnCopyImageModal').onclick = () => copyImageToClipboard(url);
    imageModal.show();
}

async function copyImageToClipboard(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        let blobToWrite = blob;
        if (blob.type !== 'image/png') {
            blobToWrite = await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width; canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(resolve, 'image/png');
                };
                img.src = URL.createObjectURL(blob);
            });
        }
        await navigator.clipboard.write([new ClipboardItem({'image/png': blobToWrite})]);
        showToast("¡Imagen copiada!");
    } catch (err) {
        console.error(err);
        window.open(url, '_blank');
        showToast("Error: Se abrió en nueva pestaña.", 'danger');
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'position-fixed bottom-0 end-0 p-3';
    toast.style.zIndex = '1100';
    const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
    const iconClass = type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill';
    toast.innerHTML = `<div class="toast show align-items-center text-white ${bgClass} border-0"><div class="d-flex"><div class="toast-body"><i class="bi ${iconClass} me-2"></i> ${message}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}