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

  /* ===========================================================================
   *  MODULES DE REVALORISATION (niveau cession)
   * ======================================================================== */

  // --- Module « Tendance » : pondération des 3 exercices (N-2, N-1, N) ------
  //  Le dernier exercice, plus représentatif, pèse davantage.
  ponderationExercices: [1, 2, 3],           // normalisés automatiquement (≈ 17/33/50 %)

  // --- Module « Tendance » : ajustement du multiple selon la croissance -----
  //  Seuils de croissance annuelle moyenne du CA → bonus/malus sur le multiple.
  tendanceMultiple: [
    { seuil: 0.08,  delta: 0.5,  label: 'Forte croissance' },
    { seuil: 0.03,  delta: 0.25, label: 'Croissance' },
    { seuil: -0.03, delta: 0.0,  label: 'Stable' },
    { seuil: -0.08, delta: -0.3, label: 'Léger recul' },
    { seuil: -Infinity, delta: -0.6, label: 'Déclin marqué' },
  ],

  // --- Module « Survaleur incorporelle & risque » : questionnaire scoré -----
  //  Chaque facteur ajoute/retire des points de % appliqués à la valeur finale.
  facteursSurvaleur: [
    { id: 'reputation', label: 'Notoriété & e-réputation',
      aide: 'Avis Google/TripAdvisor, note moyenne, abonnés réseaux sociaux. Crucial sur un emplacement touristique.',
      options: [
        { val: 'forte',  label: 'Excellente (>4,5★, nombreux avis)', pts: 10 },
        { val: 'bonne',  label: 'Bonne', pts: 4 },
        { val: 'moyenne',label: 'Moyenne', pts: 0 },
        { val: 'faible', label: 'Faible / peu d\'avis', pts: -8 },
      ] },
    { id: 'savoirFaire', label: 'Label artisan & savoir-faire',
      aide: 'Mention « Artisan Glacier », médailles/concours, recettes « fait maison » documentées et transmissibles, ingrédients AOP/bio.',
      options: [
        { val: 'fort',  label: 'Fort (label + médailles + recettes documentées)', pts: 10 },
        { val: 'moyen', label: 'Moyen', pts: 3 },
        { val: 'faible',label: 'Faible / non formalisé', pts: -5 },
      ] },
    { id: 'b2b', label: 'Revenus récurrents B2B',
      aide: 'Revente à restaurants/hôtels, événementiel, marchés, distribution. Du CA récurrent et hors saison vaut beaucoup plus cher.',
      options: [
        { val: 'fort',  label: 'Significatifs (>20 % du CA, contrats)', pts: 8 },
        { val: 'moyen', label: 'Quelques-uns', pts: 3 },
        { val: 'aucun', label: 'Aucun (comptoir uniquement)', pts: 0 },
      ] },
    { id: 'saison', label: 'Saisonnalité',
      aide: 'Une activité étalée sur l\'année (chocolats, événementiel l\'hiver) réduit le risque. Une saison très courte le concentre.',
      options: [
        { val: 'annuelle', label: 'Activité à l\'année', pts: 6 },
        { val: 'longue',   label: 'Longue saison', pts: 2 },
        { val: 'courte',   label: 'Saison courte (très saisonnier)', pts: -8 },
      ] },
    { id: 'hommeCle', label: 'Dépendance à l\'homme-clé',
      aide: 'Si le savoir-faire repose sur le dirigeant, le risque de transmission est élevé. Une équipe autonome + un accompagnement du repreneur rassurent.',
      options: [
        { val: 'faible',  label: 'Faible (équipe autonome, accompagnement prévu)', pts: 4 },
        { val: 'moyenne', label: 'Moyenne', pts: 0 },
        { val: 'forte',   label: 'Forte (tout repose sur le dirigeant)', pts: -10 },
      ] },
    { id: 'perspectives', label: 'Perspectives de marché',
      aide: 'Dynamique locale : fréquentation touristique, concurrence, projets d\'urbanisme, tendance de consommation.',
      options: [
        { val: 'favorables',  label: 'Favorables', pts: 5 },
        { val: 'stables',     label: 'Stables', pts: 0 },
        { val: 'defavorables',label: 'Défavorables', pts: -8 },
      ] },
  ],

  // Bornes de la prime/décote globale de survaleur (en %)
  survaleurBornes: { min: -0.25, max: 0.35 },

  // --- Module « Net vendeur » -----------------------------------------------
  // Provision de renouvellement : part du prix à neuf des matériels « en fin de
  // vie » que le repreneur devra réinvestir (déduite de la valeur).
  provisionRenouvellement: 0.50,

  // Barème des droits d'enregistrement sur cession de fonds de commerce (France)
  droitsEnregistrement: [
    { de: 0,      a: 23000,   taux: 0.00 },
    { de: 23000,  a: 200000,  taux: 0.03 },
    { de: 200000, a: Infinity,taux: 0.05 },
  ],

  // Régimes d'exonération de plus-value (information pédagogique)
  regimesExoneration: {
    aucun:        'Aucun régime d\'exonération particulier retenu.',
    art238:       'Art. 238 quindecies : exonération totale si valeur ≤ 300 k€, partielle ≤ 500 k€ (sous conditions de durée d\'activité).',
    retraite:     'Art. 151 septies A : exonération de la plus-value en cas de départ à la retraite du cédant (sous conditions).',
    art151septies:'Art. 151 septies : exonération selon le niveau de recettes (seuils CHR), sous conditions de durée.',
  },
};

const ETAPES = ['Juridique', 'Comptabilité', 'Retraitements', 'Matériel', 'Stock', 'Survaleur', 'Rapport'];

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
        ponderer: true,         // pondérer les exercices (dernier exercice plus lourd)
      },
      materiel: [],             // { nom, site, prixNeuf, etat }
      stock: { mp: 0, pf: 0 },

      // --- Module 1 : retraitements de l'EBE ---
      retraitements: {
        actif: true,
        remunerationActuelle: 0,   // rémunération annuelle réelle du dirigeant
        remunerationMarche: 0,     // salaire de marché d'un gérant équivalent
        loyerActuelMurs: 0,        // loyer réellement versé (ex. à une SCI)
        loyerMarcheMurs: 0,        // loyer de marché des locaux détenus
        chargesExcept: 0,          // charges non récurrentes à réintégrer
        creditBail: 0,             // redevances de crédit-bail à réintégrer
      },

      // --- Module 2/3 : survaleur incorporelle & risque ---
      survaleur: {
        actif: true,
        reputation: 'moyenne', savoirFaire: 'moyen', b2b: 'aucun',
        saison: 'longue', hommeCle: 'moyenne', perspectives: 'stables',
      },

      // --- Module 4 : cession & net vendeur ---
      cession: {
        actif: true,
        type: 'fonds',          // 'fonds' (vente du fonds) | 'titres' (cession de parts)
        tresorerie: 0,          // trésorerie disponible (cession de titres)
        detteNette: 0,          // emprunts / crédit-bail restant dû
        regimeExo: 'aucun',
      },
    };
  },

  data: null,

  // Fusion profonde d'une saisie chargée sur la structure par défaut.
  // Garantit que toutes les clés attendues existent (robustesse face aux
  // fichiers partiels, anciens ou édités à la main) → évite tout plantage.
  fusionner(base, charge) {
    if (!charge || typeof charge !== 'object') return base;
    const out = Object.assign({}, base);
    out.exclureKiosque = !!charge.exclureKiosque;
    out.etapeCourante = Number.isInteger(charge.etapeCourante) ? charge.etapeCourante : base.etapeCourante;
    // Sites : on fusionne site par site, en conservant ceux d'origine
    out.sites = {};
    Object.keys(base.sites).forEach(id => {
      out.sites[id] = Object.assign({}, base.sites[id], (charge.sites && charge.sites[id]) || {});
    });
    out.finances = Object.assign({}, base.finances, charge.finances || {});
    out.stock = Object.assign({}, base.stock, charge.stock || {});
    out.materiel = Array.isArray(charge.materiel) ? charge.materiel : base.materiel;
    out.retraitements = Object.assign({}, base.retraitements, charge.retraitements || {});
    out.survaleur = Object.assign({}, base.survaleur, charge.survaleur || {});
    out.cession = Object.assign({}, base.cession, charge.cession || {});
    if (charge.majLe) out.majLe = charge.majLe;
    return out;
  },

  charger() {
    try {
      const brut = localStorage.getItem(this.cle);
      this.data = brut ? this.fusionner(this.defaut(), JSON.parse(brut)) : this.defaut();
    } catch (e) {
      console.warn('Lecture localStorage impossible, état par défaut utilisé.', e);
      this.data = this.defaut();
    }
    return this.data;
  },

  sauver() {
    try {
      this.data.majLe = Date.now();                       // horodatage de la dernière saisie
      localStorage.setItem(this.cle, JSON.stringify(this.data));
    } catch (e) { /* mode privé : on ignore silencieusement */ }
    // Hook facultatif (mise à jour de l'indicateur « enregistré automatiquement »)
    if (typeof this.onSauver === 'function') this.onSauver();
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

  /* Moyenne pondérée des 3 exercices [N-2, N-1, N] : le dernier exercice, plus
   * représentatif, pèse davantage (module « Tendance »). Bascule sur la moyenne
   * simple si la pondération est désactivée ou les données incomplètes. */
  moyenneExercices(tab) {
    const f = Etat.data.finances;
    const vals = (tab || []).map(Number);
    // Pondération désactivée ou exercices manquants → moyenne simple
    if (!f.ponderer || vals.length !== 3 || vals.some(isNaN)) return this.moyenne(tab);
    const w = CONFIG.ponderationExercices;
    const sommeW = w[0] + w[1] + w[2];
    return (vals[0] * w[0] + vals[1] * w[1] + vals[2] * w[2]) / sommeW;
  },

  /* Croissance annuelle moyenne du CA sur la période (module « Tendance »).
   * Renvoie un taux décimal (ex. 0.05 = +5 %/an) ou null si non calculable. */
  croissanceCA() {
    const ca = (Etat.data.finances.ca || []).map(Number);
    if (ca.length !== 3 || ca.some(isNaN) || ca[0] <= 0 || ca[2] <= 0) return null;
    return Math.pow(ca[2] / ca[0], 1 / 2) - 1; // taux annuel moyen sur 2 ans
  },

  // Libellé + delta de multiple associés à la tendance du CA
  tendance() {
    const g = this.croissanceCA();
    if (g === null) return { g: null, delta: 0, label: 'Indéterminée' };
    const palier = CONFIG.tendanceMultiple.find(p => g >= p.seuil);
    return { g, delta: palier.delta, label: palier.label };
  },

  // --- CA moyens ventilés (pondérés selon le module Tendance) ---------------
  caMoyens() {
    const f = Etat.data.finances;
    const caGlobal = this.moyenneExercices(f.ca);
    const caKiosque = this.moyenneExercices(f.caKiosque);
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

  /* Multiple effectif appliqué à l'EBE : base × vétusté (+ tendance du CA).
   * Borné à [2,5 ; 6] pour rester réaliste dans le secteur. */
  multipleEffectif(exclureK) {
    const base = Number(Etat.data.finances.multiple) || 4;
    let m = base * this.facteurMultiple(exclureK);
    if (Etat.data.finances.ponderer) m += this.tendance().delta; // bonus/malus de croissance
    return Math.max(2.5, Math.min(6, m));
  },

  /* Détail des retraitements de l'EBE (module 1). Renvoie les lignes et le total
   * à réintégrer à l'EBE comptable pour obtenir l'EBE retraité. */
  retraitementDetail() {
    const r = Etat.data.retraitements;
    if (!r.actif) return { total: 0, lignes: [] };
    const lignes = [
      { label: 'Rémunération dirigeant (vs marché)', montant: (Number(r.remunerationActuelle) || 0) - (Number(r.remunerationMarche) || 0) },
      { label: 'Loyer des murs (vs marché)',         montant: (Number(r.loyerActuelMurs) || 0) - (Number(r.loyerMarcheMurs) || 0) },
      { label: 'Charges exceptionnelles',            montant: (Number(r.chargesExcept) || 0) },
      { label: 'Redevances de crédit-bail',          montant: (Number(r.creditBail) || 0) },
    ].filter(l => l.montant !== 0);
    const total = lignes.reduce((s, l) => s + l.montant, 0);
    return { total, lignes };
  },

  /* --- MÉTHODE 2 : Valeur par la Rentabilité (multiple de l'EBE retraité) -- */
  ebeRetraiteMoyen(exclureK) {
    const f = Etat.data.finances;
    let ebe = this.moyenneExercices(f.ebe) + this.retraitementDetail().total;
    if (exclureK) {
      // On retire la quote-part d'EBE attribuable au Kiosque (au prorata du CA).
      ebe = ebe * (1 - this.partKiosque());
    }
    return ebe;
  },

  valeurParRentabilite(exclureK) {
    const ebe = this.ebeRetraiteMoyen(exclureK);
    return Math.max(0, ebe * this.multipleEffectif(exclureK));
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

  /* --- MODULE 2/3 : Survaleur incorporelle & risque -----------------------
   *  Cumule les points du questionnaire → prime (ou décote) en % appliquée à
   *  la valeur finale. Indépendant du Kiosque (facteurs qualitatifs globaux). */
  survaleurDetail() {
    const s = Etat.data.survaleur;
    if (!s.actif) return { pct: 0, points: 0, lignes: [] };
    const lignes = [];
    let points = 0;
    CONFIG.facteursSurvaleur.forEach(fac => {
      const opt = fac.options.find(o => o.val === s[fac.id]) || fac.options.find(o => o.pts === 0) || fac.options[0];
      points += opt.pts;
      lignes.push({ label: fac.label, choix: opt.label, pts: opt.pts });
    });
    // Conversion points → % borné. 1 point ≈ 1 %.
    const { min, max } = CONFIG.survaleurBornes;
    const pct = Math.max(min, Math.min(max, points / 100));
    return { pct, points, lignes };
  },

  /* --- SYNTHÈSE : 3 méthodes + survaleur + fourchette pondérée ------------- */
  synthese(exclureK) {
    const ca = this.valeurParCA(exclureK);
    const renta = this.valeurParRentabilite(exclureK);
    const patri = this.valeurPatrimoniale(exclureK);
    const p = CONFIG.ponderation;

    const medianeBrute = ca * p.ca + renta * p.rentabilite + patri * p.patrimoniale;
    const survaleurPct = this.survaleurDetail().pct;        // prime/décote incorporelle
    const mediane = medianeBrute * (1 + survaleurPct);
    const basse = mediane * CONFIG.fourchette.basse;
    const haute = mediane * CONFIG.fourchette.haute;

    return { ca, renta, patri, medianeBrute, survaleurPct, basse, mediane, haute };
  },

  /* --- MODULE 4 : Provision de renouvellement -----------------------------
   *  Part du prix à neuf des matériels « en fin de vie » que le repreneur devra
   *  réinvestir prochainement → déduite de la valeur de cession. */
  provisionRenouvellement(exclureK) {
    return Etat.data.materiel.reduce((tot, m) => {
      if (exclureK && m.site === 'kiosque') return tot;
      if (m.etat !== 'finVie') return tot;
      return tot + (Number(m.prixNeuf) || 0) * CONFIG.provisionRenouvellement;
    }, 0);
  },

  // Droits d'enregistrement sur cession de fonds (barème progressif par tranches)
  droitsEnregistrement(valeur) {
    return CONFIG.droitsEnregistrement.reduce((dr, t) => {
      if (valeur <= t.de) return dr;
      const assiette = Math.min(valeur, t.a) - t.de;
      return dr + assiette * t.taux;
    }, 0);
  },

  /* --- MODULE 4 : Cession & net vendeur ------------------------------------
   *  Passage de la valeur de référence (médiane) au prix selon le type de
   *  cession, après provision de renouvellement, + droits d'enregistrement. */
  cession(exclureK) {
    const c = Etat.data.cession;
    const reference = this.synthese(exclureK).mediane;
    const provision = this.provisionRenouvellement(exclureK);
    const valeurFonds = Math.max(0, reference - provision);

    const titres = c.type === 'titres';
    const valeurTitres = titres
      ? valeurFonds + (Number(c.tresorerie) || 0) - (Number(c.detteNette) || 0)
      : null;

    const prix = titres ? valeurTitres : valeurFonds;
    const droits = this.droitsEnregistrement(valeurFonds); // assis sur le fonds
    const stock = this.valeurStock();                       // facturé en sus

    return {
      type: c.type, reference, provision, valeurFonds, valeurTitres,
      prix, droits, stock, regimeExo: c.regimeExo,
      exoTexte: CONFIG.regimesExoneration[c.regimeExo] || '',
    };
  },
};

/* =============================================================================
 *  4. UI — Rendu et interactions
 * ========================================================================== */

// Formatage monétaire français (€, sans décimale au-delà de l'unité)
const euro = n => (Math.round(Number(n) || 0)).toLocaleString('fr-FR') + ' €';
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
// Complète un nombre à deux chiffres (pour les dates de fichier)
const pad2 = n => String(n).padStart(2, '0');

/* =============================================================================
 *  Notifications éphémères (toasts)
 * ========================================================================== */
const Toast = {
  afficher(message, type = 'info', duree = 3500) {
    const conteneur = $('#toasts');
    if (!conteneur) return;
    const couleurs = { succes: 'bg-menthe-600', erreur: 'bg-framboise-600', info: 'bg-marine-700' };
    const el = document.createElement('div');
    el.className = `${couleurs[type] || couleurs.info} text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg max-w-[90vw] text-center`;
    el.textContent = message;
    conteneur.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duree);
  },
};

/* =============================================================================
 *  Sauvegarde — Export / Import de la saisie dans un fichier portable
 *  Permet d'enregistrer son dossier à tout moment, d'en garder une copie et
 *  de le reprendre plus tard, y compris sur un autre appareil.
 * ========================================================================== */
const Sauvegarde = {
  cleFlash: 'eval-glacier-flash',   // message affiché après le rechargement post-import

  // Télécharge l'état courant dans un fichier .json daté
  exporter() {
    try {
      const contenu = JSON.stringify(Etat.data, null, 2);
      const blob = new Blob([contenu], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const nom = `evaluation-glacier-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
      const a = document.createElement('a');
      a.href = url; a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      Toast.afficher('💾 Sauvegarde téléchargée : ' + nom, 'succes', 4500);
    } catch (e) {
      Toast.afficher("❌ Impossible de générer la sauvegarde.", 'erreur');
    }
  },

  // Recharge la saisie depuis un fichier choisi par l'utilisateur
  importer(fichier) {
    const lecteur = new FileReader();
    lecteur.onload = () => {
      try {
        const obj = JSON.parse(lecteur.result);
        // Validation minimale : on s'assure que c'est bien une sauvegarde de l'outil
        if (!obj || typeof obj !== 'object' || !obj.finances || !obj.sites) {
          throw new Error('format invalide');
        }
        // Fusion profonde avec la structure par défaut (robustesse / compat versions)
        Etat.data = Etat.fusionner(Etat.defaut(), obj);
        Etat.sauver();
        // On signale la réussite après le rechargement (repart sur une UI propre)
        try { localStorage.setItem(this.cleFlash, '📂 Saisie reprise avec succès.'); } catch (e) {}
        location.reload();
      } catch (e) {
        Toast.afficher("❌ Fichier invalide : ce n'est pas une sauvegarde de l'évaluateur.", 'erreur', 5000);
      }
    };
    lecteur.onerror = () => Toast.afficher('❌ Lecture du fichier impossible.', 'erreur');
    lecteur.readAsText(fichier);
  },
};

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
    // Rafraîchit les indicateurs « live » dépendant d'étapes précédentes
    const nom = ETAPES[Etat.data.etapeCourante];
    if (nom === 'Comptabilité') this.majTendance();
    if (nom === 'Retraitements') this.majRetraitements();
    if (nom === 'Survaleur') this.majSurvaleur();
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
        <input type="number" inputmode="numeric" min="0" step="500" value="${s.loyer || ''}" placeholder="0"
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
            <input type="number" inputmode="numeric" step="1000" value="${vals[i] || ''}" placeholder="0"
                   data-fin="${l.cle}" data-an="${i}" class="champ w-full text-right">
          </td>`).join('')}`;
      corps.appendChild(tr);
    });

    corps.querySelectorAll('[data-fin]').forEach(el => {
      el.addEventListener('input', () => {
        Etat.data.finances[el.dataset.fin][Number(el.dataset.an)] = Number(el.value) || 0;
        Etat.sauver();
        this.majTendance();
      });
    });

    // Multiple EBE (slider)
    $('#multiple-ebe').value = Etat.data.finances.multiple;
    $('#multiple-ebe-val').textContent = Number(Etat.data.finances.multiple).toFixed(1);
    $('#multiple-ebe').addEventListener('input', e => {
      Etat.data.finances.multiple = Number(e.target.value);
      $('#multiple-ebe-val').textContent = Number(e.target.value).toFixed(1);
      Etat.sauver();
    });

    // Pondération des exercices (module Tendance)
    const cb = $('#ponderer-exercices');
    cb.checked = Etat.data.finances.ponderer;
    cb.addEventListener('change', () => {
      Etat.data.finances.ponderer = cb.checked;
      Etat.sauver();
      this.majTendance();
    });
    this.majTendance();
  },

  // Met à jour l'indicateur de tendance du CA (croissance / déclin)
  majTendance() {
    const el = $('#tendance-readout');
    if (!el) return;
    const t = Calculs.tendance();
    if (t.g === null) {
      el.innerHTML = '<span class="text-slate-400">Renseignez le CA des 3 exercices pour détecter la tendance.</span>';
      return;
    }
    const signe = t.g >= 0 ? '+' : '';
    const couleur = t.delta > 0 ? 'text-menthe-600' : (t.delta < 0 ? 'text-framboise-600' : 'text-slate-600');
    const effet = Etat.data.finances.ponderer && t.delta !== 0
      ? ` · multiple ${t.delta > 0 ? '+' : ''}${t.delta}` : '';
    el.innerHTML = `<span class="font-semibold ${couleur}">${t.label}</span>
      <span class="text-slate-500">(${signe}${(t.g * 100).toFixed(1)} %/an${effet})</span>`;
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
          <input type="number" inputmode="numeric" min="0" step="500" value="${m.prixNeuf || ''}" placeholder="0"
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

  /* ---- ÉTAPE 3 : retraitements de l'EBE ---------------------------------- */
  rendreRetraitements() {
    const r = Etat.data.retraitements;
    const champs = {
      'retr-rem-actuelle': 'remunerationActuelle',
      'retr-rem-marche':   'remunerationMarche',
      'retr-loyer-actuel': 'loyerActuelMurs',
      'retr-loyer-marche': 'loyerMarcheMurs',
      'retr-except':       'chargesExcept',
      'retr-cb':           'creditBail',
    };
    Object.entries(champs).forEach(([id, cle]) => {
      const el = $('#' + id);
      el.value = r[cle] || '';
      el.addEventListener('input', () => {
        r[cle] = Number(el.value) || 0;
        Etat.sauver();
        this.majRetraitements();
      });
    });

    const actif = $('#retr-actif');
    actif.checked = r.actif;
    actif.addEventListener('change', () => {
      r.actif = actif.checked;
      Etat.sauver();
      this.majRetraitements();
    });
    this.majRetraitements();
  },

  majRetraitements() {
    const r = Etat.data.retraitements;
    $('#bloc-retraitements').style.opacity = r.actif ? '1' : '.45';
    $('#bloc-retraitements').style.pointerEvents = r.actif ? 'auto' : 'none';
    const det = Calculs.retraitementDetail();
    $('#retr-ebe-total').textContent = euro(Calculs.ebeRetraiteMoyen(Etat.data.exclureKiosque));
    const signe = det.total >= 0 ? '+' : '';
    $('#retr-detail').textContent = r.actif
      ? `EBE comptable moyen ${euro(Calculs.moyenneExercices(Etat.data.finances.ebe))} ${signe} retraitements ${euro(det.total)}.`
      : 'Retraitements désactivés : l\'EBE comptable moyen est utilisé tel quel.';
  },

  /* ---- ÉTAPE 6 : survaleur incorporelle & risque ------------------------- */
  rendreSurvaleur() {
    const s = Etat.data.survaleur;
    const grille = $('#grille-survaleur');
    grille.innerHTML = '';
    CONFIG.facteursSurvaleur.forEach(fac => {
      const div = document.createElement('div');
      div.className = 'bg-slate-50 rounded-xl p-4';
      div.innerHTML = `
        <label class="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">${fac.label}
          <span class="infobulle text-slate-400 text-xs">ⓘ<span class="bulle">${fac.aide}</span></span>
        </label>
        <select data-surv="${fac.id}" class="champ w-full">
          ${fac.options.map(o =>
            `<option value="${o.val}" ${s[fac.id] === o.val ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>`;
      grille.appendChild(div);
    });
    grille.querySelectorAll('[data-surv]').forEach(el => {
      el.addEventListener('change', () => {
        s[el.dataset.surv] = el.value;
        Etat.sauver();
        this.majSurvaleur();
      });
    });

    const actif = $('#surv-actif');
    actif.checked = s.actif;
    actif.addEventListener('change', () => {
      s.actif = actif.checked;
      Etat.sauver();
      this.majSurvaleur();
    });
    this.majSurvaleur();
  },

  majSurvaleur() {
    const s = Etat.data.survaleur;
    const grille = $('#grille-survaleur');
    grille.style.opacity = s.actif ? '1' : '.45';
    grille.style.pointerEvents = s.actif ? 'auto' : 'none';
    const pct = Calculs.survaleurDetail().pct;
    const bandeau = $('#surv-bandeau');
    const positif = pct >= 0;
    bandeau.className = 'mt-6 rounded-xl p-4 flex items-center justify-between text-white '
      + (positif ? 'bg-menthe-600' : 'bg-framboise-600');
    $('#surv-pct').textContent = (positif ? '+' : '') + (pct * 100).toFixed(1) + ' %';
  },

  /* ---- ÉTAPE 7 : paramètres de cession (statiques) ----------------------- */
  bindCession() {
    const c = Etat.data.cession;
    const reRendre = () => { Etat.sauver(); this.majCessionUI(); this.rendreRapport(); };

    $('#cess-actif').checked = c.actif;
    $('#cess-actif').addEventListener('change', e => { c.actif = e.target.checked; reRendre(); });

    $('#cess-type').value = c.type;
    $('#cess-type').addEventListener('change', e => { c.type = e.target.value; reRendre(); });

    $('#cess-exo').value = c.regimeExo;
    $('#cess-exo').addEventListener('change', e => { c.regimeExo = e.target.value; reRendre(); });

    $('#cess-tresorerie').value = c.tresorerie || '';
    $('#cess-tresorerie').addEventListener('input', e => { c.tresorerie = Number(e.target.value) || 0; reRendre(); });

    $('#cess-dette').value = c.detteNette || '';
    $('#cess-dette').addEventListener('input', e => { c.detteNette = Number(e.target.value) || 0; reRendre(); });

    this.majCessionUI();
  },

  // Affiche/masque les champs trésorerie & dette selon le type de cession + l'activation
  majCessionUI() {
    const c = Etat.data.cession;
    const titres = c.type === 'titres';
    $('#cess-tresorerie-wrap').classList.toggle('hidden', !titres);
    $('#cess-dette-wrap').classList.toggle('hidden', !titres);
    $('#bloc-cession').style.opacity = c.actif ? '1' : '.45';
    $('#bloc-cession').style.pointerEvents = c.actif ? 'auto' : 'none';
  },

  /* ---- ÉTAPE 7 : rapport d'expert ---------------------------------------- */
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

    // Données des modules complémentaires
    const retr = Calculs.retraitementDetail();
    const surv = Calculs.survaleurDetail();
    const cess = Calculs.cession(exclu);
    const t = Calculs.tendance();

    // Détail « rentabilité » enrichi (EBE retraité + multiple effectif)
    const detailRenta = `EBE retraité moyen ${euro(Calculs.ebeRetraiteMoyen(exclu))} × ${Calculs.multipleEffectif(exclu).toFixed(2)}`
      + (retr.total !== 0 ? ` · dont retraitements ${retr.total >= 0 ? '+' : ''}${euro(retr.total)}` : '')
      + ` · Pondération ${Math.round(CONFIG.ponderation.rentabilite*100)} %`;

    // Ligne « survaleur » (affichée seulement si une prime/décote s'applique)
    const survSigne = surv.pct >= 0 ? '+' : '';
    const ligneSurvaleur = (Etat.data.survaleur.actif && surv.pct !== 0) ? `
      <div class="flex items-center justify-between text-sm mb-3 px-1">
        <span class="text-slate-500">Valeur brute des 3 méthodes : <strong>${euro(courant.medianeBrute)}</strong>
          <span class="${surv.pct >= 0 ? 'text-menthe-600' : 'text-framboise-600'} font-semibold">(${survSigne}${(surv.pct*100).toFixed(1)} % survaleur incorporelle)</span>
        </span>
        <span class="font-semibold text-marine-800">→ ${euro(courant.mediane)}</span>
      </div>` : '';

    // Bloc « Cession & net vendeur » (module 4)
    const blocCession = Etat.data.cession.actif ? `
      <h3 class="text-sm uppercase tracking-wide font-bold text-slate-400 mb-2 mt-6">4 · Cession & net vendeur</h3>
      <div class="bg-slate-50 rounded-xl p-4 mb-2 text-sm">
        <div class="flex justify-between py-1"><span class="text-slate-500">Valeur de référence (médiane)</span><span class="font-semibold">${euro(cess.reference)}</span></div>
        <div class="flex justify-between py-1"><span class="text-slate-500">− Provision de renouvellement (matériel en fin de vie)</span><span class="font-semibold text-framboise-600">− ${euro(cess.provision)}</span></div>
        <div class="flex justify-between py-1 border-t border-slate-200 mt-1 pt-2">
          <span class="font-semibold text-slate-700">= Valeur du fonds de commerce</span><span class="font-bold text-marine-800">${euro(cess.valeurFonds)}</span></div>
        ${cess.type === 'titres' ? `
          <div class="flex justify-between py-1 mt-1"><span class="text-slate-500">+ Trésorerie transmise</span><span class="font-semibold text-menthe-600">+ ${euro(Etat.data.cession.tresorerie)}</span></div>
          <div class="flex justify-between py-1"><span class="text-slate-500">− Dette nette restante</span><span class="font-semibold text-framboise-600">− ${euro(Etat.data.cession.detteNette)}</span></div>
          <div class="flex justify-between py-1 border-t border-slate-200 mt-1 pt-2"><span class="font-semibold text-slate-700">= Valeur des titres (parts)</span><span class="font-bold text-marine-800">${euro(cess.valeurTitres)}</span></div>` : ''}
      </div>
      <div class="grid sm:grid-cols-2 gap-2 mb-2">
        <div class="bg-marine-50 rounded-xl p-3 text-sm flex justify-between items-center">
          <span class="text-slate-600">Stock facturé en sus</span><span class="font-bold text-marine-700">${euro(cess.stock)}</span>
        </div>
        <div class="bg-marine-50 rounded-xl p-3 text-sm flex justify-between items-center">
          <span class="text-slate-600 flex items-center gap-1">Droits d'enregistrement
            <span class="infobulle text-slate-400 text-xs">ⓘ<span class="bulle">Barème sur cession de fonds : 0 % jusqu'à 23 k€, 3 % de 23 k€ à 200 k€, 5 % au-delà. Normalement à la charge de l'acquéreur.</span></span>
          </span><span class="font-bold text-marine-700">${euro(cess.droits)}</span>
        </div>
      </div>
      <p class="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        ⚖️ ${cess.type === 'titres' ? 'Cession des titres' : 'Vente du fonds de commerce'} · Plus-value : ${cess.exoTexte}
        <br><span class="text-slate-400">Estimations indicatives — la fiscalité personnelle (impôt sur la plus-value) dépend de votre situation ; rapprochez-vous de votre expert-comptable.</span>
      </p>` : '';

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
          'Multiple de l\'EBE retraité moyen (×3 à ×5), ajusté selon la vétusté du matériel et la tendance du CA.',
          courant.renta,
          detailRenta)}
        ${ligneMethode(
          'Valeur Patrimoniale',
          'Actif tangible : matériel (valeur vénale après vétusté) + stock + droit au bail capitalisé.',
          courant.patri,
          `Matériel ${euro(Calculs.valeurMateriel(exclu))} · Stock ${euro(Calculs.valeurStock())} · Droit au bail ${euro(Calculs.valeurDroitAuBail(exclu))} · Pondération ${Math.round(CONFIG.ponderation.patrimoniale*100)} %`)}
      </div>

      <!-- 2. Fourchette finale -->
      <h3 class="text-sm uppercase tracking-wide font-bold text-slate-400 mb-2">2 · Fourchette d'évaluation finale</h3>
      ${ligneSurvaleur}
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

      ${blocCession}

      <p class="text-xs text-slate-400 mt-4">
        CA moyen 3 ans : ${euro(caGlobal)} (dont Kiosque ${euro(caKiosque)}, soit ${(Calculs.partKiosque()*100).toFixed(1)} %)${t.g !== null ? ` · tendance ${t.label} (${t.g >= 0 ? '+' : ''}${(t.g*100).toFixed(1)} %/an)` : ''}.
        Méthode : pondération ${Math.round(CONFIG.ponderation.ca*100)}/${Math.round(CONFIG.ponderation.rentabilite*100)}/${Math.round(CONFIG.ponderation.patrimoniale*100)}
        (CA / Rentabilité / Patrimoniale)${Etat.data.survaleur.actif && surv.pct !== 0 ? `, survaleur ${survSigne}${(surv.pct*100).toFixed(1)} %` : ''}, fourchette ±${Math.round((1-CONFIG.fourchette.basse)*100)} %.
      </p>`;
  },

  /* ---- Indicateur « enregistré automatiquement » ------------------------- */
  majIndicateurSauvegarde() {
    const el = $('#autosave-indic');
    if (!el) return;
    const heure = new Date().toLocaleTimeString('fr-FR');
    el.textContent = `Enregistré automatiquement sur cet appareil à ${heure}.`;
  },

  /* ---- Initialisation globale de l'interface ----------------------------- */
  init() {
    // Style commun des champs (injecté pour rester DRY)
    const styleChamps = document.createElement('style');
    styleChamps.textContent =
      // font-size 16px : empêche le zoom automatique d'iOS au focus d'un champ.
      '.champ{border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .65rem;font-size:16px;background:#fff;outline:none}' +
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
      if (confirm('Effacer toutes les données saisies et repartir de zéro ?\n\nAstuce : utilisez d\'abord « Enregistrer » pour conserver une copie.')) {
        Etat.reset();
        location.reload();
      }
    });

    // Sauvegarde / reprise (export et import d'un fichier portable)
    $('#btn-save').addEventListener('click', () => Sauvegarde.exporter());
    $('#btn-load').addEventListener('click', () => $('#input-load').click());
    $('#input-load').addEventListener('change', (e) => {
      const fichier = e.target.files && e.target.files[0];
      if (fichier) Sauvegarde.importer(fichier);
      e.target.value = ''; // autorise la réimportation du même fichier ensuite
    });

    // Indicateur d'enregistrement automatique (mis à jour à chaque sauvegarde)
    Etat.onSauver = () => this.majIndicateurSauvegarde();

    // Rendu initial de toutes les sections
    this.rendreSites();
    this.rendreFinances();
    this.rendreRetraitements();
    this.rendreMateriel();
    this.rendreStock();
    this.rendreSurvaleur();
    this.bindCession();
    this.allerEtape(Etat.data.etapeCourante);
  },
};

/* =============================================================================
 *  5. DÉMARRAGE
 * ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  Etat.charger();
  UI.init();
  // Message de confirmation éventuel après une reprise (rechargement post-import)
  try {
    const flash = localStorage.getItem(Sauvegarde.cleFlash);
    if (flash) {
      localStorage.removeItem(Sauvegarde.cleFlash);
      Toast.afficher(flash, 'succes', 4000);
    }
  } catch (e) { /* localStorage indisponible : sans effet */ }
});
