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

// Costos por kilómetro según el tipo de vehículo
const COST_PER_KM = {
    car: 1700,
    motorcycle: 1200
};

// Referencias a elementos del DOM
const originInputContainer = document.getElementById('originInputContainer');
const destinationInputContainer = document.getElementById('destinationInputContainer');
const waypointsContainer = document.getElementById('waypointsContainer');
const alternativesList = document.getElementById('alternativesList');
const routeSummaryCard = document.getElementById('routeSummaryCard');
const routeTimeSpan = document.getElementById('routeTime');
const routeDistanceSpan = document.getElementById('routeDistance');
const routeCostSpan = document.getElementById('routeCost');
const vehicleTypeSelect = document.getElementById('vehicleType');

// Umbral de aumento de tiempo para considerar una ruta "colapsada" (ya no relevante sin tráfico, pero se mantiene la lógica base)
const COLLAPSED_THRESHOLD_PERCENT = 0.25; // 25%

function initMapbox() {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12', // Estilo base
        center: [-74.072092, 4.710989], // Centro inicial (ej: Bogotá)
        zoom: 12
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    geocoders.origin = createGeocoder('originInputContainer', 'Buscar origen...', 'origin');
    geocoders.destination = createGeocoder('destinationInputContainer', 'Buscar destino...', 'destination');

    document.getElementById("calculateRouteBtn").addEventListener("click", calculateAndDisplayRoute);
    document.getElementById("addWaypointBtn").addEventListener("click", addWaypointInput);
    vehicleTypeSelect.addEventListener("change", calculateAndDisplayRoute); // Recalcula si cambia el tipo de vehículo
}

function createGeocoder(containerId, placeholderText, type, index = null) {
    const geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken,
        mapboxgl: mapboxgl,
        marker: false,
        placeholder: placeholderText,
        types: 'country,region,place,postcode,locality,neighborhood,address'
    });
    document.getElementById(containerId).appendChild(geocoder.onAdd(map));

    geocoder.on('result', (e) => {
        const coords = e.result.geometry.coordinates;
        if (index !== null) {
            selectedLocations.waypoints[`waypoint${index}`] = coords;
            updateMarker(`waypoint${index}`, coords);
        } else {
            selectedLocations[type] = coords;
            updateMarker(type, coords);
        }
    });

    geocoder.on('clear', () => {
        if (index !== null) {
            delete selectedLocations.waypoints[`waypoint${index}`];
            removeMarker(`waypoint${index}`);
        } else {
            selectedLocations[type] = null;
            removeMarker(type);
        }
        if (type === 'origin' || type === 'destination' || (index !== null && Object.keys(selectedLocations.waypoints).length === 0)) {
            clearRouteSummary();
            clearRoutes();
        }
    });

    return geocoder;
}

function removeMarker(type) {
    markers = markers.filter(marker => {
        if (marker.properties && marker.properties.type === type) {
            marker.remove();
            return false;
        }
        return true;
    });
}

function updateMarker(type, coordinates) {
    removeMarker(type);

    const el = document.createElement('div');
    el.className = `marker ${type}`;

    const newMarker = new mapboxgl.Marker(el)
        .setLngLat(coordinates)
        .addTo(map);

    newMarker.properties = { type: type };
    markers.push(newMarker);

    if (markers.length <= 2) {
        fitMapToBounds();
    }
}

function addWaypointInput() {
    const waypointIndex = Object.keys(geocoders).filter(key => key.startsWith('waypoint')).length;

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
        const indexToRemove = parseInt(this.dataset.waypointIndex);
        
        if (geocoders[`waypoint${indexToRemove}`]) {
            geocoders[`waypoint${indexToRemove}`].clear();
            const geocoderElement = document.getElementById(inputContainerId);
            if (geocoderElement) geocoderElement.innerHTML = '';
            
            delete geocoders[`waypoint${indexToRemove}`];
            delete selectedLocations.waypoints[`waypoint${indexToRemove}`];
            removeMarker(`waypoint${indexToRemove}`);
        }
        div.remove();
        updateWaypointPlaceholders();
        calculateAndDisplayRoute();
    });
}

function updateWaypointPlaceholders() {
    const waypointInputContainers = document.querySelectorAll(".waypoint-input-container");
    let newGeocoders = {};
    let newSelectedWaypoints = {};
    let currentWaypointIndex = 0;

    newGeocoders.origin = geocoders.origin;
    newGeocoders.destination = geocoders.destination;

    waypointInputContainers.forEach((container, domIndex) => {
        let originalGeocoderKey = null;
        for (const key in geocoders) {
            if (key.startsWith('waypoint') && geocoders[key].onAdd(map).parentNode === container) {
                originalGeocoderKey = key;
                break;
            }
        }

        if (originalGeocoderKey) {
            const geocoderInstance = geocoders[originalGeocoderKey];
            const input = container.querySelector('input');
            if (input) {
                input.placeholder = `Parada ${currentWaypointIndex + 1}...`;
            }
            const removeBtn = container.closest('.waypoint-input-group').querySelector('.remove-waypoint-btn');
            if (removeBtn) {
                removeBtn.dataset.waypointIndex = currentWaypointIndex;
            }

            newGeocoders[`waypoint${currentWaypointIndex}`] = geocoderInstance;
            if (selectedLocations.waypoints[originalGeocoderKey]) {
                newSelectedWaypoints[`waypoint${currentWaypointIndex}`] = selectedLocations.waypoints[originalGeocoderKey];
            }
            
            geocoderInstance.off('result');
            geocoderInstance.off('clear');
            geocoderInstance.on('result', (e) => {
                selectedLocations.waypoints[`waypoint${currentWaypointIndex}`] = e.result.geometry.coordinates;
                updateMarker(`waypoint${currentWaypointIndex}`, e.result.geometry.coordinates);
            });
            geocoderInstance.on('clear', () => {
                delete selectedLocations.waypoints[`waypoint${currentWaypointIndex}`];
                removeMarker(`waypoint${currentWaypointIndex}`);
                calculateAndDisplayRoute();
            });

            currentWaypointIndex++;
        }
    });

    geocoders = newGeocoders;
    selectedLocations.waypoints = newSelectedWaypoints;

    markers = markers.filter(marker => !marker.properties || !marker.properties.type.startsWith('waypoint'));
    for (const key in selectedLocations.waypoints) {
        updateMarker(key, selectedLocations.waypoints[key]);
    }
}


async function calculateAndDisplayRoute() {
    clearRoutes();
    clearRouteSummary();

    const originCoords = selectedLocations.origin;
    const destinationCoords = selectedLocations.destination;

    if (!originCoords) {
        alert("Por favor, selecciona una ubicación válida para el Origen de la lista de sugerencias.");
        return;
    }
    if (!destinationCoords) {
        alert("Por favor, selecciona una ubicación válida para el Destino de la lista de sugerencias.");
        return;
    }

    const coordinates = [
        [originCoords[0], originCoords[1]]
    ];

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
        alert("Se necesitan al menos un origen y un destino para calcular la ruta.");
        return;
    }

    // Usar el perfil de ruteo 'driving' (sin tráfico)
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates.map(c => c.join(',')).join(';')}?alternatives=true&geometries=geojson&steps=true&overview=full&access_token=${mapboxgl.accessToken}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            let routes = data.routes;
            
            // Ordenar las rutas por duración (siempre es útil mostrar la más rápida primero)
            routes.sort((a, b) => a.duration - b.duration);

            let principalRoute = routes[0];
            let finalRoutes = [principalRoute];

            if (routes.length > 1) {
                // Si la ruta más rápida es significativamente más larga que la siguiente,
                // aún se puede considerar una "alternativa mejor" si la primera es subóptima por alguna razón (ej. muchas vueltas)
                // Aunque sin tráfico explícito, la diferencia debería ser menor.
                if (routes[0].duration > routes[1].duration * (1 + COLLAPSED_THRESHOLD_PERCENT)) {
                    console.log("Primera ruta parece subóptima. Sugiriendo alternativa.");
                    principalRoute = routes[1];
                    
                    finalRoutes = [principalRoute];
                    routes.forEach(r => {
                        if (r !== principalRoute) {
                            finalRoutes.push(r);
                        }
                    });
                } else {
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

function displayRouteAlternatives(routes) {
    alternativesList.innerHTML = "";
    clearRoutes();

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
        routeLayers.push(layerId);

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
        li.dataset.routeIndex = index;
        li.dataset.duration = route.duration;
        li.dataset.distance = route.distance;

        li.addEventListener("click", () => {
            highlightSelectedAlternative(index);
            displayRouteSummary(route.duration, route.distance);
        });
        alternativesList.appendChild(li);
    });

    if (routes.length > 0) {
        highlightSelectedAlternative(0);
        displayRouteSummary(routes[0].duration, routes[0].distance);
    }
    fitMapToBounds();
}

function highlightSelectedAlternative(selectedIndex) {
    const alternatives = document.querySelectorAll("#alternativesList .list-group-item");
    alternatives.forEach((item, index) => {
        const layerId = `route-${index}`;
        if (index === selectedIndex) {
            item.classList.add("active");
            if (map.getLayer(layerId)) {
                map.setPaintProperty(layerId, 'line-color', '#F48FB1'); // Rosado principal
                map.setPaintProperty(layerId, 'line-width', 6);
                map.setPaintProperty(layerId, 'line-opacity', 0.8);
            }
        } else {
            item.classList.remove("active");
            if (map.getLayer(layerId)) {
                map.setPaintProperty(layerId, 'line-color', '#E0E0E0'); // Gris claro para alternativas
                map.setPaintProperty(layerId, 'line-width', 4);
                map.setPaintProperty(layerId, 'line-opacity', 0.5);
            }
        }
    });
}

function clearRoutes() {
    routeLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(layerId)) {
            map.removeSource(layerId);
        }
    });
    routeLayers = [];
    alternativesList.innerHTML = "";
    clearRouteSummary();
}

function clearRouteSummary() {
    routeSummaryCard.style.display = 'none';
    routeTimeSpan.textContent = '';
    routeDistanceSpan.textContent = '';
    routeCostSpan.textContent = '';
}

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
    routeSummaryCard.style.display = 'block';
}


function fitMapToBounds() {
    if (markers.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    markers.forEach(marker => bounds.extend(marker.getLngLat()));

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
            maxZoom: 15
        });

        // Ajuste de padding para móviles
        if (window.innerWidth < 992) { // Si es una pantalla pequeña (menos de 992px de ancho)
             map.fitBounds(bounds, {
                padding: { top: 50, bottom: (window.innerHeight * 0.5) + 50, left: 50, right: 50 }, // Padding inferior para mostrar el mapa sobre el panel de control
                maxZoom: 15
            });
        }
    }
}

// Se eliminan las funciones de startTrackingLocation, stopTrackingLocation y showError

document.addEventListener('DOMContentLoaded', initMapbox);