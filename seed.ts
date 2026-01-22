import { AuditSeverity } from "@prisma/client";

import { prisma } from "./src/shared/prisma.js";

async function main() {
  console.log("🌱 Starting database seed...");

  // ============================================================================
  // 1. COMPREHENSIVE AUDIT CONFIG (18 steps - Full detailed audit)
  // ============================================================================
  console.log("\n📋 Creating Comprehensive Audit Config...");
  const comprehensiveConfig = await prisma.auditConfig.create({
    data: {
      name: "Audit Complet - Complémentaire Santé NCA",
      description:
        "Audit qualité complet et exhaustif pour les appels de vente de complémentaire santé NCA. Couvre les 18 points de contrôle obligatoires (version 10/05/2025) pour assurer la conformité réglementaire maximale, éthique commerciale et protection client.",
      systemPrompt: `Vous êtes un expert en contrôle qualité pour les ventes de complémentaire santé. Votre rôle est d'analyser un enregistrement d'appel commercial et de vérifier la conformité avec les 18 points de contrôle obligatoires de NCA (Net Courtage Assurance).

Principes directeurs:
- Intérêt du client d'abord : conseil adapté au besoin, pas de survente, clarté des limites/exclusions
- Transparence légale : annonce de l'enregistrement, droit d'opposition, conservation 2 ans, ORIAS, identité NCA
- Traçabilité : tout engagement et consentement tracé
- Protection des données : collecte minimale, sécurité RIB, aucun identifiant/MDP

Pour chaque point, évaluez:
1. Si le point est traité (Traité/Non traité)
2. Le minutage exact où il apparaît
3. Si le traitement est conforme aux exigences
4. Commentaires détaillés

Cas de rejet automatique:
- IBAN demandé avant présentation ≥70% garanties
- Fausse présentation (mutuelle/organisme externe)
- Refus explicite client
- Contrat non responsable sans explication RAC0
- CSS/CMU/AME/MGO → vente interdite
- Identifiants/mots de passe demandés (Ameli, etc.)
- Répétition orale du RIB`,
      createdBy: "system",
      isActive: true,
    },
  });

  console.log(
    `✅ Created Comprehensive Audit Config: ${comprehensiveConfig.id}`
  );

  // ============================================================================
  // 2. ESSENTIAL AUDIT CONFIG (8 steps - Critical points only)
  // ============================================================================
  console.log("\n📋 Creating Essential Audit Config...");
  const essentialConfig = await prisma.auditConfig.create({
    data: {
      name: "Audit Essentiel - Complémentaire Santé NCA",
      description:
        "Audit rapide concentré sur les 8 points critiques et obligatoires de conformité légale et commerciale. Idéal pour un contrôle qualité quotidien ou une première vérification.",
      systemPrompt: `Vous êtes un expert en contrôle qualité pour les ventes de complémentaire santé. Ce contrôle se concentre sur les points ESSENTIELS et CRITIQUES uniquement.

Points critiques à vérifier:
1. Conformité légale de présentation (ORIAS, enregistrement, droits)
2. Vérification CSS/CMU/AME (BLOCAGE si oui)
3. Ancienneté contrat et type de résiliation
4. Motivation et besoins réels du client
5. Adéquation formule/besoins et type de contrat
6. Devoir de conseil sur garanties principales
7. Limites et exclusions communiquées
8. Observation qualitative globale

Pour chaque point:
- Traité ou non traité
- Conforme ou non conforme
- Minutage et commentaire
- Niveau de criticité respecté`,
      createdBy: "system",
      isActive: true,
    },
  });

  console.log(`✅ Created Essential Audit Config: ${essentialConfig.id}`);

  // ============================================================================
  // 3. QUICK AUDIT CONFIG (5 steps - Ultra-fast compliance check)
  // ============================================================================
  console.log("\n📋 Creating Quick Audit Config...");
  const quickConfig = await prisma.auditConfig.create({
    data: {
      name: "Audit Rapide - Complémentaire Santé NCA",
      description:
        "Audit ultra-rapide de conformité minimale. Vérifie uniquement les 5 points bloquants et légaux obligatoires. Utilisé pour validation rapide ou pré-audit.",
      systemPrompt: `Contrôle rapide de conformité minimale pour vente de complémentaire santé NCA.

POINTS BLOQUANTS UNIQUEMENT:
1. Présentation légale (ORIAS + enregistrement)
2. CSS/CMU/AME (blocage automatique)
3. Ancienneté contrat (résiliation possible?)
4. Type de contrat (responsable/non responsable)
5. Adéquation besoin/formule

Si UN SEUL point bloquant échoue → REJET automatique
Audit ultra-rapide : focus sur conformité légale uniquement.`,
      createdBy: "system",
      isActive: true,
    },
  });

  console.log(`✅ Created Quick Audit Config: ${quickConfig.id}`);

  // ============================================================================
  // 4. LOI DE DÉMARCHAGE AUDIT CONFIG (5 steps - Legal compliance focus)
  // ============================================================================
  console.log("\n📋 Creating Loi de Démarchage Audit Config...");
  const loiDemarchageConfig = await prisma.auditConfig.create({
    data: {
      name: "Audit Loi de Démarchage - NCA (Tolérance ASR / Phonétique)",
      description:
        "Audit dédié au contrôle strict de la Loi de Démarchage pour les appels de vente Complémentaire Santé NCA. Focalisé sur : présentation (identité + NCA + ORIAS), annonce d'enregistrement, droit de refus, conservation 2 ans, droit de copie, respect des oppositions et absence de fausse présentation. Intègre une tolérance explicite aux erreurs de transcription (ASR) et aux approximations phonétiques.",
      systemPrompt: `Vous êtes un expert qualité NCA chargé d'évaluer un appel selon la Loi de Démarchage pour la vente de complémentaire santé.

Votre mission : vérifier si le conseiller respecte les obligations légales suivantes :
- Présentation de son identité
- Mention de Net Courtage Assurance (NCA) en tant que courtier
- Annonce de l'immatriculation ORIAS
- Annonce claire de l'enregistrement de l'appel
- Information sur le droit de refus / opposition à l'enregistrement
- Mention de la conservation de l'enregistrement pendant 2 ans
- Mention du droit de demander une copie de l'enregistrement
- Absence de fausse présentation (mutuelle, Sécurité sociale, CPAM, organisme public, etc.)

IMPORTANT — TOLÉRANCE TRANSCRIPTION / PHONÉTIQUE :
Les transcriptions peuvent contenir des erreurs (mots mal reconnus, coupés, homophones, fautes d'orthographe). Vous devez baser votre analyse avant tout sur :
- le sens global,
- le contexte logique de l'échange,
- la proximité phonétique des termes attendus.

Exemples acceptables (si le sens est clair) :
- « net courach », « net courta » ≈ Net Courtage Assurance
- « oriasse », « o rias » ≈ ORIAS
- « enregisté », « enrégistré » ≈ enregistré
- « vou pouvé refuzé », « vous avé le drwa de vous oposé » ≈ droit de refuser l'enregistrement

Absence d'une mention dans la transcription seule ≠ NON CONFORME.
Absence réelle dans l'audio (au son) = NON CONFORME.

Pour chaque étape de l'audit :
1. Indiquez si le point est traité ou non.
2. Indiquez les minutages précis où il apparaît.
3. Évaluez la conformité par rapport aux exigences légales et aux standards NCA.
4. Fournissez un commentaire pédagogique (ce qui est bien, ce qui manque, ce qui est problématique).

CAS DE REJET AUTOMATIQUE (NON CONFORME LOI DE DÉMARCHAGE) :
- Aucune annonce d'enregistrement alors que l'appel est enregistré.
- Refus explicite d'enregistrement ignoré par le conseiller.
- Présentation du conseiller comme mutuelle, Sécurité sociale, CPAM, organisme public ou tout autre organisme trompeur.
- Aucune mention de NCA / Net Courtage Assurance et aucune mention de l'ORIAS.

En présence d'un seul de ces cas, l'appel doit être marqué comme NON CONFORME LOI DE DÉMARCHAGE, même si le reste du call est qualitatif.`,
      createdBy: "Qualiticien AGENT INTELLIGENCE ARTIFICIELLE - NCA",
      isActive: true,
    },
  });

  console.log(
    `✅ Created Loi de Démarchage Audit Config: ${loiDemarchageConfig.id}`
  );

  // ============================================================================
  // COMPREHENSIVE AUDIT STEPS (All 18 steps)
  // ============================================================================
  console.log("\n📝 Creating Comprehensive Audit Steps (18 steps)...");

  const comprehensiveSteps = [
    {
      name: "Présentation du Cabinet et de l'Agent / Réforme du Courtage",
      description:
        "Vérifier que le conseiller présente correctement son identité, NCA, le numéro ORIAS, et annonce les obligations légales de l'enregistrement",
      prompt: `Vérifier que le conseiller:
- Se présente avec son prénom/nom
- Mentionne "Net Courtage Assurance" ou "NCA"
- Donne le numéro ORIAS
- Annonce que l'appel est enregistré
- Mentionne le droit d'opposition du client
- Indique la conservation 2 ans de l'enregistrement
- Informe du droit de copie
- Arrête immédiatement si refus d'enregistrement`,
      controlPoints: [
        "Identité du conseiller (prénom + nom)",
        "Mention explicite de 'Net Courtage Assurance' ou 'NCA'",
        "Numéro ORIAS communiqué",
        "Annonce 'appel enregistré'",
        "Droit d'opposition mentionné",
        "Conservation 2 ans mentionnée",
        "Droit de copie mentionné",
        "Réaction appropriée en cas de refus",
      ],
      keywords: [
        "ORIAS",
        "Net Courtage",
        "NCA",
        "enregistré",
        "opposition",
        "2 ans",
        "conservation",
        "réforme courtage",
        "Bloctel",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 1,
      chronologicalImportant: true,
      weight: 10,
    },
    {
      name: "Vérification & Confirmation des informations",
      description:
        "Vérifier que le conseiller confirme l'exactitude des informations signalétiques, professionnelles et familiales du client",
      prompt: `Vérifier que le conseiller confirme:
- Nom et prénom du client
- Date de naissance
- Adresse postale complète
- Téléphone
- Email
- Situation professionnelle (régime)
- Composition familiale`,
      controlPoints: [
        "Nom et prénom confirmés",
        "Date de naissance vérifiée",
        "Adresse postale complète",
        "Numéro de téléphone validé",
        "Email confirmé",
        "Régime professionnel (salarié/indépendant/retraité/etc.)",
        "Composition du foyer (solo/couple/famille)",
      ],
      keywords: [
        "adresse",
        "email",
        "téléphone",
        "date de naissance",
        "régime",
        "salarié",
        "indépendant",
        "famille",
        "conjoint",
        "enfants",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 2,
      chronologicalImportant: true,
      weight: 7,
    },
    {
      name: "Résidence EHPAD & options dédiées",
      description:
        "Vérifier si le client réside en EHPAD et si des options dédiées sont proposées le cas échéant",
      prompt: `Vérifier:
- Si la question EHPAD est posée
- Si oui: orientation vers options adaptées
- Si non applicable: passage rapide au point suivant`,
      controlPoints: [
        "Question posée sur résidence EHPAD",
        "Traitement approprié de la réponse",
        "Options dédiées proposées si oui",
      ],
      keywords: ["EHPAD", "résidence", "établissement", "maison de retraite"],
      severityLevel: AuditSeverity.LOW,
      isCritical: false,
      position: 3,
      chronologicalImportant: false,
      weight: 2,
    },
    {
      name: "Ancienne couverture & délais",
      description:
        "Vérifier l'ancienneté du contrat actuel (≥/< 12 mois) pour déterminer les possibilités de résiliation",
      prompt: `Vérifier que le conseiller interroge sur:
- La compagnie actuelle
- Depuis combien de temps (> ou < 12 mois)
- Si le contrat a été renouvelé
- Les délais de résiliation
- La conformité avec la loi Chatel`,
      controlPoints: [
        "Compagnie actuelle identifiée",
        "Ancienneté du contrat (≥12 mois ou <12 mois)",
        "Statut du renouvellement",
        "Délais de résiliation vérifiés",
        "Conformité légale validée",
      ],
      keywords: [
        "mutuelle actuelle",
        "depuis quand",
        "12 mois",
        "ancienneté",
        "renouvellement",
        "contrat",
        "compagnie",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: true,
      position: 4,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Type de résiliation",
      description:
        "Identifier et valider le type de résiliation (Chatel, hausse de tarif, échéance) et les preuves nécessaires",
      prompt: `Vérifier:
- Le type de résiliation (Chatel/hausse/échéance/portabilité)
- Les délais de préavis respectés
- Les documents justificatifs évoqués
- Absence de rétractation d'un autre contrat en cours`,
      controlPoints: [
        "Type de résiliation identifié",
        "Préavis respecté",
        "Documents justificatifs mentionnés",
        "Pas de conflit avec rétractation en cours",
      ],
      keywords: [
        "résiliation",
        "Chatel",
        "hausse",
        "échéance",
        "préavis",
        "portabilité",
        "rétractation",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: true,
      position: 5,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Cotisation actuelle",
      description:
        "Relever le montant de la cotisation actuelle et son évolution récente",
      prompt: `Vérifier que le conseiller demande:
- Le montant actuel de la cotisation
- Si une hausse récente a été notifiée
- La fréquence de paiement (mensuel/trimestriel/annuel)`,
      controlPoints: [
        "Montant actuel relevé",
        "Évolution récente (hausse) identifiée",
        "Fréquence de paiement notée",
      ],
      keywords: [
        "cotisation",
        "montant",
        "prix",
        "tarif",
        "hausse",
        "augmentation",
        "par mois",
        "mensuel",
      ],
      severityLevel: AuditSeverity.MEDIUM,
      isCritical: false,
      position: 6,
      chronologicalImportant: false,
      weight: 5,
    },
    {
      name: "Dispositifs spécifiques (CSS/CMU/MGO/Portabilité)",
      description:
        "Vérifier impérativement si le client bénéficie de CSS, CMU, MGO ou portabilité - VENTE INTERDITE si CSS/CMU",
      prompt: `CRITIQUE: Vérifier la question sur:
- CSS (Complémentaire Santé Solidaire)
- CMU (Couverture Maladie Universelle)
- MGO (Maintien Gratuit Obligatoire)
- Portabilité

⚠️ REJET AUTOMATIQUE si CSS/CMU/AME → vente illégale`,
      controlPoints: [
        "Question CSS/CMU posée",
        "Question MGO posée",
        "Question portabilité posée",
        "Arrêt de la vente si CSS/CMU détecté",
      ],
      keywords: [
        "CSS",
        "CMU",
        "MGO",
        "portabilité",
        "AME",
        "complémentaire santé solidaire",
        "aide sociale",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 7,
      chronologicalImportant: false,
      weight: 10,
    },
    {
      name: "Motivation & besoins détaillés",
      description:
        "Comprendre la motivation du client et identifier ses urgences médicales (optique, dentaire, hospitalisation, dépassements, médecine douce, auditif)",
      prompt: `Vérifier que le conseiller identifie:
- La motivation principale (économies/garanties/les deux)
- Le budget maximal acceptable
- Les urgences de soins:
  * Optique (verres, monture, fréquence)
  * Dentaire (prothèses, implants, devis en cours)
  * Hospitalisation (chambre particulière prévue)
  * Dépassements d'honoraires (OPTAM/hors OPTAM)
  * Médecine douce (ostéo, pédicure, etc.)
  * Auditif (appareil prévu)
  * Autres spécificités`,
      controlPoints: [
        "Motivation principale identifiée",
        "Budget maximum établi",
        "Urgences optique explorées",
        "Besoins dentaire évalués",
        "Hospitalisation discutée",
        "Dépassements d'honoraires évoqués",
        "Médecine douce questionnée",
        "Auditif abordé si pertinent",
      ],
      keywords: [
        "budget",
        "optique",
        "lunettes",
        "dentaire",
        "prothèse",
        "implant",
        "hospitalisation",
        "chambre",
        "dépassement",
        "OPTAM",
        "ostéopathe",
        "médecine douce",
        "auditif",
        "appareil auditif",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 8,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Date d'effet validée",
      description:
        "Valider que la date d'effet souhaitée est cohérente avec la résiliation du contrat sortant",
      prompt: `Vérifier:
- La date d'effet proposée
- La cohérence avec l'échéance/résiliation du contrat actuel
- Respect des délais de préavis
- Absence de chevauchement ou trou de couverture`,
      controlPoints: [
        "Date d'effet mentionnée",
        "Cohérence avec résiliation vérifiée",
        "Délais de préavis respectés",
        "Continuité de couverture assurée",
      ],
      keywords: [
        "date d'effet",
        "mise en place",
        "début",
        "échéance",
        "continuité",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 9,
      chronologicalImportant: false,
      weight: 7,
    },
    {
      name: "Devis santé fournis",
      description:
        "Vérifier si le client a des devis de soins (dentaire, optique, hospitalisation) et s'ils sont pris en compte dans le conseil",
      prompt: `Vérifier:
- Si la question est posée sur les devis existants
- Type de devis (dentaire/optique/hospitalisation)
- Montant des devis
- Prise en compte dans la simulation de remboursement`,
      controlPoints: [
        "Question posée sur devis existants",
        "Type de devis identifié",
        "Montant relevé",
        "Simulation de remboursement faite si applicable",
      ],
      keywords: [
        "devis",
        "devis dentaire",
        "devis optique",
        "simulation",
        "remboursement",
        "reste à charge",
      ],
      severityLevel: AuditSeverity.MEDIUM,
      isCritical: false,
      position: 10,
      chronologicalImportant: false,
      weight: 6,
    },
    {
      name: "Choix de la formule & contrat responsable",
      description:
        "Vérifier l'adéquation entre les besoins et la formule choisie, et l'explication du contrat responsable/100% Santé ou non responsable",
      prompt: `Vérifier:
- Que la formule correspond aux besoins exprimés
- Si contrat responsable: explication du 100% Santé (RAC0)
- Si non responsable: explication de l'absence de RAC0 + non-éligibilité Madelin (si indépendant)
- Reformulation de la formule par le conseiller`,
      controlPoints: [
        "Adéquation formule/besoins",
        "Type de contrat annoncé (responsable/non responsable)",
        "Explication 100% Santé si responsable",
        "Explication limites si non responsable",
        "Info Madelin si indépendant + non responsable",
      ],
      keywords: [
        "formule",
        "contrat responsable",
        "100% Santé",
        "RAC0",
        "reste à charge zéro",
        "Madelin",
        "garanties",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 11,
      chronologicalImportant: false,
      weight: 10,
    },
    {
      name: "Frais annexes (courtage, AGIS, GPMA)",
      description:
        "Vérifier que tous les frais annexes sont annoncés clairement et figurent dans le devis",
      prompt: `Vérifier que sont mentionnés:
- Frais de courtage
- Frais AGIS
- Frais GPMA
- Que ces frais sont inclus dans le devis envoyé`,
      controlPoints: [
        "Frais de courtage mentionnés",
        "Frais AGIS mentionnés",
        "Frais GPMA mentionnés",
        "Confirmation que les frais sont dans le devis",
      ],
      keywords: [
        "frais",
        "courtage",
        "AGIS",
        "GPMA",
        "frais de dossier",
        "transparence",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 12,
      chronologicalImportant: false,
      weight: 7,
    },
    {
      name: "Devoir de conseil (garanties détaillées)",
      description:
        "Vérifier que le conseiller explique en détail les garanties sur tous les postes importants",
      prompt: `Vérifier l'explication des garanties sur:
- Hospitalisation (honoraires, chambre particulière)
- Dentaire (soins courants, prothèses, plafonds, exclusion implants)
- Optique (verres simples/progressifs, monture, lentilles, chirurgie réfractive)
- Médecine douce (forfaits)
- Auditif (forfait par oreille)
- Dépassements d'honoraires
- Pharmacie`,
      controlPoints: [
        "Garanties hospitalisation expliquées",
        "Garanties dentaire détaillées",
        "Garanties optique présentées",
        "Médecine douce mentionnée",
        "Auditif abordé si pertinent",
        "Dépassements d'honoraires traités",
        "Pharmacie évoquée",
      ],
      keywords: [
        "garanties",
        "hospitalisation",
        "dentaire",
        "optique",
        "remboursement",
        "plafond",
        "couverture",
        "prise en charge",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 13,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Explication RAC0 (100% Santé)",
      description:
        "Vérifier que le dispositif 100% Santé / RAC0 est clairement expliqué si contrat responsable",
      prompt: `Si contrat responsable, vérifier:
- Explication du panier 100% Santé
- RAC0 sur optique (verres + monture)
- RAC0 sur dentaire (prothèses)
- RAC0 sur auditif (appareils)
- Conditions d'accès (professionnels partenaires)`,
      controlPoints: [
        "Concept 100% Santé/RAC0 expliqué",
        "Optique RAC0 mentionné",
        "Dentaire RAC0 mentionné",
        "Auditif RAC0 mentionné",
        "Conditions d'accès précisées",
      ],
      keywords: [
        "100% Santé",
        "RAC0",
        "reste à charge zéro",
        "panier",
        "réforme",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 14,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Limites & exclusions de garantie",
      description:
        "Vérifier que les limites et exclusions importantes sont clairement communiquées",
      prompt: `Vérifier que sont mentionnées:
- Exclusions importantes (ex: implants dentaires souvent non couverts)
- Plafonds annuels ou par acte
- Délais de carence s'il y en a
- Franchises éventuelles
- Conditions particulières`,
      controlPoints: [
        "Exclusions principales communiquées",
        "Plafonds annoncés",
        "Délais de carence mentionnés si applicables",
        "Franchises évoquées si présentes",
        "Compréhension client vérifiée",
      ],
      keywords: [
        "exclusion",
        "limite",
        "plafond",
        "délai de carence",
        "franchise",
        "non couvert",
        "non remboursé",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 15,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Observation qualitative de l'entretien",
      description:
        "Évaluation qualitative globale: clarté, compréhension client, rythme, attitude du conseiller",
      prompt: `Évaluer:
- Clarté des explications
- Adaptation au niveau du client
- Rythme de l'appel (ni trop rapide, ni trop lent)
- Écoute active du conseiller
- Reformulations régulières
- Vérification de compréhension
- Attitude professionnelle et courtoise
- Absence de pression commerciale`,
      controlPoints: [
        "Clarté et pédagogie",
        "Adaptation au client",
        "Rythme approprié",
        "Écoute active démontrée",
        "Reformulations présentes",
        "Vérifications de compréhension",
        "Professionnalisme",
        "Absence de pression",
      ],
      keywords: [
        "compréhension",
        "clair",
        "reformulation",
        "question",
        "d'accord",
        "ok",
        "bien compris",
      ],
      severityLevel: AuditSeverity.MEDIUM,
      isCritical: false,
      position: 16,
      chronologicalImportant: false,
      weight: 6,
    },
    {
      name: "Notes complémentaires",
      description:
        "Espace pour noter tout élément pertinent: incidents, pièces reçues, particularités du dossier",
      prompt: `Noter:
- Tout incident ou difficulté rencontrée
- Documents reçus ou envoyés
- Particularités du dossier
- Éléments nécessitant un suivi
- Remarques du client`,
      controlPoints: [
        "Incidents éventuels documentés",
        "Documents tracés",
        "Particularités notées",
        "Points de suivi identifiés",
      ],
      keywords: [
        "note",
        "remarque",
        "incident",
        "document",
        "suivi",
        "particularité",
      ],
      severityLevel: AuditSeverity.LOW,
      isCritical: false,
      position: 17,
      chronologicalImportant: false,
      weight: 3,
    },
    {
      name: "Autres besoins (après signature uniquement)",
      description:
        "Vérifier que les autres besoins (prêt, auto, MRH, décennale) ne sont évoqués QU'APRÈS signature et sans pression",
      prompt: `Vérifier:
- Que les autres besoins ne sont abordés qu'APRÈS souscription complète
- Pas de pression commerciale
- Simple ouverture de possibilité
- Respect si le client refuse`,
      controlPoints: [
        "Évoqué uniquement après souscription",
        "Aucune pression",
        "Proposition optionnelle",
        "Respect du refus",
      ],
      keywords: [
        "prêt",
        "auto",
        "MRH",
        "habitation",
        "décennale",
        "autre besoin",
        "intéressé",
      ],
      severityLevel: AuditSeverity.LOW,
      isCritical: false,
      position: 18,
      chronologicalImportant: false,
      weight: 2,
    },
  ];

  // Create comprehensive audit steps
  for (const stepData of comprehensiveSteps) {
    const step = await prisma.auditStep.create({
      data: {
        auditConfigId: comprehensiveConfig.id,
        ...stepData,
      },
    });
    console.log(`  ✅ Comprehensive - Step ${step.position}: ${step.name}`);
  }

  // ============================================================================
  // ESSENTIAL AUDIT STEPS (8 critical steps)
  // ============================================================================
  console.log("\n📝 Creating Essential Audit Steps (8 steps)...");

  const essentialSteps = [
    {
      name: "Présentation du Cabinet et de l'Agent / Réforme du Courtage",
      description:
        "Vérifier que le conseiller présente correctement son identité, NCA, le numéro ORIAS, et annonce les obligations légales de l'enregistrement",
      prompt: `Vérifier que le conseiller:
- Se présente avec son prénom/nom
- Mentionne "Net Courtage Assurance" ou "NCA"
- Donne le numéro ORIAS
- Annonce que l'appel est enregistré
- Mentionne le droit d'opposition du client
- Indique la conservation 2 ans de l'enregistrement
- Informe du droit de copie
- Arrête immédiatement si refus d'enregistrement`,
      controlPoints: [
        "Identité du conseiller (prénom + nom)",
        "Mention explicite de 'Net Courtage Assurance' ou 'NCA'",
        "Numéro ORIAS communiqué",
        "Annonce 'appel enregistré'",
        "Droit d'opposition mentionné",
        "Conservation 2 ans mentionnée",
        "Droit de copie mentionné",
        "Réaction appropriée en cas de refus",
      ],
      keywords: [
        "ORIAS",
        "Net Courtage",
        "NCA",
        "enregistré",
        "opposition",
        "2 ans",
        "conservation",
        "réforme courtage",
        "Bloctel",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 1,
      chronologicalImportant: true,
      weight: 10,
    },
    {
      name: "Dispositifs spécifiques (CSS/CMU/MGO/Portabilité)",
      description:
        "Vérifier impérativement si le client bénéficie de CSS, CMU, MGO ou portabilité - VENTE INTERDITE si CSS/CMU",
      prompt: `CRITIQUE: Vérifier la question sur:
- CSS (Complémentaire Santé Solidaire)
- CMU (Couverture Maladie Universelle)
- MGO (Maintien Gratuit Obligatoire)
- Portabilité

⚠️ REJET AUTOMATIQUE si CSS/CMU/AME → vente illégale`,
      controlPoints: [
        "Question CSS/CMU posée",
        "Question MGO posée",
        "Question portabilité posée",
        "Arrêt de la vente si CSS/CMU détecté",
      ],
      keywords: [
        "CSS",
        "CMU",
        "MGO",
        "portabilité",
        "AME",
        "complémentaire santé solidaire",
        "aide sociale",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 2,
      chronologicalImportant: false,
      weight: 10,
    },
    {
      name: "Ancienne couverture & délais",
      description:
        "Vérifier l'ancienneté du contrat actuel (≥/< 12 mois) pour déterminer les possibilités de résiliation",
      prompt: `Vérifier que le conseiller interroge sur:
- La compagnie actuelle
- Depuis combien de temps (> ou < 12 mois)
- Si le contrat a été renouvelé
- Les délais de résiliation
- La conformité avec la loi Chatel`,
      controlPoints: [
        "Compagnie actuelle identifiée",
        "Ancienneté du contrat (≥12 mois ou <12 mois)",
        "Statut du renouvellement",
        "Délais de résiliation vérifiés",
        "Conformité légale validée",
      ],
      keywords: [
        "mutuelle actuelle",
        "depuis quand",
        "12 mois",
        "ancienneté",
        "renouvellement",
        "contrat",
        "compagnie",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: true,
      position: 3,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Type de résiliation",
      description:
        "Identifier et valider le type de résiliation (Chatel, hausse de tarif, échéance) et les preuves nécessaires",
      prompt: `Vérifier:
- Le type de résiliation (Chatel/hausse/échéance/portabilité)
- Les délais de préavis respectés
- Les documents justificatifs évoqués
- Absence de rétractation d'un autre contrat en cours`,
      controlPoints: [
        "Type de résiliation identifié",
        "Préavis respecté",
        "Documents justificatifs mentionnés",
        "Pas de conflit avec rétractation en cours",
      ],
      keywords: [
        "résiliation",
        "Chatel",
        "hausse",
        "échéance",
        "préavis",
        "portabilité",
        "rétractation",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: true,
      position: 4,
      chronologicalImportant: false,
      weight: 8,
    },
    {
      name: "Motivation & besoins détaillés",
      description:
        "Comprendre la motivation du client et identifier ses urgences médicales (optique, dentaire, hospitalisation, dépassements, médecine douce, auditif)",
      prompt: `Vérifier que le conseiller identifie:
- La motivation principale (économies/garanties/les deux)
- Le budget maximal acceptable
- Les urgences de soins:
  * Optique (verres, monture, fréquence)
  * Dentaire (prothèses, implants, devis en cours)
  * Hospitalisation (chambre particulière prévue)
  * Dépassements d'honoraires (OPTAM/hors OPTAM)
  * Médecine douce (ostéo, pédicure, etc.)
  * Auditif (appareil prévu)
  * Autres spécificités`,
      controlPoints: [
        "Motivation principale identifiée",
        "Budget maximum établi",
        "Urgences optique explorées",
        "Besoins dentaire évalués",
        "Hospitalisation discutée",
        "Dépassements d'honoraires évoqués",
        "Médecine douce questionnée",
        "Auditif abordé si pertinent",
      ],
      keywords: [
        "budget",
        "optique",
        "lunettes",
        "dentaire",
        "prothèse",
        "implant",
        "hospitalisation",
        "chambre",
        "dépassement",
        "OPTAM",
        "ostéopathe",
        "médecine douce",
        "auditif",
        "appareil auditif",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 5,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Choix de la formule & contrat responsable",
      description:
        "Vérifier l'adéquation entre les besoins et la formule choisie, et l'explication du contrat responsable/100% Santé ou non responsable",
      prompt: `Vérifier:
- Que la formule correspond aux besoins exprimés
- Si contrat responsable: explication du 100% Santé (RAC0)
- Si non responsable: explication de l'absence de RAC0 + non-éligibilité Madelin (si indépendant)
- Reformulation de la formule par le conseiller`,
      controlPoints: [
        "Adéquation formule/besoins",
        "Type de contrat annoncé (responsable/non responsable)",
        "Explication 100% Santé si responsable",
        "Explication limites si non responsable",
        "Info Madelin si indépendant + non responsable",
      ],
      keywords: [
        "formule",
        "contrat responsable",
        "100% Santé",
        "RAC0",
        "reste à charge zéro",
        "Madelin",
        "garanties",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 6,
      chronologicalImportant: false,
      weight: 10,
    },
    {
      name: "Devoir de conseil (garanties détaillées)",
      description:
        "Vérifier que le conseiller explique en détail les garanties sur tous les postes importants",
      prompt: `Vérifier l'explication des garanties sur:
- Hospitalisation (honoraires, chambre particulière)
- Dentaire (soins courants, prothèses, plafonds, exclusion implants)
- Optique (verres simples/progressifs, monture, lentilles, chirurgie réfractive)
- Médecine douce (forfaits)
- Auditif (forfait par oreille)
- Dépassements d'honoraires
- Pharmacie`,
      controlPoints: [
        "Garanties hospitalisation expliquées",
        "Garanties dentaire détaillées",
        "Garanties optique présentées",
        "Médecine douce mentionnée",
        "Auditif abordé si pertinent",
        "Dépassements d'honoraires traités",
        "Pharmacie évoquée",
      ],
      keywords: [
        "garanties",
        "hospitalisation",
        "dentaire",
        "optique",
        "remboursement",
        "plafond",
        "couverture",
        "prise en charge",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 7,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Limites & exclusions de garantie",
      description:
        "Vérifier que les limites et exclusions importantes sont clairement communiquées",
      prompt: `Vérifier que sont mentionnées:
- Exclusions importantes (ex: implants dentaires souvent non couverts)
- Plafonds annuels ou par acte
- Délais de carence s'il y en a
- Franchises éventuelles
- Conditions particulières`,
      controlPoints: [
        "Exclusions principales communiquées",
        "Plafonds annoncés",
        "Délais de carence mentionnés si applicables",
        "Franchises évoquées si présentes",
        "Compréhension client vérifiée",
      ],
      keywords: [
        "exclusion",
        "limite",
        "plafond",
        "délai de carence",
        "franchise",
        "non couvert",
        "non remboursé",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 8,
      chronologicalImportant: false,
      weight: 8,
    },
  ];

  // Create essential audit steps
  for (const stepData of essentialSteps) {
    const step = await prisma.auditStep.create({
      data: {
        auditConfigId: essentialConfig.id,
        ...stepData,
      },
    });
    console.log(`  ✅ Essential - Step ${step.position}: ${step.name}`);
  }

  // ============================================================================
  // QUICK AUDIT STEPS (5 critical steps only)
  // ============================================================================
  console.log("\n📝 Creating Quick Audit Steps (5 steps)...");

  const quickSteps = [
    {
      name: "Présentation légale (ORIAS + Enregistrement)",
      description:
        "Vérification express de la présentation légale : identité, NCA, ORIAS, enregistrement, droits",
      prompt: `Contrôle rapide:
- Identité conseiller + NCA mentionné
- Numéro ORIAS donné
- Enregistrement annoncé + droits (opposition, conservation 2 ans)

❌ REJET si un seul élément manquant`,
      controlPoints: [
        "Identité + NCA",
        "ORIAS communiqué",
        "Enregistrement + droits annoncés",
      ],
      keywords: [
        "ORIAS",
        "Net Courtage",
        "NCA",
        "enregistré",
        "opposition",
        "2 ans",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 1,
      chronologicalImportant: true,
      weight: 10,
    },
    {
      name: "CSS/CMU/AME - Vérification obligatoire",
      description:
        "Vérification CRITIQUE et BLOQUANTE - CSS/CMU/AME interdit toute vente",
      prompt: `⚠️ POINT BLOQUANT:
- Question CSS/CMU/AME posée?
- Si OUI → ARRÊT IMMÉDIAT (vente illégale)

❌ REJET automatique si CSS/CMU/AME détecté`,
      controlPoints: ["Question posée", "Arrêt si CSS/CMU/AME"],
      keywords: ["CSS", "CMU", "AME", "complémentaire santé solidaire"],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 2,
      chronologicalImportant: false,
      weight: 10,
    },
    {
      name: "Ancienneté contrat & résiliation possible",
      description:
        "Vérifier que la résiliation du contrat actuel est légalement possible",
      prompt: `Vérifier rapidement:
- Compagnie actuelle identifiée
- Ancienneté (≥12 mois ou <12 mois)
- Type de résiliation possible (Chatel/hausse/échéance)

❌ REJET si résiliation impossible ou non vérifiée`,
      controlPoints: [
        "Compagnie identifiée",
        "Ancienneté vérifiée",
        "Type résiliation validé",
      ],
      keywords: [
        "mutuelle actuelle",
        "12 mois",
        "résiliation",
        "Chatel",
        "échéance",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 3,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Type de contrat (Responsable / Non Responsable)",
      description:
        "Vérifier que le type de contrat est annoncé et que les implications sont expliquées",
      prompt: `Vérifier:
- Type de contrat annoncé (responsable/non responsable)
- Si responsable: RAC0 mentionné
- Si non responsable: limites expliquées + info Madelin si indépendant

❌ REJET si type non annoncé ou implications non expliquées`,
      controlPoints: [
        "Type de contrat annoncé",
        "RAC0 ou limites expliqués",
        "Info Madelin si applicable",
      ],
      keywords: [
        "contrat responsable",
        "non responsable",
        "100% Santé",
        "RAC0",
        "Madelin",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 4,
      chronologicalImportant: false,
      weight: 9,
    },
    {
      name: "Adéquation besoin / formule proposée",
      description:
        "Vérifier que la formule correspond aux besoins exprimés (pas de survente/sous-vente)",
      prompt: `Vérifier:
- Besoins principaux identifiés (optique/dentaire/hospitalisation)
- Formule proposée adaptée
- Pas de survente évidente
- Budget respecté

❌ REJET si inadéquation flagrante besoin/formule`,
      controlPoints: [
        "Besoins identifiés",
        "Formule adaptée",
        "Pas de survente",
        "Budget respecté",
      ],
      keywords: [
        "besoin",
        "formule",
        "garanties",
        "budget",
        "optique",
        "dentaire",
        "hospitalisation",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: true,
      position: 5,
      chronologicalImportant: false,
      weight: 8,
    },
  ];

  // Create quick audit steps
  for (const stepData of quickSteps) {
    const step = await prisma.auditStep.create({
      data: {
        auditConfigId: quickConfig.id,
        ...stepData,
      },
    });
    console.log(`  ✅ Quick - Step ${step.position}: ${step.name}`);
  }

  // ============================================================================
  // LOI DE DÉMARCHAGE AUDIT STEPS (5 specialized legal compliance steps)
  // ============================================================================
  console.log("\n📝 Creating Loi de Démarchage Audit Steps (5 steps)...");

  const loiDemarchageSteps = [
    {
      name: "Présentation identité + NCA + ORIAS",
      description:
        "Valider que le conseiller se présente clairement (identité), mentionne Net Courtage Assurance (NCA) comme courtier et indique l'immatriculation ORIAS, en prenant en compte les approximations phonétiques possibles.",
      prompt: `Vérifier en début d'appel :
- Que le conseiller donne son prénom (et idéalement son nom).
- Qu'il mentionne clairement Net Courtage Assurance ou NCA en tant que cabinet de courtage (tolérance phonétique : « net courach », « net courta », etc.).
- Qu'il indique l'immatriculation ORIAS, même de façon approximative (« oriasse », « o rias », « numéroroias », etc.).
- Qu'il ne se présente jamais comme une mutuelle, la Sécurité sociale, la CPAM ou un organisme public.

Si un élément manque réellement au son, noter le point comme NON CONFORME en expliquant précisément ce qui manque.
Si la transcription est imparfaite mais que l'audio permet de comprendre que l'info est donnée, considérer le point comme traité et l'indiquer clairement.`,
      controlPoints: [
        "Identité du conseiller annoncée (prénom au minimum)",
        "Mention de Net Courtage Assurance ou NCA comme courtier",
        "Annonce de l'immatriculation ORIAS (même phonétique approximative)",
        "Absence de fausse qualité (mutuelle, CPAM, Sécurité sociale, organisme public)",
        "Compréhension possible par le client qu'il parle à un courtier en assurances",
      ],
      keywords: [
        "NCA",
        "Net Courtage",
        "Net Courtage Assurance",
        "courtier",
        "ORIAS",
        "immatriculé",
        "mutuelle",
        "Sécurité sociale",
        "CPAM",
        "service qualité",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 1,
      chronologicalImportant: true,
      weight: 25,
    },
    {
      name: "Annonce de l'enregistrement + droit de refus",
      description:
        "Valider que le conseiller annonce que l'appel est enregistré, informe le client de son droit d'opposition et respecte un éventuel refus, en tenant compte des erreurs de transcription éventuelles.",
      prompt: `Vérifier :
- Que le conseiller annonce clairement que l'appel est enregistré (tolérance phonétique : « enregisté », « enrégistré », « anregistré », etc.).
- Qu'il informe le client de son droit de refuser l'enregistrement ou de s'y opposer (« vous pouvez refuser », « vous avez le droit de vous opposer », etc., même si la transcription est approximative).
- Qu'il laisse un minimum d'espace au client pour réagir (ne pas enchaîner immédiatement).
- Qu'en cas de refus explicite d'enregistrement, l'appel est arrêté ou l'enregistrement n'est pas poursuivi.

Ignorer un refus explicite d'enregistrement = NON CONFORME CRITIQUE et rejet Loi de Démarchage.
Absence réelle d'annonce d'enregistrement dans l'audio = NON CONFORME CRITIQUE.

Ne pas sanctionner une simple faute de transcription si le son montre que l'information a bien été donnée.`,
      controlPoints: [
        "Annonce explicite que l'appel est enregistré",
        "Mention claire du droit de refus / opposition",
        "Temps de réaction laissé au client",
        "Respect du refus si le client s'oppose",
        "Absence de pression ou de minimisation du droit de refus",
      ],
      keywords: [
        "appel enregistré",
        "enregistrement",
        "enregistré pour des raisons de qualité",
        "qualité",
        "vous pouvez refuser",
        "droit de refus",
        "droit d'opposition",
        "s'y opposer",
        "refuser l'enregistrement",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 2,
      chronologicalImportant: true,
      weight: 25,
    },
    {
      name: "Conservation 2 ans + droit de copie",
      description:
        "Valider que le conseiller informe le client de la durée de conservation de l'enregistrement (2 ans) et de son droit de demander une copie, en tolérant les approximations de transcription.",
      prompt: `Vérifier :
- Que le conseiller indique que l'enregistrement est conservé pendant 2 ans (tolérance phonétique : « deu an », « deux ans », « dé an », etc.).
- Qu'il mentionne le droit pour le client de demander une copie de l'enregistrement.
- Que ces informations sont compréhensibles et pas noyées dans une phrase incompréhensible.

Si l'un de ces deux éléments manque réellement dans l'audio (et pas seulement dans la transcription), considérer le point comme NON CONFORME.
Si la transcription est approximative mais que le sens est clair au son, considérer le point comme traité.`,
      controlPoints: [
        "Mention explicite de la conservation 2 ans",
        "Mention du droit de demander une copie de l'enregistrement",
        "Information donnée à un moment logique",
        "Formulation globalement compréhensible pour le client",
      ],
      keywords: [
        "conservation",
        "conservé",
        "2 ans",
        "deux ans",
        "droit de copie",
        "copie de l'enregistrement",
        "enregistrement conservé",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 3,
      chronologicalImportant: true,
      weight: 20,
    },
    {
      name: "Respect des oppositions (Bloctel + refus de démarchage)",
      description:
        "Vérifier que toute opposition explicite du client au démarchage ou au fait d'être rappelé est respectée et que l'appel est clôturé sans insistance abusive.",
      prompt: `Vérifier :
- Si le client exprime une opposition claire au fait d'être démarché ou rappelé (« ne m'appelez plus », « je suis sur Bloctel », « je ne veux pas être dérangé », etc.).
- Que le conseiller respecte cette opposition et met fin à l'appel sans contourner le refus.
- Qu'il n'y a pas d'insistance abusive après un refus clair.

Les erreurs de transcription (orthographe, découpage) ne doivent pas masquer le sens réel : si le client refuse clairement au son, ce refus doit être respecté.
Ignorer une opposition explicite = NON CONFORME MAJEUR.`,
      controlPoints: [
        "Opposition explicite du client identifiée si présente",
        "Arrêt de l'appel en cas de refus de démarchage",
        "Pas d'insistance abusive après un refus",
        "Pas de contournement de la demande de ne plus être appelé",
      ],
      keywords: [
        "Bloctel",
        "liste rouge",
        "ne m'appelez plus",
        "je ne veux plus être appelé",
        "je ne veux pas être démarché",
        "refus de poursuivre",
        "raccrocher",
        "arrêter l'appel",
      ],
      severityLevel: AuditSeverity.HIGH,
      isCritical: false,
      position: 4,
      chronologicalImportant: false,
      weight: 15,
    },
    {
      name: "Absence de fausse présentation",
      description:
        "Contrôler que le conseiller ne se présente jamais comme un organisme public ou une mutuelle, et ne crée pas de confusion intentionnelle sur le rôle de NCA.",
      prompt: `Vérifier tout au long de l'appel :
- Que le conseiller ne se présente pas comme une mutuelle, la Sécurité sociale, la CPAM, un « service qualité de votre caisse » ou autre organisme public.
- Qu'il n'induit pas le client en erreur sur le rôle de NCA (NCA reste clairement un courtier).
- Qu'il n'y a pas de contradiction entre l'introduction (courtier) et la suite de l'appel (où il parlerait comme s'il était l'organisme payeur).

Toute fausse présentation ou confusion volontaire sur la nature de NCA = NON CONFORME CRITIQUE.
Les fautes de transcription (ex : « mutuele », « securité socal ») ne changent pas le sens : c'est le contenu audio réel qui compte.`,
      controlPoints: [
        "Aucune présentation comme mutuelle ou organisme public",
        "Aucune mention trompeuse du type « service qualité de votre caisse »",
        "Cohérence entre la présentation initiale et le reste de l'appel",
        "Statut de courtier en assurances restant clair pour le client",
      ],
      keywords: [
        "mutuelle",
        "Sécurité sociale",
        "CPAM",
        "service qualité",
        "caisse",
        "organisme",
        "assurance maladie",
        "organisme public",
      ],
      severityLevel: AuditSeverity.CRITICAL,
      isCritical: true,
      position: 5,
      chronologicalImportant: false,
      weight: 15,
    },
  ];

  // Create Loi de Démarchage audit steps
  for (const stepData of loiDemarchageSteps) {
    const step = await prisma.auditStep.create({
      data: {
        auditConfigId: loiDemarchageConfig.id,
        ...stepData,
      },
    });
    console.log(`  ✅ Loi de Démarchage - Step ${step.position}: ${step.name}`);
  }

  console.log("\n🎉 Seed completed successfully!");
  console.log(`\n📊 Summary:`);
  console.log(`   - 4 Audit Configs created:`);
  console.log(
    `     • Comprehensive Audit (${comprehensiveConfig.id}) - 18 steps`
  );
  console.log(`     • Essential Audit (${essentialConfig.id}) - 8 steps`);
  console.log(`     • Quick Audit (${quickConfig.id}) - 5 steps`);
  console.log(
    `     • Loi de Démarchage Audit (${loiDemarchageConfig.id}) - 5 steps`
  );
  console.log(
    `   - Total: ${
      comprehensiveSteps.length +
      essentialSteps.length +
      quickSteps.length +
      loiDemarchageSteps.length
    } Audit Steps created`
  );
}

main()
  .catch((e) => {
    console.error("❌ Error during seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    const { disconnectDb } = await import("./src/shared/prisma.js");
    await disconnectDb();
  });
