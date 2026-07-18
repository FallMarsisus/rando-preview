let waypoints = [];
let markers = [];
let currentProfile = 'foot-hiking'; 
let currentGeoJSON = null; 
let cityCenter = null; // Stocke les coordonnées de la ville sélectionnée

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
                encoding: 'terrarium', 
                tileSize: 256,
                maxzoom: 14
            }
        },
        layers: [
            { id: 'osm-layer', type: 'raster', source: 'osm' },
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
    center: [2.2137, 46.2276], 
    zoom: 5.5, 
    pitch: 0, 
    bearing: 0
});

map.on('load', () => {
    map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }));

// --- GESTION DE LA LANDING PAGE & RECHERCHE VILLE ---
const landingPage = document.getElementById('landing-page');
const searchInput = document.getElementById('city-search');
const searchResults = document.getElementById('search-results');
let searchTimeout = null;

document.getElementById('btn-skip-landing').addEventListener('click', () => {
    landingPage.classList.add('hidden');
    instructions.classList.remove('hidden');
});

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
                        cityCenter = [lon, lat]; 
                        const is3DActive = document.getElementById('toggle-3d').checked;

                        map.flyTo({
                            center: cityCenter,
                            zoom: 13,
                            pitch: is3DActive ? 65 : 0,
                            bearing: is3DActive ? 20 : 0,
                            duration: 2500
                        });

                        genererRecommendations(lat, lon);
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

// Calcul de distance à vol d'oiseau (Formule de Haversine)
function determinerDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Récupère les points d'intérêts et crée la liste des recommandations
async function genererRecommendations(lat, lon) {
    instructionText.innerText = "Recherche des plus beaux points d'intérêt aux alentours...";
    const container = document.getElementById('recoms-container');
    container.innerHTML = `<div class="loading-text">Analyse géographique en cours...</div>`;
    document.getElementById('recoms-panel').classList.add('visible');

    // Requête sur les sommets, points de vue et lacs dans un rayon de 12km
    const query = `
        [out:json][timeout:25];
        (
          node["natural"="peak"](around:12000, ${lat}, ${lon});
          node["tourism"="viewpoint"](around:12000, ${lat}, ${lon});
          node["natural"="water"](around:12000, ${lat}, ${lon});
        );
        out body 9;
    `;

    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
        const data = await res.json();
        container.innerHTML = '';

        if (!data.elements || data.elements.length === 0) {
            container.innerHTML = `<div class="loading-text">Aucun point d'intérêt majeur identifié à proximité.</div>`;
            return;
        }

        data.elements.forEach(el => {
            const name = el.tags.name || (el.tags.natural === "peak" ? "Sommet anonyme" : "Point de vue");
            const distance = determinerDistance(lat, lon, el.lat, el.lon);
            
            let diffClass = "facile";
            let diffLabel = "Facile";
            let icon = "landscape";

            if (distance >= 3 && distance < 6) {
                diffClass = "moyen";
                diffLabel = "Moyen";
                icon = "filter_hdr";
            } else if (distance >= 6) {
                diffClass = "difficile";
                diffLabel = "Difficile";
                icon = "terrain";
            }

            const card = document.createElement('div');
            card.className = 'recom-card';
            card.innerHTML = `
                <div class="recom-header">
                    <span class="recom-name">${name}</span>
                    <span class="difficulty-badge badge-${diffClass}">${diffLabel}</span>
                </div>
                <div class="recom-meta">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span class="material-symbols-outlined">${icon}</span>
                        <span>~${(distance * 2).toFixed(1)} km (Aller-Retour)</span>
                    </div>
                </div>
            `;

            card.addEventListener('click', async () => {
                document.getElementById('recoms-panel').classList.remove('visible');
                instructionText.innerText = `Création de l'itinéraire vers : ${name}...`;
                instructions.classList.remove('hidden');

                waypoints = [cityCenter, [el.lon, el.lat]];
                markers.forEach(m => m.remove());
                markers = [];

                markers.push(new maplibregl.Marker({ color: '#188038' }).setLngLat(cityCenter).addTo(map));
                markers.push(new maplibregl.Marker({ color: '#d93025' }).setLngLat([el.lon, el.lat]).addTo(map));

                await calculerItineraire(cityCenter, [el.lon, el.lat]);
            });

            container.appendChild(card);
        });

        instructionText.innerHTML = "<b>Suggestions prêtes !</b> Choisis une rando dans la liste ou clique manuellement sur la carte.";
    } catch (error) {
        console.error("Erreur Overpass :", error);
        container.innerHTML = `<div class="loading-text">Impossible de charger les suggestions.</div>`;
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

document.getElementById('btn-close-recoms').addEventListener('click', () => {
    document.getElementById('recoms-panel').classList.remove('visible');
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
    if (!landingPage.classList.contains('hidden')) return; 
    if (waypoints.length >= 2) return;

    const coords = [e.lngLat.lng, e.lngLat.lat];
    waypoints.push(coords);

    const color = waypoints.length === 1 ? '#188038' : '#d93025';
    const marker = new maplibregl.Marker({ color: color }).setLngLat(coords).addTo(map);
    markers.push(marker);

    if (waypoints.length === 2) {
        document.getElementById('recoms-panel').classList.remove('visible');
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
                body: JSON.stringify({ coordinates: [start, end], elevation: true, extra_info: ["surface"] })
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
        currentGeoJSON = routeGeoJSON; 
        
        afficherTracerSurCarte(routeGeoJSON);
        calculerEtAfficherStats(routeGeoJSON, temperature);
        extraireNomsEtSurfaces(routeGeoJSON); 

        instructions.classList.add('hidden');
        sidebar.classList.remove('hidden');
        document.getElementById('btn-export').classList.remove('hidden'); 
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
    
    const coordinates = geojson.geometry.coordinates;
    const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    map.fitBounds(bounds, { padding: 50, pitch: document.getElementById('toggle-3d').checked ? 65 : 0 });
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

// --- EXTRACTION DES COMPOSANTS DE VOIE ---
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

// --- EXPORT GPX ---
document.getElementById('btn-export').addEventListener('click', () => {
    if (!currentGeoJSON) return;

    const coords = currentGeoJSON.geometry.coordinates;
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rando 3D">\n  <trk>\n    <name>Ma Rando 3D</name>\n    <trkseg>\n`;

    coords.forEach(c => {
        const elevation = c[2] ? `<ele>${c[2]}</ele>` : '';
        gpx += `      <trkpt lat="${c[1]}" lon="${c[0]}">${elevation}</trkpt>\n`;
    });

    gpx += `    </trkseg>\n  </trk>\n</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none'; a.href = url; a.download = 'itineraire_rando.gpx';
    document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url);
});

// --- REINITIALISATION ---
document.getElementById('btn-reset').addEventListener('click', () => {
    waypoints = [];
    currentGeoJSON = null;
    markers.forEach(m => m.remove());
    markers = [];
    
    if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    
    sidebar.classList.add('hidden');
    fab.classList.add('hidden');
    document.getElementById('btn-export').classList.add('hidden'); 
    
    if (cityCenter) {
        document.getElementById('recoms-panel').classList.add('visible');
    }
    
    instructions.classList.remove('hidden');
    instructionText.innerHTML = "Clique sur la carte : <b>Départ</b> puis <b>Arrivée</b>.";
});