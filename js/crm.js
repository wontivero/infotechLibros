import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export async function init() {
    console.log("Inicializando sección CRM...");
    loadCRM();
}

export function destroy() {
    // Nada que limpiar por ahora (no hay listeners en vivo)
}

async function loadCRM() {
    const container = document.getElementById('crmContainer');
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-warning"></div></div>';

    try {
        const q = query(collection(db, "interesados_waitlist"), orderBy("date", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<div class="alert alert-secondary">No hay nadie en lista de espera.</div>';
            return;
        }

        const grouped = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const key = data.bookTitle || "Libros Varios";
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ id: doc.id, ...data });
        });

        let html = '<div class="accordion" id="crmAccordion">';
        let i = 0;
        for (const [bookTitle, leads] of Object.entries(grouped)) {
            i++;
            html += `<div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${i}"><span class="badge bg-danger me-2">${leads.length}</span> ${bookTitle}</button></h2><div id="collapse${i}" class="accordion-collapse collapse" data-bs-parent="#crmAccordion"><div class="accordion-body p-0"><ul class="list-group list-group-flush">${leads.map(lead => `<li class="list-group-item d-flex justify-content-between align-items-center"><span>${lead.name} <small class="text-muted">(${lead.phone})</small></span><a href="https://wa.me/549${lead.phone}?text=${encodeURIComponent('Hola! Te aviso que ya conseguimos el libro ' + bookTitle)}" target="_blank" class="btn btn-sm btn-success"><i class="bi bi-whatsapp"></i> Avisar</a></li>`).join('')}</ul></div></div></div>`;
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (error) { console.error("Error CRM:", error); container.innerHTML = '<div class="alert alert-danger">Error al cargar datos del CRM.</div>'; }
}