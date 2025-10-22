import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AI Audit System API",
      version: "2.3.0",
      description: "REST API for AI-powered quality audit system with GPT-5",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:3002",
        description: "Development server",
      },
    ],
    tags: [
      { name: "Health", description: "Health check endpoints" },
      { name: "Audit Configs", description: "Audit configuration management" },
      { name: "Audits", description: "Run and manage audits" },
      { name: "Fiches", description: "Fiche-related operations" },
    ],
  },
  apis: ["./src/server.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
