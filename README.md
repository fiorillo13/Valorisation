# 🍦 Évaluateur de Fonds de Commerce — Glacier Artisanal

Application web **100 % locale** (aucun serveur, aucune base de données) pour
estimer la valeur d'une entreprise de glaces artisanales multi-sites :
**Laboratoire · Boutique du Port · Réserve · Kiosque (AOT)**.

L'interface est un **formulaire guidé en 5 étapes**, pensé pour un débutant,
mais le moteur de calcul applique des méthodes d'évaluation de niveau expert.

## ▶️ Utilisation

Ouvrez simplement **`index.html`** dans un navigateur (double-clic).
Aucune installation : Tailwind CSS est chargé via CDN. Les données saisies sont
mémorisées localement (localStorage) entre deux sessions.

## 🧩 Les 5 étapes

| Étape | Objet | Méthode de calcul |
|------|-------|-------------------|
| 1 — Juridique & Emplacements | Bail, loyer, note d'emplacement par site | Barème % du CA + droit au bail capitalisé |
| 2 — Comptabilité (3 ans) | CA global/Kiosque, EBE, charges + pondération/tendance | Multiple de l'EBE, ajusté vétusté **et tendance du CA** |
| 3 — Retraitements de l'EBE | Rémunération dirigeant, loyer de marché (SCI), charges except., crédit-bail | EBE **retraité** = capacité bénéficiaire réelle |
| 4 — Matériel & Vétusté | Inventaire avec catalogue glacier pré-rempli | Valeur vénale = valeur à neuf × coef. vétusté |
| 5 — Stock | Matières premières + produits finis | Valorisation brute au prix d'achat |
| 6 — Survaleur & risque | Notoriété, label artisan, B2B récurrent, saisonnalité, homme-clé, perspectives | Prime / décote incorporelle (borne −25 % / +35 %) |
| 7 — Cession & Rapport | Type de cession, trésorerie, dette, exonération | Net vendeur + synthèse Basse / Médiane / Haute |

### Modules de revalorisation (niveau cession)

- **Retraitements de l'EBE** — le levier n°1 : on corrige la comptabilité
  (rémunération du dirigeant vs marché, loyer de marché si murs en SCI, charges
  exceptionnelles, crédit-bail) pour révéler la vraie capacité bénéficiaire.
- **Tendance du CA** — pondération du dernier exercice et bonus/malus de
  multiple selon la croissance ou le déclin.
- **Survaleur incorporelle** — questionnaire (réputation, label artisan,
  revenus B2B récurrents, saisonnalité, dépendance homme-clé, perspectives)
  produisant une prime/décote argumentée sur la valeur finale.
- **Cession & net vendeur** — passage valeur d'entreprise → valeur des titres
  (+ trésorerie − dette nette), provision de renouvellement du matériel en fin
  de vie, droits d'enregistrement, **estimation de la plus-value et du net
  vendeur** (valeur d'origine, taux d'imposition, régimes d'exonération :
  238 quindecies, départ retraite, seuil de recettes).
- **Pondération ajustable** — curseurs pour régler le poids des 3 méthodes
  (CA / Rentabilité / Patrimoniale) selon la fiabilité des données ; total
  normalisé automatiquement à 100 %.

## ⚠️ Option « Exclure le Kiosque »

Le Kiosque dépend d'une **AOT** (Autorisation d'Occupation Temporaire du domaine
public), précaire et révocable. Le switch en haut de page recalcule
instantanément la valeur en neutralisant le CA, l'EBE (au prorata), le matériel
et l'emplacement du Kiosque — pour mesurer le **risque juridique** (pire scénario).

## 📐 Les 3 méthodes d'évaluation

1. **Valeur par le Chiffre d'affaires** — barème professionnel : un pourcentage
   du CA moyen (50 % à 120 %) selon l'emplacement et le type de bail.
2. **Valeur par la Rentabilité** — multiple de l'EBE retraité moyen, ajusté
   selon la vétusté globale du parc matériel.
3. **Valeur Patrimoniale** — matériel (valeur vénale) + stock + droit au bail.

La **valeur médiane** est une moyenne pondérée (30 % / 40 % / 30 %), encadrée
d'une fourchette ±15 %.

## 🛠️ Personnalisation

Tous les barèmes (pourcentages CA, coefficients de vétusté, multiples,
pondérations, catalogue matériel) sont centralisés dans l'objet **`CONFIG`** en
haut de `app.js`, faciles à auditer et à ajuster.

## 🖨️ Export

Le bouton « Imprimer / Exporter en PDF » de l'étape 5 produit un rapport propre
(via l'impression du navigateur → *Enregistrer au format PDF*).

---

> ⚖️ Outil d'aide à la décision. Les résultats sont indicatifs et ne se
> substituent pas à l'avis d'un expert-comptable ou d'un commissaire à l'évaluation.

## 💾 Enregistrer et reprendre sa saisie

- **Enregistrement automatique** : la saisie est conservée en continu sur
  l'appareil (un indicateur l'affiche). En rouvrant l'app sur le même
  navigateur, tout est repris automatiquement.
- **💾 Enregistrer** : télécharge un fichier de sauvegarde `.json` daté
  (copie de sécurité, archivage, ou transfert vers un autre appareil).
- **📂 Reprendre** : recharge un fichier de sauvegarde pour continuer la saisie,
  y compris **sur un autre téléphone ou ordinateur**.

La reprise est robuste : un fichier partiel ou plus ancien est fusionné avec la
structure par défaut, sans perte ni plantage.

## 📱 Application mobile (PWA)

L'application est une **PWA installable** : une fois ouverte sur le téléphone,
on peut l'ajouter à l'écran d'accueil (iOS : *Partager → Sur l'écran d'accueil* ;
Android : *menu → Ajouter à l'écran d'accueil*) et l'utiliser **en plein écran,
comme une vraie appli, y compris hors ligne** (service worker `sw.js`).

Optimisations mobiles intégrées : claviers numériques (`inputmode`), champs à
16 px (pas de zoom intempestif sur iOS), cibles tactiles agrandies, gestion des
encoches (safe-area), icônes 🍦 et manifest (`manifest.webmanifest`).

## 📁 Structure

```
index.html             Interface (HTML + Tailwind CDN) + métadonnées PWA
app.js                 Moteur de calcul et UI (JS modulaire, commenté en français)
sw.js                  Service worker (mode hors ligne)
manifest.webmanifest   Manifeste PWA (installation mobile)
icon-*.png             Icônes de l'application 🍦
apple-touch-icon.png   Icône écran d'accueil iOS
favicon-32.png         Favicon
README.md              Ce fichier
```
