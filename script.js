
let waypoints = [];
let markers = [];
let currentProfile = 'foot-hiking'; 

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
    center: [6.865, 45.923], 
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

// --- LOGIQUE API (VIA PROXY CLOUDFLARE) ---
async function calculerItineraire(start, end) {
    // ⚠️ REMPLACE CETTE URL PAR CELLE DE TON WORKER CLOUDFLARE ⚠️
    const WORKER_URL = 'https://rando.simonlncln.workers.dev/';

    // On envoie la requête à ton proxy, en ajoutant le profil à la fin de l'URL
    const urlRando = `${WORKER_URL}/${currentProfile}`;
    const urlMeteo = `https://api.open-meteo.com/v1/forecast?latitude=${start[1]}&longitude=${start[0]}&current_weather=true`;

    try {
        const [resRando, resMeteo] = await Promise.all([
            fetch(urlRando, {
                method: 'POST', 
                // PLUS BESOIN DU HEADER "Authorization" ICI !
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    coordinates: [start, end], 
                    elevation: true, 
                    extra_info: ["surface"] 
                })
            }),
            fetch(urlMeteo)
        ]);

        const dataRando = await resRando.json();
        const dataMeteo = await resMeteo.json();
        
        if (dataRando.error) {
            instructionText.innerText = `Erreur : ${dataRando.error.message || "Erreur de routage"}`;
            return;
        }

        const routeGeoJSON = dataRando.features[0];
        const temperature = dataMeteo.current_weather.temperature; 
        
        afficherTracerSurCarte(routeGeoJSON);
        calculerEtAfficherStats(routeGeoJSON, temperature);
        extraireNomsEtSurfaces(routeGeoJSON); 

        instructions.classList.add('hidden');
        sidebar.classList.remove('hidden');
        fab.classList.add('hidden');

    } catch (error) {
        console.error(error);
        instructionText.innerText = "Erreur réseau avec le proxy Serverless.";
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

// --- MATHS ---
function calculerEtAfficherStats(geojson, temperature) {
    const coords = geojson.geometry.coordinates;
    let dPlus = 0, dMinus = 0;

    if (coords.length > 0 && coords[0].length >= 3) {
        for (let i = 1; i < coords.length; i++) {
            const diff = (coords[i][2] || 0) - (coords[i - 1][2] || 0);
            if (diff > 0) dPlus += diff; else dMinus += Math.abs(diff);
        }
    }

    const distanceKm = geojson.properties.summary.distance / 1000;
    
    const tempsHeuresDecimal = (distanceKm / 4) + (dPlus / 600);
    const heures = Math.floor(tempsHeuresDecimal);
    const minutes = Math.round((tempsHeuresDecimal - heures) * 60);
    
    let litresParHeure = 0.35;
    if (temperature > 20) litresParHeure += (temperature - 20) * 0.035;

    document.getElementById('stat-dist').innerText = distanceKm.toFixed(1);
    document.getElementById('stat-dplus').innerText = Math.round(dPlus);
    document.getElementById('stat-dminus').innerText = Math.round(dMinus);
    document.getElementById('stat-time').innerText = `${heures}h${minutes.toString().padStart(2, '0')}`;
    document.getElementById('stat-water').innerText = (tempsHeuresDecimal * litresParHeure).toFixed(1);
    document.getElementById('stat-temp').innerText = temperature;
}

// --- EXTRACTION ET GESTION DYNAMIQUE DES CARTES ---
function extraireNomsEtSurfaces(geojson) {
    const props = geojson.properties;
    
    // Conteneurs et leurs "Cards" parentes respectives
    const containerNoms = document.getElementById('trail-names');
    const cardNoms = containerNoms.closest('.inner-card');
    
    const containerSurfaces = document.getElementById('surfaces-container');
    const cardSurfaces = containerSurfaces.closest('.inner-card');

    // 1. Gestion des noms de sentiers
    const nomsSentiers = new Set();
    if (props.segments && props.segments[0].steps) {
        props.segments[0].steps.forEach(step => { if (step.name && step.name !== '-') nomsSentiers.add(step.name); });
    }

    if (nomsSentiers.size > 0) {
        cardNoms.style.display = 'block'; // On affiche la carte entière
        containerNoms.innerHTML = Array.from(nomsSentiers).map(nom => `<span class="trail-chip">${nom}</span>`).join('');
    } else {
        cardNoms.style.display = 'none'; // On cache complètement la carte
    }

    // 2. Gestion des surfaces
    const dictionnaireSurfaces = {
        1: 'Goudron', 2: 'Chemin non revêtu', 3: 'Asphalte', 4: 'Béton', 
        11: 'Gravier', 12: 'Cailloux', 13: 'Chemin de terre', 14: 'Terre battue', 
        15: 'Herbe', 18: 'Sable', 21: 'Boue'
    };

    containerSurfaces.innerHTML = '';
    
    if (props.extras && props.extras.surface) {
        cardSurfaces.style.display = 'block'; // On affiche la carte entière
        const totalPoints = geojson.geometry.coordinates.length; 
        const statsSurfaces = {};

        props.extras.surface.values.forEach(bloc => {
            const nomSurface = dictionnaireSurfaces[bloc[2]] || 'Autre';
            statsSurfaces[nomSurface] = (statsSurfaces[nomSurface] || 0) + (bloc[1] - bloc[0]);
        });

        for (const [nom, valeur] of Object.entries(statsSurfaces)) {
            const pourcentage = Math.round((valeur / totalPoints) * 100);
            if (pourcentage > 0) {
                containerSurfaces.innerHTML += `
                    <div class="surface-bar"><span>${nom}</span><span>${pourcentage}%</span></div>
                    <div class="surface-progress-bg"><div class="surface-progress-fill" style="width: ${pourcentage}%;"></div></div>
                `;
            }
        }
    } else {
        cardSurfaces.style.display = 'none'; // On cache complètement la carte
    }
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