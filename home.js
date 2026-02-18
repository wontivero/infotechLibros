import { db, storage } from './js/firebase-config.js';
import { 
    collection, 
    getDocs, 
    addDoc, 
    updateDoc, 
    deleteDoc,
    doc, 
    query, 
    where, 
    limit, 
    orderBy, 
    onSnapshot, 
    serverTimestamp, 
    Timestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Variables globales del módulo
let searchInput, resultsContainer, btnProcessAI, whatsappRawText, btnConfirmOrder;
let inputOrderSearch, btnSearchOrder, btnClearSearch;
let imageModal, modalImagePreview;

// ⚠️ SEGURIDAD: En producción, mueve esto a Firebase Cloud Functions.
const GEMINI_API_KEY = "AIzaSyCZOR8SVr-iZovD4lRXo9cApK3cb4tHCKs"; 
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// CONSTANTES DE PRECIOS
const COSTO_ANILLADO = 2000;
const COSTO_HOJA_BN = 50;
const COSTO_HOJA_COLOR = 80;

// Estado local
let currentSearchResults = [];
let booksCache = [];
let ordersCache = [];

// --- FUNCIÓN DE INICIALIZACIÓN (Se llama al cargar la sección) ---
export async function init() {
    console.log("Inicializando sección Home...");

    // 1. Capturar elementos del DOM
    searchInput = document.getElementById('searchInput');
    resultsContainer = document.getElementById('resultsContainer');
    btnProcessAI = document.getElementById('btnProcessAI');
    whatsappRawText = document.getElementById('whatsappRawText');
    btnConfirmOrder = document.getElementById('btnConfirmOrder');
    
    inputOrderSearch = document.getElementById('inputOrderSearch');
    btnSearchOrder = document.getElementById('btnSearchOrder');
    btnClearSearch = document.getElementById('btnClearSearch');
    
    // Elementos de Modals
    modalImagePreview = document.getElementById('modalImagePreview');
    imageModal = new bootstrap.Modal(document.getElementById('imageModal'));

    // 2. Asignar Event Listeners
    setupEventListeners();

    // 3. Cargar Datos
    initDataListeners();

    // 4. Exponer funciones globales para onclicks del HTML
    exposeGlobalFunctions();
}

function setupEventListeners() {
    // Buscador Catálogo
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.trim().toLowerCase();
        if(term.length === 0) {
            resultsContainer.innerHTML = '<div class="col-12 text-center text-muted mt-5"><i class="bi bi-search display-4"></i><p>Empieza a escribir para buscar...</p></div>';
            return;
        }
        // Filtrado Client-Side
        const searchTerms = term.split(' ').filter(t => t.length > 0);
        const results = booksCache.filter(book => {
            const searchableText = [
                book.titulo, book.editorial, book.isbn,
                book.isWaitlist ? 'waitlist' : 'stock',
                book.precioBN.toString(), book.precioColor.toString()
            ].join(' ').toLowerCase();
            return searchTerms.every(t => searchableText.includes(t));
        });
        currentSearchResults = results;
        renderBooks(results);
    });

    // IA
    btnProcessAI.addEventListener('click', handleAIProcess);

    // Confirmar Pedido
    btnConfirmOrder.addEventListener('click', handleConfirmOrder);

    // Buscador Pedidos
    btnSearchOrder.addEventListener('click', performOrderSearch);
    inputOrderSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performOrderSearch();
    });
    btnClearSearch.addEventListener('click', () => {
        inputOrderSearch.value = '';
        updateKanbanView();
    });
}

// --- LÓGICA DE DATOS ---

function initDataListeners() {
    console.log("Sincronizando datos...");
    
    // Libros
    const qBooks = query(collection(db, "libros"), orderBy("titulo"));
    onSnapshot(qBooks, (snapshot) => {
        booksCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`📚 Catálogo: ${booksCache.length} libros.`);
    });

    // Pedidos
    const qOrders = query(collection(db, "pedidos"), orderBy("fecha", "desc"));
    onSnapshot(qOrders, (snapshot) => {
        ordersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`📦 Pedidos: ${ordersCache.length} pedidos.`);
        updateKanbanView();
    });
}

// --- HANDLERS Y LÓGICA ESPECÍFICA ---

async function handleAIProcess() {
    const text = whatsappRawText.value;
    if (!text) return;

    btnProcessAI.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';
    btnProcessAI.disabled = true;
    
    try {
        const extractedData = await procesarMensajeConIA(text);
        if (extractedData) {
            populateForm(extractedData);
            showToast("¡Datos extraídos con éxito!");
        }
    } catch (error) {
        console.error("Error IA:", error);
        alert("Hubo un error al procesar con la IA.");
    } finally {
        btnProcessAI.innerHTML = '<i class="bi bi-magic"></i> Extraer';
        btnProcessAI.disabled = false;
    }
}

async function handleConfirmOrder() {
    const clienteNombre = document.getElementById('inputClienteNombre').value;
    const clienteCelular = document.getElementById('inputClienteCelular').value;
    const alumno = document.getElementById('inputAlumno').value;
    const colegio = document.getElementById('inputColegio').value;
    const grado = document.getElementById('inputGrado').value;
    const libro = document.getElementById('inputLibro').value;
    const senia = parseFloat(document.getElementById('inputSenia').value) || 0;
    const total = parseFloat(document.getElementById('inputTotal').value) || 0;
    
    const isClone = document.getElementById('checkClone').checked;
    const cloneQty = isClone ? parseInt(document.getElementById('cloneQty').value) : 1;

    if (!libro || !alumno) {
        alert("Faltan datos obligatorios: Alumno y Libro.");
        return;
    }

    const saldo = total - senia;
    btnConfirmOrder.disabled = true;
    btnConfirmOrder.innerText = isClone ? `Creando ${cloneQty} pedidos...` : "Guardando...";

    try {
        const promises = [];
        let lastTrackingId = "";
        
        for (let i = 0; i < cloneQty; i++) {
            const trackingId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
            const nombreFinal = isClone ? `${alumno} (${i+1})` : alumno;

            promises.push(addDoc(collection(db, "pedidos"), {
                trackingId: trackingId,
                cliente: { nombre: clienteNombre, celular: clienteCelular },
                referenteNombre: nombreFinal || 'S/N',
                fecha: serverTimestamp(),
                estado: 'gris',
                senia: senia,
                total: total,
                pagoPendiente: saldo,
                descripcion: `${libro} (${grado})`,
                detalle: { alumno: nombreFinal, colegio, grado, libro }
            }));
            lastTrackingId = trackingId;
        }

        await Promise.all(promises);
        showToast(`¡${cloneQty} Pedido(s) guardado(s)!`);
        
        // Limpieza parcial
        document.getElementById('inputAlumno').value = '';
        document.getElementById('inputGrado').value = '';
        document.getElementById('inputLibro').value = '';
        document.getElementById('inputSenia').value = '';
        document.getElementById('inputTotal').value = '';
        document.getElementById('checkClone').checked = false;
        document.getElementById('cloneQty').value = '1';
        document.getElementById('whatsappRawText').value = '';

        if (clienteCelular) {
            const msg = isClone 
                ? `¡Hola ${clienteNombre}! Tomamos tus ${cloneQty} pedidos de *${libro}*.`
                : `¡Hola ${clienteNombre}! Tu pedido de *${libro}* para *${alumno}* fue registrado. Código: *#${lastTrackingId}*.`;
            window.open(`https://wa.me/549${clienteCelular}?text=${encodeURIComponent(msg)}`, '_blank');
        }

    } catch (error) {
        console.error("Error al guardar pedido:", error);
        alert("Error al guardar el pedido.");
    } finally {
        btnConfirmOrder.disabled = false;
        btnConfirmOrder.innerText = "Confirmar Pedido";
    }
}

// --- FUNCIONES AUXILIARES ---

function updateKanbanView() {
    if (inputOrderSearch.value.trim() !== '') performOrderSearch();
    else renderDailyOrders();
}

function renderDailyOrders() {
    btnClearSearch.classList.add('d-none');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayOrders = ordersCache.filter(o => o.fecha && o.fecha.toDate() >= startOfDay);
    renderOrders(todayOrders);
}

function performOrderSearch() {
    const term = inputOrderSearch.value.trim().toLowerCase();
    btnClearSearch.classList.remove('d-none');
    const searchTerms = term.split(' ').filter(t => t.length > 0);
    const results = ordersCache.filter(order => {
        const searchableText = [
            order.trackingId, order.cliente?.nombre, order.cliente?.celular,
            order.referenteNombre, order.detalle?.colegio, order.detalle?.grado,
            order.descripcion, order.estado
        ].join(' ').toLowerCase();
        return searchTerms.every(t => searchableText.includes(t));
    });
    renderOrders(results);
}

function renderOrders(orders) {
    ['col-gris', 'col-amarillo', 'col-azul', 'col-verde'].forEach(id => document.getElementById(id).innerHTML = '');
    if (orders.length === 0) return;

    orders.forEach(order => {
        const targetCol = document.getElementById(`col-${order.estado}`) || document.getElementById('col-gris');
        const isDark = order.estado === 'azul' || order.estado === 'verde';
        const textColor = isDark ? 'text-white' : 'text-dark';
        let bgColor = 'bg-light';
        if (order.estado === 'amarillo') bgColor = 'bg-warning';
        else if (order.estado === 'azul') bgColor = 'bg-primary';
        else if (order.estado === 'verde') bgColor = 'bg-success';

        const saldoText = order.pagoPendiente > 0 ? `Saldo: $${order.pagoPendiente}` : 'PAGADO';
        const trackingId = order.trackingId || '---';
        const clientInfo = order.cliente ? `${order.cliente.nombre || ''} ${order.cliente.celular ? `(${order.cliente.celular})` : ''}` : '';
        const printBtn = (order.estado === 'verde' || order.estado === 'azul')
            ? `<button class="btn btn-sm btn-light ms-2" onclick="printLabel('${order.id}')" title="Imprimir Etiqueta"><i class="bi bi-printer"></i></button>` : '';
        
        const cardHTML = `
            <div class="card shadow-sm border-0 mb-2">
                <div class="card-body ${bgColor} ${textColor} rounded p-2">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <h6 class="fw-bold mb-0 text-truncate" style="max-width: 65%">${order.referenteNombre}</h6>
                        <span class="badge ${isDark ? 'bg-light text-dark' : 'bg-secondary text-white'} bg-opacity-75" style="font-size:0.65rem">${saldoText}</span>
                    </div>
                    <div class="small opacity-75 mb-1 text-truncate"><i class="bi bi-person"></i> ${clientInfo}</div>
                    <p class="small mb-1 text-truncate" title="${order.descripcion}">#${trackingId} - ${order.descripcion}</p>
                    <div class="d-flex justify-content-between align-items-center mt-2" style="font-size: 0.8rem;">
                        <span style="cursor:pointer; text-decoration:underline" onclick="cycleOrderState('${order.id}', '${order.estado}')"><i class="bi bi-arrow-right-circle"></i> Mover</span>
                        ${printBtn}
                    </div>
                </div>
            </div>`;
        targetCol.innerHTML += cardHTML;
    });
}

function renderBooks(books) {
    if (books.length === 0) {
        resultsContainer.innerHTML = '<div class="col-12 text-center">No se encontraron libros.</div>';
        return;
    }
    resultsContainer.innerHTML = books.map(book => {
        const statusClass = book.isWaitlist ? 'book-waitlist' : 'book-stock';
        const statusBadge = book.isWaitlist ? '<span class="badge bg-danger">Waitlist</span>' : '<span class="badge bg-success">En Stock</span>';
        const imageSrc = book.imagenURL || 'https://via.placeholder.com/150x200?text=Sin+Img';
        const isPlaceholder = !book.imagenURL || book.imagenURL.includes('via.placeholder');
        const copyImgBtn = isPlaceholder ? '' : `<button class="btn btn-sm btn-copy-mini" onclick="event.stopPropagation(); copyImageToClipboard('${imageSrc}')" title="Copiar Imagen"><i class="bi bi-clipboard"></i></button>`;

        let centerActions = '', rightAction = '';
        if (book.isWaitlist) {
            centerActions = `<div class="mt-2"><button class="btn btn-outline-danger btn-sm w-100 mb-1" onclick="sendWhatsApp('${book.id}', 'waitlist_notify')"><i class="bi bi-whatsapp"></i> Avisar</button><button class="btn btn-sm btn-light text-muted w-100" onclick="addToWaitlistLead('${book.id}')"><i class="bi bi-person-plus"></i> Anotar</button></div>`;
            rightAction = `<div class="bg-light d-flex align-items-center justify-content-center h-100 text-muted" style="width:50px"><i class="bi bi-hourglass-split"></i></div>`;
        } else {
            centerActions = `<div class="d-flex gap-1 mt-2"><button class="btn btn-outline-success btn-sm flex-fill" onclick="sendWhatsApp('${book.id}', 'stock_quote')"><i class="bi bi-whatsapp"></i> Cotizar</button><button class="btn btn-outline-secondary btn-sm" onclick="copyToClipboard('${book.id}', 'stock')"><i class="bi bi-clipboard"></i> Info</button></div>`;
            rightAction = `<button class="btn btn-primary btn-load-arrow h-100 w-100 d-flex align-items-center justify-content-center" onclick="loadBookToForm('${book.id}')" title="Cargar Pedido"><i class="bi bi-cart-plus display-6"></i></button>`;
        }
        
        return `
        <div class="col-md-6">
            <div class="card card-book h-100 shadow-sm ${statusClass} overflow-hidden">
                <div class="book-card-row h-100">
                    <div class="book-thumbnail-container" onclick="viewImage('${imageSrc}')"><img src="${imageSrc}" class="book-thumbnail" alt="Tapa">${copyImgBtn}</div>
                    <div class="p-2 flex-grow-1 d-flex flex-column justify-content-center" style="min-width: 0;">
                        <div class="d-flex justify-content-between align-items-start mb-1">${statusBadge}<small class="text-muted fw-bold" style="font-size:0.7rem">${book.editorial}</small></div>
                        <h6 class="card-title text-dark mb-1 text-truncate" title="${book.titulo}">${book.titulo}</h6>
                        <div class="d-flex justify-content-between align-items-center bg-light rounded px-2 py-1"><span class="fw-bold text-dark small">BN: $${book.precioBN}</span><span class="fw-bold text-primary small">Color: $${book.precioColor}</span></div>
                        ${centerActions}
                    </div>
                    <div style="width: 60px; min-width: 60px;">${rightAction}</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// --- FUNCIONES GLOBALES (Expuestas a window) ---

function exposeGlobalFunctions() {
    window.sendWhatsApp = (id, type) => {
        const book = booksCache.find(b => b.id === id);
        if (!book) return;
        const senia = Math.ceil((book.precioColor * 0.5) / 100) * 100;
        const text = type === 'stock_quote' 
            ? `¡Hola! Lo tenemos. El libro *${book.titulo}* sale $${book.precioColor}. Para encargarlo, señalo con $${senia} (Alias: INFOTECH.CBA). Pasame comprobante, nombre de alumno y cole. ¡Gracias!`
            : `¡Hola! Por ahora no tenemos *${book.titulo}*, pero te anoto en lista de espera. Si llegamos a 10 interesados, lo conseguimos y te aviso por acá. ¡Saludos!`;
        copyToClipboardText(text);
    };

    window.copyToClipboard = (id, type) => window.sendWhatsApp(id, type);

    window.cycleOrderState = async (id, currentState) => {
        const states = ['gris', 'amarillo', 'azul', 'verde'];
        const nextState = states[(states.indexOf(currentState) + 1) % states.length];
        try { await updateDoc(doc(db, "pedidos", id), { estado: nextState }); } catch (e) { console.error(e); }
    };

    window.addToWaitlistLead = async (bookId) => {
        const book = booksCache.find(b => b.id === bookId);
        const name = prompt("Nombre del interesado:");
        const phone = prompt("Celular (sin 0 ni 15):");
        if(name && phone) {
            try {
                await addDoc(collection(db, "interesados_waitlist"), {
                    bookId, bookTitle: book ? book.titulo : "Desconocido", name, phone, date: serverTimestamp()
                });
                showToast("Interesado anotado.");
            } catch (e) { console.error(e); }
        }
    };

    window.loadBookToForm = (id) => {
        const book = booksCache.find(b => b.id === id);
        if (!book) return;
        document.getElementById('inputLibro').value = book.titulo;
        document.getElementById('inputTotal').value = book.precioColor;
        document.getElementById('inputSenia').value = Math.ceil((book.precioColor * 0.5) / 100) * 100;
        document.getElementById('inputAlumno').focus();
    };

    window.viewImage = (url) => {
        if (!url || url.includes('via.placeholder')) return;
        modalImagePreview.src = url;
        document.getElementById('btnCopyImageModal').onclick = () => window.copyImageToClipboard(url);
        imageModal.show();
    };

    window.copyImageToClipboard = async (url) => {
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
    };

    window.printLabel = (orderId) => {
        document.getElementById('printAlumno').innerText = "Alumno Ejemplo";
        document.getElementById('printQR').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${orderId}" />`;
        window.print();
    };

    window.exportToCSV = () => {
        if (ordersCache.length === 0) { alert("No hay pedidos."); return; }
        let csvContent = "data:text/csv;charset=utf-8,Fecha,Tracking,Estado,Cliente,Celular,Alumno,Colegio,Grado,Libro,Seña,Total,Saldo\n";
        ordersCache.forEach(o => {
            const fecha = o.fecha ? new Date(o.fecha.seconds * 1000).toLocaleDateString() : '-';
            const row = [
                fecha, o.trackingId || '', o.estado, `"${o.cliente?.nombre || ''}"`, o.cliente?.celular || '',
                `"${o.referenteNombre || ''}"`, `"${o.detalle.colegio || ''}"`, `"${o.detalle.grado || ''}"`,
                `"${o.descripcion || ''}"`, o.senia, o.total, o.pagoPendiente
            ].join(",");
            csvContent += row + "\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `pedidos_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    window.editBook = (id) => {
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
    };

    window.deleteBook = async (id) => {
        if (!confirm("¿Eliminar libro?")) return;
        try { await deleteDoc(doc(db, "libros", id)); showToast("Libro eliminado"); } catch (e) { console.error(e); }
    };
}

// --- UTILIDADES ---

async function copyToClipboardText(text) {
    try { await navigator.clipboard.writeText(text); showToast("¡Mensaje copiado!"); } catch (e) { console.error(e); }
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

async function procesarMensajeConIA(textoSucio) {
    const prompt = `Actúa como asistente de librería. Extrae entidades de: "${textoSucio}". Devuelve JSON: {"alumno": "", "colegio": "", "grado": "", "libro_buscado": ""}`;
    const response = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (!response.ok) throw new Error(`Error API Gemini: ${response.status}`);
    const data = await response.json();
    let jsonString = data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    const firstBrace = jsonString.indexOf('{'), lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonString);
}

function populateForm(data) {
    if(data.alumno) document.getElementById('inputAlumno').value = data.alumno;
    if(data.colegio) document.getElementById('inputColegio').value = data.colegio;
    if(data.grado) document.getElementById('inputGrado').value = data.grado;
    if(data.libro_buscado) {
        document.getElementById('inputLibro').value = data.libro_buscado;
        searchInput.value = data.libro_buscado;
        // Disparar evento input manualmente para filtrar
        searchInput.dispatchEvent(new Event('input'));
    }
}