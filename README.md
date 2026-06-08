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
| 2 — Comptabilité (3 ans) | CA global/Kiosque, EBE, masse salariale, charges | Multiple de l'EBE retraité (×3 à ×5) |
| 3 — Matériel & Vétusté | Inventaire avec catalogue glacier pré-rempli | Valeur vénale = valeur à neuf × coef. vétusté |
| 4 — Stock | Matières premières + produits finis | Valorisation brute au prix d'achat |
| 5 — Rapport d'expert | Synthèse | Fourchette pondérée Basse / Médiane / Haute |

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

## 📁 Structure

```
index.html   Interface (HTML + Tailwind CDN)
app.js       Moteur de calcul et UI (JavaScript modulaire, commenté en français)
README.md    Ce fichier
```
