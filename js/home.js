import { db, storage } from './firebase-config.js';
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
import { GEMINI_API_KEY } from './secrets.js';

// Variables globales del módulo
let searchInput, resultsContainer, btnProcessAI, whatsappRawText, btnConfirmOrder, btnPasteAI, btnClearForm, btnCopyResponse;
let imageModal, modalImagePreview, responseModal;

// ⚠️ SEGURIDAD: En producción, mueve esto a Firebase Cloud Functions.
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

// CONSTANTES DE PRECIOS
const COSTO_ANILLADO = 2000;
const COSTO_HOJA_BN = 50;
const COSTO_HOJA_COLOR = 80;

// Estado local
let currentSearchResults = [];
let booksCache = [];

// Unsubscribers
let unsubBooks = null;

// --- FUNCIÓN DE INICIALIZACIÓN (Se llama al cargar la sección) ---
export async function init() {
    console.log("Inicializando sección Home...");

    // 1. Capturar elementos del DOM
    searchInput = document.getElementById('searchInput');
    resultsContainer = document.getElementById('resultsContainer');
    btnProcessAI = document.getElementById('btnProcessAI');
    whatsappRawText = document.getElementById('whatsappRawText');
    btnConfirmOrder = document.getElementById('btnConfirmOrder');
    btnPasteAI = document.getElementById('btnPasteAI');
    btnClearForm = document.getElementById('btnClearForm');
    btnCopyResponse = document.getElementById('btnCopyResponse');
    
    // Elementos de Modals
    modalImagePreview = document.getElementById('modalImagePreview');
    if (document.getElementById('imageModal')) {
        imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
    }
    if (document.getElementById('responseModal')) {
        responseModal = new bootstrap.Modal(document.getElementById('responseModal'));
        btnCopyResponse.addEventListener('click', copyResponseToClipboard);
    }

    // 2. Asignar Event Listeners
    setupEventListeners();

    // 3. Cargar Datos
    initDataListeners();

    // 4. Exponer funciones globales para onclicks del HTML
    exposeGlobalFunctions();
}

// --- FUNCIÓN DE LIMPIEZA (Se llama al salir de la sección) ---
export function destroy() {
    console.log("Limpiando sección Home...");
    if (unsubBooks) unsubBooks();
    document.removeEventListener('keydown', handleGlobalKeys);
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
    
    // Botón Mágico (Pegar y Procesar)
    btnPasteAI.addEventListener('click', handlePasteAndProcess);
    
    // Botón Limpiar
    btnClearForm.addEventListener('click', clearForm);

    // Confirmar Pedido
    btnConfirmOrder.addEventListener('click', handleConfirmOrder);

    // Atajo de teclado Global
    document.addEventListener('keydown', handleGlobalKeys);
}

// --- LÓGICA DE DATOS ---

function initDataListeners() {
    console.log("Sincronizando datos...");
    
    // Libros
    const qBooks = query(collection(db, "libros"), orderBy("titulo"));
    unsubBooks = onSnapshot(qBooks, (snapshot) => {
        booksCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`📚 Catálogo: ${booksCache.length} libros.`);
    });
}

// --- HANDLERS Y LÓGICA ESPECÍFICA ---

function handleGlobalKeys(e) {
    // F2 para Pegar y Procesar
    if (e.key === 'F2') {
        e.preventDefault();
        handlePasteAndProcess();
    }
}

function clearForm() {
    const form = document.getElementById('orderForm');
    form.reset();
    document.getElementById('inputBookId').value = ''; // Limpiar ID del libro
    // Limpiar clases visuales (validaciones y flash)
    form.querySelectorAll('.form-control').forEach(el => el.classList.remove('is-valid', 'is-invalid', 'ai-flash'));
    whatsappRawText.value = '';
    document.getElementById('inputAlumno').focus();
}

async function handlePasteAndProcess() {
    try {
        // Leer texto del portapapeles
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            showToast("El portapapeles está vacío.", 'danger');
            return;
        }
        whatsappRawText.value = text;
        // Disparar proceso de IA
        handleAIProcess();
    } catch (err) {
        console.error('Error al leer portapapeles:', err);
        showToast("Permiso denegado. Pega el texto manualmente.", 'danger');
    }
}

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
        if (error.message.includes('429')) {
            showToast("⏳ Velocidad excedida (15/min). Espera 1 minuto.", 'warning');
        } else {
            alert("Hubo un error al procesar con la IA. Revisa la consola.");
        }
    } finally {
        btnProcessAI.innerHTML = '<i class="bi bi-magic"></i> Extraer';
        btnProcessAI.disabled = false;
    }
}

async function handleConfirmOrder() {
    const inputClienteNombre = document.getElementById('inputClienteNombre');
    const inputClienteCelular = document.getElementById('inputClienteCelular');
    const inputBookId = document.getElementById('inputBookId');
    const inputAlumno = document.getElementById('inputAlumno');
    const inputColegio = document.getElementById('inputColegio');
    const inputGrado = document.getElementById('inputGrado');
    const inputLibro = document.getElementById('inputLibro');
    const inputSenia = document.getElementById('inputSenia');
    const inputTotal = document.getElementById('inputTotal');

    // Limpiar validaciones previas (quitar borde rojo)
    [inputClienteCelular, inputAlumno, inputLibro, inputSenia].forEach(el => el.classList.remove('is-invalid'));

    const clienteNombre = inputClienteNombre.value;
    const clienteCelular = inputClienteCelular.value;
    const bookId = inputBookId.value;
    const alumno = inputAlumno.value;
    const colegio = inputColegio.value;
    const grado = inputGrado.value;
    const libro = inputLibro.value;
    const seniaVal = inputSenia.value;
    const senia = parseFloat(seniaVal) || 0;
    const total = parseFloat(inputTotal.value) || 0;
    
    const isClone = document.getElementById('checkClone').checked;
    const cloneQty = isClone ? parseInt(document.getElementById('cloneQty').value) : 1;

    let errores = [];

    // Validaciones específicas
    if (!clienteCelular) {
        inputClienteCelular.classList.add('is-invalid');
        errores.push("Falta el Celular del cliente.");
    }
    if (!alumno) {
        inputAlumno.classList.add('is-invalid');
        errores.push("Falta el nombre del Alumno.");
    }
    if (!libro) {
        inputLibro.classList.add('is-invalid');
        errores.push("No has seleccionado ningún Libro.");
    }
    if (seniaVal.trim() === '') {
        inputSenia.classList.add('is-invalid');
        errores.push("Debes ingresar la seña (0 si no hay).");
    }

    if (errores.length > 0) {
        alert("Faltan datos para procesar el pedido:\n\n- " + errores.join("\n- "));
        return;
    }

    if (senia > total) {
        inputSenia.classList.add('is-invalid');
        alert(`¡Error! La seña ($${senia}) supera el valor del libro ($${total}). Verifica los ceros.`);
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
                bookId: bookId, // Guardamos el ID del libro
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
        
        // Limpieza completa
        clearForm();

        // Generar mensaje de respuesta
        const saludo = clienteNombre ? `¡Hola ${clienteNombre}!` : `¡Hola!`;
        const msg = isClone 
            ? `${saludo} Tomamos tus ${cloneQty} pedidos de *${libro}*. Quedaron registrados. Te avisaremos cuando estén listos.`
            : `${saludo} Tu pedido de *${libro}* para *${alumno}* fue registrado correctamente.\n\n📌 *Código de seguimiento:* #${lastTrackingId}\n💰 *Saldo pendiente:* $${saldo}\n\nTe avisaremos por acá cuando esté listo para retirar. ¡Gracias!`;

        // Mostrar Modal de Respuesta
        document.getElementById('responseMessageText').value = msg;
        if (responseModal) {
            document.getElementById('btnOpenWhatsapp').href = clienteCelular ? `https://wa.me/549${clienteCelular}?text=${encodeURIComponent(msg)}` : '#';
            responseModal.show();
        }

    } catch (error) {
        console.error("Error al guardar pedido:", error);
        alert("Error al guardar el pedido.");
    } finally {
        btnConfirmOrder.disabled = false;
        btnConfirmOrder.innerText = "Confirmar Pedido";
    }
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
            centerActions = `<div class="d-flex gap-1 mt-2"><button class="btn btn-outline-success btn-sm flex-fill" onclick="sendWhatsApp('${book.id}', 'stock_quote')"><i class="bi bi-whatsapp"></i> Cotizar</button></div>`;
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
        
        let text = "";
        if (type === 'stock_quote') {
            const editorialInfo = book.editorial ? `\n🏢 Editorial: *${book.editorial}*` : '';
            text = `¡Hola! Sí, lo tenemos. 📚\n\n📖 Libro: *${book.titulo}*${editorialInfo}\n✨ *A color y anillado, excelente calidad* ✨\n💲 Precio: *$${book.precioColor}*\n\nPara encargarlo, podés señar con *$${senia}*.\n\n🏦 Alias Mercado Pago:\n👉 *INFOTECH.CBA*\n\nCuando transfieras, por favor enviame:\n✅ Comprobante\n✅ Datos del alumno: *Nombre, Colegio y Grado*\n\n¡Gracias!`;
        } else {
            text = `¡Hola! Por ahora no tenemos *${book.titulo}*, pero te anoto en lista de espera. Si llegamos a 10 interesados, lo conseguimos y te aviso por acá. ¡Saludos!`;
        }
        
        copyToClipboardText(text);
    };

    window.copyToClipboard = (id, type) => window.sendWhatsApp(id, type);

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
        document.getElementById('inputBookId').value = book.id; // Guardar ID oculto
        document.getElementById('inputLibro').value = book.titulo;
        document.getElementById('inputTotal').value = book.precioColor;
        document.getElementById('inputSenia').focus(); // Foco en seña para ingreso manual
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
}

// --- UTILIDADES ---

async function copyResponseToClipboard() {
    const text = document.getElementById('responseMessageText').value;
    copyToClipboardText(text);
}

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
    const prompt = `
        Tu tarea es extraer datos de un chat de WhatsApp que contiene un pedido y la respuesta de un cliente.

        CHAT A ANALIZAR:
        "${textoSucio}"

        INSTRUCCIONES:
        1.  **CLIENTE:** Busca la línea que dice "Cliente:". Si el texto es un número de teléfono, ponlo en 'cliente_celular'. Si es un nombre, en 'cliente_nombre'. Si es un texto genérico como "Envía mensajes a este mismo número", deja ambos campos vacíos.
        2.  **ALUMNO:** Identifica el nombre de la persona que se menciona al final del chat, usualmente después de que se piden los "Datos del alumno". Este es el dato más importante.
        3.  **COLEGIO:** Identifica el nombre del colegio. Omite palabras como "Colegio" o "Escuela".
        4.  **GRADO:** Identifica el grado y conviértelo a un número (ej: "quinto" se convierte en "5").
        5.  **LIBRO:** Identifica el nombre del libro que se está pidiendo.

        Devuelve ESTRICTAMENTE un objeto JSON con la siguiente estructura:
        {"cliente_nombre": "", "cliente_celular": "", "alumno": "", "colegio": "", "grado": "", "libro_buscado": ""}
    `;
    const response = await fetch(GEMINI_URL, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ 
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
        }) 
    });
    if (!response.ok) throw new Error(`Error API Gemini: ${response.status}`);
    const data = await response.json();
    const parsedData = JSON.parse(data.candidates[0].content.parts[0].text);
    console.log("Respuesta de la IA:", parsedData);
    return parsedData;
}

function populateForm(data) {
    let nombre = data.cliente_nombre || '';
    let celular = data.cliente_celular || '';

    // Lógica Inteligente: Si el nombre parece un número de teléfono, lo movemos a celular
    // (Ej: "549351..." o "+54 9 351...")
    if (nombre && /^[+\d\s-]+$/.test(nombre) && nombre.replace(/\D/g, '').length > 6) {
        if (!celular) celular = nombre; // Mover a celular manteniendo formato original
        nombre = ''; // Dejar nombre vacío para que lo completes o la IA lo deduzca del texto
    }

    // Limpieza de prefijo país (Argentina: +54 9) para dejarlo local
    if (celular) {
        celular = celular.replace(/^(\+?54\s*9\s*)/, '').trim();
        // Quitar espacios, guiones y paréntesis para dejar solo números
        celular = celular.replace(/\D/g, '');
    }

    // Helper para llenar y resaltar visualmente
    const fill = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) {
            el.value = val;
            el.classList.add('is-valid', 'ai-flash'); // Borde verde + Animación
            setTimeout(() => el.classList.remove('ai-flash'), 1500); // Quitar animación (dejar borde)
        }
    };

    if(nombre) fill('inputClienteNombre', nombre);
    if(celular) fill('inputClienteCelular', celular);
    if(data.alumno) fill('inputAlumno', data.alumno);
    if(data.colegio) fill('inputColegio', data.colegio);
    if(data.grado) fill('inputGrado', data.grado);

    if(data.libro_buscado) {
        // NO cargamos el libro en el input, solo buscamos
        searchInput.value = data.libro_buscado;
        searchInput.classList.add('is-valid', 'ai-flash'); // Resaltar buscador también
        setTimeout(() => searchInput.classList.remove('ai-flash'), 1500);
        // Disparar evento input manualmente para filtrar
        searchInput.dispatchEvent(new Event('input'));
    }
}
