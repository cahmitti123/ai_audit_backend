/**
 * Products Repository
 * ===================
 * Database operations for insurance products
 */

import { prisma } from "../../shared/prisma.js";
import type { Prisma } from "@prisma/client";

// ============================================
// Groupes Repository
// ============================================

export async function getAllGroupes() {
  const groupes = await prisma.groupe.findMany({
    orderBy: { libelle: "asc" },
    include: {
      _count: {
        select: {
          gammes: true,
        },
      },
    },
  });

  return groupes.map(groupe => ({
    ...groupe,
    _counts: {
      gammes: groupe._count.gammes,
    },
  }));
}

export async function getGroupeById(id: bigint) {
  const groupe = await prisma.groupe.findUnique({
    where: { id },
    include: {
      gammes: {
        include: {
          formules: true,
          _count: {
            select: {
              formules: true,
              documentsTable: true,
            },
          },
        },
      },
    },
  });

  if (!groupe) return null;

  // Add counts to each gamme
  const gammesWithCounts = groupe.gammes.map(gamme => ({
    ...gamme,
    _counts: {
      formules: gamme._count.formules,
      documents: gamme._count.documentsTable,
    },
  }));

  // Calculate total counts
  const gammesCount = groupe.gammes.length;
  const formulesCount = groupe.gammes.reduce((sum, g) => sum + g.formules.length, 0);

  return {
    ...groupe,
    gammes: gammesWithCounts,
    _counts: {
      gammes: gammesCount,
      formules: formulesCount,
    },
  };
}

export async function createGroupe(data: Prisma.GroupeCreateInput) {
  return prisma.groupe.create({
    data,
  });
}

export async function updateGroupe(id: bigint, data: Prisma.GroupeUpdateInput) {
  return prisma.groupe.update({
    where: { id },
    data,
  });
}

export async function deleteGroupe(id: bigint) {
  return prisma.groupe.delete({
    where: { id },
  });
}

// ============================================
// Gammes Repository
// ============================================

export async function getAllGammes(options?: {
  groupeId?: bigint;
  skip?: number;
  take?: number;
  search?: string;
}) {
  const where: Prisma.GammeWhereInput = {};
  
  if (options?.groupeId) {
    where.groupeId = options.groupeId;
  }
  
  if (options?.search) {
    where.libelle = {
      contains: options.search,
      mode: "insensitive",
    };
  }

  const gammes = await prisma.gamme.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { libelle: "asc" },
    include: {
      groupe: true,
      _count: {
        select: {
          formules: true,
          documentsTable: true,
        },
      },
    },
  });

  return gammes.map(gamme => ({
    ...gamme,
    _counts: {
      formules: gamme._count.formules,
      documents: gamme._count.documentsTable,
    },
  }));
}

export async function getGammeById(id: bigint) {
  const gamme = await prisma.gamme.findUnique({
    where: { id },
    include: {
      groupe: true,
      formules: {
        include: {
          garantiesParsed: {
            include: {
              categories: {
                include: {
                  items: true,
                },
              },
            },
          },
          documents: true,
        },
      },
      documentsTable: true,
    },
  });

  if (!gamme) return null;

  // Calculate counts
  const formulesCount = gamme.formules.length;
  const documentsCount = gamme.documentsTable.length;
  const garantiesCount = gamme.formules.reduce((sum, f) => sum + f.garantiesParsed.length, 0);
  const categoriesCount = gamme.formules.reduce((sum, f) => {
    return sum + f.garantiesParsed.reduce((gSum, g) => gSum + g.categories.length, 0);
  }, 0);
  const itemsCount = gamme.formules.reduce((sum, f) => {
    return sum + f.garantiesParsed.reduce((gSum, g) => {
      return gSum + g.categories.reduce((cSum, c) => cSum + c.items.length, 0);
    }, 0);
  }, 0);

  return {
    ...gamme,
    _counts: {
      formules: formulesCount,
      documents: documentsCount,
      garanties: garantiesCount,
      categories: categoriesCount,
      items: itemsCount,
    },
  };
}

export async function createGamme(data: Prisma.GammeCreateInput) {
  return prisma.gamme.create({
    data,
    include: {
      groupe: true,
    },
  });
}

export async function updateGamme(id: bigint, data: Prisma.GammeUpdateInput) {
  return prisma.gamme.update({
    where: { id },
    data,
    include: {
      groupe: true,
    },
  });
}

export async function deleteGamme(id: bigint) {
  return prisma.gamme.delete({
    where: { id },
  });
}

// ============================================
// Formules Repository
// ============================================

export async function getAllFormules(options?: {
  gammeId?: bigint;
  skip?: number;
  take?: number;
  search?: string;
}) {
  const where: Prisma.FormuleWhereInput = {};
  
  if (options?.gammeId) {
    where.gammeId = options.gammeId;
  }
  
  if (options?.search) {
    where.libelle = {
      contains: options.search,
      mode: "insensitive",
    };
  }

  const formules = await prisma.formule.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { libelle: "asc" },
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
      _count: {
        select: {
          garantiesParsed: true,
          documents: true,
        },
      },
    },
  });

  return formules.map(formule => ({
    ...formule,
    _counts: {
      garanties: formule._count.garantiesParsed,
      documents: formule._count.documents,
    },
  }));
}

export async function getFormuleById(id: bigint) {
  const formule = await prisma.formule.findUnique({
    where: { id },
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
      garantiesParsed: {
        include: {
          categories: {
            include: {
              items: {
                orderBy: { displayOrder: "asc" },
              },
            },
            orderBy: { displayOrder: "asc" },
          },
        },
      },
      documents: true,
    },
  });

  if (!formule) return null;

  // Calculate counts
  const garantiesCount = formule.garantiesParsed.length;
  const categoriesCount = formule.garantiesParsed.reduce(
    (sum, g) => sum + g.categories.length,
    0
  );
  const itemsCount = formule.garantiesParsed.reduce((sum, g) => {
    return sum + g.categories.reduce((cSum, c) => cSum + c.items.length, 0);
  }, 0);
  const documentsCount = formule.documents.length;

  return {
    ...formule,
    _counts: {
      garanties: garantiesCount,
      categories: categoriesCount,
      items: itemsCount,
      documents: documentsCount,
    },
  };
}

export async function createFormule(data: Prisma.FormuleCreateInput) {
  return prisma.formule.create({
    data,
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
    },
  });
}

export async function updateFormule(id: bigint, data: Prisma.FormuleUpdateInput) {
  return prisma.formule.update({
    where: { id },
    data,
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
    },
  });
}

export async function deleteFormule(id: bigint) {
  return prisma.formule.delete({
    where: { id },
  });
}

// ============================================
// Search & Stats
// ============================================

export async function searchProducts(query: string, options?: {
  skip?: number;
  take?: number;
}) {
  const searchTerm = `%${query}%`;
  
  // Search across groupes, gammes, and formules
  const [groupes, gammes, formules] = await Promise.all([
    prisma.groupe.findMany({
      where: {
        OR: [
          { libelle: { contains: query, mode: "insensitive" } },
          { code: { contains: query, mode: "insensitive" } },
        ],
      },
      take: 10,
    }),
    prisma.gamme.findMany({
      where: {
        OR: [
          { libelle: { contains: query, mode: "insensitive" } },
          { code: { contains: query, mode: "insensitive" } },
        ],
      },
      include: {
        groupe: true,
      },
      take: 10,
    }),
    prisma.formule.findMany({
      where: {
        OR: [
          { libelle: { contains: query, mode: "insensitive" } },
          { code: { contains: query, mode: "insensitive" } },
          { libelleAlternatif: { contains: query, mode: "insensitive" } },
        ],
      },
      include: {
        gamme: {
          include: {
            groupe: true,
          },
        },
      },
      take: 10,
    }),
  ]);

  return {
    groupes,
    gammes,
    formules,
  };
}

export async function getProductStats() {
  const [groupesCount, gammesCount, formulesCount, garantiesCount] = await Promise.all([
    prisma.groupe.count(),
    prisma.gamme.count(),
    prisma.formule.count(),
    prisma.garantieParsed.count(),
  ]);

  return {
    groupes: groupesCount,
    gammes: gammesCount,
    formules: formulesCount,
    garanties: garantiesCount,
  };
}

// ============================================
// Product Matching Repository
// ============================================

export async function findFormuleByNames(params: {
  groupeName: string;
  gammeName: string;
  formuleName: string;
}) {
  const normalize = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const levenshtein = (a: string, b: string) => {
    const s = a;
    const t = b;
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;

    const dp = new Array<number>(m + 1);
    for (let j = 0; j <= m; j++) dp[j] = j;

    for (let i = 1; i <= n; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= m; j++) {
        const temp = dp[j];
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[j] = Math.min(
          dp[j] + 1, // deletion
          dp[j - 1] + 1, // insertion
          prev + cost // substitution
        );
        prev = temp;
      }
    }
    return dp[m];
  };

  const similarity = (aRaw: string, bRaw: string) => {
    const a = normalize(aRaw);
    const b = normalize(bRaw);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.92;
    const dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length);
  };

  // Try exact match first
  const formule = await prisma.formule.findFirst({
    where: {
      OR: [
        { libelle: { equals: params.formuleName, mode: "insensitive" } },
        { libelleAlternatif: { equals: params.formuleName, mode: "insensitive" } },
      ],
      gamme: {
        libelle: { equals: params.gammeName, mode: "insensitive" },
        groupe: {
          libelle: { equals: params.groupeName, mode: "insensitive" },
        },
      },
    },
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
      garantiesParsed: {
        include: {
          categories: {
            include: {
              items: {
                orderBy: { displayOrder: "asc" },
              },
            },
            orderBy: { displayOrder: "asc" },
          },
        },
      },
      documents: true,
    },
  });

  // Exact match found
  if (formule) {
    // Calculate counts
    const garantiesCount = formule.garantiesParsed.length;
    const categoriesCount = formule.garantiesParsed.reduce(
      (sum, g) => sum + g.categories.length,
      0
    );
    const itemsCount = formule.garantiesParsed.reduce((sum, g) => {
      return sum + g.categories.reduce((cSum, c) => cSum + c.items.length, 0);
    }, 0);
    const documentsCount = formule.documents.length;

    return {
      ...formule,
      _counts: {
        garanties: garantiesCount,
        categories: categoriesCount,
        items: itemsCount,
        documents: documentsCount,
      },
      _match: {
        strategy: "exact",
      },
    };
  }

  // Fuzzy fallback (accent/punctuation tolerant) — prefer correct mapping over vector-store guesses.
  // Strategy: pick best groupe -> gamme -> formule using string similarity, then fetch full formule details.
  const inputGroupe = params.groupeName;
  const inputGamme = params.gammeName;
  const inputFormule = params.formuleName;

  const groupes = await prisma.groupe.findMany({
    select: { id: true, libelle: true, code: true },
  });
  const bestGroupe = groupes
    .map((g) => ({
      g,
      score: similarity(g.libelle, inputGroupe),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!bestGroupe || bestGroupe.score < 0.6) return null;

  const gammes = await prisma.gamme.findMany({
    where: { groupeId: bestGroupe.g.id },
    select: { id: true, libelle: true, code: true },
  });
  const bestGamme = gammes
    .map((gm) => ({
      gm,
      score: similarity(gm.libelle, inputGamme),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!bestGamme || bestGamme.score < 0.6) return null;

  const formules = await prisma.formule.findMany({
    where: { gammeId: bestGamme.gm.id },
    select: { id: true, libelle: true, libelleAlternatif: true },
  });

  const bestFormule = formules
    .map((f) => {
      const score = Math.max(
        similarity(f.libelle, inputFormule),
        f.libelleAlternatif ? similarity(f.libelleAlternatif, inputFormule) : 0
      );
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  if (!bestFormule || bestFormule.score < 0.65) return null;

  const fuzzy = await prisma.formule.findUnique({
    where: { id: bestFormule.f.id },
    include: {
      gamme: {
        include: {
          groupe: true,
        },
      },
      garantiesParsed: {
        include: {
          categories: {
            include: {
              items: {
                orderBy: { displayOrder: "asc" },
              },
            },
            orderBy: { displayOrder: "asc" },
          },
        },
      },
      documents: true,
    },
  });

  if (!fuzzy) return null;

  // Calculate counts
  const garantiesCount = fuzzy.garantiesParsed.length;
  const categoriesCount = fuzzy.garantiesParsed.reduce(
    (sum, g) => sum + g.categories.length,
    0
  );
  const itemsCount = fuzzy.garantiesParsed.reduce((sum, g) => {
    return sum + g.categories.reduce((cSum, c) => cSum + c.items.length, 0);
  }, 0);
  const documentsCount = fuzzy.documents.length;

  return {
    ...fuzzy,
    _counts: {
      garanties: garantiesCount,
      categories: categoriesCount,
      items: itemsCount,
      documents: documentsCount,
    },
    _match: {
      strategy: "fuzzy",
      scores: {
        groupe: bestGroupe.score,
        gamme: bestGamme.score,
        formule: bestFormule.score,
      },
      picked: {
        groupe: bestGroupe.g.libelle,
        gamme: bestGamme.gm.libelle,
        formule: fuzzy.libelle,
      },
    },
  };
}

