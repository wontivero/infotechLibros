// Controlador Principal de la SPA

let currentModule = null;

document.addEventListener('DOMContentLoaded', () => {
    // Cargar la sección inicial (Home/Dashboard)
    loadSection('home');
});

async function loadSection(sectionName) {
    const mainContent = document.getElementById('main-content');
    
    // 1. Mostrar indicador de carga (opcional)
    mainContent.innerHTML = '<div class="text-center mt-5"><div class="spinner-border text-primary"></div></div>';

    try {
        // Limpiar módulo anterior si existe
        if (currentModule && currentModule.destroy) {
            currentModule.destroy();
            currentModule = null;
        }

        // 2. Cargar HTML de la sección
        let response = await fetch(`js/${sectionName}.html`);
        
        // Si no lo encuentra en js/, intentamos buscarlo en la raíz (útil para home.html)
        if (!response.ok) {
            response = await fetch(`${sectionName}.html`);
        }

        if (!response.ok) throw new Error(`No se pudo cargar la sección: ${sectionName}`);
        const html = await response.text();
        mainContent.innerHTML = html;

        // 3. Cargar JS dinámicamente (Módulo)
        // Usamos timestamp para evitar caché agresivo durante desarrollo
        const module = await import(`./${sectionName}.js?t=${Date.now()}`);
        currentModule = module;
        
        // 4. Inicializar la sección
        if (module.init) {
            await module.init();
        }
        
        // Actualizar menú activo
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-link[onclick="loadSection('${sectionName}')"]`);
        if (activeLink) activeLink.classList.add('active');

        // Cerrar menú móvil si está abierto
        const navbarCollapse = document.getElementById('navbarNav');
        const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
        if (bsCollapse) bsCollapse.hide();

    } catch (error) {
        console.error("Error cargando sección:", error);
        mainContent.innerHTML = `<div class="alert alert-danger m-4">Error al cargar la sección: ${error.message}</div>`;
    }
}

// Exportar para usar en onclicks si fuera necesario navegar desde HTML
window.loadSection = loadSection;
