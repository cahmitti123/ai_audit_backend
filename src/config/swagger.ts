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
      { name: "Fiches", description: "Fiche data and caching endpoints" },
      { name: "Recordings", description: "Recording endpoints" },
      { name: "Transcriptions", description: "Audio transcription endpoints" },
      { name: "Audit Configs", description: "Audit configuration endpoints" },
      { name: "Audit", description: "Audit execution and results endpoints" },
      { name: "Product", description: "Insurance products endpoints" },
      { name: "Automation", description: "Automation endpoints" },
      { name: "Realtime", description: "Realtime SSE endpoints" },
      { name: "Chat", description: "Chat SSE endpoints" },
      { name: "Auth", description: "Authentication endpoints" },
      { name: "Admin", description: "Administration endpoints" },
      { name: "Inngest", description: "Inngest workflow endpoints" },
    ],
  },
  apis: ["./src/app.ts", "./src/modules/**/*.routes.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
