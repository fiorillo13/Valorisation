/* =============================================================================
 *  ÉVALUATEUR DE FONDS DE COMMERCE — GLACIER ARTISANAL MULTI-SITES
 * -----------------------------------------------------------------------------
 *  Application 100 % locale (aucun serveur, aucune dépendance hors Tailwind CDN).
 *  Architecture :
 *    1. CONFIG        → constantes et barèmes métier (faciles à auditer/ajuster)
 *    2. Etat          → modèle de données + persistance localStorage
 *    3. Calculs       → moteur d'évaluation (3 méthodes + fourchette)
 *    4. UI            → rendu des formulaires, du stepper et du rapport
 *    5. Initialisation
 *
 *  Le paramètre `exclureKiosque` traverse tout le moteur de calcul : lorsqu'il
 *  est actif, le CA, les charges (au prorata), le matériel et la valeur
 *  d'emplacement du Kiosque sont neutralisés pour simuler le non-renouvellement
 *  de l'AOT (Autorisation d'Occupation Temporaire).
 * ========================================================================== */
'use strict';

/* =============================================================================
 *  1. CONFIG — Barèmes et coefficients métier
 *     (Sources : barèmes professionnels CHR/glacier, pratique de cession de
 *      fonds de commerce. Centralisés ici pour une mise à jour facile.)
 * ========================================================================== */
const CONFIG = {

  // --- Barème fiscal : % du CA moyen selon emplacement et type de bail ------
  //  Un glacier se négocie usuellement entre 50 % et 120 % du CA annuel TTC,
  //  l'emplacement étant le facteur déterminant.
  baremeCA: {
    commercial: { A: 1.15, B: 0.85, C: 0.55 }, // bail 3-6-9 protégé
    // L'AOT est précaire : le « fonds » n'est pas réellement transmissible.
    // On applique une forte décote sur le barème CA pour le site concerné.
    aot:        { A: 0.55, B: 0.40, C: 0.25 },
  },

  // --- Droit au bail : nombre d'années de loyer capitalisées ----------------
  //  Plus l'emplacement est recherché, plus le « pas-de-porte » est élevé.
  //  L'AOT ne crée aucun droit au bail commercial → valeur nulle.
  droitAuBail: {
    commercial: { A: 3, B: 2, C: 1 },
    aot:        { A: 0, B: 0, C: 0 },
  },

  // --- Vétusté : coefficient de valeur vénale selon l'état du matériel -------
  vetuste: {
    neuf:       { coef: 0.90, label: 'Neuf' },
    bon:        { coef: 0.70, label: 'Bon état' },
    usage:      { coef: 0.40, label: 'Usagé' },
    finVie:     { coef: 0.10, label: 'En fin de vie' },
  },

  // --- Multiple EBE : ajustement de l'effet vétusté global ------------------
  //  Un parc matériel vieillissant pèse sur la valeur de rentabilité.
  ajustementMultiple: { min: 0.90, max: 1.05 },

  // --- Pondération des 3 méthodes pour la valeur médiane --------------------
  ponderation: { ca: 0.30, rentabilite: 0.40, patrimoniale: 0.30 },

  // --- Largeur de la fourchette autour de la médiane ------------------------
  fourchette: { basse: 0.85, haute: 1.15 },

  // --- Sites de l'entreprise ------------------------------------------------
  sites: [
    { id: 'labo',    nom: 'Laboratoire',    icone: '🏭', bailDefaut: 'commercial', genereCA: false },
    { id: 'port',    nom: 'Boutique du Port', icone: '🏪', bailDefaut: 'commercial', genereCA: true  },
    { id: 'reserve', nom: 'Réserve',        icone: '📦', bailDefaut: 'commercial', genereCA: false },
    { id: 'kiosque', nom: 'Kiosque (AOT)',  icone: '⛱️', bailDefaut: 'aot',        genereCA: true  },
  ],

  // --- Catalogue matériel pré-rempli (valeur à neuf indicative en €) --------
  catalogueMateriel: [
    { nom: 'Turbine à glace',              prix: 18000, site: 'labo' },
    { nom: 'Pasteurisateur',               prix: 12000, site: 'labo' },
    { nom: 'Mixeur / homogénéisateur',     prix: 4500,  site: 'labo' },
    { nom: 'Cellule de refroidissement',   prix: 9000,  site: 'labo' },
    { nom: 'Surgélateur / conservateur',   prix: 6000,  site: 'reserve' },
    { nom: 'Armoire positive (frigo)',     prix: 3500,  site: 'labo' },
    { nom: 'Vitrine réfrigérée négative',  prix: 11000, site: 'port' },
    { nom: 'Vitrine à glaces (ventes)',    prix: 14000, site: 'port' },
    { nom: 'Comptoir / mobilier boutique', prix: 8000,  site: 'port' },
    { nom: 'Caisse enregistreuse',         prix: 1800,  site: 'port' },
    { nom: 'Climatisation',                prix: 4000,  site: 'port' },
    { nom: 'Vitrine réfrigérée kiosque',   prix: 7000,  site: 'kiosque' },
    { nom: 'Camionnette réfrigérée',       prix: 28000, site: 'labo' },
    { nom: 'Triporteur glacier',           prix: 9000,  site: 'kiosque' },
    { nom: 'Lave-vaisselle professionnel', prix: 2500,  site: 'labo' },
    { nom: 'Autre matériel',               prix: 0,     site: 'labo' },
  ],

  notesEmplacement: [
    { val: 'A', label: 'Zone A — Top (passage fort)' },
    { val: 'B', label: 'Zone B — Moyen' },
    { val: 'C', label: 'Zone C — Faible' },
  ],
};

const ETAPES = ['Juridique', 'Financier', 'Matériel', 'Stock', 'Rapport'];

/* =============================================================================
 *  2. ETAT — Modèle de données + persistance
 * ========================================================================== */
const Etat = {
  cle: 'eval-glacier-v1',

  // Structure par défaut
  defaut() {
    const sites = {};
    CONFIG.sites.forEach(s => {
      sites[s.id] = { bail: s.bailDefaut, loyer: 0, note: 'B' };
    });
    return {
      exclureKiosque: false,
      etapeCourante: 0,
      sites,
      finances: {
        // 3 exercices : [N-2, N-1, N]
        ca:        [0, 0, 0],   // CA global
        caKiosque: [0, 0, 0],   // dont Kiosque
        ebe:       [0, 0, 0],   // Excédent Brut d'Exploitation
        masse:     [0, 0, 0],   // masse salariale
        charges:   [0, 0, 0],   // charges fixes
        multiple: 4,
        retraitement: 0,
      },
      materiel: [],             // { nom, site, prixNeuf, etat }
      stock: { mp: 0, pf: 0 },
    };
  },

  data: null,

  charger() {
    try {
      const brut = localStorage.getItem(this.cle);
      this.data = brut ? Object.assign(this.defaut(), JSON.parse(brut)) : this.defaut();
    } catch (e) {
      console.warn('Lecture localStorage impossible, état par défaut utilisé.', e);
      this.data = this.defaut();
    }
    return this.data;
  },

  sauver() {
    try { localStorage.setItem(this.cle, JSON.stringify(this.data)); }
    catch (e) { /* mode privé : on ignore silencieusement */ }
  },

  reset() {
    this.data = this.defaut();
    this.sauver();
  },
};

/* =============================================================================
 *  3. CALCULS — Moteur d'évaluation
 *     Toutes les fonctions acceptent un booléen `exclureK` afin de produire
 *     instantanément les deux scénarios (avec / sans Kiosque).
 * ========================================================================== */
const Calculs = {

  // Moyenne arithmétique sécurisée (ignore les valeurs non numériques)
  moyenne(tab) {
    const nums = (tab || []).map(Number).filter(n => !isNaN(n));
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },

  // --- CA moyens ventilés ---------------------------------------------------
  caMoyens() {
    const f = Etat.data.finances;
    const caGlobal = this.moyenne(f.ca);
    const caKiosque = this.moyenne(f.caKiosque);
    const caPort = Math.max(0, caGlobal - caKiosque); // tout le reste = hors kiosque
    return { caGlobal, caKiosque, caPort };
  },

  // Part du Kiosque dans le CA total (sert à proratiser l'EBE et les charges)
  partKiosque() {
    const { caGlobal, caKiosque } = this.caMoyens();
    return caGlobal > 0 ? Math.min(1, caKiosque / caGlobal) : 0;
  },

  /* --- MÉTHODE 1 : Valeur par le Chiffre d'Affaires (barème fiscal) --------
   *  Chaque site générant du CA est valorisé par % de son CA, selon son
   *  emplacement et son type de bail.
   */
  valeurParCA(exclureK) {
    const { caKiosque, caPort } = this.caMoyens();
    const sPort = Etat.data.sites.port;
    const sKiosque = Etat.data.sites.kiosque;

    const pctPort = CONFIG.baremeCA[sPort.bail][sPort.note];
    let valeur = caPort * pctPort;

    if (!exclureK) {
      const pctKiosque = CONFIG.baremeCA[sKiosque.bail][sKiosque.note];
      valeur += caKiosque * pctKiosque;
    }
    return valeur;
  },

  /* --- Coefficient de vétusté global du parc matériel ----------------------
   *  Moyenne des coefficients pondérée par la valeur à neuf. Sert à ajuster
   *  le multiple d'EBE (parc vieux → multiple réduit).
   */
  vetusteGlobale(exclureK) {
    let totalNeuf = 0, totalVenal = 0;
    Etat.data.materiel.forEach(m => {
      if (exclureK && m.site === 'kiosque') return;
      const neuf = Number(m.prixNeuf) || 0;
      const coef = (CONFIG.vetuste[m.etat] || CONFIG.vetuste.bon).coef;
      totalNeuf += neuf;
      totalVenal += neuf * coef;
    });
    if (totalNeuf === 0) return 0.7; // hypothèse neutre si aucun matériel
    return totalVenal / totalNeuf;   // ∈ [0.10 ; 0.90]
  },

  // Convertit la vétusté globale en facteur d'ajustement du multiple EBE
  facteurMultiple(exclureK) {
    const v = this.vetusteGlobale(exclureK);          // 0.10 → 0.90
    const { min, max } = CONFIG.ajustementMultiple;
    // Mapping linéaire : vétusté 0.10 → min ; 0.90 → max
    const t = Math.max(0, Math.min(1, (v - 0.10) / (0.90 - 0.10)));
    return min + t * (max - min);
  },

  /* --- MÉTHODE 2 : Valeur par la Rentabilité (multiple de l'EBE retraité) -- */
  ebeRetraiteMoyen(exclureK) {
    const f = Etat.data.finances;
    let ebe = this.moyenne(f.ebe) + (Number(f.retraitement) || 0);
    if (exclureK) {
      // On retire la quote-part d'EBE attribuable au Kiosque (au prorata du CA).
      ebe = ebe * (1 - this.partKiosque());
    }
    return ebe;
  },

  valeurParRentabilite(exclureK) {
    const f = Etat.data.finances;
    const ebe = this.ebeRetraiteMoyen(exclureK);
    const multipleAjuste = (Number(f.multiple) || 4) * this.facteurMultiple(exclureK);
    return Math.max(0, ebe * multipleAjuste);
  },

  // --- Valeur vénale du matériel (après vétusté) ----------------------------
  valeurMateriel(exclureK) {
    return Etat.data.materiel.reduce((tot, m) => {
      if (exclureK && m.site === 'kiosque') return tot;
      const neuf = Number(m.prixNeuf) || 0;
      const coef = (CONFIG.vetuste[m.etat] || CONFIG.vetuste.bon).coef;
      return tot + neuf * coef;
    }, 0);
  },

  // --- Valeur du stock (brute, prix d'achat) --------------------------------
  valeurStock() {
    const s = Etat.data.stock;
    return (Number(s.mp) || 0) + (Number(s.pf) || 0);
  },

  // --- Droit au bail capitalisé (par site) ----------------------------------
  valeurDroitAuBail(exclureK) {
    let total = 0;
    CONFIG.sites.forEach(def => {
      if (exclureK && def.id === 'kiosque') return;
      const s = Etat.data.sites[def.id];
      const annees = CONFIG.droitAuBail[s.bail][s.note];
      total += (Number(s.loyer) || 0) * annees;
    });
    return total;
  },

  /* --- MÉTHODE 3 : Valeur Patrimoniale ------------------------------------
   *  Actifs corporels et incorporels « tangibles » :
   *  matériel vénal + stock + droit au bail.
   */
  valeurPatrimoniale(exclureK) {
    return this.valeurMateriel(exclureK) + this.valeurStock() + this.valeurDroitAuBail(exclureK);
  },

  /* --- SYNTHÈSE : les 3 méthodes + la fourchette pondérée ------------------ */
  synthese(exclureK) {
    const ca = this.valeurParCA(exclureK);
    const renta = this.valeurParRentabilite(exclureK);
    const patri = this.valeurPatrimoniale(exclureK);
    const p = CONFIG.ponderation;

    const mediane = ca * p.ca + renta * p.rentabilite + patri * p.patrimoniale;
    const basse = mediane * CONFIG.fourchette.basse;
    const haute = mediane * CONFIG.fourchette.haute;

    return { ca, renta, patri, basse, mediane, haute };
  },
};

/* =============================================================================
 *  4. UI — Rendu et interactions
 * ========================================================================== */

// Formatage monétaire français (€, sans décimale au-delà de l'unité)
const euro = n => (Math.round(Number(n) || 0)).toLocaleString('fr-FR') + ' €';
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const UI = {

  /* ---- Stepper (barre d'étapes cliquable) -------------------------------- */
  rendreStepper() {
    const ol = $('#stepper');
    ol.innerHTML = '';
    ETAPES.forEach((nom, i) => {
      const actif = i === Etat.data.etapeCourante;
      const li = document.createElement('li');
      li.className = 'flex-1 min-w-[110px]';
      li.innerHTML = `
        <button data-goto="${i}"
          class="w-full flex items-center gap-2 px-3 py-3 border-b-2 transition-colors
                 ${actif ? 'border-marine-700 text-marine-800 font-semibold'
                         : 'border-transparent text-slate-400 hover:text-slate-600'}">
          <span class="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0
                       ${actif ? 'bg-marine-700 text-white' : 'bg-slate-200 text-slate-500'}">${i + 1}</span>
          <span class="whitespace-nowrap">${nom}</span>
        </button>`;
      ol.appendChild(li);
    });
    ol.querySelectorAll('[data-goto]').forEach(btn =>
      btn.addEventListener('click', () => this.allerEtape(Number(btn.dataset.goto))));
  },

  allerEtape(i) {
    Etat.data.etapeCourante = Math.max(0, Math.min(ETAPES.length - 1, i));
    Etat.sauver();
    $$('.panel').forEach(p =>
      p.classList.toggle('hidden', Number(p.dataset.panel) !== Etat.data.etapeCourante));
    $('#btn-prev').disabled = Etat.data.etapeCourante === 0;
    $('#btn-next').classList.toggle('invisible', Etat.data.etapeCourante === ETAPES.length - 1);
    this.rendreStepper();
    if (Etat.data.etapeCourante === ETAPES.length - 1) this.rendreRapport();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  /* ---- ÉTAPE 1 : grille des sites ---------------------------------------- */
  rendreSites() {
    const grille = $('#grille-sites');
    grille.innerHTML = '';
    CONFIG.sites.forEach(def => {
      const s = Etat.data.sites[def.id];
      const estKiosque = def.id === 'kiosque';
      const card = document.createElement('div');
      card.className = `rounded-xl border p-4 ${estKiosque
        ? 'border-framboise-500/40 bg-framboise-500/5' : 'border-slate-200 bg-slate-50'}`;
      card.innerHTML = `
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-700 flex items-center gap-2">${def.icone} ${def.nom}</h3>
          ${estKiosque ? '<span class="text-[10px] uppercase font-bold tracking-wide text-framboise-600 bg-framboise-500/10 px-2 py-0.5 rounded">précaire</span>' : ''}
        </div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Type de bail</label>
        <select data-site="${def.id}" data-champ="bail" class="champ w-full mb-3">
          <option value="commercial" ${s.bail === 'commercial' ? 'selected' : ''}>Bail commercial 3-6-9</option>
          <option value="aot" ${s.bail === 'aot' ? 'selected' : ''}>AOT précaire (domaine public)</option>
        </select>

        <label class="block text-xs font-medium text-slate-500 mb-1">Loyer annuel (€)</label>
        <input type="number" min="0" step="500" value="${s.loyer || ''}" placeholder="0"
               data-site="${def.id}" data-champ="loyer" class="champ w-full mb-3">

        <label class="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
          Note d'emplacement
          <span class="infobulle text-slate-400">ⓘ
            <span class="bulle">Qualité commerciale de l'emplacement. Zone A : flux touristique fort, front de mer. Zone B : rue passante secondaire. Zone C : à l'écart. Détermine le % du CA retenu.</span>
          </span>
        </label>
        <select data-site="${def.id}" data-champ="note" class="champ w-full">
          ${CONFIG.notesEmplacement.map(n =>
            `<option value="${n.val}" ${s.note === n.val ? 'selected' : ''}>${n.label}</option>`).join('')}
        </select>`;
      grille.appendChild(card);
    });

    // Liaison des champs → état
    grille.querySelectorAll('[data-site]').forEach(el => {
      el.addEventListener('input', () => {
        const { site, champ } = el.dataset;
        Etat.data.sites[site][champ] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
        Etat.sauver();
      });
    });
  },

  /* ---- ÉTAPE 2 : tableau des finances ------------------------------------ */
  rendreFinances() {
    const lignes = [
      { cle: 'ca',        label: 'Chiffre d\'affaires global', aide: 'CA total TTC, tous sites confondus.' },
      { cle: 'caKiosque', label: 'dont CA du Kiosque',         aide: 'Part du CA réalisée au Kiosque (AOT). Sert à isoler le scénario « sans Kiosque ».' },
      { cle: 'ebe',       label: 'EBE',                        aide: 'Excédent Brut d\'Exploitation = CA − achats − charges externes − masse salariale − impôts/taxes. Indicateur clé de rentabilité avant amortissements et financement.' },
      { cle: 'masse',     label: 'Masse salariale',            aide: 'Salaires bruts chargés. Indicatif (déjà inclus dans le calcul de l\'EBE).' },
      { cle: 'charges',   label: 'Charges fixes',              aide: 'Loyers, énergie, assurances, abonnements… Indicatif.' },
    ];
    const corps = $('#corps-finances');
    corps.innerHTML = '';
    lignes.forEach(l => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const vals = Etat.data.finances[l.cle];
      tr.innerHTML = `
        <td class="py-2 pr-3">
          <span class="flex items-center gap-1 text-slate-700">${l.label}
            <span class="infobulle text-slate-400 text-xs">ⓘ<span class="bulle">${l.aide}</span></span>
          </span>
        </td>
        ${[0, 1, 2].map(i => `
          <td class="px-1 py-1">
            <input type="number" step="1000" value="${vals[i] || ''}" placeholder="0"
                   data-fin="${l.cle}" data-an="${i}" class="champ w-full text-right">
          </td>`).join('')}`;
      corps.appendChild(tr);
    });

    corps.querySelectorAll('[data-fin]').forEach(el => {
      el.addEventListener('input', () => {
        Etat.data.finances[el.dataset.fin][Number(el.dataset.an)] = Number(el.value) || 0;
        Etat.sauver();
      });
    });

    // Multiple EBE (slider) + retraitement
    $('#multiple-ebe').value = Etat.data.finances.multiple;
    $('#multiple-ebe-val').textContent = Number(Etat.data.finances.multiple).toFixed(1);
    $('#retraitement-ebe').value = Etat.data.finances.retraitement || '';

    $('#multiple-ebe').addEventListener('input', e => {
      Etat.data.finances.multiple = Number(e.target.value);
      $('#multiple-ebe-val').textContent = Number(e.target.value).toFixed(1);
      Etat.sauver();
    });
    $('#retraitement-ebe').addEventListener('input', e => {
      Etat.data.finances.retraitement = Number(e.target.value) || 0;
      Etat.sauver();
    });
  },

  /* ---- ÉTAPE 3 : lignes de matériel -------------------------------------- */
  ajouterMateriel(prefill) {
    const base = prefill || { nom: 'Turbine à glace', site: 'labo', prixNeuf: 18000, etat: 'bon' };
    Etat.data.materiel.push(Object.assign({}, base));
    Etat.sauver();
    this.rendreMateriel();
  },

  rendreMateriel() {
    const corps = $('#corps-materiel');
    corps.innerHTML = '';
    $('#materiel-vide').classList.toggle('hidden', Etat.data.materiel.length > 0);

    Etat.data.materiel.forEach((m, idx) => {
      const coef = (CONFIG.vetuste[m.etat] || CONFIG.vetuste.bon).coef;
      const venale = (Number(m.prixNeuf) || 0) * coef;
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      tr.innerHTML = `
        <td class="py-2 pr-2">
          <select data-mat="${idx}" data-champ="nom" class="champ w-full min-w-[160px]">
            ${CONFIG.catalogueMateriel.map(c =>
              `<option value="${c.nom}" ${c.nom === m.nom ? 'selected' : ''}>${c.nom}</option>`).join('')}
          </select>
        </td>
        <td class="px-2">
          <select data-mat="${idx}" data-champ="site" class="champ w-full">
            ${CONFIG.sites.map(s =>
              `<option value="${s.id}" ${s.id === m.site ? 'selected' : ''}>${s.nom}</option>`).join('')}
          </select>
        </td>
        <td class="px-2">
          <input type="number" min="0" step="500" value="${m.prixNeuf || ''}" placeholder="0"
                 data-mat="${idx}" data-champ="prixNeuf" class="champ w-28 text-right">
        </td>
        <td class="px-2">
          <select data-mat="${idx}" data-champ="etat" class="champ w-full">
            ${Object.entries(CONFIG.vetuste).map(([k, v]) =>
              `<option value="${k}" ${k === m.etat ? 'selected' : ''}>${v.label} (${Math.round(v.coef*100)}%)</option>`).join('')}
          </select>
        </td>
        <td class="px-2 text-right font-semibold text-menthe-600 whitespace-nowrap">${euro(venale)}</td>
        <td class="pl-2 text-right">
          <button data-suppr="${idx}" class="text-framboise-500 hover:text-framboise-600 text-lg leading-none" title="Supprimer">✕</button>
        </td>`;
      corps.appendChild(tr);
    });

    // Liaison champs matériel
    corps.querySelectorAll('[data-mat]').forEach(el => {
      el.addEventListener('input', () => {
        const i = Number(el.dataset.mat);
        const champ = el.dataset.champ;
        if (champ === 'nom') {
          Etat.data.materiel[i].nom = el.value;
          // Pré-remplissage intelligent du prix neuf à la sélection
          const cat = CONFIG.catalogueMateriel.find(c => c.nom === el.value);
          if (cat && cat.prix > 0) {
            Etat.data.materiel[i].prixNeuf = cat.prix;
            Etat.data.materiel[i].site = cat.site;
          }
          Etat.sauver();
          this.rendreMateriel();
          return;
        }
        Etat.data.materiel[i][champ] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
        Etat.sauver();
        this.rendreMateriel(); // recalcule la valeur vénale affichée
      });
    });
    corps.querySelectorAll('[data-suppr]').forEach(btn => {
      btn.addEventListener('click', () => {
        Etat.data.materiel.splice(Number(btn.dataset.suppr), 1);
        Etat.sauver();
        this.rendreMateriel();
      });
    });
  },

  /* ---- ÉTAPE 4 : stock --------------------------------------------------- */
  rendreStock() {
    $('#stock-mp').value = Etat.data.stock.mp || '';
    $('#stock-pf').value = Etat.data.stock.pf || '';
    const maj = () => {
      $('#stock-total').textContent = euro(Calculs.valeurStock());
    };
    ['mp', 'pf'].forEach(k => {
      const el = $(`#stock-${k}`);
      el.addEventListener('input', () => {
        Etat.data.stock[k] = Number(el.value) || 0;
        Etat.sauver();
        maj();
      });
    });
    maj();
  },

  /* ---- ÉTAPE 5 : rapport d'expert ---------------------------------------- */
  rendreRapport() {
    const exclu = Etat.data.exclureKiosque;
    const avec = Calculs.synthese(false);   // scénario AVEC Kiosque
    const sans = Calculs.synthese(true);    // scénario SANS Kiosque
    const courant = exclu ? sans : avec;    // scénario actuellement retenu
    const { caGlobal, caKiosque } = Calculs.caMoyens();

    // Barre de répartition d'une valeur dans la fourchette (visuel simple)
    const barre = (v, max) => `
      <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full bg-marine-600" style="width:${max > 0 ? Math.min(100, v / max * 100) : 0}%"></div>
      </div>`;
    const maxMethode = Math.max(courant.ca, courant.renta, courant.patri, 1);

    const ligneMethode = (titre, aide, valeur, detail) => `
      <div class="py-3 border-b border-slate-100 last:border-0">
        <div class="flex items-center justify-between gap-3 mb-1">
          <span class="text-sm font-semibold text-slate-700 flex items-center gap-1">${titre}
            <span class="infobulle text-slate-400 text-xs">ⓘ<span class="bulle">${aide}</span></span>
          </span>
          <span class="font-bold text-marine-800 whitespace-nowrap">${euro(valeur)}</span>
        </div>
        ${barre(valeur, maxMethode)}
        <p class="text-xs text-slate-400 mt-1">${detail}</p>
      </div>`;

    const ecart = avec.mediane - sans.mediane;
    const ecartPct = avec.mediane > 0 ? (ecart / avec.mediane * 100) : 0;

    $('#rapport').innerHTML = `
      <div class="flex items-start justify-between gap-4 mb-6 pb-4 border-b border-slate-200">
        <div>
          <h2 class="text-2xl font-extrabold text-marine-800">Rapport d'évaluation</h2>
          <p class="text-slate-500 text-sm">Glacier artisanal multi-sites · établi le ${new Date().toLocaleDateString('fr-FR')}</p>
        </div>
        <span class="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full
              ${exclu ? 'bg-framboise-500/10 text-framboise-600' : 'bg-menthe-500/10 text-menthe-600'}">
          Scénario : ${exclu ? 'SANS Kiosque' : 'AVEC Kiosque'}
        </span>
      </div>

      <!-- 1. Synthèse des 3 méthodes -->
      <h3 class="text-sm uppercase tracking-wide font-bold text-slate-400 mb-2">1 · Synthèse des 3 méthodes</h3>
      <div class="bg-slate-50 rounded-xl p-4 mb-6">
        ${ligneMethode(
          'Valeur par le Chiffre d\'affaires',
          'Barème professionnel : pourcentage du CA moyen selon l\'emplacement et le type de bail (50 % à 120 % pour un glacier).',
          courant.ca,
          `Pondération finale : ${Math.round(CONFIG.ponderation.ca*100)} %`)}
        ${ligneMethode(
          'Valeur par la Rentabilité',
          'Multiple de l\'EBE retraité moyen (×3 à ×5), ajusté selon la vétusté globale du matériel.',
          courant.renta,
          `EBE retraité moyen ${euro(Calculs.ebeRetraiteMoyen(exclu))} × ${(Number(Etat.data.finances.multiple)*Calculs.facteurMultiple(exclu)).toFixed(2)} · Pondération ${Math.round(CONFIG.ponderation.rentabilite*100)} %`)}
        ${ligneMethode(
          'Valeur Patrimoniale',
          'Actif tangible : matériel (valeur vénale après vétusté) + stock + droit au bail capitalisé.',
          courant.patri,
          `Matériel ${euro(Calculs.valeurMateriel(exclu))} · Stock ${euro(Calculs.valeurStock())} · Droit au bail ${euro(Calculs.valeurDroitAuBail(exclu))} · Pondération ${Math.round(CONFIG.ponderation.patrimoniale*100)} %`)}
      </div>

      <!-- 2. Fourchette finale -->
      <h3 class="text-sm uppercase tracking-wide font-bold text-slate-400 mb-2">2 · Fourchette d'évaluation finale</h3>
      <div class="grid grid-cols-3 gap-3 mb-6">
        <div class="text-center bg-slate-50 rounded-xl p-4">
          <p class="text-xs text-slate-400 mb-1">Basse</p>
          <p class="text-lg sm:text-xl font-bold text-slate-600">${euro(courant.basse)}</p>
        </div>
        <div class="text-center bg-marine-700 rounded-xl p-4 shadow-md scale-105">
          <p class="text-xs text-marine-100 mb-1">Médiane (retenue)</p>
          <p class="text-xl sm:text-2xl font-extrabold text-white">${euro(courant.mediane)}</p>
        </div>
        <div class="text-center bg-slate-50 rounded-xl p-4">
          <p class="text-xs text-slate-400 mb-1">Haute</p>
          <p class="text-lg sm:text-xl font-bold text-slate-600">${euro(courant.haute)}</p>
        </div>
      </div>

      <!-- 3. Analyse d'impact Kiosque -->
      <h3 class="text-sm uppercase tracking-wide font-bold text-slate-400 mb-2">3 · Analyse d'impact — Risque Kiosque (AOT)</h3>
      <div class="rounded-xl border-2 ${exclu ? 'border-framboise-500/40' : 'border-menthe-500/40'} overflow-hidden mb-2">
        <div class="grid grid-cols-2">
          <div class="p-4 bg-menthe-500/5 border-r border-slate-100">
            <p class="text-xs font-semibold text-menthe-600 mb-1">Valeur AVEC Kiosque</p>
            <p class="text-xl font-extrabold text-slate-800">${euro(avec.mediane)}</p>
          </div>
          <div class="p-4 bg-framboise-500/5">
            <p class="text-xs font-semibold text-framboise-600 mb-1">Valeur SANS Kiosque</p>
            <p class="text-xl font-extrabold text-slate-800">${euro(sans.mediane)}</p>
          </div>
        </div>
        <div class="px-4 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-900 flex items-center gap-2">
          <span class="text-lg">⚖️</span>
          <span>Le non-renouvellement de l'AOT représente un risque de
            <strong>−${euro(ecart)}</strong> (soit <strong>−${ecartPct.toFixed(1)} %</strong>)
            sur la valeur médiane de l'entreprise.</span>
        </div>
      </div>
      <p class="text-xs text-slate-400">
        CA moyen 3 ans : ${euro(caGlobal)} (dont Kiosque ${euro(caKiosque)}, soit ${(Calculs.partKiosque()*100).toFixed(1)} %).
        Méthode : pondération ${Math.round(CONFIG.ponderation.ca*100)}/${Math.round(CONFIG.ponderation.rentabilite*100)}/${Math.round(CONFIG.ponderation.patrimoniale*100)}
        (CA / Rentabilité / Patrimoniale), fourchette ±${Math.round((1-CONFIG.fourchette.basse)*100)} %.
      </p>`;
  },

  /* ---- Initialisation globale de l'interface ----------------------------- */
  init() {
    // Style commun des champs (injecté pour rester DRY)
    const styleChamps = document.createElement('style');
    styleChamps.textContent =
      '.champ{border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .65rem;font-size:.875rem;background:#fff;outline:none}' +
      '.champ:focus{border-color:#1e6091;box-shadow:0 0 0 3px rgba(30,96,145,.15)}';
    document.head.appendChild(styleChamps);

    // Switch d'exclusion du Kiosque
    const sw = $('#switch-kiosque');
    sw.checked = Etat.data.exclureKiosque;
    sw.addEventListener('change', () => {
      Etat.data.exclureKiosque = sw.checked;
      Etat.sauver();
      if (Etat.data.etapeCourante === ETAPES.length - 1) this.rendreRapport();
    });

    // Navigation
    $('#btn-prev').addEventListener('click', () => this.allerEtape(Etat.data.etapeCourante - 1));
    $('#btn-next').addEventListener('click', () => this.allerEtape(Etat.data.etapeCourante + 1));
    $('#btn-add-materiel').addEventListener('click', () => this.ajouterMateriel());
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-reset').addEventListener('click', () => {
      if (confirm('Effacer toutes les données saisies et repartir de zéro ?')) {
        Etat.reset();
        location.reload();
      }
    });

    // Rendu initial de toutes les sections
    this.rendreSites();
    this.rendreFinances();
    this.rendreMateriel();
    this.rendreStock();
    this.allerEtape(Etat.data.etapeCourante);
  },
};

/* =============================================================================
 *  5. DÉMARRAGE
 * ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  Etat.charger();
  UI.init();
});
