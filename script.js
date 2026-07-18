let waypoints = [];
let markers = [];
let currentProfile = 'foot-hiking'; 
let currentGeoJSON = null; // Stocke la dernière trace pour l'export GPX

// --- INITIALISATION DE LA CARTE ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'osm': { 
                type: 'raster', 
                tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], 
                tileSize: 256, 
                attribution: '&copy; OpenStreetMap' 
            },
            'hiking-trails': { 
                type: 'raster', 
                tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'], 
                tileSize: 256, 
                attribution: '| Randos &copy; Waymarked Trails' 
            },
            // Source Mondiale Open Data AWS (Mapzen Terrarium) - Gratuite et sans clé API
            'terrainSource': { 
                type: 'raster-dem', 
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], 
                encoding: 'terrarium', // Indique à MapLibre comment interpréter le relief
                tileSize: 256,
                maxzoom: 14
            }
        },
        layers: [
            { id: 'osm-layer', type: 'raster', source: 'osm' },
            // Le hillshade ajoute des ombres de relief réalistes
            { 
                id: 'hillshade-layer', 
                type: 'hillshade', 
                source: 'terrainSource', 
                paint: { 
                    'hillshade-shadow-color': '#221e15', 
                    'hillshade-exaggeration': 0.8 
                } 
            },
            { id: 'hiking-layer', type: 'raster', source: 'hiking-trails', minzoom: 12, paint: { 'raster-opacity': 0.4 }, layout: { 'visibility': 'visible' } }
        ]
    },
    center: [2.2137, 46.2276], // Centre de la France au démarrage
    zoom: 5.5, 
    pitch: 0, // À plat initialement (vue globale)
    bearing: 0
});

// Dès que la carte est chargée, on active le maillage 3D du terrain par défaut
map.on('load', () => {
    map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }));

// --- GESTION DE LA LANDING PAGE & RECHERCHE VILLE (Sans API Key) ---
const landingPage = document.getElementById('landing-page');
const searchInput = document.getElementById('city-search');
const searchResults = document.getElementById('search-results');
let searchTimeout = null;

// Bouton "Ouvrir la carte globale"
document.getElementById('btn-skip-landing').addEventListener('click', () => {
    landingPage.classList.add('hidden');
    instructions.classList.remove('hidden');
});

// Autocomplétion Nominatim (OpenStreetMap gratuit)
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    
    if (query.length < 3) { 
        searchResults.classList.add('hidden'); 
        searchResults.innerHTML = ''; 
        return; 
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
            const data = await res.json();
            
            searchResults.innerHTML = '';
            if (data.length > 0) {
                searchResults.classList.remove('hidden');
                data.forEach(place => {
                    const li = document.createElement('li');
                    li.textContent = place.display_name;
                    li.addEventListener('click', () => {
                        landingPage.classList.add('hidden');
                        instructions.classList.remove('hidden');
                        searchResults.classList.add('hidden');
                        searchInput.value = '';
                        
                        const lat = parseFloat(place.lat);
                        const lon = parseFloat(place.lon);
                        const is3DActive = document.getElementById('toggle-3d').checked;

                        // Vol fluide vers la ville cherchée
                        map.flyTo({
                            center: [lon, lat],
                            zoom: 13,
                            pitch: is3DActive ? 65 : 0,
                            bearing: is3DActive ? 20 : 0,
                            duration: 2500
                        });

                        // Lancement de la recherche Overpass pour récupérer les randos locales
                        chercherRandosAutour(lat, lon);
                    });
                    searchResults.appendChild(li);
                });
            } else {
                searchResults.classList.add('hidden');
            }
        } catch (error) {
            console.error("Erreur de recherche", error);
        }
    }, 500);
});

// Récupération des randonnées existantes via l'API Overpass d'OpenStreetMap (Rayon de 5km)
async function chercherRandosAutour(lat, lon) {
    instructionText.innerText = "Recherche des itinéraires de randonnée à proximité...";
    
    const query = `
        [out:json][timeout:25];
        relation["route"="hiking"](around:5000, ${lat}, ${lon});
        out geom;
    `;

    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: query
        });
        const data = await res.json();

        const features = [];
        data.elements.forEach(el => {
            if (el.type === "relation" && el.members) {
                const coordinates = [];
                el.members.forEach(m => {
                    if (m.type === "way" && m.geometry) {
                        coordinates.push(m.geometry.map(g => [g.lon, g.lat]));
                    }
                });
                if (coordinates.length > 0) {
                    features.push({
                        type: "Feature",
                        properties: { name: el.tags?.name || "Randonnée sans nom" },
                        geometry: { type: "MultiLineString", coordinates: coordinates }
                    });
                }
            }
        });

        if (features.length > 0) {
            const geojson = { type: "FeatureCollection", features: features };

            if (map.getSource('local-hikes')) {
                map.getSource('local-hikes').setData(geojson);
            } else {
                map.addSource('local-hikes', { type: 'geojson', data: geojson });
                
                // Tracé blanc de lueur d'arrière-plan
                map.addLayer({ 
                    id: 'local-hikes-glow', 
                    type: 'line', 
                    source: 'local-hikes', 
                    layout: { 'line-join': 'round', 'line-cap': 'round' }, 
                    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.6 } 
                });

                // Ligne pointillée rouge distinctive M3
                map.addLayer({ 
                    id: 'local-hikes-line', 
                    type: 'line', 
                    source: 'local-hikes', 
                    layout: { 'line-join': 'round', 'line-cap': 'round' }, 
                    paint: { 'line-color': '#d93025', 'line-width': 3, 'line-dasharray': [2, 2] } 
                });

                // Interaction : Affiche le nom de la randonnée locale trouvée sur OSM au clic
                map.on('click', 'local-hikes-line', (e) => {
                    if (waypoints.length === 0) {
                        const randoName = e.features[0].properties.name;
                        instructionText.innerHTML = `Idée d'itinéraire : <b>${randoName}</b>. Place tes repères pour la tracer !`;
                    }
                });
                
                map.on('mouseenter', 'local-hikes-line', () => map.getCanvas().style.cursor = 'pointer');
                map.on('mouseleave', 'local-hikes-line', () => map.getCanvas().style.cursor = '');
            }
            
            instructionText.innerHTML = `<b>${features.length} randos</b> trouvées autour de la ville ! Clique pour tracer : <b>Départ</b> puis <b>Arrivée</b>.`;
        } else {
            instructionText.innerHTML = `Aucune rando officielle trouvée à proximité. Clique sur la carte : <b>Départ</b> puis <b>Arrivée</b>.`;
        }
    } catch (error) {
        console.error("Erreur Overpass API :", error);
        instructionText.innerHTML = `Clique sur la carte : <b>Départ</b> puis <b>Arrivée</b>.`;
    }
}


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

// Interrupteur Relief 3D (Vraies altitudes mondiales)
document.getElementById('toggle-3d').addEventListener('change', (e) => {
    if (e.target.checked) {
        map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });
        map.easeTo({ pitch: 65, bearing: 20, duration: 1200 });
    } else {
        map.setTerrain(null);
        map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
    }
});


// --- CLICS CARTE ---
map.on('click', async (e) => {
    if (!landingPage.classList.contains('hidden')) return; // Bloque si l'accueil est actif
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
    const WORKER_URL = 'https://rando.simonlncln.workers.dev';

    const urlRando = `${WORKER_URL}/${currentProfile}`;
    const urlMeteo = `https://api.open-meteo.com/v1/forecast?latitude=${start[1]}&longitude=${start[0]}&current_weather=true`;

    try {
        const [resRando, resMeteo] = await Promise.all([
            fetch(urlRando, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    coordinates: [start, end], 
                    elevation: true, 
                    extra_info: ["surface"] 
                })
            }),
            fetch(urlMeteo)
        ]);

        let temperature = 20; 
        if (resMeteo.ok) {
            const dataMeteo = await resMeteo.json();
            temperature = dataMeteo.current_weather?.temperature || 20; 
        }

        if (!resRando.ok) {
            instructionText.innerText = `Le serveur de calcul est surchargé. Réessaie.`;
            return;
        }

        const dataRando = await resRando.json();
        
        if (dataRando.error) {
            instructionText.innerText = `Erreur : ${dataRando.error.message || "Erreur de routage"}`;
            return;
        }

        const routeGeoJSON = dataRando.features[0];
        currentGeoJSON = routeGeoJSON; // Mise en mémoire pour le bouton de téléchargement GPX
        
        afficherTracerSurCarte(routeGeoJSON);
        calculerEtAfficherStats(routeGeoJSON, temperature);
        extraireNomsEtSurfaces(routeGeoJSON); 

        instructions.classList.add('hidden');
        sidebar.classList.remove('hidden');
        document.getElementById('btn-export').classList.remove('hidden'); // Rendre le bouton d'export visible
        fab.classList.add('hidden');

    } catch (error) {
        console.error("Crash complet :", error);
        instructionText.innerText = "Erreur réseau. Impossible de joindre les serveurs.";
    }
}


function afficherTracerSurCarte(geojson) {
    if (map.getSource('route')) {
        map.getSource('route').setData(geojson);
    } else {
        map.addSource('route', { type: 'geojson', data: geojson });
        map.addLayer({ id: 'route-line-outline', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b57d0', 'line-width': 5 } });
    }
}


// --- MATHS STATS ---
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
    
    const containerNoms = document.getElementById('trail-names');
    const cardNoms = containerNoms.closest('.inner-card');
    
    const containerSurfaces = document.getElementById('surfaces-container');
    const cardSurfaces = containerSurfaces.closest('.inner-card');

    const nomsSentiers = new Set();
    if (props.segments && props.segments[0].steps) {
        props.segments[0].steps.forEach(step => { if (step.name && step.name !== '-') nomsSentiers.add(step.name); });
    }

    if (nomsSentiers.size > 0) {
        cardNoms.style.display = 'block'; 
        containerNoms.innerHTML = Array.from(nomsSentiers).map(nom => `<span class="trail-chip">${nom}</span>`).join('');
    } else {
        cardNoms.style.display = 'none'; 
    }

    const dictionnaireSurfaces = {
        1: 'Goudron', 2: 'Chemin non revêtu', 3: 'Asphalte', 4: 'Béton', 
        11: 'Gravier', 12: 'Cailloux', 13: 'Chemin de terre', 14: 'Terre battue', 
        15: 'Herbe', 18: 'Sable', 21: 'Boue'
    };

    containerSurfaces.innerHTML = '';
    
    if (props.extras && props.extras.surface) {
        cardSurfaces.style.display = 'block'; 
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
        cardSurfaces.style.display = 'none'; 
    }
}


// --- EXPORT GPX (Full JS sans Backend) ---
document.getElementById('btn-export').addEventListener('click', () => {
    if (!currentGeoJSON) return;

    const coords = currentGeoJSON.geometry.coordinates;
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Rando 3D">
  <trk>
    <name>Ma Rando 3D</name>
    <trkseg>\n`;

    coords.forEach(c => {
        const elevation = c[2] ? `<ele>${c[2]}</ele>` : '';
        gpx += `      <trkpt lat="${c[1]}" lon="${c[0]}">${elevation}</trkpt>\n`;
    });

    gpx += `    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'itineraire_rando.gpx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
});


// --- RÉINITIALISATION ---
document.getElementById('btn-reset').addEventListener('click', () => {
    waypoints = [];
    currentGeoJSON = null;
    markers.forEach(m => m.remove());
    markers = [];
    
    if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    if (map.getSource('local-hikes')) map.getSource('local-hikes').setData({ type: 'FeatureCollection', features: [] });
    
    sidebar.classList.add('hidden');
    fab.classList.add('hidden');
    document.getElementById('btn-export').classList.add('hidden'); 
    instructions.classList.remove('hidden');
    instructionText.innerHTML = "Clique sur la carte : <b>Départ</b> puis <b>Arrivée</b>.";
});