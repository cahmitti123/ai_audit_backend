/**
 * Construction des Prompts
 * =========================
 * Génération des prompts optimisés pour GPT-5
 */

import type { ProductVerificationContext } from "./audits.vector-store.js";
import { formatVerificationContextForPrompt } from "./audits.vector-store.js";

export function buildAnalysisRules(): string {
  return `═══════════════════════════════════════════════════════════════════════════════
RÈGLES D'ANALYSE
═══════════════════════════════════════════════════════════════════════════════

TOLÉRANCE PHONÉTIQUE:
- Oréa/Auréa → ORIAS
- NCA/AC Assurances/NC Assurances → Net Courtage Assurance
- CME/CMU-C → CMU/CSS
- OPAM → OPTAM
- dépassements d'un horaire → dépassements d'honoraires

STRUCTURE STRICTE:
- Citations DANS chaque point_controle.citations (pas au niveau global)
- Si statut=PRESENT: AU MOINS 1 citation requise
- Si statut=ABSENT/NON_APPLICABLE: citations=[]
- TOUS les champs obligatoires même si vides

MÉTADONNÉES EXACTES:
- recording_index: depuis "Enregistrement #X" (index = X-1)
- chunk_index: depuis "Chunk Y" (index = Y-1)
- minutage_secondes: depuis "Temps: XX.XXs"
- minutage: convertir en MM:SS
- speaker: depuis "speaker_X:"
- recording_date: depuis "Date:" dans l'en-tête (format DD/MM/YYYY)
- recording_time: depuis "Heure:" dans l'en-tête (format HH:MM)

VALEURS ENUM VALIDES:
- conforme: "CONFORME" | "NON_CONFORME" | "PARTIEL"
- niveau_conformite: "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET"
- statut: "PRESENT" | "ABSENT" | "PARTIEL" | "NON_APPLICABLE"

⚠️ CHAMPS REQUIS (fournir même si vides):
{{
  "minutages": [],
  "mots_cles_trouves": [],
  "erreurs_transcription_tolerees": 0,
  "erreur_transcription_notee": false,
  "variation_phonetique_utilisee": null
}}`;
}

export function buildTimelineText(timeline: any[]): string {
  let text =
    "═══════════════════════════════════════════════════════════════════════════════\n";
  text += "CHRONOLOGIE COMPLÈTE DE LA CONVERSATION\n";
  text +=
    "═══════════════════════════════════════════════════════════════════════════════\n\n";

  for (const recording of timeline) {
    text += `\n${"=".repeat(80)}\n`;
    text += `Enregistrement #${recording.recording_index + 1}\n`;
    text += `Date: ${recording.recording_date || "N/A"}\n`;
    text += `Heure: ${recording.recording_time || "N/A"}\n`;
    text += `Call ID: ${recording.call_id}\n`;
    text += `De: ${recording.from_number || "N/A"} → Vers: ${
      recording.to_number || "N/A"
    }\n`;
    text += `Durée: ${recording.duration_seconds}s\n`;
    text += `Total Chunks: ${recording.total_chunks}\n`;
    text += `${"=".repeat(80)}\n\n`;

    for (const chunk of recording.chunks) {
      text += `\n─── Chunk ${chunk.chunk_index + 1} ───\n`;
      text += `Temps: ${chunk.start_timestamp}s - ${chunk.end_timestamp}s\n`;
      text += `Speakers: ${chunk.speakers.join(", ")}\n\n`;
      text += `Conversation:\n${chunk.full_text}\n`;
    }
  }

  text += `\n${"=".repeat(80)}\n`;
  text += "FIN DE LA CHRONOLOGIE\n";
  text += `${"=".repeat(80)}\n\n`;

  return text;
}

/**
 * Build Mail Devis context section for product verification
 */
/**
 * Build comprehensive product context from database for AI verification
 * Includes ALL product information: guarantees, legal mentions, coverage details
 */
export function buildProductContext(productInfo: any): string {
  if (!productInfo || !productInfo.matched || !productInfo.formule) {
    return "";
  }

  const formule = productInfo.formule;
  const gamme = formule.gamme;
  const groupe = gamme.groupe;

  let context = `
═══════════════════════════════════════════════════════════════════════════════
📋 INFORMATIONS PRODUIT OFFICIELLES COMPLÈTES
═══════════════════════════════════════════════════════════════════════════════

⚠️ ATTENTION: Vous DEVEZ utiliser TOUTES ces informations pour vérifier que le
conseiller a correctement présenté l'offre et vérifié qu'elle répond aux besoins
et exigences du client.

IDENTIFICATION PRODUIT:
─────────────────────────────────────────────────────────────────────────────
  Assureur:           ${groupe.libelle}
  Code assureur:      ${groupe.code}
  Gamme:              ${gamme.libelle}
  Code gamme:         ${gamme.code}
  Formule:            ${formule.libelle}${
    formule.libelleAlternatif
      ? ` (aussi appelée: ${formule.libelleAlternatif})`
      : ""
  }
  Code formule:       ${formule.code}
  URL garanties:      ${formule.garantiesHtml}

`;

  // Add ALL coverage details (showing both covered and non-covered explicitly)
  context += `RÉSUMÉ DES COUVERTURES ET CONDITIONS:
─────────────────────────────────────────────────────────────────────────────
`;

  const coverageFields = {
    "🏥 Hospitalisation": formule.hospitalisation,
    "🏥 Hospitalisation Non-OPTAM": formule.hospiNonOptam,
    "🦷 Dentaire": formule.dentaire,
    "👓 Optique": formule.optique,
    "👓 Optique Verres Complexes": formule.optiqueVc,
    "💊 Médicaments/Pharmacie": formule.medecines,
    "👨‍⚕️ Soins Non-OPTAM": formule.soinsNonOptam,
    "🛏️ Chambre particulière": formule.chambreParticuliere,
    "🌿 Médecine douce": formule.medecineDouce,
    "👂 Appareils auditifs": formule.appareilsAuditifs,
    "👶 Maternité": formule.maternite,
    "♨️ Cure thermale": formule.cureThermale,
    "📄 Frais de dossier": formule.fraisDossier,
    "⏳ Délai d'attente": formule.delaiAttente,
  };

  Object.entries(coverageFields).forEach(([key, value]) => {
    const displayValue =
      value && value !== "" ? value : "❌ NON COUVERT / NON SPÉCIFIÉ";
    context += `  ${key.padEnd(35)}: ${displayValue}\n`;
  });

  // Add gamme-level documents if available
  if (gamme.documents && Object.keys(gamme.documents).length > 0) {
    context += `\nDOCUMENTS OFFICIELS (Gamme ${gamme.libelle}):
─────────────────────────────────────────────────────────────────────────────
`;
    Object.entries(gamme.documents).forEach(([docType, url]) => {
      if (url) {
        const docLabels: Record<string, string> = {
          cg: "Conditions Générales",
          garanties: "Tableau des Garanties",
          garanties_html: "Garanties HTML",
          dipa: "Document d'Information Produit",
          logo: "Logo",
        };
        const docTypeLabel = docLabels[docType] || docType.toUpperCase();
        context += `  ${docTypeLabel}: ${url}\n`;
      }
    });
  }

  // Add formule-specific documents if available
  if (formule.documents && formule.documents.length > 0) {
    context += `\nDOCUMENTS OFFICIELS SPÉCIFIQUES (Formule ${formule.libelle}):
─────────────────────────────────────────────────────────────────────────────
`;
    formule.documents.forEach((doc: any) => {
      const docLabels: Record<string, string> = {
        cg: "Conditions Générales",
        garanties: "Tableau des Garanties",
        garanties_html: "Garanties HTML",
        dipa: "Document d'Information Produit",
        logo: "Logo",
      };
      const docTypeLabel =
        docLabels[doc.documentType] || doc.documentType.toUpperCase();
      context += `  ${docTypeLabel}: ${doc.url}\n`;
    });
  }

  // Add detailed garanties tables with ALL information
  if (formule.garantiesParsed && formule.garantiesParsed.length > 0) {
    context += `\n═══════════════════════════════════════════════════════════════════════════════
TABLEAUX DE GARANTIES DÉTAILLÉS COMPLETS
═══════════════════════════════════════════════════════════════════════════════
Total: ${formule._counts.categories} catégories | ${formule._counts.items} items de garantie

⚠️ LISEZ ATTENTIVEMENT: Ces tableaux contiennent TOUTES les garanties, plafonds,
conditions et exclusions du produit. Vérifiez que le conseiller a communiqué
les informations correctes et complètes au client.

`;

    formule.garantiesParsed.forEach((garantie: any, gIndex: number) => {
      // Add intro text if available (important context)
      if (
        garantie.introText &&
        garantie.introText.length > 0 &&
        garantie.introText.some((t: string) => t.trim())
      ) {
        context += `\n┌─────────────────────────────────────────────────────────────────────────┐\n`;
        context += `│ 📝 INFORMATIONS IMPORTANTES / CONDITIONS GÉNÉRALES                       │\n`;
        context += `└─────────────────────────────────────────────────────────────────────────┘\n`;
        garantie.introText.forEach((text: string) => {
          if (text.trim()) {
            context += `${text}\n`;
          }
        });
        context += `\n`;
      }

      if (garantie.title) {
        context += `\n┌═════════════════════════════════════════════════════════════════════════┐\n`;
        context += `│ ${garantie.title.toUpperCase().padEnd(71)} │\n`;
        context += `└═════════════════════════════════════════════════════════════════════════┘\n`;
      }

      if (garantie.formuleIndicator) {
        context += `📌 Formule concernée: ${garantie.formuleIndicator}\n\n`;
      }

      // Add all categories with their complete items
      if (garantie.categories && garantie.categories.length > 0) {
        garantie.categories.forEach((category: any, cIndex: number) => {
          context += `\n▼ CATÉGORIE ${cIndex + 1}/${
            garantie.categories.length
          }: ${category.categoryName}\n`;
          context += `${"─".repeat(80)}\n`;

          if (category.items && category.items.length > 0) {
            category.items.forEach((item: any, iIndex: number) => {
              const name = item.guaranteeName || "";
              const value = item.guaranteeValue || "";

              // Handle different types of items
              if (value === "" || value === "-" || value.trim() === "") {
                // Section header or not covered
                if (
                  name &&
                  (name.includes("CONVENTIONNÉ") ||
                    name.includes("NON CONVENTIONNÉ"))
                ) {
                  // This is a section header
                  context += `\n  ━━━ ${name} ━━━\n`;
                } else if (name) {
                  // Not covered or no value
                  context += `  ${
                    iIndex + 1
                  }. ${name}: ❌ NON COUVERT / NON APPLICABLE\n`;
                }
              } else {
                // Actual coverage value - this is important!
                context += `  ${iIndex + 1}. ${name}\n`;
                context += `       ➜ REMBOURSEMENT: ${value}\n`;
              }
            });
          } else {
            context += `  (Aucun item dans cette catégorie)\n`;
          }
        });
      }

      // CRITICAL: Add legal mentions and notes (mentions légales)
      if (garantie.notesAndLegal && garantie.notesAndLegal.trim()) {
        context += `\n┌═════════════════════════════════════════════════════════════════════════┐\n`;
        context += `│ ⚖️ MENTIONS LÉGALES ET NOTES IMPORTANTES - À VÉRIFIER OBLIGATOIREMENT    │\n`;
        context += `└═════════════════════════════════════════════════════════════════════════┘\n`;
        context += `\n${garantie.notesAndLegal}\n\n`;
        context += `⚠️ Ces mentions légales DOIVENT être communiquées ou expliquées au client!\n`;
      }
    });
  }

  // Add raw fiche product data for context
  if (productInfo.ficheProductData) {
    const ficheProduct = productInfo.ficheProductData;
    context += `\nINFORMATIONS FICHE (Ce qui a été vendu au client):
─────────────────────────────────────────────────────────────────────────────
  Formule vendue:     ${ficheProduct.formule || "Non spécifié"}
  Cotisation:         ${ficheProduct.cotisation || "Non spécifié"}€/mois
  Date d'effet:       ${ficheProduct.date_effet || "Non spécifié"}
  Type client:        ${ficheProduct.type_client || "Non spécifié"}
  Type contrat:       ${ficheProduct.type_contrat || "Non spécifié"}

`;
  }

  // Add client needs/requirements if available
  if (productInfo.clientNeeds) {
    context += `BESOINS ET EXIGENCES DU CLIENT (À VÉRIFIER):
─────────────────────────────────────────────────────────────────────────────
`;
    Object.entries(productInfo.clientNeeds).forEach(([question, answer]) => {
      context += `  Q: ${question}\n`;
      context += `  R: ${answer}\n\n`;
    });
  }

  // Summary and AI instructions
  context += `\n═══════════════════════════════════════════════════════════════════════════════
📊 RÉSUMÉ PRODUIT:
═══════════════════════════════════════════════════════════════════════════════
  ✓ Garanties parsées:      ${formule._counts.garanties}
  ✓ Catégories détaillées:  ${formule._counts.categories}
  ✓ Items de garantie:      ${formule._counts.items}
  ✓ Documents disponibles:  ${formule._counts.documents}

═══════════════════════════════════════════════════════════════════════════════
⚠️ INSTRUCTIONS CRITIQUES POUR LA VÉRIFICATION PRODUIT:
═══════════════════════════════════════════════════════════════════════════════

Vous disposez ci-dessus de TOUTES les informations officielles et complètes sur
le produit ${groupe.libelle} ${gamme.libelle} ${formule.libelle}, ainsi que
des besoins exprimés par le client.

VOUS DEVEZ VÉRIFIER OBLIGATOIREMENT:

1. ✅ PRÉSENTATION COMPLÈTE DE L'OFFRE
   - Le conseiller a-t-il expliqué les PRINCIPALES garanties du produit?
   - Les valeurs/plafonds annoncés sont-ils EXACTS par rapport aux tableaux ci-dessus?
   - A-t-il mentionné les garanties importantes pour les besoins du client?
   - A-t-il expliqué les limitations et plafonds?

2. ✅ ADÉQUATION BESOINS CLIENT
   - Le produit choisi répond-il RÉELLEMENT aux BESOINS exprimés par le client?
   - Le conseiller a-t-il VÉRIFIÉ que les garanties correspondent aux EXIGENCES?
   - Y a-t-il des besoins client NON COUVERTS qui auraient dû être signalés?
   - Le niveau de couverture correspond-il au budget et attentes du client?

3. ✅ MENTIONS LÉGALES ET EXCLUSIONS (CRITIQUE)
   - Les mentions légales importantes ont-elles été communiquées?
   - Les exclusions majeures ont-elles été expliquées clairement?
   - Les délais d'attente ont-ils été mentionnés?
   - Les conditions particulières ont-elles été précisées?

4. ✅ EXACTITUDE ABSOLUE DES INFORMATIONS
   - TOUS les montants/pourcentages annoncés correspondent-ils EXACTEMENT aux tableaux?
   - Le conseiller n'a-t-il pas exagéré ou promis des couvertures inexistantes?
   - Les conditions et restrictions sont-elles correctement expliquées?
   - Les valeurs "NON COUVERT" sont-elles mentionnées si pertinent pour le client?

5. ✅ TRANSPARENCE ET HONNÊTETÉ
   - Le conseiller a-t-il été transparent sur ce qui n'est PAS couvert?
   - A-t-il expliqué les différences avec le contrat actuel du client si applicable?
   - A-t-il mentionné les points faibles du produit?

RÈGLES DE NOTATION STRICTES:
  ❌ NON_CONFORME: Information inexacte, incomplète, manquante OU produit inadapté
  ⚠️ PARTIEL: Information correcte mais incomplète ou manque de vérification besoins
  ✅ CONFORME: Information complète, exacte, transparente ET produit adapté aux besoins

En cas de problème, CITEZ PRÉCISÉMENT:
  - La catégorie de garantie concernée (ex: "HOSPITALISATION")
  - L'item spécifique du tableau (ex: "Chambre particulière")
  - La valeur RÉELLE dans le tableau vs ce qui a été dit
  - Le besoin client non satisfait ou mal adressé
  - L'impact concret sur le client

⚠️ RAPPEL: Un produit peut être techniquement conforme mais inadapté aux besoins!
═══════════════════════════════════════════════════════════════════════════════
\n`;

  return context;
}

export function buildMailDevisContext(mailDevis: any): string {
  if (!mailDevis || !mailDevis.garanties_details) {
    return "";
  }

  const details = mailDevis.garanties_details;

  let context = `
═══════════════════════════════════════════════════════════════════════════════
📋 INFORMATIONS PRODUIT OFFICIELLES (Mail Devis Personnalisé)
═══════════════════════════════════════════════════════════════════════════════

PRODUIT SOUSCRIT:
─────────────────────────────────────────────────────────────────────────────
  Gamme:         ${details.gamme}
  Produit:       ${details.product_name}
  Formule:       ${details.formule}
  Prix:          ${details.price}€ par mois
  Tranche d'âge: ${details.age_range}

SOUSCRIPTEUR:
─────────────────────────────────────────────────────────────────────────────
  ${details.subscriber_info.civilite} ${details.subscriber_info.prenom} ${details.subscriber_info.nom}

`;

  // Add garanties information
  if (details.garanties && Object.keys(details.garanties).length > 0) {
    context += `GARANTIES ET REMBOURSEMENTS:
─────────────────────────────────────────────────────────────────────────────
`;

    Object.entries(details.garanties).forEach(
      ([key, category]: [string, any]) => {
        context += `\n📌 ${category.category_name}\n`;

        // Direct items
        if (category.items && category.items.length > 0) {
          category.items.forEach((item: any) => {
            context += `   • ${item.name}: ${item.value}`;
            if (item.note_ref) context += ` (${item.note_ref})`;
            context += `\n`;
          });
        }

        // Subcategories
        if (category.subcategories) {
          Object.entries(category.subcategories).forEach(
            ([subKey, subcategory]: [string, any]) => {
              context += `\n   ─ ${subcategory.name}\n`;
              subcategory.items.forEach((item: any) => {
                context += `     • ${item.name}: ${item.value}`;
                if (item.note_ref) context += ` (${item.note_ref})`;
                context += `\n`;
              });
            }
          );
        }
      }
    );
  }

  // Add notes (conditions, exclusions)
  if (details.notes && details.notes.length > 0) {
    context += `\nNOTES IMPORTANTES (Conditions & Exclusions):
─────────────────────────────────────────────────────────────────────────────
`;
    details.notes.forEach((note: any) => {
      context += `(${note.number}) ${note.text}\n\n`;
    });
  }

  context += `═══════════════════════════════════════════════════════════════════════════════

`;

  return context;
}

export function buildStepPrompt(
  step: any,
  auditConfig: any,
  timelineText: string,
  productVerificationContext?: ProductVerificationContext[] | null,
  productInfo?: any
): string {
  const totalSteps = auditConfig.auditSteps?.length || step.position;

  // Add Product Database context (if available and verification enabled)
  let productSection = "";
  if (
    step.verifyProductInfo === true &&
    productInfo &&
    productInfo.matched &&
    productInfo.formule
  ) {
    productSection = buildProductContext(productInfo);
  }

  // Add product verification context from vector store if available
  let verificationSection = "";
  if (
    productVerificationContext &&
    productVerificationContext.length > 0 &&
    step.verifyProductInfo === true
  ) {
    verificationSection = formatVerificationContextForPrompt(
      productVerificationContext
    );

    // Add special verification instructions
    const productName =
      productInfo && productInfo.matched && productInfo.formule
        ? `${productInfo.formule.gamme.groupe.libelle} ${productInfo.formule.gamme.libelle} ${productInfo.formule.libelle}`
        : "voir ci-dessus";

    verificationSection += `
⚠️ VÉRIFICATION PRODUIT OBLIGATOIRE:
─────────────────────────────────────────────────────────────────────────────
Pour cette étape, vous DEVEZ vérifier que toutes les affirmations du conseiller
concernant les garanties, conditions, exclusions, plafonds et remboursements sont
STRICTEMENT CONFORMES à la documentation produit fournie ci-dessus.

Règles de vérification:
1. Pour chaque point de contrôle, comparez les déclarations du conseiller avec:
   a) Les informations produit détaillées (garanties, catégories, items ci-dessus)
   b) La documentation produit générale (tableaux de garanties, conditions générales)
2. Si une affirmation est inexacte ou incomplète, marquez le point comme NON_CONFORME
3. Citez la documentation produit dans vos commentaires lorsque
   vous identifiez des divergences
4. Les garanties annoncées doivent correspondre exactement aux plafonds/conditions
   du produit souscrit (${productName})
5. Toute omission d'exclusion importante doit être signalée

En cas de divergence entre ce que dit le conseiller et la documentation:
- Marquez le checkpoint comme NON_CONFORME ou PARTIEL
- Expliquez clairement la différence dans le commentaire
- Référencez la source exacte (catégorie et item de garantie spécifique)
─────────────────────────────────────────────────────────────────────────────

`;
  } else if (
    step.verifyProductInfo === true &&
    productInfo &&
    productInfo.matched
  ) {
    // Only Product DB available (no vector store context)
    const formule = productInfo.formule;
    verificationSection = `
⚠️ VÉRIFICATION PRODUIT ACTIVÉE:
─────────────────────────────────────────────────────────────────────────────
Vérifiez que le conseiller communique des informations exactes sur le produit
souscrit en vous référant aux informations produit ci-dessus.

Points à vérifier:
- Groupe, Gamme et Formule: ${formule.gamme.groupe.libelle} ${formule.gamme.libelle} ${formule.libelle}
- Garanties principales correspondent aux tableaux de garanties ci-dessus
- Conditions et exclusions mentionnées dans la documentation
- Plafonds et remboursements correspondent aux valeurs spécifiées

En cas d'inexactitude, marquez le point comme NON_CONFORME avec explication.
─────────────────────────────────────────────────────────────────────────────

`;
  }

  return `${auditConfig.systemPrompt}

${timelineText}
${productSection}
${verificationSection}
═══════════════════════════════════════════════════════════════════════════════
ÉTAPE ${step.position}/${totalSteps}: ${step.name}
═══════════════════════════════════════════════════════════════════════════════

Sévérité: ${step.severityLevel} | Poids: ${step.weight}
Critique: ${step.isCritical ? "⚠️ OUI" : "Non"}
${step.verifyProductInfo ? "🔍 VÉRIFICATION PRODUIT: ⚠️ ACTIVÉE" : ""}

DESCRIPTION:
${step.description}

INSTRUCTIONS:
${step.prompt}

POINTS DE CONTRÔLE À ANALYSER:
${step.controlPoints
  .map((cp: string, i: number) => `${i + 1}. ${cp}`)
  .join("\n")}

MOTS-CLÉS: ${step.keywords.join(", ")}

${buildAnalysisRules()}

Analysez maintenant cette étape.`;
}
