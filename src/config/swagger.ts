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
      { name: "Fiches", description: "Fiche data and caching" },
      { name: "Recordings", description: "Recording management" },
      { name: "Transcriptions", description: "Audio transcription" },
      { name: "Audit Configs", description: "Audit configuration management" },
      { name: "Audits", description: "Audit execution and results" },
      { name: "Products", description: "Insurance products management" },
    ],
  },
  apis: ["./src/app.ts", "./src/modules/**/*.routes.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
