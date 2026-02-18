import { db } from './firebase-config.js';
import { collection, updateDoc, doc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let ordersCache = [];
let unsubOrders = null;
let inputOrderSearch, btnSearchOrder, btnClearSearch, filterDateMode, filterDateInput;

export async function init() {
    console.log("Inicializando sección Producción...");
    
    inputOrderSearch = document.getElementById('inputOrderSearch');
    btnSearchOrder = document.getElementById('btnSearchOrder');
    btnClearSearch = document.getElementById('btnClearSearch');
    filterDateMode = document.getElementById('filterDateMode');
    filterDateInput = document.getElementById('filterDateInput');

    // Listeners de Filtros de Fecha
    filterDateMode.addEventListener('change', () => {
        if (filterDateMode.value === 'date') {
            filterDateInput.classList.remove('d-none');
            if (!filterDateInput.value) filterDateInput.valueAsDate = new Date(); // Por defecto hoy
        } else {
            filterDateInput.classList.add('d-none');
        }
        updateKanbanView();
    });
    filterDateInput.addEventListener('change', updateKanbanView);

    // Listeners de búsqueda
    btnSearchOrder.addEventListener('click', performOrderSearch);
    inputOrderSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performOrderSearch();
    });
    btnClearSearch.addEventListener('click', () => {
        inputOrderSearch.value = '';
        updateKanbanView();
    });

    // Cargar datos
    initDataListeners();

    // Exponer funciones globales necesarias para el HTML de esta sección
    window.cycleOrderState = cycleOrderState;
    window.printLabel = printLabel;
    window.exportToCSV = exportToCSV;
}

export function destroy() {
    console.log("Limpiando sección Producción...");
    if (unsubOrders) unsubOrders();
}

function initDataListeners() {
    const qOrders = query(collection(db, "pedidos"), orderBy("fecha", "desc"));
    unsubOrders = onSnapshot(qOrders, (snapshot) => {
        ordersCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`📦 Pedidos: ${ordersCache.length} pedidos.`);
        updateKanbanView();
    });
}

function updateKanbanView() {
    if (inputOrderSearch.value.trim() !== '') performOrderSearch();
    else renderFilteredOrders();
}

function renderFilteredOrders() {
    btnClearSearch.classList.add('d-none');
    const mode = filterDateMode.value;
    let filtered = [];

    if (mode === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        filtered = ordersCache.filter(o => o.fecha && o.fecha.toDate() >= startOfDay);
    } else if (mode === 'all') {
        filtered = ordersCache;
    } else if (mode === 'date') {
        const dateVal = filterDateInput.value;
        if (dateVal) {
            filtered = ordersCache.filter(o => {
                if (!o.fecha) return false;
                const d = o.fecha.toDate();
                // Comparar fecha local YYYY-MM-DD
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}` === dateVal;
            });
        }
    }
    renderOrders(filtered);
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
    const cols = ['col-gris', 'col-amarillo', 'col-azul', 'col-verde'];
    if (!document.getElementById('col-gris')) return;
    cols.forEach(id => document.getElementById(id).innerHTML = '');
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

async function cycleOrderState(id, currentState) {
    const states = ['gris', 'amarillo', 'azul', 'verde'];
    const nextState = states[(states.indexOf(currentState) + 1) % states.length];
    try { await updateDoc(doc(db, "pedidos", id), { estado: nextState }); } catch (e) { console.error(e); }
}

function printLabel(orderId) {
    document.getElementById('printAlumno').innerText = "Alumno Ejemplo";
    document.getElementById('printQR').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${orderId}" />`;
    window.print();
}

function exportToCSV() {
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
}