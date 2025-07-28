// **IMPORTANTE**: Reemplaza 'YOUR_MAPBOX_ACCESS_TOKEN' con tu token de acceso de Mapbox.
// Puedes obtener uno en https://account.mapbox.com/access-tokens/
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FtdWVsZ2I0OCIsImEiOiJjbWQzNnU0N3UwMWlhMmtwbDYwdGM0NmF5In0.iSeNiG3K2lv4-RboIJa3EQ';

let map;
let geocoders = {};
let selectedLocations = {
    origin: null,
    destination: null,
    waypoints: {}
};
let markers = [];
let routeLayers = [];
let watchId = null; // Variable para almacenar el ID del watcher de geolocalización
let currentLocationMarker = null; // Marcador para la ubicación actual del usuario

// Costos por kilómetro según el tipo de vehículo
const COST_PER_KM = {
    car: 1700,
    motorcycle: 1200
};

// Coordenadas de Bogotá para el centro inicial del mapa
const BOGOTA_CENTER = [-74.072092, 4.710989];
const INITIAL_ZOOM = 12;

// Dirección y coordenadas para el botón "Laurel"
const LAUREL_ADDRESS = 'Cll 56 # 62-67 Itagüí';

// Referencias a elementos del DOM (estas son globales porque se usan en múltiples funciones)
const originInputContainer = document.getElementById('originInputContainer');
const destinationInputContainer = document.getElementById('destinationInputContainer');
const waypointsContainer = document.getElementById('waypointsContainer');
const alternativesList = document.getElementById('alternativesList');
const routeSummaryCard = document.getElementById('routeSummaryCard');
const routeTimeSpan = document.getElementById('routeTime');
const routeDistanceSpan = document.getElementById('routeDistance');
const routeCostSpan = document.getElementById('routeCost');
const vehicleTypeSelect = document.getElementById('vehicleType');
const addWaypointBtn = document.getElementById("addWaypointBtn");
const calculateRouteBtn = document.getElementById("calculateRouteBtn");
const clearFieldsBtn = document.getElementById("clearFieldsBtn");
const shareRouteBtn = document.getElementById("shareRouteBtn");
const laurelBtn = document.getElementById("laurelBtn");
// La referencia a startTrackingBtn se obtiene dentro de initMapbox para asegurar que el DOM esté listo

// Umbral de aumento de tiempo para considerar una ruta "colapsada"
const COLLAPSED_THRESHOLD_PERCENT = 0.25; // 25%

function initMapbox() {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12', // Estilo base
        center: BOGOTA_CENTER, // Centro inicial (Bogotá)
        zoom: INITIAL_ZOOM
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // Inicializar geocoders de origen y destino
    geocoders.origin = createGeocoder('originInputContainer', 'Buscar origen...', 'origin');
    geocoders.destination = createGeocoder('destinationInputContainer', 'Buscar destino...', 'destination');

    // Event listener para el botón "Laurel"
    laurelBtn.addEventListener("click", () => {
        setOriginFromLaurel();
    });

    // Añadir event listeners a los botones principales
    calculateRouteBtn.addEventListener("click", calculateAndDisplayRoute);
    addWaypointBtn.addEventListener("click", addWaypointInput);
    clearFieldsBtn.addEventListener("click", clearAllFields);
    shareRouteBtn.addEventListener("click", shareRouteViaWhatsApp);
    vehicleTypeSelect.addEventListener("change", calculateAndDisplayRoute);

    // **CORRECCIÓN:** Obtener la referencia al botón "startTrackingBtn" aquí,
    // dentro de la función que se ejecuta cuando el DOM ya está cargado.
    const startTrackingBtn = document.getElementById("startTrackingBtn"); 
    if (startTrackingBtn) { 
        startTrackingBtn.addEventListener("click", toggleTracking);
    } else {
        // Esto solo debería ocurrir si el ID del botón en el HTML está mal
        console.error("Error: El botón 'startTrackingBtn' no se encontró en el DOM. Asegúrate de que el ID es correcto.");
    }
}

/**
 * Crea e inicializa un nuevo Mapbox Geocoder.
 * @param {string} containerId - El ID del elemento DOM donde se insertará el geocodificador.
 * @param {string} placeholderText - Texto de marcador de posición para el campo de entrada.
 * @param {string} type - Tipo de ubicación ('origin', 'destination', 'waypoint').
 * @param {number|null} index - Índice para waypoints, o null para origen/destino.
 * @returns {MapboxGeocoder} La instancia del geocodificador.
 */
function createGeocoder(containerId, placeholderText, type, index = null) {
    const geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken,
        mapboxgl: mapboxgl,
        marker: false, // No queremos que el geocodificador añada su propio marcador, lo haremos nosotros
        placeholder: placeholderText,
        types: 'country,region,place,postcode,locality,neighborhood,address'
    });
    document.getElementById(containerId).appendChild(geocoder.onAdd(map));

    // Guardar el último resultado seleccionado para el geocodificador.
    geocoder.on('result', (e) => {
        const coords = e.result.geometry.coordinates;
        if (index !== null) {
            selectedLocations.waypoints[`waypoint${index}`] = coords;
            updateMarker(`waypoint${index}`, coords);
        } else {
            selectedLocations[type] = coords;
            updateMarker(type, coords);
        }
        geocoder.lastSelectedResult = e.result; // Guarda el resultado completo para el WhatsApp
        calculateAndDisplayRoute(); // Recalcular ruta automáticamente al seleccionar un punto
    });

    geocoder.on('clear', () => {
        if (index !== null) {
            delete selectedLocations.waypoints[`waypoint${index}`];
            removeMarker(`waypoint${index}`);
        } else {
            selectedLocations[type] = null;
            removeMarker(type);
        }
        geocoder.lastSelectedResult = null; // Limpiar el resultado guardado
        
        // Si se limpia un campo importante, limpiar rutas y resumen
        if (type === 'origin' || type === 'destination' || (index !== null && Object.keys(selectedLocations.waypoints).length === 0)) {
            clearRouteSummary();
            clearRoutes();
        }
    });

    return geocoder;
}

/**
 * Establece la dirección de origen usando la dirección predefinida "Laurel".
 */
function setOriginFromLaurel() {
    // Si el geocodificador de origen ya tiene la dirección de Laurel, no hacer nada para evitar recargas innecesarias
    if (geocoders.origin.input && geocoders.origin.input.value === LAUREL_ADDRESS) {
        return;
    }
    // Disparar la búsqueda programáticamente
    geocoders.origin.query(LAUREL_ADDRESS);
    // El evento 'result' del geocodificador se encargará de actualizar selectedLocations.origin,
    // dibujar el marcador y calcular la ruta si hay un destino.
}

/**
 * Elimina un marcador específico del mapa.
 * @param {string} type - El tipo de marcador a eliminar ('origin', 'destination', 'waypointX').
 */
function removeMarker(type) {
    markers = markers.filter(marker => {
        if (marker.properties && marker.properties.type === type) {
            marker.remove();
            return false; // Eliminar este marcador del array
        }
        return true; // Mantener otros marcadores
    });
}

/**
 * Actualiza o añade un marcador en el mapa.
 * @param {string} type - El tipo de marcador ('origin', 'destination', 'waypointX').
 * @param {Array<number>} coordinates - Las coordenadas [lng, lat] del marcador.
 */
function updateMarker(type, coordinates) {
    removeMarker(type); // Eliminar el marcador anterior si existe para este tipo

    const el = document.createElement('div');
    el.className = `marker ${type}`; // Añade clases CSS para diferentes tipos de marcadores

    const newMarker = new mapboxgl.Marker(el)
        .setLngLat(coordinates)
        .addTo(map);

    newMarker.properties = { type: type }; // Guardar el tipo en las propiedades del marcador para fácil identificación
    markers.push(newMarker);

    // Ajustar el mapa para que muestre los marcadores iniciales (origen, destino)
    // No hacer esto constantemente mientras se rastrea la ubicación
    if (type === 'origin' || type === 'destination') { // Solo al agregar origen/destino inicialmente
        fitMapToBounds();
    }
}

/**
 * Añade un nuevo campo de entrada para una parada (waypoint) dinámica.
 */
function addWaypointInput() {
    // Buscar el índice más alto existente para asegurar un ID único y orden correcto
    let maxIndex = -1;
    document.querySelectorAll('[id^="waypoint-input-group-"]').forEach(el => {
        const idNum = parseInt(el.id.replace('waypoint-input-group-', ''));
        if (!isNaN(idNum) && idNum > maxIndex) {
            maxIndex = idNum;
        }
    });
    const waypointIndex = maxIndex + 1;

    const div = document.createElement("div");
    div.classList.add("mb-2", "waypoint-input-group");
    div.id = `waypoint-input-group-${waypointIndex}`;

    const inputContainerId = `waypointInputContainer-${waypointIndex}`;
    div.innerHTML = `
        <div id="${inputContainerId}" class="waypoint-input-container"></div>
        <button class="btn btn-outline-danger remove-waypoint-btn" data-waypoint-index="${waypointIndex}">
            <i class="bi bi-x-lg"></i>
        </button>
    `;
    waypointsContainer.appendChild(div);

    const geocoder = createGeocoder(inputContainerId, `Parada ${waypointIndex + 1}...`, 'waypoint', waypointIndex);
    geocoders[`waypoint${waypointIndex}`] = geocoder;

    div.querySelector(".remove-waypoint-btn").addEventListener("click", function() {
        const indexToRemove = parseInt(this.dataset.waypoint-index);
        
        if (geocoders[`waypoint${indexToRemove}`]) {
            geocoders[`waypoint${indexToRemove}`].clear(); // Limpiar el geocoder de Mapbox
            const geocoderElement = document.getElementById(inputContainerId);
            if (geocoderElement) geocoderElement.innerHTML = ''; // Eliminar contenido del geocoder
            
            delete geocoders[`waypoint${indexToRemove}`];
            delete selectedLocations.waypoints[`waypoint${indexToRemove}`];
            removeMarker(`waypoint${indexToRemove}`);
        }
        div.remove(); // Eliminar el div del waypoint del DOM
        updateWaypointPlaceholders(); // Reordenar placeholders de los waypoints restantes
        calculateAndDisplayRoute(); // Recalcular ruta
    });
}

/**
 * Actualiza los placeholders de los inputs de waypoints y sus índices después de añadir/eliminar.
 */
function updateWaypointPlaceholders() {
    const waypointInputGroups = document.querySelectorAll(".waypoint-input-group");
    let newGeocoders = {};
    let newSelectedWaypoints = {};
    
    // Mantener los geocoders de origen y destino sin cambios
    newGeocoders.origin = geocoders.origin;
    newGeocoders.destination = geocoders.destination;

    let currentWaypointIndex = 0;
    waypointInputGroups.forEach(group => {
        const inputContainer = group.querySelector(".waypoint-input-container");
        const oldIndex = parseInt(group.id.replace('waypoint-input-group-', ''));
        
        // Renombrar el ID del grupo y el contenedor del input para reflejar el nuevo índice
        group.id = `waypoint-input-group-${currentWaypointIndex}`;
        inputContainer.id = `waypointInputContainer-${currentWaypointIndex}`;
        
        // Obtener la instancia del geocoder actual que estaba en el índice antiguo
        let geocoderInstance = geocoders[`waypoint${oldIndex}`];
        if (geocoderInstance) {
            // Actualizar placeholder del input visible
            const input = inputContainer.querySelector('input');
            if (input) {
                input.placeholder = `Parada ${currentWaypointIndex + 1}...`;
            }
            // Actualizar data-waypoint-index del botón de remover para que apunte al nuevo índice
            const removeBtn = group.querySelector('.remove-waypoint-btn');
            if (removeBtn) {
                removeBtn.dataset.waypointIndex = currentWaypointIndex;
            }

            // Mover la instancia del geocoder a la nueva clave en newGeocoders
            newGeocoders[`waypoint${currentWaypointIndex}`] = geocoderInstance;
            
            // Mover las coordenadas seleccionadas a la nueva clave en newSelectedWaypoints
            if (selectedLocations.waypoints[`waypoint${oldIndex}`]) {
                newSelectedWaypoints[`waypoint${currentWaypointIndex}`] = selectedLocations.waypoints[`waypoint${oldIndex}`];
            }
            
            // Eliminar listeners antiguos y añadir nuevos con el índice actualizado
            // Esto es crucial para que los geocodificadores sigan actualizando el waypoint correcto
            geocoderInstance.off('result');
            geocoderInstance.off('clear');
            geocoderInstance.on('result', (e) => {
                selectedLocations.waypoints[`waypoint${currentWaypointIndex}`] = e.result.geometry.coordinates;
                updateMarker(`waypoint${currentWaypointIndex}`, e.result.geometry.coordinates);
                geocoderInstance.lastSelectedResult = e.result;
                calculateAndDisplayRoute();
            });
            geocoderInstance.on('clear', () => {
                delete selectedLocations.waypoints[`waypoint${currentWaypointIndex}`];
                removeMarker(`waypoint${currentWaypointIndex}`);
                geocoderInstance.lastSelectedResult = null;
                calculateAndDisplayRoute();
            });

            currentWaypointIndex++;
        }
    });

    // Reemplazar los objetos geocoders y selectedLocations.waypoints con los nuevos objetos reordenados
    geocoders = newGeocoders;
    selectedLocations.waypoints = newSelectedWaypoints;

    // Actualizar los marcadores de las paradas en el mapa para reflejar el nuevo orden
    markers = markers.filter(marker => !marker.properties || !marker.properties.type.startsWith('waypoint'));
    for (const key in selectedLocations.waypoints) {
        updateMarker(key, selectedLocations.waypoints[key]);
    }
}


/**
 * Calcula y muestra la ruta en el mapa, incluyendo alternativas.
 */
async function calculateAndDisplayRoute() {
    clearRoutes(); // Limpiar rutas existentes antes de dibujar nuevas
    clearRouteSummary(); // Limpiar resumen

    const originCoords = selectedLocations.origin;
    const destinationCoords = selectedLocations.destination;

    if (!originCoords || !destinationCoords) {
        // No alertar, simplemente no calcular la ruta si falta un punto clave
        return; 
    }

    const coordinates = [
        [originCoords[0], originCoords[1]]
    ];

    // Recopilar coordenadas de waypoints en el orden correcto
    const waypointKeys = Object.keys(selectedLocations.waypoints)
        .filter(key => key.startsWith('waypoint'))
        .sort((a, b) => {
            const indexA = parseInt(a.replace('waypoint', ''));
            const indexB = parseInt(b.replace('waypoint', ''));
            return indexA - indexB;
        });

    waypointKeys.forEach(key => {
        const waypointCoords = selectedLocations.waypoints[key];
        if (waypointCoords) {
            coordinates.push([waypointCoords[0], waypointCoords[1]]);
        }
    });

    coordinates.push([destinationCoords[0], destinationCoords[1]]);

    if (coordinates.length < 2) {
        // Esto debería ser manejado por la verificación inicial de originCoords y destinationCoords
        return; 
    }

    // URL para la API de Directions de Mapbox
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates.map(c => c.join(',')).join(';')}?alternatives=true&geometries=geojson&steps=true&overview=full&access_token=${mapboxgl.accessToken}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            let routes = data.routes;
            
            // Ordenar rutas por duración (la más rápida primero)
            routes.sort((a, b) => a.duration - b.duration);

            let principalRoute = routes[0];
            let finalRoutes = [principalRoute];

            // Considerar alternativas, pero la lógica de "colapsado" puede no ser tan relevante sin datos de tráfico en tiempo real
            if (routes.length > 1) {
                if (routes[0].duration > routes[1].duration * (1 + COLLAPSED_THRESHOLD_PERCENT)) {
                    console.log("Primera ruta parece subóptima (más del 25% más lenta que la segunda). Sugiriendo alternativa.");
                    principalRoute = routes[1]; // La segunda ruta es ahora la principal
                    
                    finalRoutes = [principalRoute]; // Asegurar que la principal esté primero
                    routes.forEach(r => {
                        if (r !== principalRoute) {
                            finalRoutes.push(r);
                        }
                    });
                } else {
                    // Si la primera ruta no es significativamente peor, mostrar todas las rutas
                    routes.forEach(r => {
                        if (r !== principalRoute) {
                            finalRoutes.push(r);
                        }
                    });
                }
            }
            
            displayRouteAlternatives(finalRoutes);

        } else {
            alert("No se encontraron rutas para la combinación de puntos especificada. Intenta ser más específico con las direcciones.");
            console.error("No routes found:", data);
        }
    } catch (error) {
        console.error("Error al obtener la ruta:", error);
        alert("Ocurrió un error al calcular la ruta.");
    }
}

/**
 * Muestra las alternativas de ruta en la lista y las dibuja en el mapa.
 * @param {Array<Object>} routes - Array de objetos de ruta de la API de Mapbox.
 */
function displayRouteAlternatives(routes) {
    alternativesList.innerHTML = "";
    clearRoutes(); // Asegurarse de limpiar las rutas dibujadas antes de dibujar nuevas

    routes.forEach((route, index) => {
        const geojson = {
            type: 'Feature',
            properties: {},
            geometry: route.geometry
        };

        const layerId = `route-${index}`;
        map.addSource(layerId, {
            type: 'geojson',
            data: geojson
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: layerId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': index === 0 ? '#F48FB1' : '#E0E0E0', // Rosado para la principal, gris claro para alternativas
                'line-width': 6,
                'line-opacity': index === 0 ? 0.8 : 0.5
            }
        });
        routeLayers.push(layerId); // Guardar el ID de la capa para poder eliminarla luego

        const li = document.createElement("li");
        li.classList.add("list-group-item", "list-group-item-action");
        
        const durationHours = Math.floor(route.duration / 3600);
        const durationMinutes = Math.round((route.duration % 3600) / 60);
        const distanceKm = (route.distance / 1000).toFixed(1);

        let timeText = "";
        if (durationHours > 0) {
            timeText += `${durationHours}h `;
        }
        timeText += `${durationMinutes}min`;

        li.innerHTML = `Ruta ${index + 1}: <strong>~${timeText}</strong> - ${distanceKm} km`;
        li.dataset.routeIndex = index; // Guardar el índice de la ruta para referencia
        li.dataset.duration = route.duration;
        li.dataset.distance = route.distance;

        li.addEventListener("click", () => {
            highlightSelectedAlternative(index);
            displayRouteSummary(route.duration, route.distance);
        });
        alternativesList.appendChild(li);
    });

    // Por defecto, resaltar y mostrar el resumen de la primera ruta (la más rápida)
    if (routes.length > 0) {
        highlightSelectedAlternative(0);
        displayRouteSummary(routes[0].duration, routes[0].distance);
    }
    fitMapToBounds(); // Ajustar el mapa para mostrar todas las rutas y marcadores
}

/**
 * Resalta la alternativa de ruta seleccionada en la lista y en el mapa.
 * @param {number} selectedIndex - El índice de la ruta a resaltar.
 */
function highlightSelectedAlternative(selectedIndex) {
    const alternatives = document.querySelectorAll("#alternativesList .list-group-item");
    alternatives.forEach((item, index) => {
        const layerId = `route-${index}`;
        if (index === selectedIndex) {
            item.classList.add("active");
            if (map.getLayer(layerId)) {
                map.setPaintProperty(layerId, 'line-color', '#F48FB1'); // Color principal
                map.setPaintProperty(layerId, 'line-width', 6);
                map.setPaintProperty(layerId, 'line-opacity', 0.8);
            }
        } else {
            item.classList.remove("active");
            if (map.getLayer(layerId)) {
                map.setPaintProperty(layerId, 'line-color', '#E0E0E0'); // Color de alternativa
                map.setPaintProperty(layerId, 'line-width', 4);
                map.setPaintProperty(layerId, 'line-opacity', 0.5);
            }
        }
    });
}

/**
 * Elimina todas las rutas dibujadas del mapa y limpia la lista de alternativas.
 */
function clearRoutes() {
    routeLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(layerId)) {
            map.removeSource(layerId);
        }
    });
    routeLayers = []; // Reiniciar la lista de capas de ruta
    alternativesList.innerHTML = ""; // Limpiar la lista de alternativas en el DOM
    clearRouteSummary(); // Limpiar el resumen de la ruta
}

/**
 * Oculta y limpia el panel de resumen de la ruta.
 */
function clearRouteSummary() {
    routeSummaryCard.style.display = 'none';
    routeTimeSpan.textContent = '';
    routeDistanceSpan.textContent = '';
    routeCostSpan.textContent = '';
}

/**
 * Muestra el resumen de la ruta (tiempo, distancia, costo).
 * @param {number} duration - Duración de la ruta en segundos.
 * @param {number} distance - Distancia de la ruta en metros.
 */
function displayRouteSummary(duration, distance) {
    const durationHours = Math.floor(duration / 3600);
    const durationMinutes = Math.round((duration % 3600) / 60);
    const distanceKm = (distance / 1000);

    const selectedVehicleType = vehicleTypeSelect.value;
    const costPerKm = COST_PER_KM[selectedVehicleType];

    const cost = distanceKm * costPerKm;

    const formatter = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    const formattedCost = formatter.format(cost);

    let timeText = "";
    if (durationHours > 0) {
        timeText += `${durationHours}h `;
    }
    timeText += `${durationMinutes}min`;

    routeTimeSpan.textContent = `~${timeText}`;
    routeDistanceSpan.textContent = `${distanceKm.toFixed(1)} km`;
    routeCostSpan.textContent = formattedCost;
    routeSummaryCard.style.display = 'block'; // Mostrar el panel de resumen
}


/**
 * Ajusta la vista del mapa para que todos los marcadores y la ruta visible sean visibles.
 */
function fitMapToBounds() {
    // Incluir el marcador de ubicación actual si está activo
    const allMarkers = markers.concat(currentLocationMarker ? [currentLocationMarker] : []);

    if (allMarkers.length === 0) {
        // Si no hay marcadores, centrar el mapa en Bogotá
        map.flyTo({ center: BOGOTA_CENTER, zoom: INITIAL_ZOOM });
        return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    allMarkers.forEach(marker => bounds.extend(marker.getLngLat()));

    // Extender los límites para incluir las coordenadas de la ruta actual
    routeLayers.forEach(layerId => {
        if (map.getSource(layerId) && map.getSource(layerId)._data) {
            const geojson = map.getSource(layerId)._data;
            if (geojson.geometry && geojson.geometry.coordinates) {
                geojson.geometry.coordinates.forEach(coord => {
                    bounds.extend(coord);
                });
            }
        }
    });

    if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
            padding: { top: 70, bottom: 50, left: 450, right: 50 }, // Ajusta para el sidebar en desktop
            maxZoom: 15 // No hacer un zoom excesivo
        });

        // Ajuste de padding para móviles (sidebar en la parte superior)
        if (window.innerWidth < 992) { 
             map.fitBounds(bounds, {
                padding: { top: 50, bottom: (window.innerHeight * 0.5) + 50, left: 50, right: 50 }, // Padding inferior para mostrar el mapa sobre el panel de control
                maxZoom: 15
            });
        }
    }
}

/**
 * Limpia todos los campos de entrada, marcadores y rutas del mapa.
 */
function clearAllFields() {
    stopTracking(); // Detener el rastreo si está activo al limpiar todo

    // Limpiar los Geocoders (esto también limpia sus inputs)
    geocoders.origin.clear();
    geocoders.destination.clear();

    // Limpiar todos los inputs de paradas dinámicas
    const waypointGroups = document.querySelectorAll(".waypoint-input-group");
    waypointGroups.forEach(group => group.remove());
    
    // Resetear las ubicaciones seleccionadas
    selectedLocations = {
        origin: null,
        destination: null,
        waypoints: {}
    };

    // Eliminar todos los marcadores del mapa
    markers.forEach(marker => marker.remove());
    markers = [];

    // Limpiar todas las rutas del mapa y la lista de alternativas
    clearRoutes();

    // Limpiar el resumen de la ruta
    clearRouteSummary();

    // Reestablecer el tipo de vehículo a la opción por defecto
    vehicleTypeSelect.value = 'car';

    // Centrar el mapa en el centro predeterminado (Bogotá)
    map.flyTo({ center: BOGOTA_CENTER, zoom: INITIAL_ZOOM });

    console.log("Todos los campos y el mapa han sido limpiados.");
}

/**
 * Comparte la ruta y sus detalles por WhatsApp.
 */
function shareRouteViaWhatsApp() {
    // Es crucial obtener el place_name del último resultado para tener la dirección completa
    const originAddress = geocoders.origin.lastSelectedResult ? geocoders.origin.lastSelectedResult.place_name : null;
    const destinationAddress = geocoders.destination.lastSelectedResult ? geocoders.destination.lastSelectedResult.place_name : null;

    if (!originAddress || !selectedLocations.origin) {
        alert('Por favor, ingresa un Origen válido para compartir la ruta.');
        return;
    }
    if (!destinationAddress || !selectedLocations.destination) {
        alert('Por favor, ingresa un Destino válido para compartir la ruta.');
        return;
    }

    // Construir la URL de Google Maps para la ruta
    // Formato de Google Maps para múltiples paradas: /dir/Origen/Parada1/Parada2/Destino
    let googleMapsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(originAddress)}`;

    const waypointAddresses = [];
    // Ordenar los waypoints por su índice para la URL
    const waypointKeys = Object.keys(geocoders)
        .filter(key => key.startsWith('waypoint'))
        .sort((a, b) => {
            const indexA = parseInt(a.replace('waypoint', ''));
            const indexB = parseInt(b.replace('waypoint', ''));
            return indexA - indexB;
        });

    waypointKeys.forEach(key => {
        const geocoder = geocoders[key];
        // Asegurarse de que el geocoder exista y tenga un resultado seleccionado
        if (geocoder && geocoder.lastSelectedResult) {
            waypointAddresses.push(encodeURIComponent(geocoder.lastSelectedResult.place_name));
        }
    });

    if (waypointAddresses.length > 0) {
        googleMapsUrl += `/${waypointAddresses.join('/')}`;
    }

    googleMapsUrl += `/${encodeURIComponent(destinationAddress)}`;
    googleMapsUrl += `?travelmode=driving`; // Modo de viaje en carro

    // Obtener la información de la ruta calculada (tiempo, distancia, costo)
    const routeTimeText = routeTimeSpan.textContent;
    const routeDistanceText = routeDistanceSpan.textContent;
    const routeCostText = routeCostSpan.textContent;

    // Construir el mensaje para WhatsApp
    let message = `¡Hola! Aquí tienes la información de tu ruta:\n\n`;
    message += `📍 Origen: ${originAddress}\n`;

    if (waypointAddresses.length > 0) {
        waypointAddresses.forEach((wp, index) => {
            message += `➡️ Parada ${index + 1}: ${decodeURIComponent(wp)}\n`;
        });
    }

    message += `🏁 Destino: ${destinationAddress}\n\n`;
    message += `Tiempo estimado: ${routeTimeText}\n`;
    message += `Distancia: ${routeDistanceText}\n`;
    message += `Costo estimado: ${routeCostText}\n\n`;
    message += `Ver en Google Maps: ${googleMapsUrl}`;

    // Codificar el mensaje para la URL de WhatsApp
    const whatsappMessage = encodeURIComponent(message);

    // Solicitar al usuario el número de contacto
    const phoneNumber = prompt("Ingresa el número de WhatsApp (incluye el código de país, ej: 57310XXXXXXX):");

    if (phoneNumber) {
        // Abrir WhatsApp con el mensaje pre-rellenado
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${whatsappMessage}`;
        window.open(whatsappUrl, '_blank');
    } else {
        alert("Número de teléfono no ingresado. La ruta no se compartió por WhatsApp.");
    }
}

// --- NUEVAS FUNCIONES PARA RASTREO EN TIEMPO REAL ---

/**
 * Actualiza la posición del marcador de la ubicación actual del usuario en el mapa.
 * @param {Array<number>} coords - Las coordenadas [lng, lat] de la ubicación actual.
 */
function updateCurrentLocationMarker(coords) {
    if (currentLocationMarker) {
        currentLocationMarker.setLngLat(coords);
    } else {
        const el = document.createElement('div');
        el.className = 'marker current-location'; // Clase CSS para el marcador de ubicación actual

        currentLocationMarker = new mapboxgl.Marker(el)
            .setLngLat(coords)
            .addTo(map);
    }
    // Centrar el mapa en la ubicación actual del usuario
    // Se usa flyTo para una animación suave, con un 'speed' y 'curve' para control.
    // El 'offset' puede ser útil si el sidebar ocupa mucho espacio y quieres centrar la vista en el mapa.
    map.flyTo({ 
        center: coords, 
        speed: 0.8, // Velocidad de la animación
        curve: 1, // Curva de la animación
        easing: (t) => t, // Función de suavizado
        // offset: [window.innerWidth > 991.98 ? 200 : 0, 0] // Desplaza a la derecha si es desktop para el sidebar
    });
}

/**
 * Función de éxito que se llama cuando se obtiene la geolocalización.
 * @param {GeolocationPosition} position - Objeto de posición que contiene las coordenadas.
 */
function onGeolocationSuccess(position) {
    const { latitude, longitude } = position.coords;
    const coords = [longitude, latitude];
    console.log("Ubicación actual:", coords);
    updateCurrentLocationMarker(coords);
}

/**
 * Función de error que se llama si no se puede obtener la geolocalización.
 * @param {GeolocationPositionError} error - Objeto de error de geolocalización.
 */
function onGeolocationError(error) {
    console.error("Error al obtener la ubicación:", error);
    let errorMessage = "No se pudo obtener la ubicación.";
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errorMessage += " Permiso denegado. Por favor, habilita los permisos de ubicación en tu navegador.";
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage += " Información de ubicación no disponible.";
            break;
        case error.TIMEOUT:
            errorMessage += " La solicitud para obtener la ubicación ha caducado.";
            break;
        default:
            errorMessage += " Error desconocido.";
            break;
    }
    alert(errorMessage + " No se iniciará el rastreo.");
    // Asegurarse de que el botón refleje el estado de inactividad
    const startTrackingBtn = document.getElementById("startTrackingBtn");
    if (startTrackingBtn) {
        startTrackingBtn.textContent = 'Iniciar Ruta y Rastreo';
        startTrackingBtn.classList.remove('btn-danger'); // Si estaba rojo, quitarlo
        startTrackingBtn.classList.add('btn-info'); // Volver al color original
    }
    watchId = null; // Reiniciar el watchId si hubo un error irrecuperable
}

/**
 * Inicia el rastreo de la ubicación del usuario en tiempo real.
 */
function startTracking() {
    if ("geolocation" in navigator) {
        // Opciones para el rastreo (mayor precisión, timeouts)
        const options = {
            enableHighAccuracy: true, // Intentar usar los métodos más precisos (GPS)
            timeout: 10000, // Tiempo máximo para obtener una ubicación (10 segundos)
            maximumAge: 0 // No usar caché de ubicaciones antiguas, siempre una nueva
        };
        // watchPosition monitorea y notifica cambios de posición
        watchId = navigator.geolocation.watchPosition(onGeolocationSuccess, onGeolocationError, options);
        
        const startTrackingBtn = document.getElementById("startTrackingBtn");
        if (startTrackingBtn) {
            startTrackingBtn.textContent = 'Detener Rastreo';
            startTrackingBtn.classList.remove('btn-info');
            startTrackingBtn.classList.add('btn-danger'); // Cambiar a rojo para indicar "detener"
        }
        alert("Rastreo de ubicación iniciado. Tu posición se mostrará en el mapa.");
        console.log("Rastreo de ubicación iniciado con watchId:", watchId);
    } else {
        alert("Tu navegador no soporta la API de Geolocalización. No es posible rastrear la ubicación.");
    }
}

/**
 * Detiene el rastreo de la ubicación del usuario.
 */
function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId); // Detener el monitoreo
        watchId = null; // Reiniciar el ID
        if (currentLocationMarker) {
            currentLocationMarker.remove(); // Eliminar el marcador de la ubicación actual
            currentLocationMarker = null;
        }
        const startTrackingBtn = document.getElementById("startTrackingBtn");
        if (startTrackingBtn) {
            startTrackingBtn.textContent = 'Iniciar Ruta y Rastreo';
            startTrackingBtn.classList.remove('btn-danger');
            startTrackingBtn.classList.add('btn-info'); // Volver al color original
        }
        alert("Rastreo de ubicación detenido.");
        console.log("Rastreo de ubicación detenido.");
    }
}

/**
 * Alterna entre iniciar y detener el rastreo de la ubicación.
 */
function toggleTracking() {
    if (watchId === null) {
        startTracking();
    } else {
        stopTracking();
    }
}

// Asegurarse de que el DOM esté completamente cargado antes de inicializar el mapa
document.addEventListener('DOMContentLoaded', initMapbox);