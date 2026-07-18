let waypoints = [];
let markers = [];
let currentProfile = 'foot-hiking'; 
let currentGeoJSON = null; 
let cityCenter = null; 

// --- INITIALISATION DE LA CARTE ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'osm': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' },
            'hiking-trails': { type: 'raster', tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'], tileSize: 256, attribution: '| Randos &copy; Waymarked Trails' },
            'terrainSource': { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14 }
        },
        layers: [
            { id: 'osm-layer', type: 'raster', source: 'osm' },
            { id: 'hillshade-layer', type: 'hillshade', source: 'terrainSource', paint: { 'hillshade-shadow-color': '#221e15', 'hillshade-exaggeration': 0.8 } },
            { id: 'hiking-layer', type: 'raster', source: 'hiking-trails', minzoom: 12, paint: { 'raster-opacity': 0.4 }, layout: { 'visibility': 'visible' } }
        ]
    },
    center: [2.2137, 46.2276], zoom: 5.5, pitch: 0, bearing: 0
});

map.on('load', () => { map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 }); });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }));

// --- GESTION DES PANNEAUX INTERFACES ---
const landingPage = document.getElementById('landing-page');
const searchInput = document.getElementById('city-search');
const searchResults = document.getElementById('search-results');
let searchTimeout = null;

// Bouton de validation du setup initial ou de modification
document.getElementById('btn-skip-landing').addEventListener('click', () => {
    landingPage.classList.add('hidden');
    instructions.classList.remove('hidden');
    
    // Si une recherche de ville a déjà eu lieu, on applique dynamiquement les changements de profil ou de difficulté
    if (cityCenter) {
        const rayon = document.getElementById('radius-select').value;
        genererRecommendations(cityCenter[1], cityCenter[0], rayon);
    }
});

// Déclencheur du bouton de modification du setup (Rouvre l'overlay de configuration)
document.getElementById('btn-open-setup').addEventListener('click', () => {
    landingPage.classList.remove('hidden');
    document.getElementById('btn-skip-landing').innerText = "Enregistrer les préférences";
});

// Autocomplétion géocodage
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length < 3) { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; return; }

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
                        map.flyTo({ center: cityCenter, zoom: 12.5, pitch: is3DActive ? 65 : 0, bearing: is3DActive ? 20 : 0, duration: 2500 });

                        const rayonInitial = document.getElementById('radius-select').value;
                        genererRecommendations(lat, lon, rayonInitial);
                    });
                    searchResults.appendChild(li);
                });
            } else { searchResults.classList.add('hidden'); }
        } catch (error) { console.error(error); }
    }, 500);
});

// Écoute dynamique du changement de mode dans le Setup d'accueil
document.querySelectorAll('input[name="route-mode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
        currentProfile = e.target.value;
        if (waypoints[0] && waypoints[1]) {
            await calculerItineraire(waypoints[0], waypoints[1]);
        }
    });
});

// Relance automatique de la recherche locale si le selecteur de rayon change dans la sidebar
document.getElementById('radius-select').addEventListener('change', (e) => {
    if (cityCenter) { genererRecommendations(cityCenter[1], cityCenter[0], e.target.value); }
});

function determinerDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// Génération des POI filtrés selon les préférences de difficulté du bouton segmenté
async function genererRecommendations(lat, lon, radius) {
    instructionText.innerText = "Recherche des plus beaux points d'intérêt aux alentours...";
    const container = document.getElementById('recoms-container');
    container.innerHTML = `<div class="loading-text">Analyse géographique en cours...</div>`;
    document.getElementById('recoms-panel').classList.add('visible');
    fabRecoms.classList.add('hidden');

    // Récupère la valeur du bouton segmenté de difficulté choisi par l'utilisateur
    const diffPreferee = document.querySelector('input[name="pref-diff"]:checked').value;

    const query = `
        [out:json][timeout:25];
        (
          nwr["natural"="peak"](around:${radius}, ${lat}, ${lon});
          nwr["tourism"="viewpoint"](around:${radius}, ${lat}, ${lon});
          nwr["natural"="water"](around:${radius}, ${lat}, ${lon});
          nwr["water"](around:${radius}, ${lat}, ${lon});
        );
        out center body 30;
    `;

    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
        const data = await res.json();
        container.innerHTML = '';

        if (!data.elements || data.elements.length === 0) {
            container.innerHTML = `<div class="loading-text">Aucun point d'intérêt majeur identifié.</div>`;
            return;
        }

        let cartesAffichees = 0;

        data.elements.forEach(el => {
            if (!el.tags || !el.tags.name || el.tags.name.trim() === "") return;

            const elLon = el.lon || (el.center ? el.center.lon : null);
            const elLat = el.lat || (el.center ? el.center.lat : null);
            if (!elLon || !elLat) return;

            const altitude = el.tags.ele ? parseInt(el.tags.ele, 10) : null;
            if (altitude && altitude > 3000) return; 

            const estUnLac = el.tags.natural === "water" || el.tags.water;
            const distance = determinerDistance(lat, lon, elLat, elLon);
            
            let diffClass = "facile";
            let diffLabel = "Facile";
            let icon = estUnLac ? "water" : "landscape"; 

            if (!estUnLac) {
                if (distance >= 4 && distance < 8) { diffClass = "moyen"; diffLabel = "Moyen"; icon = "filter_hdr"; }
                else if (distance >= 8) { diffClass = "difficile"; diffLabel = "Difficile"; icon = "terrain"; }
            } else {
                diffClass = distance < 5 ? "facile" : "moyen";
                diffLabel = distance < 5 ? "Rando Lac Facile" : "Rando Lac";
            }

            // APPLICATION STRICT DU FILTRE DE DIFFICULTÉ DU SLIDER/SEGMENTED CONTROL
            if (diffPreferee !== "tous" && diffClass !== diffPreferee) {
                return; // On ignore si ça ne matche pas le profil choisi
            }

            const baseName = el.tags.name;
            const name = altitude ? `${baseName} (${altitude} m)` : baseName;

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
                        <span>~${distance.toFixed(1)} km (Distance linéaire)</span>
                    </div>
                </div>
            `;

            card.addEventListener('click', () => {
                document.getElementById('recoms-panel').classList.remove('visible');
                fabRecoms.classList.add('hidden');
                if (markers[1]) { markers[1].remove(); markers[1] = null; }
                waypoints[1] = [elLon, elLat];
                markers[1] = new maplibregl.Marker({ color: '#d93025' }).setLngLat(waypoints[1]).addTo(map);

                if (waypoints[0]) {
                    instructionText.innerText = "Calcul du parcours...";
                    calculerItineraire(waypoints[0], waypoints[1]);
                } else {
                    instructionText.innerHTML = `Destination fixée : <b>${baseName}</b>.<br>Cliquez sur la carte pour définir votre <b>Départ exact</b>.`;
                    instructions.classList.remove('hidden');
                }
            });

            container.appendChild(card);
            cartesAffichees++;
        });

        if (cartesAffichees === 0) {
            container.innerHTML = `<div class="loading-text">Aucun tracé correspondant à la difficulté sélectionnée ("${diffPreferee}").</div>`;
        } else {
            instructionText.innerHTML = "<b>Suggestions prêtes !</b> Choisissez un lieu puis fixez votre point de départ.";
        }
    } catch (error) { console.error(error); container.innerHTML = `<div class="loading-text">Erreur de connexion.</div>`; }
}

// --- LOGIQUE CONTROLES INTERFACES ---
const sidebar = document.getElementById('sidebar');
const fab = document.getElementById('btn-reopen');
const fabRecoms = document.getElementById('btn-reopen-recoms');
const instructions = document.getElementById('instructions');
const instructionText = document.getElementById('instruction-text');

document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    sidebar.classList.add('hidden');
    if (waypoints[0] && waypoints[1]) fab.classList.remove('hidden');
});

document.getElementById('btn-close-recoms').addEventListener('click', () => {
    document.getElementById('recoms-panel').classList.remove('visible');
    if (cityCenter && waypoints.length < 2) fabRecoms.classList.remove('hidden');
});

fab.addEventListener('click', () => { sidebar.classList.remove('hidden'); fab.classList.add('hidden'); });
fabRecoms.addEventListener('click', () => { document.getElementById('recoms-panel').classList.add('visible'); fabRecoms.classList.add('hidden'); });

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

// --- INTERACTIONS CLICS CARTES & ROUTAGE ---
map.on('click', async (e) => {
    if (!landingPage.classList.contains('hidden')) return; 
    const coords = [e.lngLat.lng, e.lngLat.lat];

    if (!waypoints[0] && !waypoints[1]) {
        waypoints[0] = coords;
        markers[0] = new maplibregl.Marker({ color: '#188038' }).setLngLat(coords).addTo(map);
        instructionText.innerHTML = "Départ enregistré. Cliquez pour l'<b>Arrivée</b>.";
    } else if (waypoints[0] && !waypoints[1]) {
        waypoints[1] = coords;
        markers[1] = new maplibregl.Marker({ color: '#d93025' }).setLngLat(coords).addTo(map);
        document.getElementById('recoms-panel').classList.remove('visible');
        fabRecoms.classList.add('hidden');
        instructionText.innerText = "Analyse topologique...";
        await calculerItineraire(waypoints[0], waypoints[1]);
    } else if (!waypoints[0] && waypoints[1]) {
        waypoints[0] = coords;
        markers[0] = new maplibregl.Marker({ color: '#188038' }).setLngLat(coords).addTo(map);
        instructionText.innerText = "Calcul optimal...";
        await calculerItineraire(waypoints[0], waypoints[1]);
    }
});

async function calculerItineraire(start, end) {
    const WORKER_URL = 'https://rando.simonlncln.workers.dev';
    try {
        const [resRando, resMeteo] = await Promise.all([
            fetch(`${WORKER_URL}/${currentProfile}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coordinates: [start, end], elevation: true, extra_info: ["surface"] })
            }),
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${start[1]}&longitude=${start[0]}&current_weather=true`)
        ]);

        let temp = 20; if (resMeteo.ok) { temp = (await resMeteo.json()).current_weather?.temperature || 20; }
        if (!resRando.ok) { instructionText.innerText = "Serveur surchargé."; return; }

        const dataRando = await resRando.json();
        if (dataRando.error) { instructionText.innerText = "Erreur de routage."; return; }

        const routeGeoJSON = dataRando.features[0];
        currentGeoJSON = routeGeoJSON; 
        
        if (map.getSource('route')) { map.getSource('route').setData(routeGeoJSON); } 
        else {
            map.addSource('route', { type: 'geojson', data: routeGeoJSON });
            map.addLayer({ id: 'route-line-outline', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
            map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b57d0', 'line-width': 5 } });
        }
        
        const bounds = routeGeoJSON.geometry.coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(routeGeoJSON.geometry.coordinates[0], routeGeoJSON.geometry.coordinates[0]));
        map.fitBounds(bounds, { padding: 60, pitch: document.getElementById('toggle-3d').checked ? 65 : 0 });

        // Calcul stats
        const coords = routeGeoJSON.geometry.coordinates;
        let dP = 0, dM = 0;
        for (let i = 1; i < coords.length; i++) {
            const diff = (coords[i][2] || 0) - (coords[i - 1][2] || 0);
            if (diff > 0) dP += diff; else dM += Math.abs(diff);
        }
        const dist = routeGeoJSON.properties.summary.distance / 1000;
        const hDec = (dist / 4) + (dP / 600);
        const h = Math.floor(hDec), m = Math.round((hDec - h) * 60);

        document.getElementById('stat-dist').innerText = dist.toFixed(1);
        document.getElementById('stat-dplus').innerText = Math.round(dP);
        document.getElementById('stat-dminus').innerText = Math.round(dM);
        document.getElementById('stat-time').innerText = `${h}h${m.toString().padStart(2, '0')}`;
        document.getElementById('stat-water').innerText = (hDec * (0.35 + (temp > 20 ? (temp - 20) * 0.035 : 0))).toFixed(1);
        document.getElementById('stat-temp').innerText = temp;

        // Extraction surfaces & noms
        const props = routeGeoJSON.properties;
        const nCont = document.getElementById('trail-names');
        const sCont = document.getElementById('surfaces-container');
        
        const noms = new Set();
        if (props.segments && props.segments[0].steps) { props.segments[0].steps.forEach(s => { if (s.name && s.name !== '-') noms.add(s.name); }); }
        nCont.closest('.inner-card').style.display = noms.size > 0 ? 'block' : 'none';
        nCont.innerHTML = Array.from(noms).map(n => `<span class="trail-chip">${n}</span>`).join('');

        sCont.innerHTML = '';
        if (props.extras && props.extras.surface) {
            sCont.closest('.inner-card').style.display = 'block';
            const stats = {};
            props.extras.surface.values.forEach(b => {
                const n = { 1: 'Goudron', 2: 'Chemin non revêtu', 3: 'Asphalte', 11: 'Gravier', 12: 'Cailloux', 13: 'Chemin de terre', 15: 'Herbe' }[b[2]] || 'Autre';
                stats[n] = (stats[n] || 0) + (b[1] - b[0]);
            });
            for (const [k, v] of Object.entries(stats)) {
                const pct = Math.round((v / coords.length) * 100);
                if (pct > 0) sCont.innerHTML += `<div class="surface-bar"><span>${k}</span><span>${pct}%</span></div><div class="surface-progress-bg"><div class="surface-progress-fill" style="width: ${pct}%;"></div></div>`;
            }
        } else { sCont.closest('.inner-card').style.display = 'none'; }

        instructions.classList.add('hidden'); sidebar.classList.remove('hidden');
        document.getElementById('btn-export').classList.remove('hidden'); fab.classList.add('hidden'); fabRecoms.classList.add('hidden');
    } catch (e) { console.error(e); }
}

// --- EXPORT GPX & ACTION RESET ---
document.getElementById('btn-export').addEventListener('click', () => {
    if (!currentGeoJSON) return;
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rando 3D">\n  <trk>\n    <name>Ma Rando 3D</name>\n    <trkseg>\n`;
    currentGeoJSON.geometry.coordinates.forEach(c => { gpx += `      <trkpt lat="${c[1]}" lon="${c[0]}">${c[2] ? `<ele>${c[2]}</ele>` : ''}</trkpt>\n`; });
    gpx += `    </trkseg>\n  </trk>\n</gpx>`;
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = 'itineraire_rando.gpx';
    document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url);
});

document.getElementById('btn-reset').addEventListener('click', () => {
    waypoints = []; currentGeoJSON = null; markers.forEach(m => { if (m) m.remove(); }); markers = [];
    if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    sidebar.classList.add('hidden'); fab.classList.add('hidden'); document.getElementById('btn-export').classList.add('hidden'); 
    if (cityCenter) document.getElementById('recoms-panel').classList.add('visible');
    instructions.classList.remove('hidden'); instructionText.innerHTML = "Cliquez sur la carte : <b>Départ</b> puis <b>Arrivée</b>.";
});