// --- CONFIGURATION ---
// Plus besoin de clé API avec BRouter !
let waypoints = [];
let markers = [];
let currentProfile = 'foot-hiking'; // Mode par défaut

// --- INITIALISATION DE LA CARTE ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'osm': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' },
            'hiking-trails': { type: 'raster', tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'], tileSize: 256, attribution: '| Randos &copy; Waymarked Trails' },
            'terrainSource': { type: 'raster-dem', url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json', tileSize: 256 }
        },
        layers: [
            { id: 'osm-layer', type: 'raster', source: 'osm' },
            { id: 'hillshade-layer', type: 'hillshade', source: 'terrainSource', paint: { 'hillshade-shadow-color': '#473b24', 'hillshade-exaggeration': 0.6 } },
            { id: 'hiking-layer', type: 'raster', source: 'hiking-trails', minzoom: 12, paint: { 'raster-opacity': 0.4 }, layout: { 'visibility': 'visible' } }
        ],
        terrain: { source: 'terrainSource', exaggeration: 1.5 }
    },
    center: [6.865, 45.923], // Chamonix
    zoom: 12, pitch: 65, bearing: 15
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }));

// --- GESTION DE L'INTERFACE UI ---
const sidebar = document.getElementById('sidebar');
const fab = document.getElementById('btn-reopen');
const instructions = document.getElementById('instructions');
const instructionText = document.getElementById('instruction-text');

document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    sidebar.classList.add('hidden');
    if (waypoints.length === 2) fab.classList.remove('hidden');
});

fab.addEventListener('click', () => {
    sidebar.classList.remove('hidden');
    fab.classList.add('hidden');
});

// Sélecteurs
document.querySelectorAll('input[name="route-mode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
        currentProfile = e.target.value;
        if (waypoints.length === 2) {
            instructionText.innerText = "Recalcul de l'itinéraire...";
            instructions.classList.remove('hidden');
            await calculerItineraire(waypoints[0], waypoints[1]);
        }
    });
});

document.getElementById('toggle-hiking-layer').addEventListener('change', (e) => {
    map.setLayoutProperty('hiking-layer', 'visibility', e.target.checked ? 'visible' : 'none');
});

// --- CLICS CARTE ---
map.on('click', async (e) => {
    if (waypoints.length >= 2) return;

    const coords = [e.lngLat.lng, e.lngLat.lat];
    waypoints.push(coords);

    const color = waypoints.length === 1 ? '#188038' : '#d93025';
    const marker = new maplibregl.Marker({ color: color }).setLngLat(coords).addTo(map);
    markers.push(marker);

    if (waypoints.length === 2) {
        instructionText.innerText = "Calcul et analyse en cours...";
        await calculerItineraire(waypoints[0], waypoints[1]);
    }
});

// --- LOGIQUE API BROUTER ---
async function calculerItineraire(start, end) {
    // Adaptation des profils pour BRouter
    // "trekking" privilégie la randonnée/nature, "shortest" va au plus court (route)
    const brouterProfile = currentProfile === 'foot-hiking' ? 'trekking' : 'shortest';
    
    // Requête GET simple sur l'API publique de BRouter
    const urlRando = `https://brouter.de/brouter?lonlats=${start[0]},${start[1]}|${end[0]},${end[1]}&profile=${brouterProfile}&alternativeidx=0&format=geojson`;
    const urlMeteo = `https://api.open-meteo.com/v1/forecast?latitude=${start[1]}&longitude=${start[0]}&current_weather=true`;

    try {
        const [resRando, resMeteo] = await Promise.all([
            fetch(urlRando), // Plus besoin de POST ni de Headers !
            fetch(urlMeteo)
        ]);

        const dataRando = await resRando.json();
        const dataMeteo = await resMeteo.json();
        
        // Gestion des erreurs BRouter (si aucun chemin n'est trouvé)
        if (!dataRando.features || dataRando.features.length === 0) {
            instructionText.innerText = `Erreur : Impossible de relier ces points.`;
            return;
        }

        const routeGeoJSON = dataRando.features[0];
        const temperature = dataMeteo.current_weather.temperature; 
        
        afficherTracerSurCarte(routeGeoJSON);
        calculerEtAfficherStats(routeGeoJSON, temperature);
        gererNomsEtSurfacesInexistants(); // Mise à jour de l'UI

        instructions.classList.add('hidden');
        sidebar.classList.remove('hidden');
        fab.classList.add('hidden');

    } catch (error) {
        console.error(error);
        instructionText.innerText = "Erreur réseau. Impossible de contacter le serveur.";
    }
}

// --- AFFICHAGE TRACÉ ---
function afficherTracerSurCarte(geojson) {
    if (map.getSource('route')) {
        map.getSource('route').setData(geojson);
    } else {
        map.addSource('route', { type: 'geojson', data: geojson });
        map.addLayer({ id: 'route-line-outline', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b57d0', 'line-width': 5 } });
    }
}

// --- MATHS (Adapté pour BRouter) ---
function calculerEtAfficherStats(geojson, temperature) {
    const coords = geojson.geometry.coordinates;
    let dPlus = 0, dMinus = 0;

    // L'altitude (Z) est fournie dans les coordonnées BRouter
    if (coords.length > 0 && coords[0].length >= 3) {
        for (let i = 1; i < coords.length; i++) {
            const diff = (coords[i][2] || 0) - (coords[i - 1][2] || 0);
            if (diff > 0) dPlus += diff; else dMinus += Math.abs(diff);
        }
    }

    // Extraction de la distance fournie par BRouter dans les "properties" (en mètres)
    const trackLength = parseInt(geojson.properties['track-length'] || 0);
    const distanceKm = trackLength / 1000;
    
    // Règle de Naismith Sportive (1h tous les 600m D+)
    const tempsHeuresDecimal = (distanceKm / 4) + (dPlus / 600);
    const heures = Math.floor(tempsHeuresDecimal);
    const minutes = Math.round((tempsHeuresDecimal - heures) * 60);
    
    // Eau : Base de 0.35L/h + bonus
    let litresParHeure = 0.35;
    if (temperature > 20) litresParHeure += (temperature - 20) * 0.035;

    document.getElementById('stat-dist').innerText = distanceKm.toFixed(1);
    document.getElementById('stat-dplus').innerText = Math.round(dPlus);
    document.getElementById('stat-dminus').innerText = Math.round(dMinus);
    document.getElementById('stat-time').innerText = `${heures}h${minutes.toString().padStart(2, '0')}`;
    document.getElementById('stat-water').innerText = (tempsHeuresDecimal * litresParHeure).toFixed(1);
    document.getElementById('stat-temp').innerText = temperature;
}

// --- DEGRADATION GRACIEUSE DE L'UI ---
function gererNomsEtSurfacesInexistants() {
    // BRouter ne fournissant pas ces infos, on adapte l'interface
    const containerNoms = document.getElementById('trail-names');
    const containerSurfaces = document.getElementById('surfaces-container');
    
    containerNoms.innerHTML = `<div class="loading-text" style="color: #666; margin-top: 5px;">Les noms des sentiers ne sont pas fournis par l'API publique BRouter.</div>`;
    
    containerSurfaces.innerHTML = `<div class="loading-text" style="color: #666; margin-top: 5px;">Le détail de la nature du sol n'est pas fourni par l'API publique BRouter.</div>`;
}

// --- RÉINITIALISATION ---
document.getElementById('btn-reset').addEventListener('click', () => {
    waypoints = [];
    markers.forEach(m => m.remove());
    markers = [];
    if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    
    sidebar.classList.add('hidden');
    fab.classList.add('hidden');
    instructions.classList.remove('hidden');
    instructionText.innerHTML = "Clique sur la carte : <b>Départ</b> puis <b>Arrivée</b>.";
});